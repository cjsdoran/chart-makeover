// The chart upload (CM-1, CM-2, spec §3.2–3.3): one .pptx slide, one PDF page, or a photo or
// screenshot, checked in the browser in order: type (extension and magic bytes), size, open (HEIC
// converted first), one chart, something to read, and the case detector. Then the read call's
// `upload` body and the 1,600 px copy kept in the session. Every refusal carries an error code.
// The file itself is never stored. Built on Tree Surgery's treeUpload.js.
import { config, limits } from '../../shared/limits.js';
import { CODES } from '../../shared/errorCodes.js';
import { CASE_BLOCK_MESSAGE, detectCase } from '../../shared/caseDetector.js';
import { openPdf, pageImage, pageSize, pageTextBlock, pageTextLines, pdfjsAssets, recordImage } from './pdfPage.js';
import { chartsText, listSlides, openPptx, pictureBase64, readSlide, shapesText, slideContent, tablesText, thumbnailBase64 } from './pptx.js';
import { preparePhoto } from './image.js';

const MB = 1024 * 1024;
const ONE_CHART = config.upload.oneChartMessage;

export const UPLOAD_MESSAGES = {
  wrongType: (name) => `${name} isn't a PowerPoint slide, a PDF or a photo. Upload a .pptx, .pdf, .png, .jpg or .heic file.`,
  oldFormat: (name) => `${name} is an older PowerPoint file. Save it as .pptx, or export the slide to PDF, and upload again.`,
  tooBig: (name, mb) => `${name} is ${mb} MB. A chart file is limited to ${config.upload.maxMB} MB. Compress the pictures, or export the slide to PDF, and upload again.`,
  heic: 'Export the photo as JPEG and upload again.',
  unreadable: (name) => `We couldn't open ${name}. It may be damaged. Save it again, or export it to PDF, and upload again.`,
  password: (name) => `${name} is password-protected. Remove the password, or export it again without one, and upload again.`,
  // CM-U04 is Daniel's in-world line, then the hint.
  pages: (n) => `This PDF has ${n} pages. Upload a one-page PDF or a one-slide .pptx.`,
  slides: (n) => `This file has ${n} slides. Upload a one-page PDF or a one-slide .pptx.`,
  charts: (n) => `This slide has ${n} charts. Put just the chart you want to work on on the slide, and upload again.`,
  noChart: "We couldn't find a chart on that slide. Export it to PDF and upload that.",
  tooMuchText: 'Your slide has too much text to send. Upload just the chart.',
  caseBlocked: CASE_BLOCK_MESSAGE,
  sameSlideKind: (name) => `${name} isn't a PDF or a picture. Add the same slide as a one-page PDF, .png or .jpg, or leave it out.`,
};

const EXTENSIONS = { pptx: 'pptx', pdf: 'pdf', png: 'png', jpg: 'jpg', jpeg: 'jpg', heic: 'heic', heif: 'heic' };
const MEDIA = { png: 'image/png', jpg: 'image/jpeg' };

export function fileType(name) {
  const ext = /\.([a-z0-9]+)$/i.exec(name ?? '')?.[1]?.toLowerCase();
  return EXTENSIONS[ext] ?? null;
}

/** What the first bytes say the file is, or null. */
export function sniff(bytes) {
  const b = bytes;
  const ascii = (from, to) => String.fromCharCode(...b.subarray(from, to));
  if (ascii(0, 5) === '%PDF-') return 'pdf';
  if (b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) return 'pptx';
  if (b[0] === 0x89 && ascii(1, 4) === 'PNG') return 'png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (ascii(4, 8) === 'ftyp' && /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(ascii(8, 12))) return 'heic';
  return null;
}

/** A refusal: what the student sees, and the code they can quote to Chris. */
export function refuse(reason, code, message, detail) {
  return { ok: false, reason, code, message, ...(detail ? { detail } : {}) };
}

/** Logs a refusal to the browser console: code and error name only, never file content. */
function logRefusal(code, err) {
  if (typeof console !== 'undefined') console.warn(`Chart Makeover ${code}${err?.name ? ` ${err.name}` : ''}`);
}

const errorName = (err) => (/^\w{1,40}$/.test(err?.name ?? '') ? err.name : 'Error');
const fail = (reason, code, message, err) => {
  logRefusal(code, err);
  return refuse(reason, code, message, code === CODES.unreadable ? errorName(err) : undefined);
};
const oneChart = (reason, hint) => ({ ...fail(reason, CODES.oneChart, ONE_CHART), hint });

