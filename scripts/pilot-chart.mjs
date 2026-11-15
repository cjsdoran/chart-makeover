// The chart-stage pilot, P-2 (build brief, milestone 5; tests/test-plan.md). Drives the real stage
// engine through Stages 2–5 for each calibration case with chart stages, as a student who accepts
// every fix (calibration/README.md step 3), with the same review cores and retries as the browser.
//
//   node scripts/pilot-chart.mjs                 dry run: builds every Stage 2 request; no model calls
//   node scripts/pilot-chart.mjs --yes           real model calls: costs money; run when Chris asks
//   node scripts/pilot-chart.mjs --rescore --out <dir>   re-check saved replies with the current check (no calls)
//   options: --only C01,C08   --readings <dir> (default pilot/read-test, from RT-1)   --out <dir>
//
// Stage 1 is not reviewed here: the case's agreedLead (or pilotLead, Claude's stand-in) is applied
// as a passing lead. The reading comes from RT-1's saved readings; the image is prepared from the
// calibration file exactly as the browser does, so pptx cases carry no image, as in the app.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSession } from '../src/store/session.js';
import { readingPatch } from '../src/upload/sendChart.js';
import {
  acceptAllMinor, acceptFinding, applyReview, checklistState, chooseNameData, confirmFit, confirmReading,
  continueStage, currentStage, openMinors, reviewRequest, setComparison, stageFindings, submitLead,
} from '../src/engine/engine.js';
import { checkReview, wordCount } from '../shared/reviewCheck.js';
import { config } from '../shared/limits.js';
import { reviewStage } from '../netlify/lib/stages.mjs';
import { loadEnv, prepare } from './read-test.mjs';
import { reviewWithRetries } from './pilot-run.mjs';

