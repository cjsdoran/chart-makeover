// Native chart parts of a .pptx (spec §3.4, CM-2): ppt/charts/chartN.xml (and the Office 2016
// "chartex" parts used for waterfall, treemap and the like), parsed into a plain object and then
// written as compact text for the read call. Values come straight from the chart's caches, so the
// reading's numbers are the file's, not estimates.
import { kid, kids, local, parseXml } from './xml.js';

// Plot types in c:plotArea, and what each is called in the text.
const PLOT_TYPES = ['lineChart', 'line3DChart', 'barChart', 'bar3DChart', 'pieChart', 'pie3DChart', 'doughnutChart', 'ofPieChart',
  'scatterChart', 'bubbleChart', 'areaChart', 'area3DChart', 'radarChart', 'stockChart', 'surfaceChart', 'surface3DChart'];

/** Drops namespace prefixes in place, so the reader works whatever prefixes the file uses. */
function stripPrefixes(node) {
  node.name = local(node.name);
  node.children.forEach(stripPrefixes);
  return node;
}

const val = (node, name) => kid(node, name)?.attrs.val ?? null;
const flag = (node, name) => {
  const v = val(node, name);
  if (v === null) return kid(node, name) ? true : null;
  return v === '1' || v === 'true';
};
const pts = (sz) => (sz ? Number(sz) / 100 : null);

// Text of a rich text body (titles, custom labels): paragraphs joined with " / ".
function richText(node) {
  if (!node) return '';
  return kids(node, 'p')
    .map((p) => p.children.map((r) => (r.name === 'r' || r.name === 'fld' ? kid(r, 't')?.text ?? '' : r.name === 'br' ? ' ' : '')).join('').trim())
    .filter(Boolean)
    .join(' / ');
}

// Font sizes in a text body or txPr: run sizes, then paragraph defaults.
function sizesIn(node, out = new Set()) {
  if (!node) return out;
  for (const c of node.children) {
    if ((c.name === 'rPr' || c.name === 'defRPr' || c.name === 'endParaRPr') && c.attrs.sz) out.add(pts(c.attrs.sz));
    sizesIn(c, out);
  }
  return out;
}

/** A title element's text: rich text, or a cell reference's cached string. */
function titleText(title) {
  const tx = kid(title, 'tx');
  if (!tx) return null;
  const rich = kid(tx, 'rich');
  if (rich) return richText(rich) || null;
  return cacheStrings(kid(tx, 'strRef'))[0] ?? null;
}

// A fill colour: an RGB hex, "theme" for a scheme colour, or null when none is set.
function fillColour(spPr) {
  if (!spPr) return null;
  const fill = kid(spPr, 'solidFill') ?? kid(kid(spPr, 'ln'), 'solidFill');
  if (!fill) return kid(spPr, 'noFill') ? 'none' : null;
  const rgb = kid(fill, 'srgbClr');
  if (rgb) return rgb.attrs.val?.toUpperCase() ?? null;
  if (kid(fill, 'schemeClr')) return 'theme';
  const sys = kid(fill, 'sysClr');
  return sys ? (sys.attrs.lastClr?.toUpperCase() ?? 'system') : null;
}

// Line colour for line and scatter series: the outline first.
function lineColour(spPr) {
  if (!spPr) return null;
  const ln = kid(spPr, 'ln');
  if (ln) {
    const c = fillColour({ name: 'spPr', attrs: {}, children: ln.children.filter((x) => x.name === 'solidFill' || x.name === 'noFill'), text: '' });
    if (c) return c;
  }
  return fillColour(spPr);
}

// Cached points of a strRef/numRef/strLit/numLit/multiLvlStrRef: strings in index order.
function cacheStrings(ref) {
  if (!ref) return [];
  const cache = kid(ref, 'strCache') ?? kid(ref, 'numCache') ?? (ref.name.endsWith('Lit') ? ref : null) ?? kid(ref, 'multiLvlStrCache');
  if (!cache) return [];
  if (cache.name === 'multiLvlStrCache') {
    // Several category levels: join each point's labels, innermost first.
    const levels = kids(cache, 'lvl').map((l) => pointsOf(l, Number(val(cache, 'ptCount') ?? 0)));
    const n = Number(val(cache, 'ptCount') ?? Math.max(0, ...levels.map((l) => l.length)));
    return Array.from({ length: n }, (_, i) => levels.map((l) => l[i]).filter((v) => v !== null && v !== undefined).join(' · '));
  }
  return pointsOf(cache, Number(val(cache, 'ptCount') ?? 0));
}

