// The pilot's Stage 1 judge (milestone 4): mustCatch by rule and severity, rule-named mustNot items,
// and the global checks; the rest is listed for Chris.
import { describe, expect, it } from 'vitest';
import { judgeStage1, stage1Request } from '../../scripts/pilot-run.mjs';

const f = (rules, severity) => ({ id: 'S1-1', rules, severity, location: 'lead', issue: 'i', fix: 'f' });
const data = (findings, extra = {}) => ({ verdict: 'hardStop', findings, whatWorks: null, offeredLead: null, message: 'Short message.', ...extra });
const exp = {
  verdict: 'hardStop',
  mustCatch: [{ stages: [1], rules: ['L2', 'L6'], severity: 'hardStop', point: 'p' }, { stages: [1], rules: ['L9', 'L10'], severity: 'major', point: 'p' }],
  mustNot: ['L7 as a fault (Chris: it is insightful)', 'Any comment on the chart'],
};

describe('judgeStage1', () => {
  it('passes when every mustCatch is raised at its severity and no rule-named mustNot is', () => {
    const j = judgeStage1(exp, data([f(['L6'], 'hardStop'), f(['L9', 'L10'], 'major')]), []);
    expect(j.ok).toBe(true);
    expect(j.forChris).toEqual(['Any comment on the chart']);
  });

  it('misses a wrong severity, a rule-named mustNot and the verdict', () => {
    const j = judgeStage1(exp, data([f(['L6'], 'major'), f(['L10'], 'major'), f(['L7'], 'hardStop')], { verdict: 'revise' }), []);
    expect(j.checks.filter((c) => c.ok === false).map((c) => c.check)).toEqual([
      'verdict', 'mustCatch L2/L6 (hardStop)', 'mustNot: L7 as a fault (Chris: it is insightful)',
    ]);
  });

  it('builds one round with the student’s lead', () => {
    expect(stage1Request({ audience: 'a', studentLead: 'b' }, { summary: 's' })).toEqual({
      stage: 1, round: 1, input: { audience: 'a', lead: 'b', round: 1, cap: 5, history: [], reading: { summary: 's' }, offerMade: false },
    });
  });
});

// P-2 (milestone 5): the chart-stage driver on the real engine with scripted replies, and its judge.
import { drivePath, judgeChartStages, stage2Session } from '../../scripts/pilot-chart.mjs';

const CASE = { file: 'inputs/x.pdf', audience: 'The board', agreedLead: { text: 'Man City grew fastest' } };
const READING = { readable: true, kind: 'data', summary: 'A line chart of revenue.', texts: {}, chart: {} };
const reply = (stage, findings, extra = {}) => ({
  ok: true, tries: [{ attempt: 1, ms: 5, outcome: 'ok' }],
  data: { stage, verdict: 'pass', findings: findings.map((x, i) => ({ id: `S${stage}-${i + 1}`, location: 'chart', issue: 'i', fix: 'f', ...x })), message: 'Short.', whatWorks: null, offeredLead: null, route: null, reopenStage: null, impression: null, declineResponses: [], ...extra },
});
const scripted = (byStage) => async (request) => byStage[request.stage].shift();

describe('P-2 driver', () => {
  it('accepts every fix, answers the comparison and confirms the page: one review per stage', async () => {
    const review = scripted({
      2: [reply(2, [{ rules: ['D1'], severity: 'major' }, { rules: ['D4'], severity: 'minor' }], { verdict: 'revise' })],
      3: [reply(3, [{ rules: ['C11'], severity: 'major' }], { verdict: 'revise' })],
      4: [reply(4, [{ rules: ['P4'], severity: 'minor' }])],
      5: [reply(5, [])],
    });
    const r = await drivePath(stage2Session(CASE, READING, null), { comparison: 'Time' }, review);
    expect(r.calls.map((c) => c.stage)).toEqual([2, 3, 4, 5]);
    expect(r.session.step).toBe('changes');
    expect(r.session.run.comparison).toEqual({ type: 'Time', other: null });
    expect(Object.values(r.session.run.findings).filter((x) => x.stage > 1).every((x) => x.status === 'accepted')).toBe(true);
    // Stage 5 saw the accepted fixes on the planned page.
    expect(r.calls[3].request.input.plannedPage.acceptedFixes.map((x) => x.rules[0])).toEqual(['D1', 'D4', 'C11', 'P4']);
  });

  it('C08 path A: stops at the re-upload route; the Stage 2 request says leadChanged with one re-upload left', async () => {
    const review = scripted({ 2: [reply(2, [{ rules: ['D1'], severity: 'major' }], { verdict: 'revise', route: 'reupload' })] });
    const r = await drivePath(stage2Session(CASE, READING, null, { reuploadsLeft: 1, leadChanged: true }), { comparison: 'Relationship' }, review, { stopAfterStage2Route: true });
    expect(r.calls[0].request.input).toMatchObject({ leadChanged: true, reuploadsLeft: 1 });
    expect(r.notes[0]).toMatch(/redrawn chart/);
  });

  it('the judge: stage, severity, raised once across stages, rule-named mustNot, route and the global checks', () => {
    const calls = [
      { stage: 2, round: 1, result: reply(2, [{ rules: ['D3'], severity: 'major' }]) },
      { stage: 3, round: 1, result: reply(3, [{ rules: ['C3'], severity: 'major' }, { rules: ['P4'], severity: 'minor' }]) },
    ];
    const j = judgeChartStages({
      mustCatch: [{ stages: [2, 3], rules: ['D3', 'C3'], severity: 'major' }, { stages: [3], rules: ['C11'], severity: 'major' }],
      mustNot: ['P1 at hard-stop severity', 'Calling the chart good'], expectRoute: null,
    }, calls, []);
    const failed = j.checks.filter((c) => c.ok === false).map((c) => c.check);
    expect(failed).toEqual(['raised once: D3/C3', 'mustCatch S3 C11 (major)', 'global S3 r1: no P rules']);
    expect(j.forChris).toEqual(['Calling the chart good']);
    expect(judgeChartStages({ mustCatch: [], expectRoute: 'reupload' }, [{ stage: 2, round: 1, result: reply(2, [], { route: 'reupload' }) }], []).ok).toBe(true);
  });
});

describe('P-2 judge: textMatch (D66)', () => {
  it('counts a point said in words under another rule, as grouped, and only when the words match', () => {
    const exp = { mustCatch: [{ stages: [3, 4], rules: ['P13'], severity: 'minor', textMatch: 'dividers?.{0,120}label' }], expectRoute: null };
    const said = [{ stage: 3, round: 1, result: reply(3, [{ rules: ['C12'], severity: 'major', fix: 'Rebuild the dividers at 3.0 and label each one.' }]) }];
    const j = judgeChartStages(exp, said, []);
    expect(j.checks.find((c) => c.check.startsWith('mustCatch')).ok).toBe(true);
    const silent = [{ stage: 3, round: 1, result: reply(3, [{ rules: ['C12'], severity: 'major', fix: 'Swap the axes.' }]) }];
    expect(judgeChartStages(exp, silent, []).checks.find((c) => c.check.startsWith('mustCatch')).ok).toBe(false);
  });
});
