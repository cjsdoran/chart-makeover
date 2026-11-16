// Make these changes (CM-8, spec §9): T-RD-1..10 in tests/test-plan.md. The redraw check and
// /api/redraw-plan on a fake model; the PptxGenJS builder unzipped and read; the Chart.js preview
// drawn in Node; the engine's versions and changed choices. No model calls, no cost.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import redrawPlan, { validBody } from '../../netlify/functions/redraw-plan.mjs';
import { fillRedraw, fillRedrawPart, redrawPlanStage } from '../../netlify/lib/stages.mjs';
import { planInTwoCalls } from '../../src/redraw/twoCalls.js';
import { setClientFactoryForTests } from '../../netlify/lib/anthropic.mjs';
import { loadPrompt } from '../../netlify/lib/prompts.mjs';
import { REDRAW_REGENERATE, checkRedraw, leadNumberTokens } from '../../shared/redrawCheck.js';
import { checkSchema, schemaText } from '../../shared/schemaCheck.js';
import { config } from '../../shared/limits.js';
import { TABLE_STYLE_ID, buildPptx, speakerNotes } from '../../src/redraw/buildPptx.js';
import { planSlide, niceBounds } from '../../src/redraw/layout.js';
import { formatValue, parseFormat } from '../../src/redraw/format.js';
import { renderPreview } from '../../src/redraw/preview.js';
import { redrawFileName } from '../../src/redraw/fileName.js';
import {
  applyRedraw, buildAgain, changeChoice, changeableFindings, plannedPage, redrawRequest, startChangingChoices,
} from '../../src/engine/engine.js';
import { fakeClient, readEvents } from '../helpers/fakeAnthropic.js';
import { SPECS } from '../helpers/redrawSpecs.js';
import { atChanges, ok, withSlide } from '../helpers/runs.js';

const CODE = 'class-code';
const BG = `image/jpeg;base64,${readFileSync('assets/template/title-only-bg.jpg').toString('base64')}`;
const EMU = 914400;
const R = config.redraw;
const clone = (o) => structuredClone(o);

async function unzip(spec) {
  const { bytes, plan } = await buildPptx(spec, { background: BG, dataToSource: ['League average, 2009–2025'] });
  const zip = await JSZip.loadAsync(bytes);
  const files = Object.keys(zip.files).filter((f) => !zip.files[f].dir);
  const chartFile = files.find((f) => /^ppt\/charts\/chart\d+\.xml$/.test(f));
  const read = (f) => zip.file(f === 'chart' ? chartFile ?? '' : f)?.async('string');
  return { zip, read, plan, bytes };
}

