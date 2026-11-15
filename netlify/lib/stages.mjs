// The model-call cores (spec §7): what each function sends and how it reads the reply. The
// functions use `finish`; the read test and the pilot harness call `read` in-process.
import { stageSystemPrompt, taskSystemPrompt } from './prompts.mjs';
import { checkReview } from '../../shared/reviewCheck.js';
import { checkSchema, parseModelJson, schemaText } from '../../shared/schemaCheck.js';
import { config } from '../../shared/limits.js';

const INVALID_JSON = 'Your reply was not a single valid JSON object. Return only the JSON object.';

function cleanErrors(errors) {
  return Array.isArray(errors) ? errors.filter((e) => typeof e === 'string' && e.trim()).slice(0, 20) : [];
}

/**
 * Parses and checks a reply: JSON, then omitted empty fields filled in (QT D23, spec D24), then
 * the schema, then the call's own check.
 * @returns {{ ok: true, data: object } | { ok: false, errors: string[] }}
 */
export function readReply(text, { schema, fill = (d) => d, check = () => ({ ok: true, errors: [] }) }) {
  const parsed = parseModelJson(text);
  if (!parsed.ok) return { ok: false, errors: [INVALID_JSON] };
  const data = fill(parsed.data);
  const valid = checkSchema(schema, data);
  if (!valid.ok) return { ok: false, errors: valid.errors.map((e) => `Schema: ${e}.`) };
  const checked = check(data);
  return checked.ok ? { ok: true, data } : { ok: false, errors: checked.errors };
}

// ---------- Reading the chart (spec §3.5, CMS-7) ----------

// A reading cut off at max_tokens comes back as invalid with this, so the retry can be shorter.
export const READ_CUT_OFF = 'Your last reply was cut off at the length limit. Keep every series and value, but in texts.other list only text that is not already in chart or table (leave out tick labels, legend entries and data labels), and keep emphasis and summary to one short sentence each.';

// What the JSON block says about the attached image, by where it came from (spec §3.3).
export const IMAGE_ROLES = {
  page: 'attached above: the PDF page, rendered in the browser',
  photo: "attached above: the student's photo or screenshot",
  picture: 'attached above: the chart, which is a picture pasted onto the slide',
  thumbnail: "attached above: the slide's embedded thumbnail, low resolution, a guide to layout and colour only",
  sameSlide: 'attached above: a PDF export or picture of this same slide, supplied by the student; the pptx data is the truth for words and values',
};

/** Fills the fields a model may leave out when they are empty (D24). */
export function fillReading(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  const defaults = (obj, values) => {
    const o = { ...obj };
    for (const [k, v] of Object.entries(values)) if (o[k] === undefined || (Array.isArray(v) && o[k] === null)) o[k] = v;
    return o;
  };
  const out = defaults(data, { unreadableReason: null, chart: null, table: null, uncertain: [], smallestTextPt: null });
  if (out.texts && typeof out.texts === 'object') {
    out.texts = defaults(out.texts, { title: null, subheading: null, chartTitle: null, source: null, illustrativeLabel: false, other: [] });
  }
  if (out.readable === false) {
    // An unreadable page needs only its reason; the rest is empty.
    out.kind ??= 'text';
    out.texts ??= { title: null, subheading: null, chartTitle: null, source: null, illustrativeLabel: false, other: [] };
    out.emphasis ??= '';
    out.valuesSource ??= 'none';
    out.summary ??= 'I read this as a page I could not read.';
  }
  return out;
}

/** A reading is consistent: readable pages have what their kind needs; unreadable ones a reason. */
export function checkReading(data) {
  const errors = [];
  if (!data.readable) {
    if (!data.unreadableReason?.trim()) errors.push('An unreadable page needs unreadableReason.');
    return { ok: errors.length === 0, errors };
  }
  if (data.unreadableReason !== null) errors.push('unreadableReason must be null when readable is true.');
  if (data.kind === 'data' && !data.chart) errors.push('A data chart needs the chart object.');
  if (data.kind === 'table' && !data.table) errors.push('A table needs the table object.');
  return { ok: errors.length === 0, errors };
}

/**
 * The user message (spec §3.5, D6): the image block when there is one, then one JSON text block.
 * Retry hints follow the JSON as <previous_errors>.
 */
