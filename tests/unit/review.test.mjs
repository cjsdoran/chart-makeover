// /api/review and the review check (CM-4, CM-5, CMS-5; spec §7, §7.1, §8): T-REV-1..4 in
// tests/test-plan.md, on a fake model (no cost).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import review from '../../netlify/functions/review.mjs';
import { fillReview, reviewContent, reviewStage } from '../../netlify/lib/stages.mjs';
import { setClientFactoryForTests } from '../../netlify/lib/anthropic.mjs';
import { STAGE_PROMPTS, loadPrompt, rulesL8L11, stageRules, stageSystemPrompt } from '../../netlify/lib/prompts.mjs';
import { REGENERATE, checkReview, quotedPassages, verdictOf, wordCount } from '../../shared/reviewCheck.js';
import { schemaText } from '../../shared/schemaCheck.js';
import { askDaniel } from '../../src/daniel/askDaniel.js';
import { fakeClient, readEvents } from '../helpers/fakeAnthropic.js';

const CODE = 'class-code';
const LEAD = 'Looking at the data, City grew commercial revenue faster than the other four clubs';
const input1 = (extra = {}) => ({ audience: 'Board of a rival club', lead: LEAD, round: 1, cap: 5, history: [], reading: { summary: 'x' }, offerMade: false, ...extra });
const body1 = (extra = {}) => ({ stage: 1, round: 1, input: input1(), attempt: 1, ...extra });
const finding = (extra = {}) => ({ id: 'S1-1', rules: ['L2'], severity: 'hardStop', location: 'Your lead', issue: 'Describes, no conclusion.', fix: 'State the finding.', ...extra });
const rev = (extra = {}) => ({
  stage: 1, round: 1, verdict: 'hardStop', findings: [finding()], whatWorks: null, declineResponses: [], offeredLead: null,
  route: null, reopenStage: null, impression: null, message: 'I stopped at your lead: it describes, it doesn\'t conclude. So what should the board do?', ...extra,
});
const post = (b) => new Request('http://localhost/api/review', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CM-Access-Code': CODE }, body: JSON.stringify(b),
});

let client;
function reply(obj) {
  client = fakeClient({ chunks: [typeof obj === 'string' ? obj : JSON.stringify(obj)] });
  setClientFactoryForTests(() => client);
}
const final = async (b) => (await readEvents(await review(post(b)))).at(-1);

