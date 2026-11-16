// The redraw QA, P-3 (build brief, milestone 6; tests/test-plan.md). For each calibration case with
// chart stages, the saved P-2 run is replayed through the real engine (no stage calls) to reach its
// planned page; then one redraw plan call (the browser's retries) and the .pptx and preview built
// exactly as the browser builds them. Open the .pptx files in PowerPoint for the style guide's QA
// list; scripts/render-pptx.ps1 exports each slide as a PNG for the report.
//
//   node scripts/pilot-redraw.mjs                 dry run: replays and builds every plan request; no model calls
//   node scripts/pilot-redraw.mjs --yes           real model calls (one per case, plus any retries): costs money
//   node scripts/pilot-redraw.mjs --rebuild --out <dir>   rebuild the .pptx and previews from saved specs (no calls)
//   options: --only C01,C08   --out <dir>
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { applyReview, confirmFit, redrawRequest } from '../src/engine/engine.js';
import { buildPptx } from '../src/redraw/buildPptx.js';
import { renderPreview } from '../src/redraw/preview.js';
import { redrawFileName } from '../src/redraw/fileName.js';
import { planInTwoCalls } from '../src/redraw/twoCalls.js';
import { checkRedraw, leadNumberTokens } from '../shared/redrawCheck.js';
import { config } from '../shared/limits.js';
import { redrawPlanStage } from '../netlify/lib/stages.mjs';
import { callModel } from '../netlify/lib/anthropic.mjs';
import { loadEnv } from './read-test.mjs';
import { PILOT_STUDENT, drivePath, stage2Session } from './pilot-chart.mjs';

const R = config.redraw;
const BG_FILE = 'assets/template/title-only-bg.jpg';
const pass = (stage, message) => ({ stage, verdict: 'pass', findings: [], message, whatWorks: null, offeredLead: null, route: null, reopenStage: null, impression: null, declineResponses: [] });
const STAGE2_PASS = pass(2, '(pilot: Stage 2 skipped)');
const PILOT_SETUP = { accessCode: 'pilot', name: 'Pilot Student', studentId: 'PILOT', team: '', caseName: '' };