describe('T-RD-1: the redraw check (spec §9.1)', () => {
  const input = { lead: SPECS.line.title, declinedFixes: [{ fix: 'Drop the 2020 dip', reason: 'The board knows about Covid' }] };

  it('passes a good spec, and resets the title and the notes from the run (no regeneration)', () => {
    const spec = { ...clone(SPECS.line), title: 'Man City grew commercial revenue fast' };
    const r = checkRedraw(spec, input);
    expect(r.ok).toBe(true);
    expect(r.data.title).toBe(SPECS.line.title);
    expect(r.data.notes.declinedFixes).toEqual(input.declinedFixes);
    expect(r.fixes.map((f) => f.type)).toEqual(['titleReset', 'notesDeclinedReset']);
  });

  it('regenerates for no subject, a lead number missing, an unknown anchor series, chart and table both', () => {
    const noSubject = clone(SPECS.line);
    noSubject.chart.series[0].role = 'comparison';
    expect(checkRedraw(noSubject, input).errors).toContain(REDRAW_REGENERATE.subject(0));
    const missing = { ...clone(SPECS.line), leadNumbers: [] };
    expect(checkRedraw(missing, input).errors).toContain(REDRAW_REGENERATE.leadNumber('9.8%'));
    const badAnchor = { ...clone(SPECS.line), annotations: [{ text: 'x', anchor: { series: 'Arsenal', x: '2020' } }] };
    expect(checkRedraw(badAnchor, input).errors).toContain(REDRAW_REGENERATE.anchor('Arsenal'));
    const both = { ...clone(SPECS.line), table: SPECS.table.table };
    expect(checkRedraw(both, input).errors).toContain(REDRAW_REGENERATE.twoKinds);
  });

  it('more than three annotations and a source without "Source: " fail the schema', () => {
    const many = { ...clone(SPECS.line), annotations: Array(4).fill(SPECS.line.annotations[0]) };
    expect(checkSchema('redraw-spec', many).ok).toBe(false);
    expect(checkSchema('redraw-spec', { ...clone(SPECS.line), source: 'Deloitte' }).ok).toBe(false);
  });

  it('finds the lead numbers: money, percentages and counts, not years or seasons', () => {
    expect(leadNumberTokens('Fund pricing first: it delivers HK$15m of the HK$35m programme gain by 2027')).toEqual(['HK$15m', 'HK$35m']);
    expect(leadNumberTokens('Vietnam is the fastest growing room A/C market in ASEAN, at 9.8% CAGR')).toEqual(['9.8%']);
    expect(leadNumberTokens('Three of our 12 stores lose money after rent')).toEqual(['12']);
    expect(leadNumberTokens("Man City's commercial revenue ran far ahead of its football record from 09/10 to 17/18")).toEqual([]);
  });

  it('a concept chart needs only its reason', () => {
    const concept = { ...clone(SPECS.line), redrawable: false, reason: 'It is an organisation chart with no plotted data.', chart: null };
    expect(checkRedraw(concept, input).ok).toBe(true);
    expect(checkRedraw({ ...concept, reason: ' ' }, input).errors).toEqual([REDRAW_REGENERATE.reason]);
  });

  it('every test spec is schema-valid and passes the check', () => {
    for (const spec of Object.values(SPECS)) {
      expect(checkSchema('redraw-spec', spec).errors).toEqual([]);
      expect(checkRedraw(spec, { lead: spec.title, declinedFixes: [] }).errors ?? []).toEqual([]);
    }
  });
});

