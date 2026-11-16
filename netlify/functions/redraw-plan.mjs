// POST /api/redraw-plan: turns the agreed lead and the accepted fixes into a redraw spec (CM-8, spec
// §9.1, D80), in two calls the browser makes one after the other, each inside the time budget.
// Body: { part: 'chart' | 'finish', input: { lead, audience, comparison, reading, readingCorrection,
// acceptedFixes, declinedFixes, dataToSource, isDummy }, plannedChart? (part 'finish': the first
// call's chart), attempt, previousErrors? }. One model call, no persona; the reply passes the schema
// and the redraw check or comes back as invalid for the browser's retry.
// The browser builds the .pptx from the spec (no server-side file generation).
import { guard, json, logCall } from '../lib/guard.mjs';
import { respondWithModel } from '../lib/anthropic.mjs';
import { redrawPlanStage } from '../lib/stages.mjs';
import { MESSAGES, config as appConfig, limits } from '../../shared/limits.js';

const ENDPOINT = 'redraw-plan';
const isText = (v) => typeof v === 'string' && v.trim().length > 0;
const fixList = (v, withReason) => Array.isArray(v) && v.length <= 60
  && v.every((f) => f && typeof f === 'object' && typeof f.fix === 'string' && (!withReason || isText(f.reason)));

export function validBody(body) {
  const { input, attempt, part, plannedChart } = body;
  if (!['chart', 'finish'].includes(part)) return false;
  if (part === 'finish' && !(plannedChart && typeof plannedChart === 'object' && plannedChart.redrawable === true
    && (plannedChart.chart || plannedChart.table) && typeof plannedChart.subheading === 'string' && typeof plannedChart.source === 'string')) return false;
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  if (!isText(input.lead) || !isText(input.audience)) return false;
  if (!input.reading || typeof input.reading !== 'object') return false;
  if (!fixList(input.acceptedFixes, false) || !fixList(input.declinedFixes, true)) return false;
  if (!Array.isArray(input.dataToSource) || !input.dataToSource.every((d) => typeof d === 'string')) return false;
  if (typeof input.isDummy !== 'boolean') return false;
  return Number.isInteger(attempt) && attempt >= 1 && attempt <= appConfig.replyMaxAttempts;
}

export default async (req) => {
  const startedAt = Date.now();
  const { response, body, missing } = await guard(req, { maxBytes: limits.requestMaxBytes });
  const attempt = Number.isInteger(body?.attempt) ? body.attempt : null;
  if (response) {
    logCall({ endpoint: ENDPOINT, startedAt, attempt, outcome: response.status, missing });
    return response;
  }
  if (!validBody(body)) {
    logCall({ endpoint: ENDPOINT, startedAt, attempt, outcome: 400 });
    return json(400, { error: 'bad_request', message: MESSAGES.badRequest });
  }
  const stage = redrawPlanStage(body);
  return respondWithModel({ ...stage, endpoint: ENDPOINT, startedAt, attempt });
};

export const config = { path: '/api/redraw-plan' };
