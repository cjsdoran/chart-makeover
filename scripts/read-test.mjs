#!/usr/bin/env node
// The read test (RT-1, build brief milestone 2): reads each calibration chart the way the app does
// and compares the reading with calibration/read-truth.json. Copied from Tree Surgery's read test.
//
//   node scripts/read-test.mjs                 prepare the inputs only (no model calls, no cost)
//   node scripts/read-test.mjs --yes           real model calls: costs money; run when Chris asks
//   options: --only C01,C06   --out <dir> (default pilot/read-test)
//   diagnostics, for this run only: --model <id>   --max-tokens N   --budget S (seconds)
//   node scripts/read-test.mjs --rescore       re-check the readings saved in <out> (no model calls)
//
// Needs ANTHROPIC_API_KEY in the environment or in .env. pilot/ is git-ignored.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { prepareUpload } from '../src/upload/upload.js';
import { callModel } from '../netlify/lib/anthropic.mjs';
import { readChartStage } from '../netlify/lib/stages.mjs';
import { config } from '../shared/limits.js';
import { compareReading } from './lib/readTruth.js';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

/** The browser's upload dependencies, in Node (spec D23). */
export const nodeDeps = {
  loadPdfjs: () => import('pdfjs-dist/legacy/build/pdf.mjs'),
  assetsBase: 'node_modules/pdfjs-dist/',
  createCanvas,
  encode: async (c, type, q) => new Uint8Array(await c.encode(type === 'image/png' ? 'png' : 'jpeg', q ? Math.round(q * 100) : undefined)),
  toBase64: (b) => Buffer.from(b).toString('base64'),
  // @napi-rs/canvas applies the EXIF orientation when it decodes, as the browser does
  // (checked by T-UP-9), so image.js must not rotate again.
  decodeImage: async (bytes) => {
    const image = await loadImage(Buffer.from(bytes));
    return { image, width: image.width, height: image.height, exifApplied: true };
  },
  convertHeic: async () => {
    throw Object.assign(new Error('HEIC conversion runs in the browser only'), { name: 'HeicUnsupported' });
  },
};