describe('/api/redraw-plan in two calls (spec §9.1, D80, T-FN-1)', () => {
  const input = () => redrawRequest(atChanges()).input;
  const chartPart = () => {
    const { leadNumbers: _l, annotations: _a, referenceLines: _r, notes: _n, title: _t, ...rest } = clone(SPECS.line);
    return rest;
  };
  const finishPart = (extra = {}) => ({ leadNumbers: SPECS.line.leadNumbers, annotations: SPECS.line.annotations, referenceLines: SPECS.line.referenceLines, notes: { ...SPECS.line.notes, declinedFixes: [] }, ...extra });
  const post = (b, code = CODE) => new Request('http://localhost/api/redraw-plan', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CM-Access-Code': code }, body: JSON.stringify(b),
  });
  let client;
  const reply = (obj) => {
    client = fakeClient({ chunks: [JSON.stringify(obj)] });
    setClientFactoryForTests(() => client);
  };
  const last = async (b) => (await readEvents(await redrawPlan(post(b)))).at(-1);
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

  it('each call sends the plan prompt (no persona) with its part of the schema, and the input as one JSON block', () => {
    const one = redrawPlanStage({ part: 'chart', input: input(), attempt: 1 });
    expect(one.system.startsWith(loadPrompt('redraw-plan').text)).toBe(true);
    expect(one.system).not.toContain(loadPrompt('persona').text);
    expect(one.system).toContain(schemaText('redraw-chart'));
    expect(JSON.parse(one.content)).toEqual({ part: 'chart', ...input() });
    const two = redrawPlanStage({ part: 'finish', input: input(), plannedChart: chartPart(), attempt: 1 });
    expect(two.system).toContain(schemaText('redraw-finish'));
    expect(JSON.parse(two.content).plannedChart).toEqual(chartPart());
    expect(one.promptVersion).toBe(`redraw-plan ${loadPrompt('redraw-plan').version}`);
  });

  it('the first call returns the checked chart; the second, the whole slide with the agreed lead as title', async () => {
    const i = input();
    reply(chartPart());
    const first = await last({ part: 'chart', input: i, attempt: 1 });
    expect(first.type).toBe('result');
    expect(first.chart.chart.kind).toBe('line');
    expect(first.chart.leadNumbers).toBeUndefined();
    reply(finishPart());
    const second = await last({ part: 'finish', input: i, plannedChart: first.chart, attempt: 1 });
    expect(second.type).toBe('result');
    expect(second.spec.title).toBe(i.lead);
    expect(second.spec.chart).toEqual(first.chart.chart);
    expect(second.spec.notes.declinedFixes).toEqual(i.declinedFixes.map(({ fix, reason }) => ({ fix, reason })));
    expect(checkSchema('redraw-spec', second.spec).errors).toEqual([]);
  });

  it('a chart with no subject, or a finish without the lead number, comes back invalid for the retry', async () => {
    const bad = chartPart();
    bad.chart.series[0].role = 'comparison';
    reply(bad);
    expect((await last({ part: 'chart', input: input(), attempt: 1 })).errors).toContain(REDRAW_REGENERATE.subject(0));
    reply(finishPart({ leadNumbers: [] }));
    const r = await last({ part: 'finish', input: input(), plannedChart: chartPart(), attempt: 1 });
    expect(r.type).toBe('invalid');
    expect(r.errors).toContain(REDRAW_REGENERATE.leadNumber('9.8%'));
  });

  it('a chart part with overlays in it fails the schema (each call returns only its own part)', async () => {
    reply({ ...chartPart(), leadNumbers: [] });
    expect((await last({ part: 'chart', input: input(), attempt: 1 })).type).toBe('invalid');
  });

  it('refuses a wrong access code, no part, a finish without a planned chart, a bad body and an over-long reason, with no model call', async () => {
    reply(chartPart());
    expect((await redrawPlan(post({ part: 'chart', input: input(), attempt: 1 }, 'nope'))).status).toBe(401);
    expect((await redrawPlan(post({ input: input(), attempt: 1 }))).status).toBe(400);
    expect((await redrawPlan(post({ part: 'finish', input: input(), attempt: 1 }))).status).toBe(400);
    expect((await redrawPlan(post({ part: 'chart', input: { ...input(), isDummy: 'no' }, attempt: 1 }))).status).toBe(400);
    const long = { ...input(), declinedFixes: [{ fix: 'x', reason: 'r'.repeat(301) }] };
    expect((await redrawPlan(post({ part: 'chart', input: long, attempt: 1 }))).status).toBe(413);
    expect(client.calls.length + client.beta.calls.length).toBe(0);
    expect(validBody({ part: 'finish', input: input(), plannedChart: chartPart(), attempt: 1 })).toBe(true);
  });

  it('fills omitted empty fields before the schema (D24)', () => {
    const { annotations: _a, referenceLines: _r, ...rest } = clone(SPECS.line);
    expect(checkSchema('redraw-spec', fillRedraw(rest)).ok).toBe(true);
    const { leadNumbers: _l, ...finish } = finishPart();
    expect(checkSchema('redraw-finish', fillRedrawPart(finish, 'finish')).errors).toEqual([]);
  });

  it('the browser helper makes both calls, and after a failed second call repeats only the second', async () => {
    const i = { input: input() };
    const calls = [];
    let failSecond = true;
    const call = async (body) => {
      calls.push(body.part);
      if (body.part === 'chart') return { ok: true, result: { chart: chartPart(), promptVersion: 'p', servedBy: 'm' } };
      if (failSecond) {
        failSecond = false;
        return { ok: false, message: 'timeout', code: 'CM-S03', final: false };
      }
      return { ok: true, result: { spec: { ...SPECS.line }, promptVersion: 'p', servedBy: 'm' } };
    };
    const r1 = await planInTwoCalls(i, call);
    expect(r1.ok).toBe(false);
    expect(r1.chart.chart.kind).toBe('line');
    const r2 = await planInTwoCalls(i, call, { chart: r1.chart });
    expect(r2.ok).toBe(true);
    expect(calls).toEqual(['chart', 'finish', 'finish']);
    const concept = await planInTwoCalls(i, async () => ({ ok: true, result: { chart: { ...chartPart(), redrawable: false, reason: 'A process diagram.', chart: null } } }));
    expect(concept.result.spec.redrawable).toBe(false);
  });
});