/** The newest saved P-2 run for a case: the path that reached the fit check. */
export function latestChartRun(id, root = 'pilot') {
  const files = readdirSync(root).filter((d) => d.startsWith('run-') && d.includes('-chart'))
    .map((d) => join(root, d, `${id}.chart.json`)).filter((f) => existsSync(f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return files.length ? { file: files[0], saved: JSON.parse(readFileSync(files[0], 'utf8')) } : null;
}

/** Replays a saved path through the engine: the same reviews, so the same planned page. */
export async function replay(c, id, saved, reading) {
  const st = PILOT_STUDENT[id];
  const path = saved.paths.find((p) => p.name === 'B') ?? saved.paths.find((p) => p.name === 'main');
  let start = stage2Session(c, reading, null, { isDummy: st.isDummy, ...(path.name === 'B' ? { reuploadsLeft: 0 } : {}) });
  if (path.name === 'B') start = applyReview(start, STAGE2_PASS);
  let i = 0;
  const r = await drivePath(start, st, async () => path.calls[i++]?.result ?? { ok: false, tries: [] });
  let session = r.session;
  let note = null;
  // A saved run whose Stage 5 reply never passed its checks (C02 in the first P-2): the page is
  // confirmed as planned, so the redraw can still be tested.
  if (session.step === 'fit' && session.run.pending?.stage === 5) {
    session = applyReview(session, pass(5, '(pilot: no valid Stage 5 reply in the saved run; the page is confirmed as planned)'));
    const confirmed = confirmFit(session);
    if (!confirmed.error) {
      session = confirmed.session;
      note = 'The saved run had no valid Stage 5 reply; the replay confirmed the planned page.';
    }
  }
  return { ...session, setup: { ...PILOT_SETUP, caseName: id }, pilotNote: note };
}

/** One of the plan's calls, with the browser's retries on a reply that fails its checks. */
async function callWithRetries(body, tries) {
  let previousErrors = [];
  let lastFailure = { ok: false, message: 'no valid reply', final: false };
  for (let attempt = 1; attempt <= config.replyMaxAttempts; attempt++) {
    const stage = redrawPlanStage({ ...body, attempt, ...(previousErrors.length ? { previousErrors } : {}) });
    const startedAt = Date.now();
    const reply = await callModel({ ...stage, startedAt });
    const ms = Date.now() - startedAt;
    if (!reply.ok) {
      tries.push({ part: body.part, attempt, ms, outcome: reply.error });
      previousErrors = reply.error === 'truncated' ? [stage.truncatedError] : [];
      lastFailure = { ok: false, message: reply.error, final: false };
      continue;
    }
    const event = stage.finish(reply.text);
    tries.push({
      part: body.part, attempt, ms, outcome: event.type === 'result' ? 'ok' : 'invalid', errors: event.errors, fixes: event.fixes,
      ...(event.type === 'result' ? {} : { text: reply.text.slice(0, 4000) }),
      inputTokens: reply.inputTokens, outputTokens: reply.outputTokens, servedBy: reply.servedBy,
    });
    if (event.type === 'result') return { ok: true, result: { ...event, promptVersion: stage.promptVersion, servedBy: reply.servedBy } };
    previousErrors = event.errors;
    lastFailure = { ok: false, message: 'invalid', final: false };
  }
  return lastFailure;
}

/** The plan in its two calls (D80), each with the browser's retries, as the browser makes them. */
export async function planWithRetries(input) {
  const tries = [];
  const r = await planInTwoCalls({ input }, (body) => callWithRetries(body, tries));
  return r.ok ? { ok: true, spec: r.result.spec, tries, promptVersion: r.result.promptVersion } : { ok: false, tries };
}

/** The checks code can make against the style guide's QA list (the rest is by eye in PowerPoint). */
export function qaChecks(spec, plan, input) {
  const checks = [];
  const add = (check, ok, detail = '') => checks.push({ check, ok, detail });
  const b = plan.body;
  const outside = plan.overlays.filter((o) => o.x < b.x - 1e-6 || o.y < b.y - 1e-6 || o.x + o.w > b.x + b.w + 1e-6 || o.y + o.h > b.y + b.h + 1e-6);
  add('title is the agreed lead, word for word', spec.title === input.lead);
  add('title fits two lines (about 120 characters at 24 pt)', spec.title.length <= 120, `${spec.title.length} characters`);
  add('subheading in capitals', plan.subheading.text === plan.subheading.text.toUpperCase(), `${plan.subheading.fontSize} pt`);
  add('nothing below 12 pt', plan.overlays.every((o) => o.fontSize >= 12) && plan.subheading.fontSize >= 12);
  add('nothing outside the body zone', outside.length === 0, outside.map((o) => o.text).join('; '));
  add('"Illustrative data" on the slide', plan.illustrative.text === R.illustrativeLabel);
  add('source line starts "Source: "', spec.source.startsWith('Source: '), spec.source);
  add('every lead number on the chart', leadNumberTokens(input.lead).every((t) => spec.leadNumbers.some((n) => n.text.includes(t.replace(/\s/g, '')) || n.text.includes(t))), spec.leadNumbers.map((n) => n.text).join(', ') || 'none');
  add('lead numbers placed', plan.overlays.filter((o) => o.role === 'leadNumber').length === spec.leadNumbers.length);
  add('one chart', Boolean(spec.chart) !== Boolean(spec.table));
  add('declined fixes in the notes', JSON.stringify(spec.notes.declinedFixes) === JSON.stringify(input.declinedFixes.map(({ fix, reason }) => ({ fix, reason }))), `${input.declinedFixes.length} declined`);
  return checks;
}

async function main() {
  loadEnv();
  const args = process.argv.slice(2);
  const flag = (name) => args.includes(name);
  const option = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
  };
  const live = flag('--yes');
  const rebuild = flag('--rebuild');
  const only = option('--only', '').split(',').filter(Boolean);
  const out = option('--out', join('pilot', `run-${new Date().toISOString().slice(0, 10)}-redraw`));
  const expected = JSON.parse(readFileSync('calibration/expected.json', 'utf8'));
  const ids = Object.keys(expected.cases).filter((id) => expected.cases[id].chartStages && (!only.length || only.includes(id)));
  if (live && !process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is not set (environment or .env). Nothing was sent.');
    process.exit(1);
  }
  const m = config.models.redrawPlan;
  console.log(rebuild ? `Rebuilding the slides in ${out} from saved specs; no model calls.`
    : live ? `Redraw QA: ${ids.length} cases, REAL model calls (${m.model}, effort ${m.effort}, max ${m.maxTokens} tokens).`
      : `Dry run: ${ids.length} cases replayed to the plan request; no model calls.`);
  mkdirSync(out, { recursive: true });
  const bgBytes = readFileSync(BG_FILE);
  const background = `image/jpeg;base64,${bgBytes.toString('base64')}`;
  const bgImage = await loadImage(bgBytes);

  const rows = [];
  const sections = [];
  const timings = [['case', 'part', 'attempt', 'ms', 'outcome', 'inputTokens', 'outputTokens', 'servedBy', 'fixes']];
  for (const id of ids) {
    const c = expected.cases[id];
    const savedFile = join(out, `${id}.redraw.json`);
    let input;
    let result;
    let source = '';
    if (rebuild) {
      ({ input, result, source } = JSON.parse(readFileSync(savedFile, 'utf8')));
      // The current redraw check, so a rebuild shows today's code fixes too.
      if (result.ok && result.spec.redrawable) {
        const c = checkRedraw(result.spec, input);
        if (c.ok) result.spec = c.data;
      }
    } else {
      const run = latestChartRun(id);
      if (!run) {
        console.log(`${id}: no saved P-2 run; skipped.`);
        continue;
      }
      const reading = JSON.parse(readFileSync(join('pilot', 'read-test', `${id}.reading.json`), 'utf8'));
      const session = await replay(c, id, run.saved, reading);
      if (session.step !== 'changes') {
        console.log(`${id}: the replay of ${run.file} stopped at "${session.step}"; skipped.`);
        continue;
      }
      source = run.file.replace(/\\/g, '/');
      input = redrawRequest(session).input;
      if (session.pilotNote) source += ` (${session.pilotNote})`;
      if (!live) {
        const stage = redrawPlanStage({ input, attempt: 1 });
        console.log(`${id}: plan request ready from ${source} (${input.acceptedFixes.length} accepted, ${input.declinedFixes.length} declined; ${JSON.stringify(input).length} chars; prompt ${stage.promptVersion}).`);
        continue;
      }
      result = await planWithRetries(input);
      writeFileSync(savedFile, JSON.stringify({ id, source, input, result }, null, 2));
    }
    result.tries.forEach((t) => timings.push([id, t.part, t.attempt, t.ms, t.outcome, t.inputTokens, t.outputTokens, t.servedBy, (t.fixes ?? []).join(' ')]));
    const time = result.tries.reduce((n, t) => n + t.ms, 0);
    const lines = [`## ${id}`, '', `**Lead:** ${input.lead}`, '', `**From:** ${source} · ${input.acceptedFixes.length} accepted fixes, ${input.declinedFixes.length} declined`, '',
      `Calls: ${result.tries.map((t) => `${t.part ?? ""} attempt ${t.attempt} ${t.outcome} ${(t.ms / 1000).toFixed(1)} s${t.outputTokens ? ` (${t.inputTokens} in / ${t.outputTokens} out)` : ''}${t.fixes?.length ? ` · fixes: ${t.fixes.join(', ')}` : ''}${t.errors ? ` · regenerate: ${t.errors.join(' ')}` : ''}`).join('; ')}`, ''];
    if (!result.ok) {
      rows.push(`| ${id} | no valid plan | ${(time / 1000).toFixed(1)} s |`);
      sections.push([...lines, '**No valid plan after the retries.**', ''].join('\n'));
      console.log(`${id}: no valid plan`);
      continue;
    }
    const spec = result.spec;
    if (!spec.redrawable) {
      rows.push(`| ${id} | not redrawable: ${spec.reason} | ${(time / 1000).toFixed(1)} s |`);
      sections.push([...lines, `**Not redrawable:** ${spec.reason}`, ''].join('\n'));
      console.log(`${id}: not redrawable`);
      continue;
    }
    const session = { attemptId: 'PILOT', setup: { ...PILOT_SETUP, caseName: id } };
    const fileName = redrawFileName(session);
    const { bytes, plan } = await buildPptx(spec, { background, dataToSource: input.dataToSource });
    writeFileSync(join(out, fileName), bytes);
    const png = await renderPreview(spec, { createCanvas, background: bgImage, ppi: 96 }).encode('png');
    writeFileSync(join(out, `${id}.preview.png`), png);
    const checks = qaChecks(spec, plan, input);
    const misses = checks.filter((x) => !x.ok);
    rows.push(`| ${id} | ${spec.chart?.kind ?? 'table'}; ${misses.length ? `${misses.length} QA miss(es): ${misses.map((x) => x.check).join('; ')}` : `${checks.length} code checks pass`} | ${(time / 1000).toFixed(1)} s |`);
    lines.push(`**Kind:** ${spec.chart?.kind ?? 'table'} · **Subheading:** ${spec.subheading}`, '', `**File:** ${fileName} · preview \`${id}.preview.png\``, '');
    lines.push('| QA check (code) | | Detail |', '| --- | --- | --- |', ...checks.map((x) => `| ${x.check} | ${x.ok ? '✓' : '✗'} | ${String(x.detail).replace(/\|/g, '/')} |`), '');
    lines.push('**By eye in PowerPoint:** title position, subheading present, overlays clear of the marks, colours by role, series labelled at the end, no gridlines or legend, slide number, notes filled.', '');
    lines.push('**Accepted fixes it was given:**', '', ...input.acceptedFixes.map((f) => `- S${f.stage} ${f.rules.join('/')}: ${f.fix}`), '');
    if (input.declinedFixes.length) lines.push('**Declined (must not appear):**', '', ...input.declinedFixes.map((f) => `- ${f.fix} (reason: ${f.reason})`), '');
    lines.push('**Notes: data you must source:**', '', ...(spec.notes.dataToSource.length ? spec.notes.dataToSource.map((d) => `- ${d}`) : ['- (none listed)']), '');
    sections.push(lines.join('\n'));
    console.log(`${id}: ${spec.chart?.kind ?? 'table'}, ${misses.length ? `${misses.length} QA miss(es)` : 'code QA pass'} [${result.tries.map((t) => `${(t.ms / 1000).toFixed(1)} s ${t.outcome}`).join('/')}]`);
  }
  if (!live && !rebuild) return;

  const okMs = timings.slice(1).filter((t) => t[4] === 'ok').map((t) => t[3]).sort((a, b) => a - b);
  const report = [
    '# Pilot P-3: redraw QA (milestone 6)', '',
    `${rebuild ? 'Rebuilt from saved specs' : 'Live'}, ${new Date().toISOString()}, ${m.model}, effort ${m.effort}, max ${m.maxTokens} tokens. Each case's planned page comes from replaying its newest saved P-2 run (the pilot student accepted every fix).`, '',
    `Valid calls: ${okMs.length} (two per case); slowest call ${okMs.length ? (okMs.at(-1) / 1000).toFixed(1) : '—'} s (target: redraw within 60 s; each call inside 24 s).`, '',
    '| Case | Result | Time |', '| --- | --- | --- |', ...rows, '',
    'The code checks cover what can be measured from the spec and the layout. The style guide\'s QA list also needs each slide opened in PowerPoint (or its PNG from scripts/render-pptx.ps1): that judgement is for Chris.', '',
    ...sections,
  ].join('\n');
  writeFileSync(join(out, 'report.md'), report);
  writeFileSync(join(out, 'timings.csv'), timings.map((r) => r.join(',')).join('\n'));
  console.log(`Written to ${out}`);
}

if (process.argv[1]?.endsWith('pilot-redraw.mjs')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