function pointsOf(cache, count) {
  const out = Array.from({ length: count }, () => null);
  for (const p of kids(cache, 'pt')) {
    const i = Number(p.attrs.idx);
    if (Number.isInteger(i) && i >= 0) out[i] = kid(p, 'v')?.text ?? null;
  }
  return out;
}

function formatCode(ref) {
  const cache = kid(ref, 'numCache') ?? (ref?.name === 'numLit' ? ref : null);
  return cache ? kid(cache, 'formatCode')?.text ?? null : null;
}

const refOf = (node) => (node ? kid(node, 'strRef') ?? kid(node, 'numRef') ?? kid(node, 'multiLvlStrRef') ?? kid(node, 'strLit') ?? kid(node, 'numLit') : null);

/** Data labels: which parts show, their number format and size, and any typed-over texts. */
function readLabels(dLbls) {
  if (!dLbls) return null;
  const parts = ['showVal', 'showPercent', 'showCatName', 'showSerName', 'showBubbleSize'].filter((k) => flag(dLbls, k));
  const custom = [];
  const deleted = [];
  for (const d of kids(dLbls, 'dLbl')) {
    const idx = Number(val(d, 'idx'));
    if (flag(d, 'delete')) {
      deleted.push(idx);
      continue;
    }
    const text = richText(kid(kid(d, 'tx'), 'rich'));
    if (text) custom.push({ idx, text });
  }
  return {
    shown: !flag(dLbls, 'delete') && (parts.length > 0 || custom.length > 0),
    parts: parts.map((p) => p.replace(/^show/, '').toLowerCase()),
    numFmt: kid(dLbls, 'numFmt')?.attrs.formatCode ?? null,
    sizes: [...sizesIn(kid(dLbls, 'txPr')), ...custom.length ? [...sizesIn(dLbls)] : []],
    custom,
    deleted,
  };
}

function readSeries(ser, group, groupLabels) {
  const scatterLike = group.type === 'scatterChart' || group.type === 'bubbleChart';
  const name = titleText(ser) ?? `Series ${Number(val(ser, 'idx') ?? 0) + 1}`;
  const spPr = kid(ser, 'spPr');
  const isLine = /^(line|line3D|scatter|radar)Chart$/.test(group.type);
  const colour = (isLine ? lineColour(spPr) : fillColour(spPr)) ?? 'auto';
  const pointColours = kids(ser, 'dPt').map((d) => ({ idx: Number(val(d, 'idx')), colour: fillColour(kid(d, 'spPr')) ?? 'auto' }));
  const labels = readLabels(kid(ser, 'dLbls')) ?? groupLabels;
  const out = { name, chartType: group.type, colour, pointColours, labels, axIds: group.axIds };
  if (scatterLike) {
    out.x = cacheStrings(refOf(kid(ser, 'xVal')));
    out.y = cacheStrings(refOf(kid(ser, 'yVal')));
    if (group.type === 'bubbleChart') out.size = cacheStrings(refOf(kid(ser, 'bubbleSize')));
    out.format = formatCode(refOf(kid(ser, 'yVal')));
  } else {
    out.categories = cacheStrings(refOf(kid(ser, 'cat')));
    out.values = cacheStrings(refOf(kid(ser, 'val')));
    out.format = formatCode(refOf(kid(ser, 'val')));
  }
  if (group.type === 'lineChart' || group.type === 'scatterChart') {
    const symbol = val(kid(ser, 'marker'), 'symbol');
    out.markers = symbol ? symbol !== 'none' : null;
  }
  return out;
}