describe('T-RD-2: the slide and its master (spec §9.2)', () => {
  it('is A4 landscape 10.83 × 7.5 in with the template background, the title placeholder and a slide number, no footer', async () => {
    const { zip, read } = await unzip(SPECS.line);
    const pres = await read('ppt/presentation.xml');
    expect(pres).toContain(`cx="${Math.round(10.83 * EMU)}" cy="${Math.round(7.5 * EMU)}"`);
    const media = Object.keys(zip.files).filter((f) => f.startsWith('ppt/media/') && !zip.files[f].dir);
    const bg = await zip.file(media[0]).async('uint8array');
    expect(Buffer.from(bg).equals(readFileSync('assets/template/title-only-bg.jpg'))).toBe(true);
    const layout = await read('ppt/slideLayouts/slideLayout2.xml');
    expect(layout).toContain('<p:bg>');
    expect(layout).toContain('type="sldNum"');
    expect(layout).not.toContain('type="ftr"');
    const slide = await read('ppt/slides/slide1.xml');
    expect(slide).toMatch(/type="title"/);
    expect(slide).toContain(`<a:off x="${Math.round(R.title.x * EMU)}" y="${Math.round(R.title.y * EMU)}"/>`);
    expect(slide).toMatch(/<a:rPr lang="en-US" sz="2400" b="1"[^>]*><a:solidFill><a:srgbClr val="1F497D"\/>/);
    expect(slide).toContain(`<a:t>${SPECS.line.title}</a:t>`);
  });

  it('escapes "&" so a lead like "K&C" still opens', async () => {
    const { read } = await unzip(SPECS.stackedColumn);
    expect(await read('ppt/slides/slide1.xml')).toContain('K&amp;C');
    expect(await read('docProps/app.xml')).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;)/);
  });
});

describe('T-RD-3: the chart XML', () => {
  it('has no gridlines, no legend, no chart title; Calibri; colours by role', async () => {
    const { read } = await unzip(SPECS.line);
    const xml = await read('chart');
    expect(xml).not.toContain('<c:majorGridlines');
    expect(xml).not.toContain('<c:legend>');
    expect(xml).toContain('<c:autoTitleDeleted val="1"/>');
    expect(xml).not.toContain('typeface="Arial"');
    expect(xml).toContain('typeface="Calibri"');
    const sers = xml.match(/<c:ser>[\s\S]*?<\/c:ser>/g);
    expect(sers[0]).toContain('val="033D93"');
    expect(sers[1]).toContain('val="BFBFBF"');
  });

  it('others take C00000, 008000, FFC000 in order', () => {
    const spec = clone(SPECS.line);
    spec.chart.series.push(...['A', 'B', 'C'].map((name) => ({ ...clone(spec.chart.series[1]), name, role: 'other' })));
    expect(planSlide(spec).colours).toEqual(['033D93', 'BFBFBF', 'C00000', '008000', 'FFC000']);
  });

  it('sets the plot area and the value axis explicitly', async () => {
    const { read, plan } = await unzip(SPECS.line);
    const xml = await read('chart');
    expect(xml).toContain('<c:layoutTarget val="inner" />');
    expect(xml).toContain(`<c:max val="${plan.valueBounds.max}"/>`);
    expect(xml).toContain(`<c:min val="${plan.valueBounds.min}"/>`);
  });
});

describe('T-RD-4: every kind builds and reopens', () => {
  it.each(Object.keys(SPECS))('%s', async (kind) => {
    const { zip, read } = await unzip(SPECS[kind]);
    expect(await read('ppt/slides/slide1.xml')).toBeTruthy();
    const chart = await read('chart');
    if (kind === 'table') {
      expect(chart).toBeUndefined();
      expect(await read('ppt/slides/slide1.xml')).toContain(`<a:tableStyleId>${TABLE_STYLE_ID}</a:tableStyleId>`);
      return;
    }
    expect(Object.keys(zip.files).some((f) => f.startsWith('ppt/embeddings/'))).toBe(true);
    if (kind === 'waterfall') {
      expect(chart).toContain('<c:grouping val="stacked"/>');
      expect(chart.match(/<c:ser>[\s\S]*?<\/c:ser>/g)[0]).toContain('<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>');
    }
    if (kind === 'stacked100') expect(chart).toContain('<c:grouping val="percentStacked"/>');
    if (kind === 'scatter') expect(chart).toContain('<c:scatterChart>');
    if (kind === 'bubble') expect(chart).toContain('<c:bubbleChart>');
  });
});

