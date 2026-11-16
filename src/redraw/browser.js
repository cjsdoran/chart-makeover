// The browser side of Make these changes (spec §9) and the record (§13): the plan call, building and
// saving the .pptx, and drawing the preview. PptxGenJS, Chart.js and pdf-lib load on first use, so
// the chat doesn't wait for them. The tests replace this module's functions through App `screens`.
import backgroundUrl from '../../assets/template/title-only-bg.jpg';
import { askDaniel } from '../daniel/askDaniel.js';
import { redrawFileName } from './fileName.js';

const PPTX_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

/** Saves bytes as a file through a temporary link. */
export function saveFile(bytes, fileName, type = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

let background = null;
/** The template background, once: as a data URL for PptxGenJS and as an image for the canvas. */
async function loadBackground() {
  if (!background) {
    background = (async () => {
      const blob = await (await fetch(backgroundUrl)).blob();
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
      // onload, not decode(): decode() can wait indefinitely while the page isn't painting (a
      // background tab).
      const image = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('background image'));
        img.src = dataUrl;
      });
      return { dataUrl, image };
    })();
    background.catch(() => { background = null; });
  }
  return background;
}

const createCanvas = (w, h) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

/** The plan call (spec §9.1), with the browser's retries. */
export function planRedraw(request, accessCode) {
  return askDaniel('/api/redraw-plan', request, accessCode);
}

/** Builds one version's .pptx and saves it. */
export async function downloadPptx(version, session) {
  const [{ buildPptx }, bg] = await Promise.all([import('./buildPptx.js'), loadBackground()]);
  const { bytes } = await buildPptx(version.spec, { background: bg.dataUrl, dataToSource: version.dataToSource });
  saveFile(bytes, version.fileName || redrawFileName(session), PPTX_TYPE);
}

/** The preview as a PNG data URL (for the screen). */
export async function previewDataUrl(spec, { ppi = 96 } = {}) {
  const [{ renderPreview }, bg] = await Promise.all([import('./preview.js'), loadBackground()]);
  return renderPreview(spec, { createCanvas, background: bg.image, ppi }).toDataURL('image/png');
}

/** The preview as PNG bytes (for the record). */
export async function previewPng(spec) {
  const url = await previewDataUrl(spec, { ppi: 150 });
  return Uint8Array.from(atob(url.split(',')[1]), (c) => c.charCodeAt(0));
}

/** The record PDF (spec §13), with each redraw version's preview, saved. */
export async function downloadRecord(session) {
  const { buildRecord } = await import('../record/buildRecord.js');
  const result = await buildRecord(session, { previewPng });
  saveFile(result.bytes, result.fileName, 'application/pdf');
  return result;
}

export const browserRedraw = { plan: planRedraw, download: downloadPptx, preview: previewDataUrl, record: downloadRecord };
