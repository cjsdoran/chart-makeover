// Reads the one slide of a .pptx (spec §3.3–3.4, D8): each text shape with its position, size,
// font and font size; tables; pictures; and each native chart, parsed from its chart part.
// Positions are in points from the slide's top left (EMU ÷ 12,700), groups flattened.
// Placeholders that inherit their position or font size are resolved from the slide layout and
// master, so a title's size is known even when the slide itself doesn't say. Copied from Tree
// Surgery's tree reader and extended.
import { limits } from '../../shared/limits.js';
import { all, kid, kids, local, parseXml, path } from './xml.js';
import { chartText, parseChart, parseChartEx } from './chartXml.js';

const EMU_PER_PT = 12700;
const pt = (emu) => Math.round(Number(emu) / EMU_PER_PT);
const loadJSZip = async () => (await import('jszip')).default;

const LINE_PRESETS = /^(line|straightConnector\d*|bentConnector\d+|curvedConnector\d+)$/;
const PICTURE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };
const CHART_URI = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const CHARTEX_URI = /schemas\.microsoft\.com\/office\/drawing\/2014\/chartex/;
const DEFAULT_SIZE = 18;
const THEME_FONTS = { '+mj-lt': 'theme heading font', '+mn-lt': 'theme body font', '+mj-ea': 'theme heading font', '+mn-ea': 'theme body font' };

export async function openPptx(data) {
  return (await loadJSZip()).loadAsync(data);
}

// Resolves a relationship target against the part that owns it.
function resolve(base, target) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

async function readRels(zip, partPath) {
  const dir = partPath.split('/').slice(0, -1).join('/');
  const file = zip.file(`${dir}/_rels/${partPath.split('/').pop()}.rels`);
  if (!file) return {};
  const rels = parseXml(await file.async('string'));
  return Object.fromEntries(kids(rels, 'Relationship').map((r) => [r.attrs.Id, { target: resolve(partPath, r.attrs.Target), type: r.attrs.Type ?? '' }]));
}

const relTarget = (rels, id) => rels[id]?.target ?? null;

async function partXml(zip, p) {
  const f = p && zip.file(p);
  return f ? parseXml(await f.async('string')) : null;
}

/**
 * The slides in presentation order, with the slide size in points.
 * @returns {Promise<{ width: number, height: number, slides: { n: number, path: string }[] }>}
 */
export async function listSlides(zip) {
  const pres = await partXml(zip, 'ppt/presentation.xml');
  if (!pres) throw Object.assign(new Error('No presentation part'), { name: 'NotPowerPoint' });
  const size = kid(pres, 'p:sldSz');
  const rels = await readRels(zip, 'ppt/presentation.xml');
  let paths = kids(kid(pres, 'p:sldIdLst'), 'p:sldId').map((s) => relTarget(rels, s.attrs['r:id'])).filter((p) => p && zip.file(p));
  if (!paths.length) {
    paths = Object.keys(zip.files)
      .map((name) => ({ name, n: Number(/^ppt\/slides\/slide(\d+)\.xml$/.exec(name)?.[1]) }))
      .filter((s) => Number.isFinite(s.n))
      .sort((a, b) => a.n - b.n)
      .map((s) => s.name);
  }
  const defaultSize = kids(path(pres, 'p:defaultTextStyle', 'a:lvl1pPr'), 'a:defRPr')[0]?.attrs.sz;
  return {
    width: size ? pt(size.attrs.cx) : 960,
    height: size ? pt(size.attrs.cy) : 540,
    defaultSize: defaultSize ? Number(defaultSize) / 100 : DEFAULT_SIZE,
    slides: paths.map((p, i) => ({ n: i + 1, path: p })),
  };
}

// ---------- Text ----------

/** Text of a text body: paragraphs joined with " / ", runs and fields joined within a paragraph. */
export function bodyText(txBody) {
  if (!txBody) return '';
  return kids(txBody, 'a:p')
    .map((p) => p.children.map((r) => {
      if (r.name === 'a:br') return ' ';
      if (r.name === 'a:r' || r.name === 'a:fld') return kid(r, 'a:t')?.text ?? '';
      return '';
    }).join('').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' / ');
}

