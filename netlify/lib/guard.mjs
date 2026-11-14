// Request guard for every function (CMS-6): method, access code, size limits, then the case
// detector. Order follows spec §12; copied from Tree Surgery.
// Nothing reaches the model unless all four pass.
import { timingSafeEqual } from 'node:crypto';
import { limits, MESSAGES } from '../../shared/limits.js';
import { codeForOutcome } from '../../shared/errorCodes.js';
import { CASE_BLOCK_MESSAGE, collectStudentText, detectCase } from '../../shared/caseDetector.js';

export const ACCESS_HEADER = 'x-cm-access-code';

export function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

function codesMatch(given, expected) {
  const a = Buffer.from(String(given ?? ''), 'utf8');
  const b = Buffer.from(String(expected), 'utf8');
  // Compare against itself on length mismatch so timing doesn't reveal the length.
  if (a.length !== b.length) {
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

export function checkAccessCode(req, expected = process.env.CM_ACCESS_CODE) {
  if (!expected) return json(500, { error: 'server_misconfigured', message: MESSAGES.serverMisconfigured });
  if (!codesMatch(req.headers.get(ACCESS_HEADER), expected)) {
    return json(401, { error: 'bad_access_code', message: MESSAGES.badAccessCode });
  }
  return null;
}

function tooLarge() {
  return json(413, { error: 'too_large', message: MESSAGES.tooLarge });
}

const over = (value, max) => typeof value === 'string' && value.length > max;

// Character limits on the student text a request can carry (spec §12).
export function checkTextLimits(body) {
  const input = body?.input && typeof body.input === 'object' ? body.input : {};
  const pptx = body?.upload?.pptx ?? {};
  const pptxChars = ['shapes', 'charts', 'tables'].reduce((n, k) => n + (typeof pptx[k] === 'string' ? pptx[k].length : 0), 0);
  const list = (v, max) => Array.isArray(v) && v.some((s) => over(s, max));
  if (
    over(body?.upload?.pdfText, limits.pdfTextMaxChars)
    || pptxChars > limits.pptxTextMaxChars
    || over(pptx.charts, limits.chartXmlMaxChars)
    || over(input.audience, limits.audienceMaxChars)
    || over(input.lead, limits.leadMaxChars)
    || over(input.readingCorrection, limits.correctionMaxChars)
    || over(input.comparison, limits.comparisonMaxChars)
    || list(input.dataToSource, limits.dataToSourceMaxChars)
    || (input.history !== undefined && JSON.stringify(input.history).length > limits.historyMaxChars)
  ) return tooLarge();
  return null;
}

/**
 * Runs the common checks. Returns { body } on success or { response } to send back as is;
 * `missing` names an unset environment variable, for the log only (CM-S01).
 * @param {Request} req
 * @param {{ accessCode?: string, parseBody?: boolean, maxBytes?: number }} [opts] maxBytes is
 *   larger for /api/read-chart, which carries the page image.
 */
export async function guard(req, opts = {}) {
  if (req.method !== 'POST') {
    return { response: json(405, { error: 'method_not_allowed' }, { Allow: 'POST' }) };
  }
  const expected = opts.accessCode ?? process.env.CM_ACCESS_CODE;
  const denied = checkAccessCode(req, expected);
  if (denied) return { response: denied, ...(expected ? {} : { missing: 'CM_ACCESS_CODE' }) };

  const maxBytes = opts.maxBytes ?? limits.requestMaxBytes;
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return { response: tooLarge() };

  const raw = await req.text();
  if (Buffer.byteLength(raw, 'utf8') > maxBytes) return { response: tooLarge() };
  if (opts.parseBody === false) return { body: null };

  let body;
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    return { response: json(400, { error: 'bad_request', message: MESSAGES.badRequest }) };
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { response: json(400, { error: 'bad_request', message: MESSAGES.badRequest }) };
  }
  const overText = checkTextLimits(body);
  if (overText) return { response: overText };

  // Rule IDs only go back in the response; never the matched text.
  const detection = detectCase(collectStudentText(body));
  if (detection.blocked) {
    return { response: json(422, { error: 'case_blocked', message: CASE_BLOCK_MESSAGE }), caseBlocked: detection.reasons };
  }

  return { body };
}

// Logs metadata only, never student content or findings (spec §12): the error code, and for
// CM-S01 the name of the missing environment variable.
export function logCall({ endpoint, round = null, startedAt, outcome, attempt = null, inputTokens = null, outputTokens = null, missing }) {
  const durationMs = Date.now() - startedAt;
  const code = codeForOutcome(outcome);
  console.log(JSON.stringify({
    ts: 'call', endpoint, ...(round ? { round } : {}), durationMs, inputTokens, outputTokens, attempt, outcome, code,
    ...(missing ? { missing } : {}),
  }));
}