/**
 * Type, size and magic bytes; HEIC converted to JPEG.
 * @returns {Promise<{ ok: true, type: 'pptx'|'pdf'|'png'|'jpg', bytes: Uint8Array } | refusal>}
 */
async function openBytes(file, { convertHeic, allowed = ['pptx', 'pdf', 'png', 'jpg', 'heic'] }) {
  const type = fileType(file.name);
  if (!type || !allowed.includes(type)) {
    if (/\.(ppt|pps|pot)$/i.test(file.name ?? '') && allowed.includes('pptx')) return fail('old_format', CODES.oldFormat, UPLOAD_MESSAGES.oldFormat(file.name));
    return fail('wrong_type', CODES.wrongType, allowed.includes('pptx') ? UPLOAD_MESSAGES.wrongType(file.name) : UPLOAD_MESSAGES.sameSlideKind(file.name));
  }
  if (file.size > config.upload.maxMB * MB) return fail('too_big', CODES.tooBig, UPLOAD_MESSAGES.tooBig(file.name, (file.size / MB).toFixed(1)));
  let bytes = new Uint8Array(await file.arrayBuffer());
  if (sniff(bytes) !== type) return fail('wrong_type', CODES.wrongType, UPLOAD_MESSAGES.wrongType(file.name));
  if (type === 'heic') {
    try {
      bytes = await convertHeic(bytes);
    } catch (err) {
      return fail('heic', CODES.heic, UPLOAD_MESSAGES.heic, err);
    }
    return { ok: true, type: 'jpg', bytes };
  }
  return { ok: true, type, bytes };
}

const b64 = (deps, image) => ({ mediaType: image.mediaType, base64: deps.toBase64(image.bytes) });
const stored = (deps, rec) => ({ mediaType: rec.mediaType, base64: deps.toBase64(rec.bytes), width: rec.width, height: rec.height });

async function preparePdf(bytes, name, deps, { withText = true } = {}) {
  let pdf;
  try {
    pdf = await openPdf(bytes, await deps.loadPdfjs(), deps.assetsBase ? pdfjsAssets(deps.assetsBase) : {});
  } catch (err) {
    if (err?.name === 'PasswordException') return fail('password', CODES.password, UPLOAD_MESSAGES.password(name), err);
    return fail('unreadable', CODES.unreadable, UPLOAD_MESSAGES.unreadable(name), err);
  }
  try {
    if (pdf.pageCount !== config.upload.pdfPages) return oneChart('pages', UPLOAD_MESSAGES.pages(pdf.pageCount));
    const { doc } = pdf;
    const lines = await pageTextLines(doc, 1);
    const pdfText = pageTextBlock(lines, await pageSize(doc, 1));
    if (detectCase(pdfText).blocked) return fail('case_blocked', CODES.caseBlocked, UPLOAD_MESSAGES.caseBlocked);
    const image = await pageImage(doc, 1, deps);
    const rec = await recordImage(doc, 1, deps);
    return { ok: true, image: b64(deps, image), record: stored(deps, rec), pdfText: withText && pdfText ? pdfText : undefined };
  } catch (err) {
    return fail('unreadable', CODES.unreadable, UPLOAD_MESSAGES.unreadable(name), err);
  } finally {
    await pdf.close();
  }
}

async function prepareImage(bytes, type, name, deps) {
  try {
    const p = await preparePhoto(bytes, MEDIA[type], deps);
    return { ok: true, image: b64(deps, p.image), record: stored(deps, p.record) };
  } catch (err) {
    return fail('unreadable', CODES.unreadable, UPLOAD_MESSAGES.unreadable(name), err);
  }
}