const SEVERITY_RANK = { hardStop: 0, major: 1, minor: 2, suggestion: 3 };
const SEVERITY_WORDS = { hardStop: 'Hard stop', major: 'Major', minor: 'Minor', suggestion: 'Suggestion' };
const csv = (v) => (v === null || v === undefined ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

/**
 * The simulated student's Stage 3 answer and dummy tick, per case: Claude's stand-ins (not in
 * expected.json), the comparison each agreed lead makes, so the pilot tests the chart critique.
 */
export const PILOT_STUDENT = {
  C01: { comparison: 'Time' },
  C02: { comparison: 'Relationship' },
  C03: { comparison: 'Time' },
  C05: { comparison: 'Items' },
  C06: { comparison: 'Items', isDummy: true },
  C07: { comparison: 'Time' },
  C08: { comparison: 'Relationship' },
  C09: { comparison: 'Items' },
  C10: { comparison: 'Framework' },
};
const NAME_DATA = 'The data Daniel named (pilot student)';

const ok = (r) => {
  if (r.error) throw new Error(`Engine refused a pilot step: ${r.error}`);
  return r.session;
};

/** A session at Stage 2 for a case: the upload read, the lead agreed, the reading confirmed. */
export function stage2Session(c, reading, image1600, { isDummy = false, reuploadsLeft, leadChanged = false } = {}) {
  let s = { ...createSession(), step: 'upload' };
  const prepared = { meta: { fileName: c.file.split('/').pop() }, upload: { kind: 'pilot' }, record: image1600 };
  const { patch } = readingPatch(s, { prepared, result: { reading }, audience: c.audience, isDummy });
  s = { ...s, ...patch };
  s = ok(submitLead(s, leadOf(c).text));
  s = applyReview(s, { stage: 1, verdict: 'pass', findings: [], message: '(pilot: the agreed lead)', whatWorks: null, offeredLead: null, route: null, reopenStage: null, impression: null, declineResponses: [] });
  if (reuploadsLeft !== undefined) s = { ...s, run: { ...s.run, reuploadsLeft } };
  s = ok(confirmReading(s, null));
  if (leadChanged) s = { ...s, run: { ...s.run, pending: { stage: 2, leadChanged: true } } };
  return s;
}

export function leadOf(c) {
  return c.agreedLead ? { text: c.agreedLead.text, from: 'Chris' } : { text: c.pilotLead.text, from: 'Claude (pilotLead stand-in)' };
}

/** A synthetic Stage 2 pass, to start a path at Stage 3 (C08 path B). */
const STAGE2_PASS = { stage: 2, verdict: 'pass', findings: [], message: '(pilot: Stage 2 skipped)', whatWorks: null, offeredLead: null, route: null, reopenStage: null, impression: null, declineResponses: [] };

/**
 * Runs one path through the engine. `review(request)` returns `{ ok, data, tries, ... }`.
 * Returns the calls made and the student's choices.
 */
export async function drivePath(start, student, review, { stopAfterStage2Route = false } = {}) {
  let s = start;
  const calls = [];
  const notes = [];
  for (let step = 0; step < 80; step++) {
    if (s.step === 'changes') break;
    if (s.run.pending) {
      const request = reviewRequest(s);
      const result = await review(request);
      calls.push({ stage: request.stage, round: request.round, request, result });
      if (!result.ok) {
        notes.push(`Stage ${request.stage}: no valid review after the retries; the path stops.`);
        break;
      }
      s = applyReview(s, result.data);
      continue;
    }
    if (s.run.awaitingReupload) {
      notes.push('Daniel asked for a redrawn chart (route "reupload").');
      if (stopAfterStage2Route) break;
      notes.push('The pilot has no redrawn chart to upload; the path stops.');
      break;
    }
    const stage = currentStage(s);
    if (s.run.route) {
      notes.push(`Stage ${s.run.route.stage}: Daniel offered the routes (${s.run.route.options.join(', ')}); the pilot student kept the lead and named the data.`);
      s = ok(chooseNameData(s, NAME_DATA));
      continue;
    }
    if (stage === 3 && !s.run.comparison) {
      s = ok(setComparison(s, student.comparison));
      continue;
    }
    if (stage >= 2 && stage <= 5) {
      const open = stageFindings(s.run, stage).filter((f) => f.status === 'open' || f.status === 'pushedBack');
      if (stage <= 4 && openMinors(s.run, stage).length) {
        s = ok(acceptAllMinor(s, stage));
        continue;
      }
      if (open.length) {
        s = ok(acceptFinding(s, open[0].id));
        continue;
      }
      if (stage <= 4 && checklistState(s.run, stage) === 'minors') {
        s = ok(continueStage(s));
        continue;
      }
      if (stage === 5) {
        const last = s.run.reviews.filter((r) => r.stage === 5).at(-1);
        if (last?.reopenStage) notes.push(`Stage 5: Daniel suggested reopening Stage ${last.reopenStage}; the pilot student confirmed the page instead.`);
        s = ok(confirmFit(s));
        continue;
      }
    }
    notes.push(`The pilot stopped at step "${s.step}" with nothing to do.`);
    break;
  }
  return { calls, notes, session: s };
}

// ---------- the judge ----------

// A finding counts when it cites one of the rules, or (mustCatch `textMatch`, D66) when its issue or
// fix says the point in words under another rule.
const hits = (calls, rules, stages, textMatch) => calls.filter((c) => c.result.ok && (!stages || stages.includes(c.stage)))
  .flatMap((c) => c.result.data.findings.filter((f) => f.rules.some((r) => rules.includes(r))
    || (textMatch && new RegExp(textMatch, 'i').test(`${f.issue} ${f.fix}`))).map((f) => ({ ...f, stage: c.stage })));
const describe = (fs) => (fs.length ? `found ${fs.map((f) => `S${f.stage} ${f.rules.join('/')} ${f.severity}`).join('; ')}` : 'not raised');

/**
 * Judges a case's chart-stage calls against expected.json `chartStages`: each mustCatch at one of its
 * stages and its severity (or grouped into a more severe finding), raised once when it spans two
 * stages; the machine-checkable mustNot items; the route; and globalMustNot per call.
 */
export function judgeChartStages(exp, calls, global) {
  const checks = [];
  const add = (check, okay, detail = '') => checks.push({ check, ok: okay, detail });
  for (const m of exp.mustCatch ?? []) {
    const inStage = hits(calls, m.rules, m.stages, m.textMatch);
    const atSeverity = inStage.filter((f) => m.severity === 'any' || f.severity === m.severity);
    // Grouped into a more severe finding: by its rules, or said in words under another rule (textMatch).
    const grouped = inStage.filter((f) => !atSeverity.includes(f) && (f.rules.length > 1 || !f.rules.some((r) => m.rules.includes(r))) && SEVERITY_RANK[f.severity] < SEVERITY_RANK[m.severity]);
    const elsewhere = hits(calls, m.rules).filter((f) => !m.stages.includes(f.stage));
    const detail = `${describe(inStage)}${elsewhere.length ? `; also ${describe(elsewhere).replace('found ', '')} outside Stage ${m.stages.join('/')}` : ''}${!atSeverity.length && grouped.length ? ' (grouped into a more severe finding: for Chris)' : ''}`;
    add(`mustCatch S${m.stages.join('/')} ${m.rules.join('/')} (${m.severity})`, atSeverity.length > 0 || grouped.length > 0, detail);
    if (m.stages.length > 1) add(`raised once: ${m.rules.join('/')}`, inStage.length <= 1, describe(inStage));
  }
  for (const m of exp.optional ?? []) {
    checks.push({ check: `optional S${m.stages.join('/')} ${m.rules.join('/')} (${m.severity})`, ok: null, detail: describe(hits(calls, m.rules, m.stages)) });
  }
  const forChris = [];
  const okCalls = calls.filter((c) => c.result.ok);
  for (const text of exp.mustNot ?? []) {
    const rule = /^([LDCPF]\d{1,2})\b/.exec(text);
    if (/^P1 at hard-stop severity/i.test(text)) add(`mustNot: ${text}`, !hits(calls, ['P1']).some((f) => f.severity === 'hardStop'));
    else if (rule) add(`mustNot: ${text}`, hits(calls, [rule[1]]).length === 0, describe(hits(calls, [rule[1]])));
    else if (/^A hard stop or major in Stages 2.3/i.test(text)) {
      const blocking = okCalls.filter((c) => c.stage <= 3).flatMap((c) => c.result.data.findings.filter((f) => SEVERITY_RANK[f.severity] <= 1).map((f) => ({ ...f, stage: c.stage })));
      add(`mustNot: ${text}`, blocking.length === 0, describe(blocking));
    } else if (/^whatWorks in Stage 4/i.test(text)) add(`mustNot: ${text}`, !okCalls.some((c) => c.stage === 4 && c.result.data.whatWorks));
    else forChris.push(text);
  }
  if (exp.whatWorks) forChris.push(`whatWorks should include: "${exp.whatWorks}" (Daniel said: ${okCalls.map((c) => c.result.data.whatWorks).filter(Boolean).map((w) => `"${w}"`).join('; ') || 'nothing'})`);
  const routes = okCalls.filter((c) => c.result.data.route).map((c) => `S${c.stage} ${typeof c.result.data.route === 'string' ? c.result.data.route : c.result.data.route.options.join('/')}`);
  if (exp.expectRoute === 'reupload') {
    const first2 = okCalls.find((c) => c.stage === 2);
    add('route: reupload at Stage 2', first2?.result.data.route === 'reupload', routes.join('; ') || 'no route');
  } else {
    add('route: none', routes.length === 0, routes.join('; ') || 'no route');
  }
  for (const c of okCalls) {
    const d = c.result.data;
    const tag = `S${c.stage} r${c.round}`;
    add(`global ${tag}: no score`, !/\b\d+(\.\d+)?\s*(\/|out of)\s*(5|10|100)\b/i.test(d.message));
    add(`global ${tag}: whatWorks null with a hard stop`, !(d.verdict === 'hardStop' && d.whatWorks));
    if (c.stage === 2) add(`global ${tag}: no C or P rules`, !d.findings.some((f) => f.rules.some((r) => /^[CP]/.test(r))));
    if (c.stage === 3) add(`global ${tag}: no P rules`, !d.findings.some((f) => f.rules.some((r) => /^P/.test(r))));
    add(`global ${tag}: message ≤ ${config.caps.messageWordsMax} words`, wordCount(d.message) <= config.caps.messageWordsMax, `${wordCount(d.message)} words`);
  }
  forChris.push(...global.filter((g) => /typo that isn't on the page/i.test(g)));
  return { checks, forChris, ok: checks.every((x) => x.ok !== false) };
}

// ---------- report ----------

function callSection(c) {
  const r = c.result;
  const lines = [`### Stage ${c.stage}, round ${c.round}`, ''];
  lines.push(`Calls: ${r.tries.map((t) => `attempt ${t.attempt} ${t.outcome} ${(t.ms / 1000).toFixed(1)} s${t.outputTokens ? ` (${t.inputTokens} in / ${t.outputTokens} out)` : ''}${t.fixes?.length ? ` · fixes: ${t.fixes.join(', ')}` : ''}${t.errors ? ` · regenerate: ${t.errors.join(' ')}` : ''}`).join('; ')}`, '');
  if (!r.ok) return [...lines, '**No valid review after the retries.**', ''].join('\n');
  const d = r.data;
  const extra = [d.route ? `route ${typeof d.route === 'string' ? d.route : d.route.options.join('/')}` : null, d.reopenStage ? `reopen Stage ${d.reopenStage}` : null].filter(Boolean);
  lines.push(`**Verdict:** ${d.verdict}${extra.length ? ` · ${extra.join(' · ')}` : ''}`, '');
  lines.push('| ID | Rules | Severity | Location | Issue | Fix |', '| --- | --- | --- | --- | --- | --- |');
  for (const f of d.findings) lines.push(`| ${f.id} | ${f.rules.join(', ')} | ${SEVERITY_WORDS[f.severity]} | ${f.location.replace(/\|/g, '/')} | ${f.issue.replace(/\|/g, '/')} | ${f.fix.replace(/\|/g, '/')} |`);
  if (!d.findings.length) lines.push('| — | | | | | |');
  lines.push('', `**Daniel's message** (${wordCount(d.message)} words):`, '', `> ${d.message.replace(/\n/g, '\n> ')}`, '');
  if (d.whatWorks) lines.push(`**What works:** ${d.whatWorks}`, '');
  if (d.impression) lines.push(`**Impression:** ${d.impression}`, '');
  return lines.join('\n');
}

function caseReport(id, c, paths, judged) {
  const lead = leadOf(c);
  const st = PILOT_STUDENT[id];
  const lines = [`## ${id}`, '', `**Audience:** ${c.audience}`, '', `**Agreed lead** (${lead.from}): ${lead.text}`, '',
    `**Pilot student:** comparison "${st.comparison}"${st.isDummy ? ', dummy chart ticked' : ''}; accepts every fix.`, ''];
  for (const p of paths) {
    if (paths.length > 1) lines.push(`**Path ${p.name}:** ${p.about}`, '');
    if (p.notes.length) lines.push(...p.notes.map((n) => `- ${n}`), '');
    lines.push(...p.calls.map(callSection));
  }
  lines.push('**Checks**', '', '| Check | | Detail |', '| --- | --- | --- |');
  for (const ch of judged.checks) lines.push(`| ${ch.check} | ${ch.ok === null ? '·' : ch.ok ? '✓' : '✗'} | ${ch.detail.replace(/\|/g, '/')} |`);
  lines.push('', '**For Chris to judge:**', '', ...judged.forChris.map((t) => `- [ ] ${t}`), '');
  return lines.join('\n');
}

// ---------- main ----------

async function main() {
  loadEnv();
  const args = process.argv.slice(2);
  const flag = (name) => args.includes(name);
  const option = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
  };
  const live = flag('--yes');
  const rescore = flag('--rescore');
  const only = option('--only', '').split(',').filter(Boolean);
  const readings = option('--readings', join('pilot', 'read-test'));
  const out = option('--out', join('pilot', `run-${new Date().toISOString().slice(0, 10)}-chart`));
  const expected = JSON.parse(readFileSync('calibration/expected.json', 'utf8'));
  const ids = Object.keys(expected.cases).filter((id) => expected.cases[id].chartStages && (!only.length || only.includes(id)));
  if (live && !rescore && !process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is not set (environment or .env). Nothing was sent.');
    process.exit(1);
  }
  const ms = [2, 3, 4, 5].map((n) => config.models[`stage${n}`]);
  console.log(rescore ? `Rescoring the saved chart-stage replies in ${out}; no model calls.`
    : live ? `Chart-stage pilot: ${ids.length} cases, REAL model calls (${ms[0].model}, effort ${ms[0].effort}, max ${ms.map((m) => m.maxTokens).join('/')} tokens).`
      : `Dry run: ${ids.length} cases to Stage 2's request; no model calls.`);
  mkdirSync(out, { recursive: true });

  const summary = [];
  const sections = [];
  const points = [['case', 'stage', 'round', 'kind', 'rules', 'severity', 'text', 'agree (Y/N)', 'note']];
  const timings = [['case', 'stage', 'round', 'attempt', 'ms', 'outcome', 'inputTokens', 'outputTokens', 'servedBy', 'fixes']];
  for (const id of ids) {
    const c = expected.cases[id];
    const exp = c.chartStages;
    const st = PILOT_STUDENT[id];
    const reading = JSON.parse(readFileSync(join(readings, `${id}.reading.json`), 'utf8'));
    const prepared = await prepare(join('calibration', c.file));
    const image = prepared.ok ? prepared.record ?? null : null;
    const savedFile = join(out, `${id}.chart.json`);
    const saved = rescore ? JSON.parse(readFileSync(savedFile, 'utf8')) : null;

    // The review function per path: live, saved (rescore) or a dry run that stops at the first request.
    const reviewFor = (pathName) => {
      let i = 0;
      return async (request) => {
        if (rescore) {
          const prev = saved.paths.find((p) => p.name === pathName)?.calls[i++];
          if (!prev) return { ok: false, tries: [] };
          const r = prev.result;
          if (r.ok) {
            const c2 = checkReview(r.data, request);
            if (c2.ok) r.data = c2.data;
          }
          return r;
        }
        if (!live) return { ok: false, tries: [], dry: true };
        return reviewWithRetries(request);
      };
    };

    const plan = id === 'C08'
      ? [
        { name: 'A', about: 'Stage 2 after a rewritten lead (leadChanged true, one re-upload left): expect route "reupload".', start: stage2Session(c, reading, image, { isDummy: st.isDummy, reuploadsLeft: 1, leadChanged: true }), opts: { stopAfterStage2Route: true } },
        { name: 'B', about: 'Stages 3–5 on the original chart, no re-upload left (Stage 2 skipped).', start: applyReview(stage2Session(c, reading, image, { isDummy: st.isDummy, reuploadsLeft: 0 }), STAGE2_PASS), opts: {} },
      ]
      : [{ name: 'main', about: '', start: stage2Session(c, reading, image, { isDummy: st.isDummy }), opts: {} }];

    if (!live && !rescore) {
      for (const p of plan) {
        const at = p.start.run.pending ? p.start : ok(setComparison(p.start, st.comparison));
        const request = reviewRequest(at);
        const stage = reviewStage({ ...request, attempt: 1 });
        console.log(`${id}${plan.length > 1 ? ` ${p.name}` : ''}: Stage ${request.stage} request ready (${JSON.stringify({ ...request.input, image: undefined }).length} chars of input${request.input.image ? ', with image' : ', no image'}; prompt ${stage.promptVersion}).`);
      }
      continue;
    }

    const paths = [];
    for (const p of plan) {
      const r = await drivePath(p.start, st, reviewFor(p.name), p.opts);
      paths.push({ name: p.name, about: p.about, notes: r.notes, calls: r.calls.map(({ stage, round, result }) => ({ stage, round, result })) });
    }
    writeFileSync(savedFile, JSON.stringify({ id, paths }, null, 2));
    const calls = paths.flatMap((p) => p.calls);
    const judged = judgeChartStages(exp, calls, expected.globalMustNot);
    const misses = judged.checks.filter((x) => x.ok === false);
    const total = calls.reduce((n, cl) => n + cl.result.tries.reduce((m, t) => m + t.ms, 0), 0);
    summary.push({ id, ok: judged.ok, calls: calls.length, attempts: calls.reduce((n, cl) => n + cl.result.tries.length, 0), ms: total,
      line: judged.ok ? `PASS (${judged.checks.length} checks)` : `${misses.length} miss(es): ${misses.map((x) => x.check).join('; ')}` });
    sections.push(caseReport(id, c, paths, judged));
    for (const cl of calls) {
      cl.result.tries.forEach((t) => timings.push([id, cl.stage, cl.round, t.attempt, t.ms, t.outcome, t.inputTokens, t.outputTokens, t.servedBy, (t.fixes ?? []).join(' ')]));
      if (!cl.result.ok) continue;
      cl.result.data.findings.forEach((f) => points.push([id, cl.stage, cl.round, 'finding', f.rules.join(' '), f.severity, `${f.issue} Fix: ${f.fix}`, '', '']));
      points.push([id, cl.stage, cl.round, 'message', '', cl.result.data.verdict, cl.result.data.message, '', '']);
    }
    console.log(`${id}: ${summary.at(-1).line} [${calls.map((cl) => `S${cl.stage} ${cl.result.tries.map((t) => `${(t.ms / 1000).toFixed(1)} s ${t.outcome}`).join('/')}`).join(', ')}]`);
  }
  if (!live && !rescore) return;

  const okMs = timings.slice(1).filter((t) => t[5] === 'ok').map((t) => t[4]).sort((a, b) => a - b);
  const p95 = okMs.length ? okMs[Math.min(okMs.length - 1, Math.ceil(okMs.length * 0.95) - 1)] : null;
  const byStage = [2, 3, 4, 5].map((n) => {
    const t = timings.slice(1).filter((r) => r[1] === n && r[5] === 'ok').map((r) => r[4]).sort((a, b) => a - b);
    return t.length ? `Stage ${n}: ${t.length} calls, slowest ${(t.at(-1) / 1000).toFixed(1)} s` : null;
  }).filter(Boolean);
  const report = [
    '# Pilot P-2: chart stages (milestone 5)', '',
    `${rescore ? 'Rescored (saved replies, current review check), ' : 'Live, '}${new Date().toISOString()}, ${ms[0].model}, effort ${ms[0].effort}. Readings from ${readings}; the student accepts every fix.`, '',
    `Valid replies: ${okMs.length}; p95 ${p95 ? (p95 / 1000).toFixed(1) : '—'} s; slowest ${okMs.length ? (okMs.at(-1) / 1000).toFixed(1) : '—'} s (target: 95% ≤ 20 s, none over 24 s). ${byStage.join('; ')}.`, '',
    '| Case | Result | Reviews | Attempts | Time |', '| --- | --- | --- | --- | --- |',
    ...summary.map((s) => `| ${s.id} | ${s.line.replace(/\|/g, '/')} | ${s.calls} | ${s.attempts} | ${(s.ms / 1000).toFixed(1)} s |`), '',
    'Misses are prompt or rule questions for Chris; nothing has been changed to make them pass. The comparison answers are Claude\'s stand-ins (`PILOT_STUDENT` in the script), and so are the pilotLead leads (C05, C06). `points.csv` has one row per finding and message for Chris to mark.', '',
    ...sections,
  ].join('\n');
  writeFileSync(join(out, 'report.md'), report);
  writeFileSync(join(out, 'points.csv'), points.map((r) => r.map(csv).join(',')).join('\n'));
  writeFileSync(join(out, 'timings.csv'), timings.map((r) => r.map(csv).join(',')).join('\n'));
  console.log(`Written to ${out}`);
}

if (process.argv[1]?.endsWith('pilot-chart.mjs')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