function readAxis(ax) {
  const scaling = kid(ax, 'scaling');
  const num = (name) => {
    const v = val(scaling, name);
    return v === null ? null : Number(v);
  };
  return {
    id: val(ax, 'axId'),
    kind: ax.name, // catAx | valAx | dateAx | serAx
    position: val(ax, 'axPos'),
    deleted: flag(ax, 'delete') === true,
    title: titleText(kid(ax, 'title')),
    titleSizes: [...sizesIn(kid(ax, 'title'))],
    min: num('min'),
    max: num('max'),
    logBase: num('logBase'),
    reversed: val(scaling, 'orientation') === 'maxMin',
    numFmt: kid(ax, 'numFmt')?.attrs.formatCode ?? null,
    gridlines: Boolean(kid(ax, 'majorGridlines') || kid(ax, 'minorGridlines')),
    tickLabels: val(ax, 'tickLblPos') !== 'none',
    labelSizes: [...sizesIn(kid(ax, 'txPr'))],
    crossAx: val(ax, 'crossAx'),
  };
}

/**
 * Parses one chart part (c:chartSpace).
 * @returns {object} type groups, series, axes and the chart-level settings
 */
export function parseChart(xml) {
  const space = stripPrefixes(parseXml(xml));
  const chart = kid(space, 'chart');
  const plot = kid(chart, 'plotArea');
  const groups = (plot?.children ?? []).filter((c) => PLOT_TYPES.includes(c.name)).map((g) => ({
    type: g.name,
    barDir: val(g, 'barDir'),
    grouping: val(g, 'grouping'),
    varyColors: flag(g, 'varyColors') === true,
    holeSize: val(g, 'holeSize'),
    axIds: kids(g, 'axId').map((a) => a.attrs.val),
    node: g,
  }));
  const axes = (plot?.children ?? []).filter((c) => /^(cat|val|date|ser)Ax$/.test(c.name)).map(readAxis);

  // Axis roles: the first group's axes are x and y1; a value axis used only by a later group is y2.
  const primaryValue = groups[0]?.axIds[1] ?? null;
  const roleOf = (id) => {
    if (id === groups[0]?.axIds[0]) return 'x';
    if (id === primaryValue) return 'y1';
    return groups.some((g) => g.axIds[0] === id) ? 'x2' : 'y2';
  };
  for (const a of axes) a.role = roleOf(a.id);

  const series = groups.flatMap((g) => {
    const groupLabels = readLabels(kid(g.node, 'dLbls'));
    return kids(g.node, 'ser').map((s) => readSeries(s, g, groupLabels));
  });
  for (const s of series) s.axis = s.axIds[1] && s.axIds[1] !== primaryValue ? 'secondary' : 'primary';

  const legend = kid(chart, 'legend');
  const title = kid(chart, 'title');
  const view3D = Boolean(kid(chart, 'view3D'));
  return {
    groups: groups.map(({ node: _n, ...g }) => g),
    series,
    axes,
    title: title && flag(chart, 'autoTitleDeleted') !== true ? titleText(title) ?? '(automatic title)' : null,
    titleSizes: [...sizesIn(title)],
    legend: legend ? { shown: true, position: val(legend, 'legendPos') } : { shown: false, position: null },
    // PowerPoint writes view3D on some flat charts too, so 3D is the plot type.
    is3D: groups.some((g) => /3D/.test(g.type)),
    view3D,
    dualAxis: series.some((s) => s.axis === 'secondary'),
    fontSizes: [...sizesIn(kid(space, 'txPr'))],
  };
}

/**
 * Parses an Office 2016+ chartex part (waterfall, treemap, sunburst, funnel, box and whisker,
 * histogram, Pareto). Values and categories come from cx:chartData.
 */