// The level-1 default run properties of a list style (a:lstStyle, p:titleStyle, …).
const lvl1 = (style) => kid(kid(style, 'a:lvl1pPr'), 'a:defRPr');

/**
 * Font facts of a text body: the sizes of its runs (each run's own size, else the paragraph's,
 * else the shape's list style, else `inherited`), bold, and typefaces.
 */
function fontOf(txBody, inherited) {
  const sizes = new Set();
  const faces = new Set();
  let bold = false;
  const listDefault = lvl1(kid(txBody, 'a:lstStyle'));
  for (const p of kids(txBody, 'a:p')) {
    const pDefault = kid(kid(p, 'a:pPr'), 'a:defRPr');
    for (const r of p.children.filter((c) => c.name === 'a:r' || c.name === 'a:fld')) {
      if (!(kid(r, 'a:t')?.text ?? '').trim()) continue;
      const rPr = kid(r, 'a:rPr');
      const sz = rPr?.attrs.sz ?? pDefault?.attrs.sz ?? listDefault?.attrs.sz;
      sizes.add(sz ? Number(sz) / 100 : inherited.size);
      const b = rPr?.attrs.b ?? pDefault?.attrs.b ?? listDefault?.attrs.b;
      if (b === '1' || b === 'true' || ((b === undefined) && inherited.bold)) bold = true;
      const face = kid(rPr, 'a:latin')?.attrs.typeface ?? kid(listDefault, 'a:latin')?.attrs.typeface ?? inherited.face;
      if (face) faces.add(THEME_FONTS[face] ?? face);
    }
  }
  return { sizes: [...sizes].filter(Boolean).sort((a, b) => b - a), bold, faces: [...faces] };
}

// ---------- Layout and master: placeholder positions and sizes ----------

const phKey = (ph) => (ph ? { type: ph.attrs.type ?? 'body', idx: ph.attrs.idx ?? null } : null);

function placeholders(spTree) {
  const out = [];
  for (const sp of all(spTree, 'p:sp')) {
    const ph = path(sp, 'p:nvSpPr', 'p:nvPr', 'p:ph');
    if (ph) out.push({ key: phKey(ph), sp });
  }
  return out;
}

function matchPlaceholder(list, key) {
  const titleLike = (t) => t === 'title' || t === 'ctrTitle';
  return list.find((p) => key.idx !== null && p.key.idx === key.idx)
    ?? list.find((p) => p.key.type === key.type || (titleLike(p.key.type) && titleLike(key.type)))
    ?? null;
}

