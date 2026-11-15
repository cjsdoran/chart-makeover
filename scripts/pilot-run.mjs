// The pilot harness (build brief, milestone 4: Stage 1 only; milestones 5 and 8 add the chart
// stages and the redraw). Runs the same cores as /api/review in-process, with the browser's retries,
// and judges each reply against calibration/expected.json.
//
//   node scripts/pilot-run.mjs                 dry run: builds every Stage 1 request; no model calls
//   node scripts/pilot-run.mjs --yes           real model calls: costs money; run when Chris asks
//   node scripts/pilot-run.mjs --rescore --out <dir>   re-check saved replies with the current check (no calls)
//   options: --only C01,C06   --readings <dir> (default pilot/read-test, from RT-1)   --out <dir>
//
// Stage 1 is one round with the student's lead and the audience line (calibration/README.md). The
// reading comes from the read test's saved readings, so no read calls are repeated.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { callModel } from '../netlify/lib/anthropic.mjs';
import { reviewStage } from '../netlify/lib/stages.mjs';
import { checkReview, wordCount } from '../shared/reviewCheck.js';
import { config } from '../shared/limits.js';
import { loadEnv } from './read-test.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const SEVERITY_RANK = { hardStop: 0, major: 1, minor: 2, suggestion: 3 };
const SEVERITY_WORDS = { hardStop: 'Hard stop', major: 'Major', minor: 'Minor', suggestion: 'Suggestion' };
const csv = (v) => (v === null || v === undefined ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

/** One review with the browser's retries (spec §7 step 5): invalid replies go back with previousErrors. */
export async function reviewWithRetries(request) {
  let previousErrors = [];
  const tries = [];
  for (let attempt = 1; attempt <= config.replyMaxAttempts; attempt++) {
    const stage = reviewStage({ ...request, attempt, ...(previousErrors.length ? { previousErrors } : {}) });
    const startedAt = Date.now();
    const reply = await callModel({ ...stage, startedAt });
    const ms = Date.now() - startedAt;
    if (!reply.ok) {
      tries.push({ attempt, ms, outcome: reply.error });
      previousErrors = reply.error === 'truncated' ? [stage.truncatedError] : [];
      continue;
    }
    const r = stage.read(reply.text);
    tries.push({
      attempt, ms, outcome: r.ok ? 'ok' : 'invalid', errors: r.ok ? undefined : r.errors, fixes: r.fixes.map((f) => f.type),
      inputTokens: reply.inputTokens, outputTokens: reply.outputTokens, servedBy: reply.servedBy,
    });
    if (r.ok) return { ok: true, data: r.data, fixes: r.fixes, tries, promptVersion: stage.promptVersion };
    previousErrors = r.errors;
  }
  return { ok: false, tries };
}

/** Stage 1's request for a case (calibration/README.md step 2). */
export function stage1Request(c, reading) {
  return {
    stage: 1, round: 1,
    input: { audience: c.audience, lead: c.studentLead, round: 1, cap: config.caps.leadRounds, history: [], reading, offerMade: false },
  };
}

/**
 * Judges a Stage 1 review against expected.json: the verdict, each mustCatch (a finding citing any of
 * its rules, at its severity unless "any"), the machine-checkable mustNot items, and globalMustNot.
 * Anything only a reader can judge is listed for Chris.
 */
export function judgeStage1(exp, data, global) {
  const checks = [];
  const add = (check, ok, detail = '') => checks.push({ check, ok, detail });
  add('verdict', data.verdict === exp.verdict, `expected ${exp.verdict}, got ${data.verdict}`);
  for (const m of exp.mustCatch ?? []) {
    const hit = data.findings.filter((f) => f.rules.some((r) => m.rules.includes(r)));
    const atSeverity = hit.filter((f) => m.severity === 'any' || f.severity === m.severity);
    // Raised inside a more severe finding that groups it with another rule (the prompts ask for one
    // finding per root cause): counted, and flagged for Chris.
    const grouped = hit.filter((f) => !atSeverity.includes(f) && f.rules.length > 1 && SEVERITY_RANK[f.severity] < SEVERITY_RANK[m.severity]);
    const found = hit.length ? `found ${hit.map((f) => `${f.rules.join('/')} ${f.severity}`).join('; ')}` : 'not raised';
    add(`mustCatch ${m.rules.join('/')} (${m.severity})`, atSeverity.length > 0 || grouped.length > 0,
      atSeverity.length || !grouped.length ? found : `${found} (grouped into a more severe finding: for Chris)`);
  }
  for (const m of exp.optional ?? []) {
    const hit = data.findings.filter((f) => f.rules.some((r) => m.rules.includes(r)));
    checks.push({ check: `optional ${m.rules.join('/')} (${m.severity})`, ok: null, detail: hit.length ? `raised: ${hit.map((f) => `${f.rules.join('/')} ${f.severity}`).join('; ')}` : 'not raised' });
  }
  const forChris = [];
  for (const text of exp.mustNot ?? []) {
    const rule = /^([LDCPF]\d{1,2})\b/.exec(text);
    if (rule) add(`mustNot: ${text}`, !data.findings.some((f) => f.rules.includes(rule[1])));
    else if (/^A hard stop\b/i.test(text)) add(`mustNot: ${text}`, !data.findings.some((f) => f.severity === 'hardStop'));
    else if (/^offeredLead$/i.test(text)) add(`mustNot: ${text}`, data.offeredLead === null);
    else if (/^whatWorks$/i.test(text)) add(`mustNot: ${text}`, !data.whatWorks);
    else forChris.push(text);
  }
  // globalMustNot, as far as code can tell (the review check has already fixed the strippable ones).
  add('global: no score', !/\b\d+(\.\d+)?\s*(\/|out of)\s*(5|10|100)\b/i.test(data.message));
  add('global: no offeredLead in round 1', data.offeredLead === null);
  add('global: whatWorks null with a hard stop', !(data.verdict === 'hardStop' && data.whatWorks));
  add('global: no C or P rules in Stage 1', !data.findings.some((f) => f.rules.some((r) => /^[CP]/.test(r))));
  add(`global: message ≤ ${config.caps.messageWordsMax} words`, wordCount(data.message) <= config.caps.messageWordsMax, `${wordCount(data.message)} words`);
  forChris.push(...global.filter((g) => /typo that isn't on the page/i.test(g)));
  return { checks, forChris, ok: checks.every((c) => c.ok !== false) };
}

function caseReport(id, c, result, judged) {
  const lines = [`## ${id}`, '', `**Audience:** ${c.audience}`, '', `**Student's lead:** ${c.studentLead}`, ''];
  lines.push(`Calls: ${result.tries.map((t) => `attempt ${t.attempt} ${t.outcome} ${(t.ms / 1000).toFixed(1)} s${t.outputTokens ? ` (${t.inputTokens} in / ${t.outputTokens} out)` : ''}${t.fixes?.length ? ` · fixes: ${t.fixes.join(', ')}` : ''}${t.errors ? ` · regenerate: ${t.errors.join(' ')}` : ''}`).join('; ')}`, '');
  if (!result.ok) return [...lines, '**No valid review after the retries.**', ''].join('\n');
  const d = result.data;
  lines.push(`**Verdict:** ${d.verdict} (expected ${c.stage1.verdict})`, '');
  lines.push('**Findings**', '', '| ID | Rules | Severity | Location | Issue | Fix |', '| --- | --- | --- | --- | --- | --- |');
  for (const f of d.findings) lines.push(`| ${f.id} | ${f.rules.join(', ')} | ${SEVERITY_WORDS[f.severity]} | ${f.location.replace(/\|/g, '/')} | ${f.issue.replace(/\|/g, '/')} | ${f.fix.replace(/\|/g, '/')} |`);
  if (!d.findings.length) lines.push('| — | | | | | |');
  lines.push('', `**Daniel's message** (${wordCount(d.message)} words):`, '', `> ${d.message.replace(/\n/g, '\n> ')}`, '');
  if (d.whatWorks) lines.push(`**What works:** ${d.whatWorks}`, '');
  lines.push('**Checks**', '', '| Check | | Detail |', '| --- | --- | --- |');
  for (const ch of judged.checks) lines.push(`| ${ch.check} | ${ch.ok === null ? '·' : ch.ok ? '✓' : '✗'} | ${ch.detail} |`);
  lines.push('', '**For Chris to judge** (mustNot that only a reader can check):', '', ...judged.forChris.map((t) => `- [ ] ${t}`), '');
  return lines.join('\n');
}

async function main() {
  loadEnv();
  const live = flag('--yes');
  const rescore = flag('--rescore');
  const only = option('--only', '').split(',').filter(Boolean);
  const readings = option('--readings', join('pilot', 'read-test'));
  const stamp = new Date().toISOString().slice(0, 10);
  const out = option('--out', join('pilot', `run-${stamp}-stage1`));
  const expected = JSON.parse(readFileSync('calibration/expected.json', 'utf8'));
  const ids = Object.keys(expected.cases).filter((id) => !only.length || only.includes(id));

  const missing = ids.filter((id) => !existsSync(join(readings, `${id}.reading.json`)));
  if (missing.length) {
    console.error(`No saved reading for ${missing.join(', ')} in ${readings}. Run the read test first (node scripts/read-test.mjs --yes).`);
    process.exit(1);
  }
  if (live && !rescore && !process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is not set (environment or .env). Nothing was sent.');
    process.exit(1);
  }
  const m = config.models.stage1;
  console.log(rescore ? `Rescoring ${ids.length} saved Stage 1 replies in ${out}; no model calls.` : live ? `Stage 1 pilot: ${ids.length} cases, REAL model calls (${m.model}, effort ${m.effort}, max ${m.maxTokens} tokens).` : `Dry run: building ${ids.length} Stage 1 requests; no model calls.`);
  mkdirSync(out, { recursive: true });

  const sections = [];
  const summary = [];
  const points = [['case', 'stage', 'kind', 'rules', 'severity', 'text', 'agree (Y/N)', 'note']];
  const timings = [['case', 'attempt', 'ms', 'outcome', 'inputTokens', 'outputTokens', 'servedBy', 'fixes']];
  for (const id of ids) {
    const c = expected.cases[id];
    const reading = JSON.parse(readFileSync(join(readings, `${id}.reading.json`), 'utf8'));
    const request = stage1Request(c, reading);
    if (rescore) {
      // Re-check a saved reply with the current review check and judge (no model calls).
      const saved = JSON.parse(readFileSync(join(out, `${id}.stage1.json`), 'utf8'));
      if (saved.ok) {
        const c2 = checkReview(saved.data, request);
        if (c2.ok) {
          saved.data = c2.data;
          const types = c2.fixes.map((f) => f.type).filter((t) => t !== 'verdictMismatch');
          if (types.length) saved.tries.at(-1).fixes = [...new Set([...(saved.tries.at(-1).fixes ?? []), ...types])];
        }
      }
      writeFileSync(join(out, `${id}.stage1.json`), JSON.stringify(saved, null, 2));
    }
    if (!live && !rescore) {
      const stage = reviewStage({ ...request, attempt: 1 });
      console.log(`${id}: request ready (${JSON.stringify(request.input).length} chars of input; prompt ${stage.promptVersion}).`);
      continue;
    }
    const result = rescore ? JSON.parse(readFileSync(join(out, `${id}.stage1.json`), 'utf8')) : await reviewWithRetries(request);
    result.tries.forEach((t) => timings.push([id, t.attempt, t.ms, t.outcome, t.inputTokens, t.outputTokens, t.servedBy, (t.fixes ?? []).join(' ')]));
    writeFileSync(join(out, `${id}.stage1.json`), JSON.stringify(result, null, 2));
    if (!result.ok) {
      summary.push({ id, line: `no valid review (${result.tries.map((t) => t.outcome).join(', ')})`, ok: false });
      sections.push(caseReport(id, c, result, null));
      console.log(`${id}: no valid review`);
      continue;
    }
    const judged = judgeStage1(c.stage1, result.data, expected.globalMustNot);
    const misses = judged.checks.filter((x) => x.ok === false);
    summary.push({ id, ok: judged.ok, verdict: `${result.data.verdict} / ${c.stage1.verdict}`, line: judged.ok ? `PASS (${judged.checks.length} checks)` : `${misses.length} miss(es): ${misses.map((x) => x.check).join('; ')}`, ms: result.tries.reduce((n, t) => n + t.ms, 0), attempts: result.tries.length });
    sections.push(caseReport(id, c, result, judged));
    result.data.findings.forEach((f) => points.push([id, 1, 'finding', f.rules.join(' '), f.severity, `${f.issue} Fix: ${f.fix}`, '', '']));
    points.push([id, 1, 'message', '', result.data.verdict, result.data.message, '', '']);
    console.log(`${id}: ${summary.at(-1).line} [${result.tries.map((t) => `${(t.ms / 1000).toFixed(1)} s ${t.outcome}`).join(', ')}]`);
  }
  if (!live && !rescore) return;

  const okMs = timings.slice(1).filter((t) => t[3] === 'ok').map((t) => t[2]).sort((a, b) => a - b);
  const p95 = okMs.length ? okMs[Math.min(okMs.length - 1, Math.ceil(okMs.length * 0.95) - 1)] : null;
  const report = [
    '# Pilot: Stage 1 (milestone 4)', '',
    `${rescore ? 'Rescored (saved replies, current review check), ' : 'Live, '}${new Date().toISOString()}, ${m.model}, effort ${m.effort}, max ${m.maxTokens} tokens. One round with each student's lead; readings from ${readings}.`, '',
    `Calls that returned a valid reply: ${okMs.length}; p95 ${p95 ? (p95 / 1000).toFixed(1) : '—'} s; slowest ${okMs.length ? (okMs.at(-1) / 1000).toFixed(1) : '—'} s (target: 95% ≤ 20 s, none over 24 s).`, '',
    '| Case | Verdict (got / expected) | Result | Attempts | Time |', '| --- | --- | --- | --- | --- |',
    ...summary.map((s) => `| ${s.id} | ${s.verdict ?? '—'} | ${s.line.replace(/\|/g, '/')} | ${s.attempts ?? '—'} | ${s.ms ? `${(s.ms / 1000).toFixed(1)} s` : '—'} |`), '',
    'Misses are prompt or rule questions for Chris; nothing has been changed to make them pass. `points.csv` has one row per finding and message for Chris to mark agree or disagree (P-6).', '',
    ...sections,
  ].join('\n');
  writeFileSync(join(out, 'report.md'), report);
  writeFileSync(join(out, 'points.csv'), points.map((r) => r.map(csv).join(',')).join('\n'));
  writeFileSync(join(out, 'timings.csv'), timings.map((r) => r.map(csv).join(',')).join('\n'));
  console.log(`Written to ${out}`);
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/').replace(/^([A-Za-z]):/, '/$1:')}` || process.argv[1]?.endsWith('pilot-run.mjs')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