export function parseChartEx(xml) {
  const space = stripPrefixes(parseXml(xml));
  const data = new Map();
  for (const d of kids(kid(space, 'chartData'), 'data')) {
    const dims = d.children.filter((c) => c.name === 'strDim' || c.name === 'numDim');
    const get = (type) => {
      const dim = dims.find((x) => x.attrs.type === type);
      const lvl = dim && kids(dim, 'lvl')[0];
      return lvl ? kids(lvl, 'pt').map((p) => p.text) : [];
    };
    data.set(d.attrs.id, { categories: get('cat'), values: get('val'), format: kids(dims.find((x) => x.attrs.type === 'val'), 'lvl')[0]?.attrs.formatCode ?? null });
  }
  const chart = kid(space, 'chart');
  const plot = kid(kid(chart, 'plotArea'), 'plotAreaRegion');
  const series = kids(plot, 'series').map((s, i) => {
    const d = data.get(kid(s, 'dataId')?.attrs.val) ?? { categories: [], values: [], format: null };
    const name = kid(kid(s, 'tx'), 'txData') ? kid(kid(kid(s, 'tx'), 'txData'), 'v')?.text : null;
    const labels = kid(s, 'dataLabels');
    return {
      name: name ?? `Series ${i + 1}`,
      chartType: s.attrs.layoutId ?? 'chartex',
      colour: fillColour(kid(s, 'spPr')) ?? 'auto',
      pointColours: kids(s, 'dataPt').map((p) => ({ idx: Number(p.attrs.idx), colour: fillColour(kid(p, 'spPr')) ?? 'auto' })),
      labels: labels ? { shown: Boolean(kid(labels, 'visibility')?.attrs.value !== '0'), parts: ['val'], numFmt: kid(labels, 'numFmt')?.attrs.formatCode ?? null, sizes: [], custom: [], deleted: [] } : null,
      categories: d.categories,
      values: d.values,
      format: d.format,
      axis: 'primary',
      subtotals: kids(kid(kid(s, 'layoutPr'), 'subtotals'), 'idx').map((x) => Number(x.attrs.val)),
    };
  });
  const axes = kids(kid(chart, 'plotArea'), 'axis').map((a) => ({
    id: a.attrs.id, kind: kid(a, 'catScaling') ? 'catAx' : 'valAx', role: kid(a, 'catScaling') ? 'x' : 'y1', position: null,
    deleted: a.attrs.hidden === '1', title: richText(kid(kid(kid(a, 'title'), 'tx'), 'rich')) || null, titleSizes: [],
    min: null, max: null, logBase: null, reversed: false, numFmt: null,
    gridlines: Boolean(kid(a, 'majorGridlines')), tickLabels: Boolean(kid(a, 'tickLabels')), labelSizes: [],
  }));
  const title = kid(chart, 'title');
  return {
    groups: [{ type: series[0]?.chartType ?? 'chartex', barDir: null, grouping: null, varyColors: false, axIds: [] }],
    series,
    axes,
    title: title ? richText(kid(kid(title, 'tx'), 'rich')) || '(title)' : null,
    titleSizes: [],
    legend: kid(chart, 'legend') ? { shown: true, position: kid(chart, 'legend').attrs.pos ?? null } : { shown: false, position: null },
    is3D: false,
    view3D: false,
    dualAxis: false,
    fontSizes: [],
    chartex: true,
  };
}

// ---------- Compact text for the read call ----------

const q = (s) => `"${String(s).replace(/"/g, "'")}"`;
const list = (xs) => xs.map((x) => (x === null || x === undefined ? 'blank' : x)).join(', ');
const sizesText = (xs) => [...new Set(xs.filter(Boolean))].sort((a, b) => b - a).map((s) => `${s} pt`).join('/');

function groupName(g) {
  if (g.type === 'barChart' || g.type === 'bar3DChart') {
    return `${g.type} ${g.barDir === 'bar' ? 'horizontal bars' : 'vertical columns'}, grouping ${g.grouping ?? 'clustered'}`;
  }
  if (g.grouping && g.grouping !== 'standard' && /^(line|area)/.test(g.type)) return `${g.type}, grouping ${g.grouping}`;
  if (g.type === 'doughnutChart') return `${g.type}${g.holeSize ? `, hole ${g.holeSize}%` : ''}`;
  return g.type;
}

function labelsText(l) {
  if (!l || !l.shown) return 'labels none';
  const bits = [`labels ${l.parts.join('+') || 'custom'}`];
  if (l.numFmt) bits.push(`format ${q(l.numFmt)}`);
  if (l.sizes?.length) bits.push(sizesText(l.sizes));
  if (l.deleted?.length) bits.push(`hidden on points ${l.deleted.map((i) => i + 1).join(', ')}`);
  return bits.join(' ');
}

