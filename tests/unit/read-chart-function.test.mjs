// /api/read-chart (CM-2, CMS-7, spec §3.5): T-READ-1 (no persona; image block then one JSON block),
// T-READ-2 (a reading that fails its checks is retried with previousErrors, then CM-S04), T-FN-3
// (omitted empty fields filled), and the request checks.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import readChart from '../../netlify/functions/read-chart.mjs';
import { fillReading, readChartContent, READ_CUT_OFF } from '../../netlify/lib/stages.mjs';
import { setClientFactoryForTests } from '../../netlify/lib/anthropic.mjs';
import { loadPrompt } from '../../netlify/lib/prompts.mjs';
import { schemaText } from '../../shared/schemaCheck.js';
import { askDaniel } from '../../src/daniel/askDaniel.js';
import { config } from '../../shared/limits.js';
import { fakeClient, readEvents } from '../helpers/fakeAnthropic.js';

const CODE = 'class-code';
const IMAGE = { mediaType: 'image/png', base64: 'iVBORw0KGgo=' };
const pdfBody = (extra = {}) => ({ upload: { kind: 'pdf', imageRole: 'page', image: IMAGE, pdfText: 'Page 780 × 540 pt\n"Phillipines" x=1 y=2 w=3 size=18' }, attempt: 1, ...extra });
const pptxBody = (extra = {}) => ({ upload: { kind: 'pptx', pptx: { shapes: 'Slide 780 × 540 pt\nS2 "Revenue mix 2025"', charts: 'CHART 1 pie3DChart' } }, attempt: 1, ...extra });
const post = (b) => new Request('http://localhost/api/read-chart', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CM-Access-Code': CODE }, body: JSON.stringify(b),
});

export const READING = {
  readable: true,
  unreadableReason: null,
  kind: 'data',
  texts: { title: 'Revenue mix 2025', subheading: null, chartTitle: null, source: null, illustrativeLabel: false, other: [] },
  chart: {
    type: 'pie', orientation: 'n/a', stacking: 'none', is3D: true, dualAxis: false, panels: 1, logScale: false, logLabelled: false,
    sorted: 'descending', categories: ['Health & beauty retail'], series: [{ name: 'Revenue', colour: null, values: [{ x: 'Health & beauty retail', y: 3100 }], labelledDirectly: true, axis: 'primary' }],
    axes: [], referenceLines: [], annotations: [], gridlines: false, legend: true, dataLabels: 'all',
  },
  table: null,
  emphasis: 'The largest slice.',
  smallestTextPt: 14,
  valuesSource: 'file',
  uncertain: [],
  summary: 'I read this as revenue by business, 2025, in HK$m.',
};

let client;
function reply(obj, extra = {}) {
  client = fakeClient({ chunks: [typeof obj === 'string' ? obj : JSON.stringify(obj)], ...extra });
  setClientFactoryForTests(() => client);
}
const final = async (b) => (await readEvents(await readChart(post(b)))).at(-1);

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

describe('T-READ-1: what the model receives', () => {
  it('a PDF page: the image block, then one JSON block with the text layer', () => {
    const content = readChartContent(pdfBody());
    expect(content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } });
    expect(JSON.parse(content[1].text)).toEqual({ kind: 'pdf', image: 'attached above: the PDF page, rendered in the browser', pdfText: pdfBody().upload.pdfText });
  });

  it('a slide with no image: one JSON text block with its shapes and chart', () => {
    const content = readChartContent(pptxBody());
    expect(typeof content).toBe('string');
    expect(JSON.parse(content)).toEqual({ kind: 'pptx', pptx: { shapes: pptxBody().upload.pptx.shapes, charts: 'CHART 1 pie3DChart' } });
  });

  it('a slide with its thumbnail or a same-slide picture says which it is', () => {
    const thumb = readChartContent(pptxBody({ upload: { ...pptxBody().upload, image: IMAGE, imageRole: 'thumbnail' } }));
    expect(JSON.parse(thumb[1].text).image).toMatch(/thumbnail, low resolution, a guide to layout and colour only/);
    const same = readChartContent(pptxBody({ upload: { ...pptxBody().upload, image: IMAGE, imageRole: 'sameSlide' } }));
    expect(JSON.parse(same[1].text).image).toMatch(/same slide, supplied by the student/);
  });

  it('retry hints follow the JSON as previous_errors', () => {
    const content = readChartContent(pptxBody({ previousErrors: ['A data chart needs the chart object.'] }));
    expect(content).toMatch(/\n\n<previous_errors>\n- A data chart needs the chart object.\n<\/previous_errors>$/);
  });

  it('uses read-chart.md only (no persona), with the configured model and cached system prompt', async () => {
    reply(READING);
    await final(pdfBody());
    const params = client.beta.calls[0];
    expect(params.system).toEqual([{ type: 'text', text: expect.any(String), cache_control: { type: 'ephemeral' } }]);
    const text = params.system[0].text;
    expect(text.startsWith(loadPrompt('read-chart').text)).toBe(true);
    // The schema follows the prompt, so the model knows the exact property names.
    expect(text).toContain(schemaText('read-chart'));
    expect(params.system[0].text).not.toContain('Daniel Hart');
    expect(params.system[0].text).not.toContain('version:');
    expect(params).toMatchObject({ model: 'claude-opus-5-5', max_tokens: config.models.readChart.maxTokens, output_config: { effort: 'low' } });
  });
});

