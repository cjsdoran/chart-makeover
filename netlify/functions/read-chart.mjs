// POST /api/read-chart: reads the uploaded chart into a structured reading (CM-2, spec §3.5). One
// model call, no persona (CMS-7). Body: { upload: { kind: 'pdf'|'image'|'pptx', imageRole?,
// image?: { mediaType, base64 }, pdfText?, pptx?: { shapes, charts?, tables? } }, attempt,
// previousErrors? }. The request may carry the page image, so its size limit is readChartMaxBytes.
import { guard, json, logCall } from '../lib/guard.mjs';
import { respondWithModel } from '../lib/anthropic.mjs';
import { IMAGE_ROLES, readChartStage } from '../lib/stages.mjs';
import { MESSAGES, config as appConfig, limits } from '../../shared/limits.js';

const ENDPOINT = 'read-chart';
const IMAGE_TYPES = ['image/png', 'image/jpeg'];
const isText = (v) => typeof v === 'string' && v.trim().length > 0;
const optionalText = (v) => v === undefined || typeof v === 'string';

function validImage(image) {
  return image && IMAGE_TYPES.includes(image.mediaType) && isText(image.base64) && /^[A-Za-z0-9+/]+=*$/.test(image.base64.slice(0, 200));
}

export function validBody(body) {
  const { upload, attempt } = body;
  if (!upload || typeof upload !== 'object' || !['pdf', 'image', 'pptx'].includes(upload.kind)) return false;
  if (upload.image !== undefined && !validImage(upload.image)) return false;
  if (upload.imageRole !== undefined && !Object.hasOwn(IMAGE_ROLES, upload.imageRole)) return false;
  if (!optionalText(upload.pdfText)) return false;
  if (upload.pptx !== undefined) {
    const p = upload.pptx;
    if (!p || typeof p !== 'object' || !optionalText(p.shapes) || !optionalText(p.charts) || !optionalText(p.tables)) return false;
  }
  // A PDF page and a photo are always an image; a slide is its parsed text, with an image if any.
  const hasInput = upload.kind === 'pptx'
    ? Boolean(upload.pptx) && (isText(upload.pptx.shapes) || isText(upload.pptx.charts) || isText(upload.pptx.tables) || Boolean(upload.image))
    : Boolean(upload.image) && upload.pptx === undefined;
  if (upload.kind === 'image' && upload.pdfText !== undefined) return false;
  return hasInput && Number.isInteger(attempt) && attempt >= 1 && attempt <= appConfig.replyMaxAttempts;
}

export default async (req) => {
  const startedAt = Date.now();
  const { response, body, missing } = await guard(req, { maxBytes: limits.readChartMaxBytes });
  const attempt = Number.isInteger(body?.attempt) ? body.attempt : null;
  if (response) {
    logCall({ endpoint: ENDPOINT, startedAt, attempt, outcome: response.status, missing });
    return response;
  }
  if (!validBody(body)) {
    logCall({ endpoint: ENDPOINT, startedAt, attempt, outcome: 400 });
    return json(400, { error: 'bad_request', message: MESSAGES.badRequest });
  }
  const stage = readChartStage(body);
  return respondWithModel({ ...stage, endpoint: ENDPOINT, startedAt, attempt });
};

export const config = { path: '/api/read-chart' };