function axisText(a) {
  const range = a.kind === 'catAx' && a.min === null && a.max === null ? '' : `, min ${a.min ?? 'auto'}, max ${a.max ?? 'auto'}`;
  return [
    `${a.role} (${a.kind}${a.position ? `, ${a.position}` : ''})`,
    `title ${a.title ? q(a.title) : 'none'}${a.titleSizes.length ? ` ${sizesText(a.titleSizes)}` : ''}`,
    a.deleted ? 'hidden' : 'shown',
    a.tickLabels ? `tick labels${a.labelSizes.length ? ` ${sizesText(a.labelSizes)}` : ''}` : 'no tick labels',
  ].join(', ')
    + range
    + (a.logBase ? `, log scale base ${a.logBase}` : '')
    + (a.reversed ? ', reversed' : '')
    + (a.numFmt && a.numFmt !== 'General' ? `, format ${q(a.numFmt)}` : '')
    + `, gridlines ${a.gridlines ? 'yes' : 'no'}`;
}

/**
 * The chart as compact text (spec §3.4), for example:
 *   CHART 1 lineChart, 5 series, 17 categories
 *   CATEGORIES 2008/09, 2009/10, …
 *   S1 "Man City" colour 4472C4 axis y1 labels none values 18, 22, …, 340
 *   AXES x (catAx, b): … · y1 (valAx, l): …
 *   LEGEND yes (b) · TITLE "Commercial revenue (£m)" · 3D no · dual axis no · chart text 18 pt
 */
export function chartText(chart, n = 1) {
  const types = [...new Set(chart.groups.map(groupName))];
  const combo = chart.groups.length > 1 ? 'combo of ' : '';
  const cats = chart.series.find((s) => s.categories?.length)?.categories ?? [];
  const lines = [`CHART ${n} ${combo}${types.join(' + ')}${chart.chartex ? ' (Office 2016+ chart)' : ''}, ${chart.series.length} series${cats.length ? `, ${cats.length} categories` : ''}`];
  if (cats.length) lines.push(`CATEGORIES ${list(cats)}`);
  chart.series.forEach((s, i) => {
    const head = `S${i + 1} ${q(s.name)}${chart.groups.length > 1 ? ` (${s.chartType})` : ''} colour ${s.colour} axis ${s.axis === 'secondary' ? 'y2' : 'y1'} ${labelsText(s.labels)}`;
    const ownCats = s.categories && cats.length && s.categories.join('\u0001') !== cats.join('\u0001') ? ` categories ${list(s.categories)}` : '';
    let data;
    if (s.x) {
      data = s.x.map((x, j) => `(${x ?? 'blank'}, ${s.y[j] ?? 'blank'}${s.size ? `, size ${s.size[j] ?? 'blank'}` : ''})`).join(' ');
      data = `points x, y${s.size ? ', size' : ''}: ${data}`;
    } else data = `values ${list(s.values ?? [])}`;
    const extra = [
      s.format && s.format !== 'General' ? `format ${q(s.format)}` : '',
      s.markers === false ? 'no markers' : '',
      s.pointColours.length ? `point colours ${s.pointColours.map((p) => `${p.idx + 1}:${p.colour}`).join(' ')}` : '',
      s.labels?.custom?.length ? `point labels ${s.labels.custom.map((c) => `${c.idx + 1}:${q(c.text)}`).join(' ')}` : '',
      s.subtotals?.length ? `totals at points ${s.subtotals.map((x) => x + 1).join(', ')}` : '',
    ].filter(Boolean).join(' · ');
    lines.push(`${head}${ownCats} ${data}${extra ? ` · ${extra}` : ''}`);
  });
  if (chart.axes.length) lines.push(`AXES ${chart.axes.map(axisText).join(' · ')}`);
  lines.push([
    `LEGEND ${chart.legend.shown ? `yes${chart.legend.position ? ` (${chart.legend.position})` : ''}` : 'no'}`,
    `TITLE ${chart.title ? q(chart.title) : 'none'}${chart.titleSizes.length ? ` ${sizesText(chart.titleSizes)}` : ''}`,
    `3D ${chart.is3D ? 'yes' : 'no'}`,
    `dual axis ${chart.dualAxis ? 'yes' : 'no'}`,
    chart.fontSizes.length ? `chart text ${sizesText(chart.fontSizes)}` : 'chart text default size',
  ].join(' · '));
  return lines.join('\n');
}
