// Synthetic .pptx, PDF and image fixtures for the upload tests (test plan §1): built in memory, so
// no binaries are committed. Sizes are in points and written as EMU.
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { createCanvas } from '@napi-rs/canvas';
import { box, makePptx, picture } from './pptx.js';

const EMU = 12700;
const C_NS = 'xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export { box, makePptx, picture };

/** A graphic frame that holds a chart part (rId in the slide's rels). */
export function chartFrame(id, rId, x = 40, y = 100, w = 600, h = 360) {
  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Chart ${id}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${x * EMU}" y="${y * EMU}"/><a:ext cx="${w * EMU}" cy="${h * EMU}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="${rId}"/></a:graphicData></a:graphic></p:graphicFrame>`;
}

/** A native table frame. */
export function tableFrame(id, rows, x = 40, y = 100) {
  const tr = rows.map((r) => `<a:tr h="300000">${r.map((c) => `<a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:rPr sz="900"/><a:t>${esc(c)}</a:t></a:r></a:p></a:txBody></a:tc>`).join('')}</a:tr>`).join('');
  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Table ${id}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${x * EMU}" y="${y * EMU}"/><a:ext cx="${600 * EMU}" cy="${300 * EMU}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr><a:tableStyleId>{93296810-A885-4BE3-A3E7-6D5BEEA58F35}</a:tableStyleId></a:tblPr>${tr}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
}

const strCache = (xs) => `<c:strCache><c:ptCount val="${xs.length}"/>${xs.map((x, i) => `<c:pt idx="${i}"><c:v>${esc(x)}</c:v></c:pt>`).join('')}</c:strCache>`;
const numCache = (xs) => `<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${xs.length}"/>${xs.map((x, i) => `<c:pt idx="${i}"><c:v>${x}</c:v></c:pt>`).join('')}</c:numCache>`;

function fill(colour) {
  if (!colour) return '';
  if (colour === 'scheme') return '<c:spPr><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></c:spPr>';
  return `<c:spPr><a:solidFill><a:srgbClr val="${colour}"/></a:solidFill></c:spPr>`;
}

function ser(s, i, categories) {
  return `<c:ser><c:idx val="${i}"/><c:order val="${i}"/><c:tx><c:strRef><c:f>Sheet1!$B$1</c:f>${strCache([s.name])}</c:strRef></c:tx>${fill(s.colour)}<c:cat><c:strRef><c:f>A</c:f>${strCache(categories)}</c:strRef></c:cat><c:val><c:numRef><c:f>B</c:f>${numCache(s.values)}</c:numRef></c:val></c:ser>`;
}

function valAx(id, cross, { pos = 'l', logBase, title, gridlines = false } = {}) {
  const t = title ? `<c:title><c:tx><c:rich><a:bodyPr/><a:p><a:r><a:t>${esc(title)}</a:t></a:r></a:p></c:rich></c:tx></c:title>` : '';
  return `<c:valAx><c:axId val="${id}"/><c:scaling>${logBase ? `<c:logBase val="${logBase}"/>` : ''}<c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${pos}"/>${gridlines ? '<c:majorGridlines/>' : ''}${t}<c:crossAx val="${cross}"/></c:valAx>`;
}
const catAx = (id, cross, del = false) => `<c:catAx><c:axId val="${id}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="${del ? 1 : 0}"/><c:axPos val="b"/><c:crossAx val="${cross}"/></c:catAx>`;

/**
 * A chart part. `groups` are plot groups: { type: 'lineChart'|'barChart', barDir?, grouping?,
 * series: [{ name, values, colour? }], secondary? }. A secondary group gets its own axes.
 */
export function chartXml({ categories, groups, legend = true, title = null, logBase, gridlines = true }) {
  let n = 0;
  const plots = [];
  const axes = [];
  groups.forEach((g, gi) => {
    const cat = 100 + gi * 2;
    const val = 101 + gi * 2;
    const series = g.series.map((s) => ser(s, n++, categories)).join('');
    const bar = g.type === 'barChart' ? `<c:barDir val="${g.barDir ?? 'col'}"/><c:grouping val="${g.grouping ?? 'clustered'}"/>` : '<c:grouping val="standard"/>';
    plots.push(`<c:${g.type}>${bar}${series}<c:axId val="${cat}"/><c:axId val="${val}"/></c:${g.type}>`);
    axes.push(catAx(cat, val, gi > 0), valAx(val, cat, { pos: gi > 0 ? 'r' : 'l', logBase: gi === 0 ? logBase : undefined, gridlines: gi === 0 && gridlines }));
  });
  const t = title ? `<c:title><c:tx><c:rich><a:bodyPr/><a:p><a:r><a:t>${esc(title)}</a:t></a:r></a:p></c:rich></c:tx></c:title><c:autoTitleDeleted val="0"/>` : '<c:autoTitleDeleted val="1"/>';
  return `<?xml version="1.0"?><c:chartSpace ${C_NS}><c:chart>${t}<c:plotArea>${plots.join('')}${axes.join('')}</c:plotArea>${legend ? '<c:legend><c:legendPos val="r"/></c:legend>' : ''}</c:chart></c:chartSpace>`;
}

/** A one-slide .pptx with one chart (or several) and some text boxes. */
export async function chartPptx(charts, { texts = ['Revenue by region', 'Source: test data'], extraShapes = '', files = {} } = {}) {
  const frames = charts.map((_, i) => chartFrame(10 + i, `rIdC${i + 1}`, 40, 100 + i * 10)).join('');
  const rels = Object.fromEntries(charts.map((_, i) => [`rIdC${i + 1}`, `../charts/chart${i + 1}.xml`]));
  const chartFiles = Object.fromEntries(charts.map((c, i) => [`ppt/charts/chart${i + 1}.xml`, c]));
  const shapes = texts.map((t, i) => box(2 + i, t, 40, 20 + i * 450, 600, 30)).join('') + frames + extraShapes;
  return makePptx([{ shapes, rels, files: { ...chartFiles, ...files } }]);
}

/** One PDF page per string, with Helvetica text. An empty string draws a grey box only (a scan). */
export async function makePdf(pageTexts, { size = [842, 595] } = {}) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of pageTexts) {
    const page = doc.addPage(size);
    if (!text) {
      page.drawRectangle({ x: 50, y: 50, width: size[0] - 100, height: size[1] - 100, opacity: 0.3 });
      continue;
    }
    let y = size[1] - 60;
    for (const line of text.split('\n')) {
      page.drawText(line, { x: 50, y, size: 12, font });
      y -= 18;
    }
  }
  return doc.save();
}

/** A plain image: PNG or JPEG of the given size, a dark bar on the left so orientation shows. */
export async function makeImage(width, height, type = 'png') {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, Math.max(1, Math.round(width / 10)), height);
  return new Uint8Array(await canvas.encode(type === 'png' ? 'png' : 'jpeg', 90));
}

/** Adds an EXIF APP1 segment with the given orientation to a JPEG. */
export function withExifOrientation(jpeg, orientation) {
  // Big-endian TIFF header, one IFD entry: 0x0112 SHORT 1 = orientation.
  const tiff = [0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, 0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
  const body = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff];
  const len = body.length + 2;
  const app1 = [0xff, 0xe1, len >> 8, len & 0xff, ...body];
  return Uint8Array.from([...jpeg.subarray(0, 2), ...app1, ...jpeg.subarray(2)]);
}

export const asFile = (bytes, name) => new File([bytes], name);
