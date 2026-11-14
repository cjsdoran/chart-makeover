// T-FN-1: the access-code guard and size limits on every function (spec §12, T-SET-1 server side),
// T-DET-2: the server-side case detector, and the CM-S01/S02 codes in the logs (T-ERR-1, T-ERR-2).
// Ported from Tree Surgery.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { guard } from '../../netlify/lib/guard.mjs';
import { limits } from '../../shared/limits.js';
import { CASE_BLOCK_MESSAGE } from '../../shared/caseDetector.js';
import check from '../../netlify/functions/check.mjs';
import readChart from '../../netlify/functions/read-chart.mjs';

const CODE = 'test-class-code';
const MODEL_FUNCTIONS = { 'read-chart': readChart };

function post(body, { code = CODE, headers = {} } = {}) {
  const h = { 'Content-Type': 'application/json', ...headers };
  if (code !== null) h['X-CM-Access-Code'] = code;
  return new Request('http://localhost/api/test', {
    method: 'POST',
    headers: h,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const logged = () => console.log.mock.calls.map((c) => JSON.parse(c[0]));

beforeEach(() => {
  vi.stubEnv('CM_ACCESS_CODE', CODE);
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('guard', () => {
  it('accepts a POST with the right code and returns the parsed body', async () => {
    const { body, response } = await guard(post({ attempt: 1 }));
    expect(response).toBeUndefined();
    expect(body).toEqual({ attempt: 1 });
  });

  it('rejects other methods with 405', async () => {
    const { response } = await guard(new Request('http://localhost/api/test'));
    expect(response.status).toBe(405);
  });

  it.each([
    ['missing', null],
    ['wrong', 'nope'],
    ['wrong but same length', 'test-class-codX'],
  ])('rejects a %s access code with 401 and the Canvas message', async (_label, code) => {
    const { response } = await guard(post({}, { code }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: 'bad_access_code',
      message: "That access code isn't recognised. Check Canvas.",
    });
  });

  it("does not accept Question Time's header", async () => {
    const { response } = await guard(post({}, { code: null, headers: { 'X-QT-Access-Code': CODE } }));
    expect(response.status).toBe(401);
  });

  it('T-ERR-1 CM-S01: fails closed with 500 when CM_ACCESS_CODE is not set; only the log names it', async () => {
    vi.stubEnv('CM_ACCESS_CODE', '');
    const res = await check(post({}));
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain('CM_ACCESS_CODE');
    expect(JSON.parse(text)).toEqual({ error: 'server_misconfigured', message: 'Chart Makeover is not set up correctly. Tell your instructor.' });
    expect(logged().at(-1)).toMatchObject({ endpoint: 'check', outcome: 500, code: 'CM-S01', missing: 'CM_ACCESS_CODE' });
  });

  it('T-ERR-2 CM-S02: logs the code for a bad access code', async () => {
    await check(post({}, { code: 'nope' }));
    expect(logged().at(-1)).toMatchObject({ ts: 'call', endpoint: 'check', outcome: 401, code: 'CM-S02' });
  });

  it('checks the access code before the size limit', async () => {
    const big = 'x'.repeat(limits.requestMaxBytes + 1);
    const { response } = await guard(post(big, { code: 'nope' }));
    expect(response.status).toBe(401);
  });

  it('rejects a request over 1 MB with 413, unless the function allows more', async () => {
    const big = JSON.stringify({ pad: 'x'.repeat(limits.requestMaxBytes) });
    expect((await guard(post(big))).response.status).toBe(413);
    expect((await guard(post(big), { maxBytes: limits.readChartMaxBytes })).response).toBeUndefined();
  });

  it('counts bytes, not characters, against the request limit', async () => {
    // Each 中 is 3 bytes in UTF-8.
    const chars = Math.ceil(limits.requestMaxBytes / 3) + 10;
    const { response } = await guard(post(JSON.stringify({ pad: '中'.repeat(chars) })));
    expect(response.status).toBe(413);
  });

  it.each([
    ['PDF text layer', { upload: { kind: 'pdf', pdfText: 'a'.repeat(limits.pdfTextMaxChars + 1) } }],
    ['slide text', { upload: { kind: 'pptx', pptx: { shapes: 'a'.repeat(limits.pptxTextMaxChars - 10), tables: 'b'.repeat(11) } } }],
    ['chart text', { upload: { kind: 'pptx', pptx: { charts: 'a'.repeat(limits.chartXmlMaxChars + 1) } } }],
    ['audience line', { input: { audience: 'a'.repeat(limits.audienceMaxChars + 1) } }],
    ['lead', { input: { lead: 'a'.repeat(limits.leadMaxChars + 1) } }],
    ['reading correction', { input: { readingCorrection: 'a'.repeat(limits.correctionMaxChars + 1) } }],
    ['comparison', { input: { comparison: 'a'.repeat(limits.comparisonMaxChars + 1) } }],
    ['data to source', { input: { dataToSource: ['ok', 'a'.repeat(limits.dataToSourceMaxChars + 1)] } }],
    ['history', { input: { history: ['a'.repeat(limits.historyMaxChars)] } }],
  ])('rejects an over-long %s with 413', async (_label, body) => {
    expect((await guard(post(body))).response.status).toBe(413);
  });

  it('accepts text at the limits', async () => {
    const { response } = await guard(post({
      upload: { kind: 'pdf', pdfText: 'a'.repeat(limits.pdfTextMaxChars) },
      input: { audience: 'a'.repeat(limits.audienceMaxChars), lead: 'b'.repeat(limits.leadMaxChars) },
    }));
    expect(response).toBeUndefined();
  });

  it.each(['not json', '[1,2]', 'null'])('rejects a body of %s with 400', async (raw) => {
    const { response } = await guard(post(raw));
    expect(response.status).toBe(400);
  });

  it('logs metadata only, never the request content', async () => {
    await readChart(post({ upload: { kind: 'pdf', pdfText: 'SECRET STUDENT TEXT' } }));
    const lines = console.log.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(lines).not.toContain('SECRET STUDENT TEXT');
    expect(logged()[0]).toMatchObject({ ts: 'call', endpoint: 'read-chart' });
  });
});

describe('T-DET-2: server-side case detector', () => {
  const CASE = 'This case was written by Professor Lee solely as a basis for class discussion.';
  const bodies = {
    'PDF text layer': { upload: { kind: 'pdf', pdfText: CASE } },
    'slide shapes': { upload: { kind: 'pptx', pptx: { shapes: `S1 "${CASE}"` } } },
    'chart text': { upload: { kind: 'pptx', pptx: { charts: `CHART 1 ${CASE}` } } },
    'slide table': { upload: { kind: 'pptx', pptx: { tables: `row 1: ${CASE}` } } },
    'audience line': { input: { audience: CASE } },
    lead: { input: { lead: CASE } },
  };

  for (const [name, fn] of Object.entries(MODEL_FUNCTIONS)) {
    it.each(Object.keys(bodies))(`/api/${name} returns 422 case_blocked for case text in the %s, and logs CM-U06`, async (where) => {
      const res = await fn(post(bodies[where]));
      expect(res.status).toBe(422);
      expect(await res.json()).toEqual({ error: 'case_blocked', message: CASE_BLOCK_MESSAGE });
      expect(logged().at(-1)).toMatchObject({ endpoint: name, outcome: 422, code: 'CM-U06' });
    });
  }

  it('checks the access code before the detector', async () => {
    const res = await readChart(post(bodies['PDF text layer'], { code: 'nope' }));
    expect(res.status).toBe(401);
  });

  it('lets an ordinary chart through', async () => {
    const { response } = await guard(post({ upload: { kind: 'pdf', pdfText: '"Source: Deloitte Football Money League; club annual reports" x=1 y=2 w=3 size=12' } }));
    expect(response).toBeUndefined();
  });
});

describe('functions', () => {
  it('/api/check returns 204 for the right code and 401 otherwise', async () => {
    expect((await check(post(''))).status).toBe(204);
    expect((await check(post('', { code: 'nope' }))).status).toBe(401);
  });

  it('/api/read-chart is guarded (401) and needs an upload and an attempt (400)', async () => {
    expect((await readChart(post({}, { code: 'nope' }))).status).toBe(401);
    expect((await readChart(post({}))).status).toBe(400);
  });

  it('/api/read-chart takes a page image over 1 MB (up to 5 MB); /api/check refuses it', async () => {
    const body = { upload: { kind: 'pdf', image: { mediaType: 'image/png', base64: 'A'.repeat(2 * 1024 * 1024) } } };
    // Past the size check, so the body check answers: 400 (no attempt), not 413.
    expect((await readChart(post(body))).status).toBe(400);
    expect((await check(post(body))).status).toBe(413);
    const huge = { upload: { kind: 'pdf', image: { mediaType: 'image/png', base64: 'A'.repeat(limits.readChartMaxBytes) } } };
    expect((await readChart(post(huge))).status).toBe(413);
  });
});