export function readChartContent(body) {
  const { upload } = body;
  const input = { kind: upload.kind };
  if (upload.image) input.image = IMAGE_ROLES[upload.imageRole] ?? IMAGE_ROLES.page;
  if (upload.pdfText) input.pdfText = upload.pdfText;
  if (upload.pptx) {
    input.pptx = Object.fromEntries(['shapes', 'charts', 'tables'].filter((k) => upload.pptx[k]).map((k) => [k, upload.pptx[k]]));
  }
  const errors = cleanErrors(body.previousErrors);
  const text = JSON.stringify(input, null, 2)
    + (errors.length ? `\n\n<previous_errors>\n${errors.map((e) => `- ${e}`).join('\n')}\n</previous_errors>` : '');
  if (!upload.image) return text;
  return [
    { type: 'image', source: { type: 'base64', media_type: upload.image.mediaType, data: upload.image.base64 } },
    { type: 'text', text },
  ];
}

export function readChartStage(body) {
  const prompt = taskSystemPrompt('read-chart');
  const read = (text) => readReply(text, { schema: 'read-chart', fill: fillReading, check: checkReading });
  return {
    call: 'readChart',
    // The prompt ends at its Output heading; the schema it names follows, so there is one copy of it.
    system: `${prompt.text}\n\n\`\`\`json\n${schemaText('read-chart')}\n\`\`\``,
    content: readChartContent(body),
    promptVersion: prompt.version,
    truncatedError: READ_CUT_OFF,
    read,
    finish(text) {
      const r = read(text);
      if (!r.ok) return { type: 'invalid', errors: r.errors };
      return { type: 'result', reading: r.data };
    },
  };
}

// ---------- Stage reviews (spec §4, §6, §7) ----------

/** Fills the fields a review may leave out when they are empty (D24). */
export function fillReview(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  const out = { ...data };
  for (const [k, v] of Object.entries({ findings: [], declineResponses: [], whatWorks: null, offeredLead: null, route: null, reopenStage: null, impression: null })) {
    if (out[k] === undefined || (Array.isArray(v) && out[k] === null)) out[k] = v;
  }
  return out;
}

/**
 * The user message for a review (D6): the 1,600 px image block when the stage sends one, then the
 * input as one JSON text block, then any <previous_errors>.
 */
export function reviewContent(body) {
  const { image, ...input } = body.input;
  const errors = cleanErrors(body.previousErrors);
  const text = JSON.stringify({ stage: body.stage, round: body.round, ...input, ...(image ? { image: 'attached above: the chart as uploaded' } : {}) }, null, 2)
    + (errors.length ? `\n\n<previous_errors>\n${errors.map((e) => `- ${e}`).join('\n')}\n</previous_errors>` : '');
  if (!image) return text;
  return [
    { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.base64 } },
    { type: 'text', text },
  ];
}

export const REVIEW_CUT_OFF = 'Your last reply was cut off at the length limit. Keep the same findings, each issue and fix to one sentence, and the message to about 100 words.';

/**
 * One stage review (spec §7): the stage's system prompt, one call, then parse, fill, schema and
 * the review check. `read(text)` gives `{ ok, data, fixes }` or `{ ok: false, errors, fixes }`.
 */
export function reviewStage(body) {
  const prompt = stageSystemPrompt(body.stage, schemaText('stage-review'));
  const request = { stage: body.stage, round: body.round, input: body.input };
  let fixes = [];
  const read = (text) => {
    fixes = [];
    const r = readReply(text, {
      schema: 'stage-review',
      fill: fillReview,
      check: (data) => {
        const c = checkReview(data, request);
        fixes = c.fixes;
        if (c.ok) Object.assign(data, c.data);
        return c;
      },
    });
    return { ...r, fixes };
  };
  return {
    call: `stage${body.stage}`,
    system: prompt.text,
    content: reviewContent(body),
    promptVersion: prompt.version,
    truncatedError: REVIEW_CUT_OFF,
    read,
    finish(text) {
      const r = read(text);
      if (!r.ok) return { type: 'invalid', errors: r.errors, fixes: r.fixes };
      return { type: 'result', data: r.data, rulesVersion: config.rulesVersion ?? null, fixes: r.fixes.map((f) => f.type) };
    },
  };
}