describe('T-RD-5: valueToSlide', () => {
  it('maps a known point to slide inches, and puts the lead number within 0.2 in of it', () => {
    const plan = planSlide(SPECS.line);
    const P = plan.plot;
    const { min, max } = plan.valueBounds;
    const at = plan.toSlide(5, 190);
    expect(at.x).toBeCloseTo(P.x + (5.5 / 6) * P.w, 6);
    expect(at.y).toBeCloseTo(P.y + P.h * (1 - (190 - min) / (max - min)), 6);
    const n = plan.overlays.find((o) => o.role === 'leadNumber');
    expect(Math.max(0, at.y - (n.y + n.h))).toBeLessThanOrEqual(0.2);
    expect(Math.abs(n.x + n.w / 2 - at.x)).toBeLessThan(0.6);
  });

  it('a lead number that repeats a data label replaces it', () => {
    expect(planSlide(SPECS.bar).hiddenLabels).toEqual([{ series: 0, index: 0 }]);
  });

  it('a lead number with a different figure leaves the data label alone', () => {
    const spec = clone(SPECS.bar);
    spec.leadNumbers = [{ text: '3 of 12', anchor: { series: 'CAGR', x: 'Thailand' } }];
    spec.title = 'Three markets, 3 of 12 below zero';
    expect(planSlide(spec).hiddenLabels).toEqual([]);
  });

  it('keeps every overlay inside the body zone, at 12 pt or more', () => {
    for (const spec of Object.values(SPECS)) {
      const { body, overlays } = planSlide(spec);
      for (const o of overlays) {
        expect(o.x).toBeGreaterThanOrEqual(body.x - 1e-9);
        expect(o.y).toBeGreaterThanOrEqual(body.y - 1e-9);
        expect(o.x + o.w).toBeLessThanOrEqual(body.x + body.w + 1e-9);
        expect(o.y + o.h).toBeLessThanOrEqual(body.y + body.h + 1e-9);
        expect(o.fontSize).toBeGreaterThanOrEqual(12);
      }
    }
  });

  it('round axis bounds start at zero for columns; values are formatted as the spec says', () => {
    expect(niceBounds([3, 47], { fromZero: true })).toMatchObject({ min: 0, max: 50 });
    expect(formatValue(0.452, parseFormat('0%', [0.452]))).toBe('45%');
    expect(formatValue(45.2, parseFormat('0%', [45.2]))).toBe('45%');
    expect(formatValue(-3, parseFormat('"HK$"0"m"'))).toBe('−HK$3m');
    expect(formatValue(1240, parseFormat('#,##0'))).toBe('1,240');
  });
});

describe('T-RD-6: "Illustrative data" and the file name', () => {
  it('labels the slide and names the file', async () => {
    const { read } = await unzip(SPECS.line);
    expect(await read('ppt/slides/slide1.xml')).toContain(`<a:t>${R.illustrativeLabel}</a:t>`);
    const s = { attemptId: 'ABCD2345', setup: { caseName: 'Man City (EPL)', studentId: '2087-12/34' } };
    expect(redrawFileName(s)).toBe('MGMT5760_ManCityEPL_ChartMakeover_2087-1234_ABCD2345_illustrative.pptx');
    expect(redrawFileName(s, 2)).toBe('MGMT5760_ManCityEPL_ChartMakeover_2087-1234_ABCD2345_v2_illustrative.pptx');
  });
});

describe('T-RD-7: speaker notes', () => {
  it('hold the lead, accepted fixes, declined fixes with reasons, and the data to source', async () => {
    const spec = { ...clone(SPECS.line), notes: { ...SPECS.line.notes, declinedFixes: [{ fix: 'Drop 2020', reason: 'The board knows' }] } };
    const { read } = await unzip(spec);
    const notes = await read('ppt/notesSlides/notesSlide1.xml');
    for (const t of [`Agreed lead: ${spec.title}`, 'Index both series to the league average', 'Drop 2020 (your reason: The board knows)', 'Data you must source:', 'League average, 2009–2025']) {
      expect(notes).toContain(t);
    }
    expect(speakerNotes(spec)).toContain('League average: invented values; find the real series.');
  });
});