/** Reads KEY=value lines from .env into process.env, without overwriting what is set. */
export function loadEnv(file = '.env') {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

/** Prepares one calibration file exactly as the browser does. */
export async function prepare(file) {
  return prepareUpload(new File([readFileSync(file)], basename(file)), { deps: nodeDeps });
}

/** One read, with the browser's retries on a reply that fails its checks (spec §7 step 5). */
async function readOnce(upload) {
  let previousErrors = [];
  const tries = [];
  for (let attempt = 1; attempt <= config.replyMaxAttempts; attempt++) {
    const stage = readChartStage({ upload, attempt, ...(previousErrors.length ? { previousErrors } : {}) });
    const startedAt = Date.now();
    const reply = await callModel({ ...stage, startedAt });
    const ms = Date.now() - startedAt;
    if (!reply.ok) {
      tries.push({ attempt, ms, outcome: reply.error });
      previousErrors = reply.error === 'truncated' ? [stage.truncatedError] : [];
      continue;
    }
    const r = stage.read(reply.text);
    tries.push({ attempt, ms, outcome: r.ok ? 'ok' : 'invalid', errors: r.ok ? undefined : r.errors, inputTokens: reply.inputTokens, outputTokens: reply.outputTokens, servedBy: reply.servedBy });
    if (r.ok) return { ok: true, data: r.data, tries, raw: reply.text };
    previousErrors = r.errors;
  }
  return { ok: false, tries };
}

function reportFor(id, file, cmp, reading, tries) {
  const lines = [`# Read test: ${id} (${basename(file)})`, '', `**${cmp.ok ? 'PASS' : `${cmp.checks.filter((c) => !c.ok).length} miss(es)`}** · ${tries.map((t) => `attempt ${t.attempt}: ${t.outcome}, ${(t.ms / 1000).toFixed(1)} s${t.outputTokens ? `, ${t.inputTokens} in / ${t.outputTokens} out` : ''}`).join('; ')}`, ''];
  lines.push('| Check | | Expected | Got |', '| --- | --- | --- | --- |');
  for (const c of cmp.checks) lines.push(`| ${c.check.replace(/\|/g, '/')} | ${c.ok ? '✓' : '✗'} | ${String(c.expected).replace(/\|/g, '/')} | ${String(c.got).replace(/\|/g, '/')}${c.note ? ` (${c.note})` : ''} |`);
  lines.push('', `Summary: ${reading.summary}`, '', '## The reading', '', '```json', JSON.stringify(reading, null, 2), '```', '');
  return lines.join('\n');
}

const csv = (rows) => rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');

async function main() {
  loadEnv();
  const live = flag('--yes');
  const only = option('--only', '').split(',').filter(Boolean);
  const out = option('--out', join('pilot', 'read-test'));
  if (option('--model')) config.models.readChart.model = option('--model');
  if (option('--max-tokens')) config.models.readChart.maxTokens = Number(option('--max-tokens'));
  if (option('--budget')) config.functionBudgetSeconds = Number(option('--budget'));
  mkdirSync(out, { recursive: true });

  const truth = JSON.parse(readFileSync('calibration/read-truth.json', 'utf8')).cases;
  const cases = JSON.parse(readFileSync('calibration/cases.json', 'utf8')).filter((c) => !only.length || only.includes(c.id));

  if (flag('--rescore')) {
    for (const c of cases) {
      const f = join(out, `${c.id}.reading.json`);
      if (!existsSync(f)) continue;
      const cmp = compareReading(c.id, truth[c.id], JSON.parse(readFileSync(f, 'utf8')), { photo: /\.(jpe?g|heic)$/i.test(c.file) });
      console.log(`${c.id}: ${cmp.ok ? 'PASS' : `FAIL: ${cmp.checks.filter((x) => !x.ok).map((x) => x.check).join('; ')}`}`);
    }
    return;
  }
  if (live && !process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is not set (environment or .env). Nothing was sent.');
    process.exit(1);
  }
  const m = config.models.readChart;
  console.log(live ? `Read test: ${cases.length} charts, REAL model calls (${m.model}, effort ${m.effort}, max ${m.maxTokens} tokens, ${config.functionBudgetSeconds} s budget).` : `Dry run: preparing ${cases.length} charts; no model calls.`);

  const summary = [];
  const timings = [['case', 'attempt', 'ms', 'outcome', 'inputTokens', 'outputTokens', 'servedBy']];
  for (const c of cases) {
    const file = join('calibration', 'inputs', c.file);
    const prepared = await prepare(file);
    if (!prepared.ok) {
      console.log(`${c.id}: refused before reading (${prepared.code}): ${prepared.message}`);
      summary.push({ id: c.id, result: `refused (${prepared.code})` });
      continue;
    }
    const u = prepared.upload;
    const text = [u.pdfText, u.pptx?.shapes, u.pptx?.charts, u.pptx?.tables].filter(Boolean).join('\n\n');
    writeFileSync(join(out, `${c.id}.input.txt`), `${u.kind}${u.image ? `, image (${u.imageRole}) ${u.image.mediaType}, ${Math.round(u.image.base64.length * 0.75 / 1024)} KB` : ', no image'}\n\n${text || '(no text)'}\n`);
    if (u.image) writeFileSync(join(out, `${c.id}.input.${u.image.mediaType === 'image/png' ? 'png' : 'jpg'}`), Buffer.from(u.image.base64, 'base64'));
    if (!live) {
      console.log(`${c.id}: ${u.kind}${u.image ? ` + image (${u.imageRole})` : ''}, ${text.length} chars of text`);
      summary.push({ id: c.id, result: 'prepared' });
      continue;
    }
    const r = await readOnce(u);
    r.tries.forEach((t) => timings.push([c.id, t.attempt, t.ms, t.outcome, t.inputTokens, t.outputTokens, t.servedBy]));
    if (!r.ok) {
      const result = `no valid reading (${r.tries.map((t) => `${t.outcome}${t.errors ? `: ${t.errors.join(' ')}` : ''}`).join('; ')})`;
      console.log(`${c.id}: ${result}`);
      writeFileSync(join(out, `${c.id}.md`), `# Read test: ${c.id}\n\n${result}\n`);
      summary.push({ id: c.id, result });
      continue;
    }
    writeFileSync(join(out, `${c.id}.reading.json`), `${JSON.stringify(r.data, null, 2)}\n`);
    const cmp = compareReading(c.id, truth[c.id], r.data, { photo: /\.(jpe?g|heic)$/i.test(c.file) });
    writeFileSync(join(out, `${c.id}.md`), reportFor(c.id, file, cmp, r.data, r.tries));
    const misses = cmp.checks.filter((x) => !x.ok);
    const result = cmp.ok ? `PASS (${cmp.checks.length} checks)` : `FAIL ${misses.length}/${cmp.checks.length}: ${misses.map((x) => `${x.check} → ${x.got}`).join('; ')}`;
    console.log(`${c.id}: ${result} [${r.tries.map((t) => `${(t.ms / 1000).toFixed(1)} s ${t.outcome}`).join(', ')}]`);
    summary.push({ id: c.id, result });
  }

  writeFileSync(join(out, 'summary.md'), ['# Read test summary (RT-1)', '', `${live ? 'Live' : 'Dry run'}, ${new Date().toISOString()}, ${m.model}, effort ${m.effort}, max ${m.maxTokens} tokens`, '', '| Case | Result |', '| --- | --- |', ...summary.map((s) => `| ${s.id} | ${s.result.replace(/\|/g, '/')} |`), ''].join('\n'));
  if (live) writeFileSync(join(out, 'timings.csv'), `${csv(timings)}\n`);
  console.log(`Written to ${out}`);
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/read-test.mjs')) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
