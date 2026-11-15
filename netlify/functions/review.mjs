// POST /api/review: one stage review (CM-4, spec §4, §6, §7). Body: { stage: 1..5, round, input,
// attempt, previousErrors? }. One model call with Daniel's persona, the overlay and the stage
// prompt; the reply passes the schema and the review check (§7.1) or comes back as invalid for the
// browser's retry. Stages 2–4 carry the 1,600 px image, so the size limit is reviewMaxBytes.
import { guard, json, logCall } from '../lib/guard.mjs';
import { respondWithModel } from '../lib/anthropic.mjs';
import { reviewStage } from '../lib/stages.mjs';
import { MESSAGES, config as appConfig, limits } from '../../shared/limits.js';

const ENDPOINT = 'review';
const IMAGE_TYPES = ['image/png', 'image/jpeg'];
const isText = (v) => typeof v === 'string' && v.trim().length > 0;

function validImage(image) {
  return image && IMAGE_TYPES.includes(image.mediaType) && isText(image.base64) && /^[A-Za-z0-9+/]+=*$/.test(image.base64.slice(0, 200));
}

export function validBody(body) {
  const { stage, round, input, attempt } = body;
  if (![1, 2, 3, 4, 5].includes(stage) || !Number.isInteger(round) || round < 1 || round > 20) return false;
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  if (!isText(input.audience)) return false;
  if (stage === 1 ? !isText(input.lead) : (input.lead !== null && typeof input.lead !== 'string')) return false;
  if (input.image !== undefined && (stage < 2 || stage > 4 || !validImage(input.image))) return false;
  if (input.history !== undefined && !Array.isArray(input.history)) return false;
  if (input.declines !== undefined && !(Array.isArray(input.declines) && input.declines.every((d) => isText(d?.findingId) && isText(d?.reason)))) return false;
  return Number.isInteger(attempt) && attempt >= 1 && attempt <= appConfig.replyMaxAttempts;
}

export default async (req) => {
  const startedAt = Date.now();
  const { response, body, missing } = await guard(req, { maxBytes: limits.reviewMaxBytes });
  const attempt = Number.isInteger(body?.attempt) ? body.attempt : null;
  const round = Number.isInteger(body?.stage) ? `stage${body.stage}-r${body.round}` : null;
  if (response) {
    logCall({ endpoint: ENDPOINT, round, startedAt, attempt, outcome: response.status, missing });
    return response;
  }
  if (!validBody(body)) {
    logCall({ endpoint: ENDPOINT, round, startedAt, attempt, outcome: 400 });
    return json(400, { error: 'bad_request', message: MESSAGES.badRequest });
  }
  const stage = reviewStage(body);
  return respondWithModel({ ...stage, endpoint: ENDPOINT, round, startedAt, attempt });
};

export const config = { path: '/api/review' };