describe('T-RD-8: declined fixes stay out; changing choices and building again', () => {
  it('the plan request carries declines only as declinedFixes, never as accepted', () => {
    const { input } = redrawRequest(atChanges());
    expect(input.declinedFixes).toHaveLength(1);
    expect(input.declinedFixes[0].reason).toBe('Like-for-like is fine here');
    expect(input.acceptedFixes.map((f) => f.fix)).not.toContain(input.declinedFixes[0].fix);
    expect(input.lead).toBe(SPECS.line.title);
    expect(input.comparison).toBe('Time');
  });

  it("the first version brings Daniel's last line; a change of choices and Build again add a version", () => {
    let s = withSlide();
    expect(s.run.redraws).toHaveLength(1);
    expect(s.chat.at(-2).kind).toBe('redraw');
    expect(s.chat.at(-1).text).toBe(config.openers.lastMessage);
    expect(changeChoice(s, 'x', 'accept').error).toBeTruthy();
    s = ok(startChangingChoices(s));
    const declined = changeableFindings(s.run).find((f) => f.reason);
    const accepted = changeableFindings(s.run).find((f) => f.status === 'accepted' && f.severity === 'major');
    s = ok(changeChoice(s, declined.id, 'accept'));
    expect(changeChoice(s, accepted.id, 'decline', 'short').error).toMatch(/at least 10/);
    s = ok(changeChoice(s, accepted.id, 'decline', 'The board has seen this cut'));
    const page = plannedPage(s.run);
    expect(page.acceptedFixes.map((f) => f.fix)).toContain(declined.fix);
    expect(page.declinedFixes.map((f) => f.fix)).toEqual([accepted.fix]);
    s = ok(buildAgain(s));
    s = ok(applyRedraw(s, { spec: SPECS.line }, { fileName: redrawFileName(s, 2) }));
    expect(s.run.redraws.map((v) => v.version)).toEqual([1, 2]);
    expect(s.run.redraws[1].declinedFixes.map((f) => f.fix)).toEqual([accepted.fix]);
    expect(s.run.editingChoices).toBe(false);
    expect(s.chat.filter((m) => m.text === config.openers.lastMessage)).toHaveLength(1);
  });
});

describe('T-RD-9: a concept chart', () => {
  it("gets Daniel's reason and no version to download", () => {
    const s = ok(applyRedraw(atChanges(), { spec: { ...clone(SPECS.line), redrawable: false, reason: 'It is a process diagram with no plotted data.', chart: null } }));
    expect(s.run.redraws).toHaveLength(0);
    expect(s.run.notRedrawable).toMatch(/process diagram/);
    expect(s.chat.at(-1).kind).toBe('notRedrawable');
  });
});

describe('T-RD-10: the Chart.js preview', () => {
  it.each(Object.keys(SPECS))('draws %s to a PNG', async (kind) => {
    const background = await loadImage(readFileSync('assets/template/title-only-bg.jpg'));
    const canvas = renderPreview(SPECS[kind], { createCanvas, background, ppi: 60 });
    expect(canvas.width).toBe(Math.round(10.83 * 60));
    const png = await canvas.encode('png');
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect(png.length).toBeGreaterThan(5000);
  });
});

describe('Q14 and D77: 100% stacks show shares; category series may come as values', () => {
  it('a 100% stack labels each segment with its share, not its value; a plain stack keeps its values', async () => {
    const shares = planSlide(SPECS.stacked100).overlays.filter((o) => o.role === 'segmentValue').map((o) => o.text);
    expect(shares.slice(0, 2)).toEqual(['25%', '29%']); // Transit 10 of 40, 12 of 42
    expect(shares.every((t) => /^\d+%$/.test(t))).toBe(true);
    const { read } = await unzip(SPECS.stacked100);
    expect(await read('chart')).not.toContain('<c:showVal val="1"/>');
    expect(planSlide(SPECS.stackedColumn).overlays.some((o) => o.role === 'segmentValue')).toBe(false);
    const { read: readPlain } = await unzip(SPECS.stackedColumn);
    expect(await readPlain('chart')).toContain('<c:showVal val="1"/>');
  });

  it('values, one per category, become points before the schema', () => {
    const spec = clone(SPECS.line);
    spec.chart.series = spec.chart.series.map(({ points, ...s }) => ({ ...s, values: points.map((p) => p.y) }));
    const filled = fillRedraw(spec);
    expect(checkSchema('redraw-spec', filled).errors).toEqual([]);
    expect(filled.chart.series[0].points).toEqual(SPECS.line.chart.series[0].points);
    expect(filled.chart.series[0].values).toBeUndefined();
  });
});