beforeEach(() => {
  vi.stubEnv('CM_ACCESS_CODE', CODE);
  vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  setClientFactoryForTests();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('T-REV-1: the stage prompt (spec §8)', () => {
  it('is persona + overlay + the stage prompt with every placeholder filled, then the schema', () => {
    for (const stage of [1, 2, 3, 4, 5]) {
      const p = stageSystemPrompt(stage, schemaText('stage-review'));
      expect(p.text.startsWith(loadPrompt('persona').text)).toBe(true);
      expect(p.text).toContain(loadPrompt('overlay-chart-makeover').text);
      expect(p.text).not.toMatch(/\{\{[A-Z0-9_]+\}\}/);
      expect(p.text).toContain(schemaText('stage-review'));
      expect(p.version).toMatch(new RegExp(`^${STAGE_PROMPTS[stage]} 1\\.0; persona 1\\.0; overlay 1\\.0; rules 1\\.0`));
    }
  });

  it('inserts only the stage’s own rule table (Stage 1 with the lead shapes and actions), and L8 and L11 for Stage 5', () => {
    const library = loadPrompt('shared/rule-library').text;
    const s1 = stageSystemPrompt(1, '{}').text;
    expect(s1).toContain(stageRules(library, 1));
    expect(s1).toMatch(/Shapes of strong leads/);
    expect(s1).not.toContain('| D1 | Proves the lead');
    const s5 = stageSystemPrompt(5, '{}').text;
    expect(rulesL8L11(library).split('\n')).toHaveLength(4);
    expect(s5).toContain(rulesL8L11(library));
  });

  it('the call uses the stage model, the cached system prompt, and one JSON block (no image for Stage 1)', async () => {
    reply(rev());
    await final(body1());
    const params = client.beta.calls[0] ?? client.calls[0];
    expect(params.model).toBe('claude-opus-5-5');
    expect(params.max_tokens).toBe(1600);
    expect(params.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(JSON.parse(params.messages[0].content)).toMatchObject({ stage: 1, round: 1, lead: LEAD, offerMade: false });
  });

  it('Stages 2–4 send the image block first, then the JSON naming it', () => {
    const content = reviewContent({ stage: 2, round: 1, input: { ...input1(), image: { mediaType: 'image/jpeg', base64: 'AAAA' } } });
    expect(content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } });
    expect(JSON.parse(content[1].text).image).toBe('attached above: the chart as uploaded');
  });
});

describe('T-REV-2: strip-and-log fixes (spec §7.1)', () => {
  const check = (r, req = { stage: 1, round: 1, input: input1() }) => checkReview(fillReview(r), req);

  it('drops a finding citing only another stage’s rules (logic first), and the rule from a mixed one', () => {
    const c = check(rev({ findings: [finding(), finding({ id: 'S1-2', rules: ['C3'], severity: 'major' }), finding({ id: 'S1-3', rules: ['L9', 'P4'], severity: 'major' })] }));
    expect(c.ok).toBe(true);
    expect(c.data.findings.map((f) => f.rules)).toEqual([['L2'], ['L9']]);
    expect(c.fixes.map((f) => f.type)).toEqual(['ruleNotInStage', 'findingDropped', 'ruleNotInStage']);
  });

  it('D10 is allowed in Stage 1 (it is listed for Stages 1 and 2)', () => {
    expect(check(rev({ findings: [finding({ rules: ['D10'] })] })).data.findings).toHaveLength(1);
  });

  it('a severity the rule doesn’t allow is set to its default; the verdict follows the severities', () => {
    const c = check(rev({ verdict: 'revise', findings: [finding({ rules: ['L9'], severity: 'hardStop' })] }));
    expect(c.data.findings[0].severity).toBe('major');
    expect(c.data.verdict).toBe('revise');
    expect(c.fixes.map((f) => f.type)).toEqual(['severityCorrected']);
  });

  it('a grouped finding is at least as severe as its strictest rule requires (L6 with L1 is a hard stop)', () => {
    const c = check(rev({ verdict: 'revise', findings: [finding({ rules: ['L1', 'L10', 'L6'], severity: 'major' })] }));
    expect(c.data.findings[0].severity).toBe('hardStop');
    expect(c.data.verdict).toBe('hardStop');
    expect(c.fixes.map((f) => f.type)).toEqual(['severityRaised', 'verdictMismatch']);
    // A rule that allows two severities sets no floor above its lower one (P2: hard stop or major).
    const p2 = checkReview(fillReview(rev({ stage: 4, verdict: 'revise', findings: [finding({ rules: ['P2'], severity: 'major' })] })), { stage: 4, round: 1, input: input1() });
    expect(p2.data.findings[0].severity).toBe('major');
  });

  it('a model verdict that disagrees is corrected and logged', () => {
    const c = check(rev({ verdict: 'pass' }));
    expect(c.data.verdict).toBe('hardStop');
    expect(c.fixes).toContainEqual({ type: 'verdictMismatch', model: 'pass', engine: 'hardStop' });
  });

  it('whatWorks is nulled with a hard stop; offeredLead before round 3, a second time or on a pass is stripped', () => {
    expect(check(rev({ whatWorks: 'Nice colours.' })).data.whatWorks).toBeNull();
    expect(check(rev({ offeredLead: 'City grew fastest' })).data.offeredLead).toBeNull();
    const r3 = { stage: 1, round: 3, input: input1({ round: 3 }) };
    expect(check(rev({ round: 3, offeredLead: 'City grew fastest' }), r3).data.offeredLead).toBe('City grew fastest');
    expect(check(rev({ offeredLead: 'City grew fastest' }), { ...r3, input: input1({ round: 3, offerMade: true }) }).data.offeredLead).toBeNull();
    expect(check(rev({ verdict: 'pass', findings: [], offeredLead: 'x' }), r3).data.offeredLead).toBeNull();
  });

  it('route, reopenStage and impression are stripped outside their stages', () => {
    const c = check(rev({ route: { options: ['rewriteLead', 'nameData'] }, reopenStage: 2, impression: 'Decisive.' }));
    expect([c.data.route, c.data.reopenStage, c.data.impression]).toEqual([null, null, null]);
    const s4 = checkReview(fillReview(rev({ stage: 4, verdict: 'pass', findings: [], whatWorks: 'Clean.', impression: 'Decisive and focused.' })), { stage: 4, round: 1, input: input1() });
    expect(s4.data.impression).toBe('Decisive and focused.');
    const reupload = checkReview(fillReview(rev({ stage: 2, findings: [finding({ rules: ['D1'], severity: 'major' })], route: 'reupload' })), { stage: 2, round: 1, input: input1({ reuploadsLeft: 0 }) });
    expect(reupload.data.route).toBeNull();
  });

  it('a second push-back on the same finding becomes an accept', () => {
    const req = { stage: 2, round: 2, input: input1({ declines: [{ findingId: 'S2-1', reason: 'We only have this' }], history: [{ round: 1, findings: [{ findingId: 'S2-1', pushBack: 'Sure?' }] }] }) };
    const c = checkReview(fillReview(rev({ stage: 2, findings: [], verdict: 'pass', whatWorks: null, declineResponses: [{ findingId: 'S2-1', decision: 'pushBack', message: 'Really?' }] })), req);
    expect(c.data.declineResponses[0].decision).toBe('accept');
    expect(c.fixes.map((f) => f.type)).toContain('secondPushBackConverted');
  });
});

describe('T-REV-3: regenerate what code can’t fix (spec §7.1)', () => {
  const check = (r, req = { stage: 1, round: 1, input: input1() }) => checkReview(fillReview(r), req);
  const majors = (n) => Array.from({ length: n }, (_, i) => finding({ id: `S1-${i + 1}`, rules: [['L1', 'L5', 'L9', 'L10'][i]], severity: 'major' }));

  it('more than three blocking findings', () => {
    expect(check(rev({ verdict: 'revise', findings: majors(3) })).ok).toBe(true);
    expect(check(rev({ verdict: 'revise', findings: majors(4) })).errors).toEqual([REGENERATE.tooMany]);
  });

  it('a message over 150 words', () => {
    const long = Array.from({ length: 151 }, () => 'word').join(' ');
    expect(check(rev({ message: long })).errors).toEqual([REGENERATE.tooLong(151)]);
    expect(wordCount('£18m to £340m, a 20% rise.')).toBe(6);
  });

  it('a score; the word "score" only when the student didn’t use it', () => {
    expect(check(rev({ message: 'I’d give this 4/10.' })).errors).toEqual([REGENERATE.score]);
    expect(check(rev({ message: 'This rates 7 out of 10.' })).errors).toEqual([REGENERATE.score]);
    expect(check(rev({ message: 'Your grade here is low.' })).errors).toEqual([REGENERATE.score]);
    const scored = { stage: 1, round: 1, input: input1({ lead: 'Kestrel scores 4.2 on attractiveness' }) };
    expect(check(rev({ message: 'A 1–5 score is an artificial number; say what it means.' }), scored).ok).toBe(true);
  });

  it('a missing decline response', () => {
    const req = { stage: 2, round: 2, input: input1({ declines: [{ findingId: 'S2-1', reason: 'We only have this' }] }) };
    expect(checkReview(fillReview(rev({ stage: 2, findings: [], verdict: 'pass' })), req).errors).toEqual([REGENERATE.declineMissing(['S2-1'])]);
  });

  it('Stage 1 before round 3: a quoted rewrite of six or more words that isn’t the student’s', () => {
    expect(quotedPassages('Try “City is the fastest growing club in the League” instead.')).toHaveLength(1);
    expect(check(rev({ message: 'Try “City is the fastest growing club in the League” instead.' })).errors).toEqual([REGENERATE.leadRewrite]);
    // Quoting the student's own words is fine, and so is a short quote.
    expect(check(rev({ message: 'You open with "Looking at the data, City grew commercial revenue" and never conclude.' })).ok).toBe(true);
    expect(check(rev({ message: 'Drop "Looking at the data".' })).ok).toBe(true);
    // From round 3 it is allowed.
    const r3 = { stage: 1, round: 3, input: input1({ round: 3 }) };
    expect(check(rev({ round: 3, message: 'Try “City is the fastest growing club in the League” instead.' }), r3).ok).toBe(true);
  });

  it('verdictOf', () => {
    expect(verdictOf([{ severity: 'minor' }])).toBe('pass');
  });
});

describe('T-REV-4: the function', () => {
  it('a good reply: result with data, promptVersion, rulesVersion and the fix types', async () => {
    reply(rev({ verdict: 'pass' }));
    const ev = await final(body1());
    expect(ev).toMatchObject({ type: 'result', data: { verdict: 'hardStop', stage: 1 }, rulesVersion: expect.stringMatching(/^1\.0/), fixes: ['verdictMismatch'] });
    expect(ev.promptVersion).toMatch(/^stage1-lead 1\.0; persona/);
    const logged = console.log.mock.calls.map((c) => JSON.parse(c[0])).find((l) => l.endpoint === 'review');
    expect(logged).toMatchObject({ round: 'stage1-r1', outcome: 'ok', fixes: ['verdictMismatch'] });
    expect(JSON.stringify(logged)).not.toContain('Looking at the data');
  });

  it('a reply that needs regenerating comes back invalid; the browser retries with previousErrors', async () => {
    let n = 0;
    client = fakeClient(() => ({ chunks: [JSON.stringify(n++ === 0 ? rev({ message: 'I’d give this 4/10.' }) : rev())] }));
    setClientFactoryForTests(() => client);
    const call = async (path, b) => {
      const events = await readEvents(await review(post(b)));
      const last = events.at(-1);
      return last.type === 'result' ? { ok: true, result: last } : { ok: false, error: last.type, errors: last.errors };
    };
    const r = await askDaniel('/api/review', { stage: 1, round: 1, input: input1() }, CODE, { call });
    expect(r.ok).toBe(true);
    expect(r.attempts).toBe(2);
    const second = (client.beta.calls[1] ?? client.calls[1]).messages[0].content;
    expect(second).toContain(`<previous_errors>\n- ${REGENERATE.score}\n</previous_errors>`);
  });

  it('omitted empty fields are filled before the schema', async () => {
    const { declineResponses, route, reopenStage, impression, ...rest } = rev();
    reply(rest);
    expect((await final(body1())).type).toBe('result');
  });

  it('refuses a bad body, an image in Stage 1, and a lead over 300 characters', async () => {
    reply(rev());
    expect((await review(post(body1({ stage: 6 })))).status).toBe(400);
    expect((await review(post(body1({ input: input1({ image: { mediaType: 'image/png', base64: 'AAAA' } }) })))).status).toBe(400);
    expect((await review(post(body1({ input: input1({ lead: 'x'.repeat(301) }) })))).status).toBe(413);
    expect((await review(post(body1({ input: input1({ lead: '  ' }) })))).status).toBe(400);
  });

  it('reviewStage reads a reply in-process for the pilot, with the fixes', () => {
    const r = reviewStage(body1()).read(JSON.stringify(rev({ whatWorks: 'Bold.' })));
    expect(r.ok).toBe(true);
    expect(r.fixes.map((f) => f.type)).toEqual(['whatWorksStripped']);
  });
});