/** The slide's layout and master, for placeholder inheritance. */
async function inheritance(zip, slideRels) {
  const layoutPath = Object.values(slideRels).find((r) => /slideLayout$/.test(r.type) || /slideLayouts\//.test(r.target))?.target;
  const layout = await partXml(zip, layoutPath);
  const layoutRels = layoutPath ? await readRels(zip, layoutPath) : {};
  const masterPath = Object.values(layoutRels).find((r) => /slideMaster$/.test(r.type) || /slideMasters\//.test(r.target))?.target;
  const master = await partXml(zip, masterPath);
  return {
    layout: layout ? placeholders(path(layout, 'p:cSld', 'p:spTree')) : [],
    master: master ? placeholders(path(master, 'p:cSld', 'p:spTree')) : [],
    styles: master ? kid(master, 'p:txStyles') : null,
  };
}

// ---------- Geometry ----------

const IDENTITY = { ox: 0, oy: 0, sx: 1, sy: 1 };
const apply = (t, x, y) => ({ x: t.ox + x * t.sx, y: t.oy + y * t.sy });

function groupTransform(parent, grpSpPr) {
  const xfrm = kid(grpSpPr, 'a:xfrm');
  if (!xfrm) return parent;
  const off = kid(xfrm, 'a:off')?.attrs; const ext = kid(xfrm, 'a:ext')?.attrs;
  const chOff = kid(xfrm, 'a:chOff')?.attrs; const chExt = kid(xfrm, 'a:chExt')?.attrs;
  if (!off || !ext || !chOff || !chExt) return parent;
  const sx = Number(chExt.cx) ? Number(ext.cx) / Number(chExt.cx) : 1;
  const sy = Number(chExt.cy) ? Number(ext.cy) / Number(chExt.cy) : 1;
  const inner = { ox: Number(off.x) - Number(chOff.x) * sx, oy: Number(off.y) - Number(chOff.y) * sy, sx, sy };
  return { ox: parent.ox + inner.ox * parent.sx, oy: parent.oy + inner.oy * parent.sy, sx: parent.sx * inner.sx, sy: parent.sy * inner.sy };
}

function frame(xfrm, t) {
  const off = kid(xfrm, 'a:off')?.attrs; const ext = kid(xfrm, 'a:ext')?.attrs;
  if (!off || !ext) return null;
  const a = apply(t, Number(off.x), Number(off.y));
  const b = apply(t, Number(off.x) + Number(ext.cx), Number(off.y) + Number(ext.cy));
  return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y, flipH: xfrm.attrs.flipH === '1', flipV: xfrm.attrs.flipV === '1', rot: Number(xfrm.attrs.rot ?? 0) / 60000 };
}

const box = (f) => ({ x: pt(f.x), y: pt(f.y), w: pt(f.w), h: pt(f.h) });

// ---------- The slide ----------

/**
 * Walks a slide's shape tree.
 * @returns {Promise<{ shapes: object[], lines: object[], tables: object[], pictures: object[],
 *   charts: { path: string, ex: boolean, x, y, w, h }[], diagrams: string[] }>}
 */
export async function readSlide(zip, slidePath, { defaultSize = DEFAULT_SIZE } = {}) {
  const slide = parseXml(await zip.file(slidePath).async('string'));
  const rels = await readRels(zip, slidePath);
  const inh = await inheritance(zip, rels);
  const out = { shapes: [], lines: [], tables: [], pictures: [], charts: [], diagrams: [] };
  const tree = path(slide, 'p:cSld', 'p:spTree');

  function inheritedFont(key) {
    const layoutSp = key ? matchPlaceholder(inh.layout, key)?.sp : null;
    const masterSp = key ? matchPlaceholder(inh.master, key)?.sp : null;
    const fromSp = (sp) => lvl1(kid(kid(sp, 'p:txBody'), 'a:lstStyle'));
    const styleName = !key ? 'p:otherStyle' : (key.type === 'title' || key.type === 'ctrTitle') ? 'p:titleStyle' : 'p:bodyStyle';
    const candidates = [fromSp(layoutSp), fromSp(masterSp), key ? lvl1(kid(inh.styles, styleName)) : null];
    const size = candidates.map((c) => c?.attrs.sz).find(Boolean);
    const bold = candidates.map((c) => c?.attrs.b).find((b) => b !== undefined);
    const face = candidates.map((c) => kid(c, 'a:latin')?.attrs.typeface).find(Boolean);
    return { size: size ? Number(size) / 100 : defaultSize, bold: bold === '1', face };
  }

  function inheritedFrame(key) {
    for (const list of [inh.layout, inh.master]) {
      const sp = matchPlaceholder(list, key)?.sp;
      const f = sp && frame(path(sp, 'p:spPr', 'a:xfrm'), IDENTITY);
      if (f) return f;
    }
    return null;
  }

  async function walk(node, t) {
    for (const el of node.children) {
      const type = local(el.name);
      if (type === 'grpSp') await walk(el, groupTransform(t, kid(el, 'p:grpSpPr')));
      else if (type === 'sp' || type === 'cxnSp') readShape(el, t, type);
      else if (type === 'graphicFrame') await readFrame(el, t);
      else if (type === 'pic') readPicture(el, t);
      else if (type === 'AlternateContent') {
        const choice = kid(el, 'mc:Choice') ?? kid(el, 'mc:Fallback');
        if (choice) await walk(choice, t);
      }
    }
  }

  function readShape(el, t, type) {
    const nv = kid(el, type === 'sp' ? 'p:nvSpPr' : 'p:nvCxnSpPr');
    const id = kid(nv, 'p:cNvPr')?.attrs.id ?? '?';
    const ph = phKey(path(nv, 'p:nvPr', 'p:ph'));
    const spPr = kid(el, 'p:spPr');
    let f = frame(kid(spPr, 'a:xfrm'), t);
    const prst = kid(spPr, 'a:prstGeom')?.attrs.prst ?? '';
    const txBody = kid(el, 'p:txBody');
    const text = bodyText(txBody);
    if (type === 'cxnSp' || LINE_PRESETS.test(prst)) {
      if (!f) return;
      const [x1, x2] = f.flipH ? [f.x + f.w, f.x] : [f.x, f.x + f.w];
      const [y1, y2] = f.flipV ? [f.y + f.h, f.y] : [f.y, f.y + f.h];
      out.lines.push({ id, x1: pt(x1), y1: pt(y1), x2: pt(x2), y2: pt(y2), shape: prst || 'connector' });
      return;
    }
    if (!text) return;
    if (!f && ph) f = inheritedFrame(ph);
    const font = fontOf(txBody, inheritedFont(ph));
    out.shapes.push({ id, placeholder: ph?.type ?? null, text, ...(f ? box(f) : { x: null, y: null, w: null, h: null }), rot: f ? Math.round(f.rot) || 0 : 0, font, shape: prst || null });
  }

  async function readFrame(el, t) {
    const f = frame(kid(el, 'p:xfrm'), t);
    const data = path(el, 'a:graphic', 'a:graphicData');
    const uri = data?.attrs.uri ?? '';
    const table = kid(data, 'a:tbl');
    if (table) {
      const rows = kids(table, 'a:tr').map((tr) => kids(tr, 'a:tc').map((tc) => bodyText(kid(tc, 'a:txBody'))));
      const sizes = new Set();
      for (const tc of all(table, 'a:tc')) fontOf(kid(tc, 'a:txBody'), { size: defaultSize }).sizes.forEach((s) => sizes.add(s));
      out.tables.push({ rows, ...(f ? box(f) : {}), sizes: [...sizes].sort((a, b) => b - a), styleId: kid(kid(table, 'a:tblPr'), 'a:tableStyleId')?.text ?? null });
      return;
    }
    if (uri === CHART_URI || CHARTEX_URI.test(uri)) {
      const ref = data.children.find((c) => local(c.name) === 'chart');
      const target = ref && relTarget(rels, ref.attrs['r:id']);
      out.charts.push({ path: target, ex: CHARTEX_URI.test(uri), ...(f ? box(f) : {}) });
      return;
    }
    const ids = all(data, 'dgm:relIds')[0];
    const target = ids && relTarget(rels, ids.attrs['r:dm']);
    if (target && zip.file(target)) out.diagrams.push(...diagramLines(parseXml(await zip.file(target).async('string'))));
  }

  function readPicture(el, t) {
    const embed = all(el, 'a:blip')[0]?.attrs['r:embed'];
    const target = embed && relTarget(rels, embed);
    const f = frame(path(el, 'p:spPr', 'a:xfrm'), t);
    if (!target || !f) return;
    const ext = target.split('.').pop().toLowerCase();
    out.pictures.push({ target, mediaType: PICTURE_TYPES[ext] ?? null, ext, ...box(f) });
  }

  if (tree) await walk(tree, IDENTITY);
  return out;
}

/** SmartArt text, in the diagram's own order: enough to say what a concept slide holds. */
function diagramLines(data) {
  return all(data, 'dgm:pt')
    .filter((p) => (p.attrs.type ?? 'node') === 'node')
    .map((p) => bodyText(kid(p, 'dgm:t')))
    .filter(Boolean);
}

// ---------- What the slide gives the read call ----------

/**
 * Decides what a slide can send (spec §3.2 steps 4–5): one chart, or a refusal.
 * @returns {{ kind: 'ok', picture: object|null } | { kind: 'several', count: number } | { kind: 'none' }}
 */
export function slideContent(read, { width, height }) {
  if (read.charts.length > 1) return { kind: 'several', count: read.charts.length };
  const big = read.pictures.filter((p) => p.w * p.h >= limits.pictureCoverShare * width * height);
  // A chart pasted as a picture: no native chart, and one picture covering much of the slide.
  const picture = !read.charts.length && big.length === 1 ? big[0] : null;
  if (read.charts.length || read.tables.length || picture || read.shapes.length >= limits.pptxMinTextShapes) {
    return { kind: 'ok', picture };
  }
  return { kind: 'none' };
}

const q = (s) => `"${String(s).replace(/"/g, "'")}"`;
const sizes = (xs) => (xs.length ? `${xs.map((s) => `${s} pt`).join('/')}` : 'size unknown');

/** The shapes text (spec §3.3): one line per text shape, line, picture and SmartArt. */
export function shapesText(read, { width, height }) {
  const out = [`Slide ${width} × ${height} pt`];
  const sorted = [...read.shapes].sort((a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0));
  for (const s of sorted) {
    const where = s.x === null ? 'position from the layout' : `x=${s.x} y=${s.y} w=${s.w} h=${s.h}${s.rot ? ` rot=${s.rot}` : ''}`;
    const role = s.placeholder ? ` [${s.placeholder} placeholder]` : s.shape && s.shape !== 'rect' ? ` [${s.shape}]` : '';
    const font = `font ${sizes(s.font.sizes)}${s.font.bold ? ' bold' : ''}${s.font.faces.length ? ` ${s.font.faces.join('/')}` : ''}`;
    out.push(`S${s.id}${role} ${q(s.text)} ${where} ${font}`);
  }
  for (const l of read.lines) out.push(`L${l.id} ${l.shape} from (${l.x1},${l.y1}) to (${l.x2},${l.y2})`);
  for (const p of read.pictures) out.push(`PICTURE ${p.ext} x=${p.x} y=${p.y} w=${p.w} h=${p.h}`);
  for (const c of read.charts) if (c.x !== undefined) out.push(`CHART FRAME x=${c.x} y=${c.y} w=${c.w} h=${c.h}`);
  if (read.diagrams.length) out.push(`SMARTART ${read.diagrams.map(q).join(', ')}`);
  return out.join('\n');
}

/** Tables as text: one row per line, cells separated by " | ". */
export function tablesText(read) {
  return read.tables.map((t, i) => [
    `TABLE ${i + 1}${t.x !== undefined ? ` x=${t.x} y=${t.y} w=${t.w} h=${t.h}` : ''}, ${t.rows.length} rows × ${Math.max(0, ...t.rows.map((r) => r.length))} columns, font ${sizes(t.sizes)}`,
    ...t.rows.map((r, j) => `row ${j + 1}: ${r.join(' | ')}`),
  ].join('\n')).join('\n\n');
}

/** The native chart, parsed and written as text (spec §3.4), capped at chartXmlMaxChars. */
export async function chartsText(zip, read) {
  const parts = [];
  for (const [i, c] of read.charts.entries()) {
    const file = c.path && zip.file(c.path);
    if (!file) {
      parts.push(`CHART ${i + 1} (the chart's data part is missing from the file)`);
      continue;
    }
    const xml = await file.async('string');
    parts.push(chartText(c.ex ? parseChartEx(xml) : parseChart(xml), i + 1));
  }
  const text = parts.join('\n\n');
  return text.length > limits.chartXmlMaxChars ? `${text.slice(0, limits.chartXmlMaxChars - 40)}\n[chart data cut at the length limit]` : text;
}

/** docProps/thumbnail.jpeg, when PowerPoint saved one (layout and colour only). */
export async function thumbnailBase64(zip) {
  const f = zip.file('docProps/thumbnail.jpeg');
  return f ? f.async('base64') : null;
}

export async function pictureBase64(zip, picture) {
  return zip.file(picture.target).async('base64');
}