async function preparePptx(bytes, name, deps) {
  let zip;
  let deck;
  try {
    zip = await openPptx(bytes);
    deck = await listSlides(zip);
  } catch (err) {
    return fail('unreadable', CODES.unreadable, UPLOAD_MESSAGES.unreadable(name), err);
  }
  if (deck.slides.length !== config.upload.pptxSlides) return oneChart('slides', UPLOAD_MESSAGES.slides(deck.slides.length));
  let read;
  try {
    read = await readSlide(zip, deck.slides[0].path, deck);
  } catch (err) {
    return fail('unreadable', CODES.unreadable, UPLOAD_MESSAGES.unreadable(name), err);
  }
  const content = slideContent(read, deck);
  if (content.kind === 'several') return oneChart('charts', UPLOAD_MESSAGES.charts(content.count));
  if (content.kind === 'none') return fail('no_chart', CODES.noChart, UPLOAD_MESSAGES.noChart);

  const pptx = { shapes: shapesText(read, deck) };
  const charts = await chartsText(zip, read);
  const tables = tablesText(read);
  if (charts) pptx.charts = charts;
  if (tables) pptx.tables = tables;
  if (detectCase(Object.values(pptx).join('\n')).blocked) return fail('case_blocked', CODES.caseBlocked, UPLOAD_MESSAGES.caseBlocked);
  if (pptx.shapes.length + (pptx.tables?.length ?? 0) + (pptx.charts?.length ?? 0) > limits.pptxTextMaxChars) {
    return fail('too_long', CODES.tooBig, UPLOAD_MESSAGES.tooMuchText);
  }

  // The image, if any: the pasted picture (the chart itself), else the thumbnail.
  let image;
  let imageRole;
  let record = null;
  if (content.picture?.mediaType) {
    const raw = Uint8Array.from(atobSafe(await pictureBase64(zip, content.picture)));
    const p = await prepareImage(raw, content.picture.ext === 'png' ? 'png' : 'jpg', name, deps);
    if (!p.ok) return p;
    ({ image, record } = p);
    imageRole = 'picture';
  } else {
    const thumb = await thumbnailBase64(zip);
    if (thumb) {
      image = { mediaType: 'image/jpeg', base64: thumb };
      imageRole = 'thumbnail';
    }
  }
  return { ok: true, pptx, image, imageRole, record, picture: Boolean(content.picture) };
}

function atobSafe(base64) {
  const bin = typeof atob === 'function' ? atob(base64) : Buffer.from(base64, 'base64').toString('binary');
  return Array.from(bin, (c) => c.charCodeAt(0));
}

/**
 * Checks and prepares one upload, with an optional same-slide PDF or picture for a .pptx (D27
 * default, spec §15 assumption 3).
 * @param {File} file
 * @param {{ sameSlide?: File|null, deps: { loadPdfjs, assetsBase?, createCanvas, encode, toBase64, decodeImage, convertHeic } }} opts
 * @returns {Promise<{ ok: true, upload: object, record: object|null, meta: object } | { ok: false, reason, code, message, hint?, detail? }>}
 *   `upload` is the read call's body field; `record` the stored 1,600 px copy (or null).
 */
export async function prepareUpload(file, { sameSlide = null, deps }) {
  const opened = await openBytes(file, deps);
  if (!opened.ok) return opened;
  const { type, bytes } = opened;
  const meta = { fileName: file.name, sizeBytes: file.size, type };

  if (type === 'pdf') {
    const p = await preparePdf(bytes, file.name, deps);
    if (!p.ok) return p;
    return { ok: true, upload: { kind: 'pdf', imageRole: 'page', image: p.image, ...(p.pdfText ? { pdfText: p.pdfText } : {}) }, record: p.record, meta };
  }
  if (type === 'png' || type === 'jpg') {
    const p = await prepareImage(bytes, type, file.name, deps);
    if (!p.ok) return p;
    return { ok: true, upload: { kind: 'image', imageRole: 'photo', image: p.image }, record: p.record, meta };
  }

  const p = await preparePptx(bytes, file.name, deps);
  if (!p.ok) return p;
  let { image, imageRole, record } = p;
  if (sameSlide) {
    const extra = await openBytes(sameSlide, { ...deps, allowed: ['pdf', 'png', 'jpg', 'heic'] });
    if (!extra.ok) return { ...extra, sameSlide: true };
    const q = extra.type === 'pdf'
      ? await preparePdf(extra.bytes, sameSlide.name, deps, { withText: false })
      : await prepareImage(extra.bytes, extra.type, sameSlide.name, deps);
    if (!q.ok) return { ...q, sameSlide: true };
    // The student's own picture of the slide replaces the thumbnail, and a pasted picture too.
    image = q.image;
    imageRole = 'sameSlide';
    record = q.record;
    meta.sameSlideName = sameSlide.name;
  }
  return {
    ok: true,
    upload: { kind: 'pptx', pptx: p.pptx, ...(image ? { image, imageRole } : {}) },
    record,
    meta,
  };
}