describe('what the browser gets', () => {
  it('a reading, with the prompt version and model', async () => {
    reply(READING);
    expect(await final(pdfBody())).toMatchObject({ type: 'result', reading: READING, promptVersion: 'read-chart 1.1', servedBy: 'claude-opus-5-5' });
  });

  it('T-FN-3: an unreadable page needs only its reason; the empty fields are filled', async () => {
    reply({ readable: false, unreadableReason: 'several charts' });
    expect(await final(pdfBody())).toMatchObject({ type: 'result', reading: { readable: false, unreadableReason: 'several charts', chart: null, table: null, uncertain: [] } });
    expect(fillReading({ ...READING, uncertain: undefined, texts: { title: 'T' } })).toMatchObject({ uncertain: [], texts: { title: 'T', other: [], source: null, illustrativeLabel: false } });
  });

  it.each([
    ['a summary that does not start "I read this as"', { ...READING, summary: 'Revenue by business.' }, /summary/],
    ['an unreadable page with no reason', { ...READING, readable: false, unreadableReason: null }, /needs unreadableReason/],
    ['a data chart with no chart', { ...READING, chart: null }, /needs the chart object/],
    ['a table with no table', { ...READING, kind: 'table', chart: null }, /needs the table object/],
    ['a readable page with a reason', { ...READING, unreadableReason: 'blurred' }, /must be null when readable/],
    ['an unknown chart type', { ...READING, chart: { ...READING.chart, type: 'radar' } }, /Schema/],
  ])('T-READ-2: %s is invalid, so the browser retries', async (_label, data, error) => {
    reply(data);
    const r = await final(pdfBody());
    expect(r.type).toBe('invalid');
    expect(r.errors.join(' ')).toMatch(error);
  });

  it('a reading cut off at max_tokens comes back invalid, with the instruction to cut texts.other', async () => {
    reply('{"readable": true, "kind": "data", "texts": {', { stopReason: 'max_tokens' });
    expect(await final(pdfBody())).toEqual({ type: 'invalid', errors: [READ_CUT_OFF] });
  });

  it('T-READ-2: the browser retries an invalid reading with previousErrors, then gives up with CM-S04', async () => {
    const call = vi.fn(async () => ({ ok: false, status: 200, error: 'invalid', errors: ['Schema: /summary must match pattern.'] }));
    const r = await askDaniel('/api/read-chart', pdfBody(), CODE, { call });
    expect(call).toHaveBeenCalledTimes(config.replyMaxAttempts);
    expect(call.mock.calls[1][1]).toMatchObject({ attempt: 2, previousErrors: ['Schema: /summary must match pattern.'] });
    expect(r).toEqual({ ok: false, message: "Daniel's reply didn't come through properly. Try again.", code: 'CM-S04', final: false });
  });
});

describe('request checks', () => {
  it.each([
    ['no upload', { upload: undefined }],
    ['an unknown kind', { upload: { kind: 'docx', image: IMAGE } }],
    ['a PDF with no image', { upload: { kind: 'pdf', pdfText: 'x' } }],
    ['a photo with no image', { upload: { kind: 'image' } }],
    ['a photo with a text layer', { upload: { kind: 'image', image: IMAGE, pdfText: 'x' } }],
    ['a GIF', { upload: { kind: 'image', image: { mediaType: 'image/gif', base64: 'R0lG' } } }],
    ['an unknown image role', { upload: { kind: 'image', image: IMAGE, imageRole: 'selfie' } }],
    ['a slide with nothing to read', { upload: { kind: 'pptx', pptx: { shapes: ' ' } } }],
    ['a slide whose shapes are not text', { upload: { kind: 'pptx', pptx: { shapes: ['S1'] } } }],
    ['attempt 0', { attempt: 0 }],
    ['attempt 4', { attempt: 4 }],
  ])('400 for %s, with no model call', async (_label, extra) => {
    reply(READING);
    const res = await readChart(post(pdfBody(extra)));
    expect(res.status).toBe(400);
    expect(client.calls.length + client.beta.calls.length).toBe(0);
  });

  it('accepts a photo, a slide with only an image, and a slide with only a table', async () => {
    for (const upload of [
      { kind: 'image', imageRole: 'photo', image: IMAGE },
      { kind: 'pptx', imageRole: 'picture', image: IMAGE, pptx: { shapes: '' } },
      { kind: 'pptx', pptx: { tables: 'TABLE 1\nrow 1: a | b' } },
    ]) {
      reply(READING);
      expect((await final({ upload, attempt: 1 })).type).toBe('result');
    }
  });
});
