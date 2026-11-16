// The redraw's geometry (spec §9.2): where the chart's plot area sits on the slide, the axis bounds,
// `valueToSlide` for any data point, and every overlay (lead numbers, annotations, series labels,
// CAGR labels, totals, segment labels, reference lines, quadrant lines). The .pptx builder and the
// Chart.js preview both draw from this one plan, so the preview shows what the slide shows.
// Inches throughout. Plain JavaScript, no DOM.
import { config } from '../../shared/limits.js';
import { formatValue, parseFormat } from './format.js';

const R = config.redraw;
const COLOURS = R.colours;
const GAP = 1.5; // PowerPoint's default gap width, 150% (set explicitly in the .pptx)

export const CATEGORY_KINDS = new Set(['line', 'column', 'bar', 'stackedColumn', 'stacked100', 'waterfall']);
export const STACKED_KINDS = new Set(['stackedColumn', 'stacked100']);
const DARK = new Set([COLOURS.subject, ...COLOURS.others.slice(0, 2)]);

/** Colours by role (PRD): subject blue, comparison grey, others in order. */
export function seriesColours(series) {
  let other = 0;
  return series.map((s) => {
    if (s.role === 'subject') return COLOURS.subject;
    if (s.role === 'comparison') return COLOURS.comparison;
    const c = COLOURS.others[other % COLOURS.others.length];
    other += 1;
    return c;
  });
}

/** Text on a filled mark: white on the dark colours, black on grey and amber. */
export const labelColourOn = (fill) => (DARK.has(fill) ? 'FFFFFF' : '000000');

// Rough text widths for Calibri bold, so boxes fit their text (inches per character at 1 pt).
const CHAR_W = 0.0068;
export const textWidth = (text, pt) => String(text).split('\n').reduce((m, l) => Math.max(m, l.length), 0) * pt * CHAR_W + 0.2;
export const lineHeight = (pt) => (pt * 1.2) / 72;

function niceStep(range, ticks = 5) {
  const raw = range / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const f = raw / mag;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * mag;
}

/** Round axis bounds and a major unit; columns and bars start at zero (unless values go below). */
export function niceBounds(values, { min = null, max = null, fromZero = false, log = false, labelPad = 0 } = {}) {
  const v = values.filter((x) => typeof x === 'number' && Number.isFinite(x));
  if (log) {
    const pos = v.filter((x) => x > 0);
    const lo = min ?? 10 ** Math.floor(Math.log10(Math.min(...pos, 1)));
    const hi = max ?? 10 ** Math.ceil(Math.log10(Math.max(...pos, 10)));
    return { min: lo, max: hi, unit: null, log: true };
  }
  let lo = Math.min(...v, fromZero ? 0 : Infinity);
  let hi = Math.max(...v, fromZero ? 0 : -Infinity);
  if (!Number.isFinite(lo)) lo = 0;
  if (!Number.isFinite(hi)) hi = 1;
  if (hi === lo) hi = lo + 1;
  if (!fromZero && lo > 0 && lo < (hi - lo) * 0.6) lo = 0;
  const step = niceStep((max ?? hi) - (min ?? lo));
  // Room below the lowest value (so points don't sit on the axis) and, with data labels, for the
  // labels beyond the ends of the bars.
  const pad = (!fromZero && lo !== 0 ? (hi - lo) * 0.04 : 0) + (lo < 0 ? (hi - lo) * labelPad : 0);
  const outMin = min ?? Math.floor((lo - pad) / step) * step;
  let outMax = max ?? Math.ceil((hi + (hi - outMin) * Math.max(0.04, labelPad)) / step) * step;
  if (outMax <= outMin) outMax = outMin + step;
  return { min: outMin, max: outMax, unit: niceStep(outMax - outMin), log: false };
}

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/** A box kept inside an area. */
function inside(box, area) {
  return {
    ...box,
    x: clamp(box.x, area.x, area.x + area.w - box.w),
    y: clamp(box.y, area.y, area.y + area.h - box.h),
  };
}

const overlapArea = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
  * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/**
 * The candidate box (kept inside `area`) that overlaps the placed overlays and the chart's marks
 * least; the first one wins a tie, so candidates are listed in order of preference.
 */
/** A coarse grid of places over the plot area: the fallback when every nearby place is crowded. */
function gridCandidates(plan, w, h) {
  const P = plan.plot;
  const out = [];
  for (let r = 0; r <= 4; r++) for (let c = 0; c <= 6; c++) out.push({ x: P.x + ((P.w - w) * c) / 6, y: P.y + ((P.h - h) * r) / 4, w, h });
  return out;
}

function bestBox(plan, candidates, area, { ignore = [] } = {}) {
  const obstacles = [...plan.overlays.filter((o) => !ignore.includes(o.role)), ...plan.marks];
  let best = null;
  let score = Infinity;
  for (const c of candidates) {
    const b = inside(c, area);
    // Covering text (a label, a lead number, a callout) costs more than covering a bar or a point.
    const s = obstacles.reduce((n, o) => n + overlapArea(b, o) * (o.text !== undefined || o.nativeLabel ? 4 : o.axis ? 2 : 1), 0);
    if (s < score - 1e-9) {
      best = b;
      score = s;
    }
  }
  return best;
}

/** Spreads labels at the same x apart vertically, keeping their order. */
function spread(labels, top, bottom) {
  const sorted = [...labels].sort((a, b) => a.y - b.y);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    if (sorted[i].y < prev.y + prev.h) sorted[i].y = prev.y + prev.h;
  }
  const over = sorted.length ? sorted.at(-1).y + sorted.at(-1).h - bottom : 0;
  if (over > 0) for (const l of sorted) l.y = Math.max(top, l.y - over);
  return sorted;
}

/** The values a chart plots, per category, for the axis bounds. */
function stackTotals(chart) {
  return chart.categories.map((c) => chart.series.reduce((sum, s) => sum + (pointAt(s, c)?.y ?? 0), 0));
}

export function pointAt(series, x) {
  return series.points.find((p) => String(p.x) === String(x)) ?? null;
}

/** Waterfall steps: the first and last points are totals, the rest changes (spec §9.2). */
export function waterfallSteps(series) {
  const pts = series.points;
  let running = 0;
  return pts.map((p, i) => {
    const y = p.y ?? 0;
    if (i === 0 || i === pts.length - 1) {
      running = y;
      return { x: p.x, kind: 'total', base: Math.min(0, y), size: Math.abs(y), top: Math.max(0, y), value: y };
    }
    const from = running;
    running += y;
    return { x: p.x, kind: y >= 0 ? 'up' : 'down', base: Math.min(from, running), size: Math.abs(y), top: Math.max(from, running), value: y };
  });
}

/**
 * The plan for one slide.
 * @param {object} spec a checked redraw spec
 * @returns {object} frame, plot, bounds, toSlide(), marks and overlays
 */
export function planSlide(spec) {
  const body = R.bodyZone;
  const pt = R.chartFontSize;
  const plan = {
    body,
    title: { ...R.title, text: spec.title },
    subheading: subheadingBox(spec.subheading),
    illustrative: { x: body.x + body.w - 2.4, y: body.y, w: 2.4, h: 0.3, text: R.illustrativeLabel, fontSize: 14, bold: true, color: 'C00000', align: 'right' },
    source: { ...R.source, text: spec.source },
    frame: { x: body.x, y: body.y + 0.35, w: body.w, h: body.h - 0.35 },
    overlays: [],
    lines: [],
    // Areas the overlays should keep clear of (bubbles), and native data labels a lead number replaces.
    marks: [],
    hiddenLabels: [],
  };
  if (spec.table && !spec.chart) {
    plan.table = tablePlan(spec.table, plan.frame);
    addLeadNumbers(plan, spec);
    return plan;
  }
  const chart = spec.chart;
  const kind = chart.kind;
  const colours = seriesColours(chart.series);
  plan.kind = kind;
  plan.colours = colours;
  const allY = chart.series.flatMap((s) => s.points.map((p) => p.y));
  plan.fmt = parseFormat(chart.numberFormat, allY);

  // ---- margins inside the frame ----
  const F = plan.frame;
  const names = chart.series.map((s) => s.name);
  const cats = chart.categories;
  const longestCat = cats.reduce((m, c) => Math.max(m, String(c).length), 0);
  const valueShown = chart.valueAxis.shown && !STACKED_KINDS.has(kind) && kind !== 'waterfall';
  const valueTitle = valueShown && chart.valueAxis.title ? 0.45 : 0;
  const catTitle = chart.categoryAxis.shown && chart.categoryAxis.title ? 0.45 : 0;
  let left = valueShown ? 0.85 + valueTitle : 0.25;
  let right = 0.35;
  let bottom = (chart.categoryAxis.shown ? 0.55 : 0.2) + catTitle;
  const keyed = (kind === 'column' || kind === 'bar') && chart.series.length > 1;
  const top = 0.45 + (keyed ? (chart.series.length - 1) * (lineHeight(pt) + 0.08) : 0);
  if (kind === 'bar') {
    left = clamp(longestCat * pt * CHAR_W + 0.35, 1.0, 3.2) + catTitle;
    bottom = (valueShown ? 0.55 : 0.2) + valueTitle;
  }
  if (STACKED_KINDS.has(kind)) left = clamp(Math.max(...names.map((n) => n.length)) * pt * CHAR_W + 0.3, 1.0, 2.6);
  if (kind === 'line') {
    const widest = Math.max(...chart.series.map((s) => textWidth(s.cagr ? `${s.name}\n${s.cagr} CAGR` : s.name, pt)));
    right = clamp(widest + 0.1, 1.0, 2.8);
  }
  if (STACKED_KINDS.has(kind) && chart.series.some((s) => s.cagr)) right = 1.2;
  if (kind === 'scatter' || kind === 'bubble') {
    left = (chart.valueAxis.shown ? 0.85 : 0.25) + valueTitle;
    right = 0.6;
  }
  // Category names wrap onto a second line where they're wider than their slot (vertical charts).
  if (kind !== 'bar' && CATEGORY_KINDS.has(kind)) {
    const slot = (F.w - left - right) / Math.max(cats.length, 1);
    plan.categoryLabels = cats.map((c) => wrapLabel(String(c), slot, pt));
    const lines = Math.max(1, ...plan.categoryLabels.map((l) => l.split('\n').length));
    bottom += (lines - 1) * lineHeight(pt);
  } else plan.categoryLabels = cats.map(String);
  const P = { x: F.x + left, y: F.y + top, w: F.w - left - right, h: F.h - top - bottom };
  plan.plot = P;
  plan.margins = { left, right, top, bottom };

  // ---- bounds ----
  const fromZero = kind !== 'line' && kind !== 'scatter' && kind !== 'bubble';
  let valueValues = allY;
  if (kind === 'stackedColumn') valueValues = stackTotals(chart);
  if (kind === 'waterfall') valueValues = waterfallSteps(chart.series[0]).flatMap((s) => [s.base, s.top]);
  plan.valueBounds = kind === 'stacked100'
    ? { min: 0, max: 1, unit: 0.25, log: false }
    : niceBounds(valueValues, {
      min: chart.valueAxis.min, max: chart.valueAxis.max, fromZero, log: chart.valueAxis.log,
      labelPad: (kind === 'bar' || kind === 'column') && chart.dataLabels !== 'none' ? 0.12 : 0,
    });
  if (kind === 'scatter' || kind === 'bubble') {
    const xs = chart.series.flatMap((s) => s.points.map((p) => Number(p.x)));
    plan.xBounds = niceBounds(xs, { min: chart.categoryAxis.min, max: chart.categoryAxis.max });
  }

  const vb = plan.valueBounds;
  const frac = (v) => (vb.log
    ? (Math.log10(v) - Math.log10(vb.min)) / (Math.log10(vb.max) - Math.log10(vb.min))
    : (v - vb.min) / (vb.max - vb.min));
  const n = Math.max(cats.length, 1);
  const band = (kind === 'bar' ? P.h : P.w) / n;
  // One series per category (the subject's bar blue, the rest grey): each bar takes the full slot.
  plan.exclusive = (kind === 'column' || kind === 'bar') && chart.series.length > 1
    && cats.every((c) => chart.series.filter((s) => (pointAt(s, c)?.y ?? null) !== null).length <= 1);
  const nBars = (kind === 'column' || kind === 'bar') && !plan.exclusive ? chart.series.length : 1;
  const groupW = band / (1 + GAP);
  const barW = groupW / nBars;
  plan.band = band;
  plan.barW = barW;

  /** Slide inches of a category and value (the bar of `seriesIndex` in a clustered chart). */
  const categoryToSlide = (catIndex, value, seriesIndex = null) => {
    const centre = (catIndex + 0.5) * band;
    const offset = seriesIndex === null || nBars === 1 ? 0 : -groupW / 2 + (seriesIndex + 0.5) * barW;
    if (kind === 'bar') return { x: P.x + P.w * frac(value), y: P.y + centre + offset };
    return { x: P.x + centre + offset, y: P.y + P.h * (1 - frac(value)) };
  };
  const xyToSlide = (x, y) => {
    const xb = plan.xBounds;
    return { x: P.x + (P.w * (x - xb.min)) / (xb.max - xb.min), y: P.y + P.h * (1 - frac(y)) };
  };
  plan.toSlide = CATEGORY_KINDS.has(kind) ? categoryToSlide : xyToSlide;

  // ---- where each anchor is: the mark's top (or end, for bars) ----
  const catIndex = (x) => cats.findIndex((c) => String(c) === String(x));
  const steps = kind === 'waterfall' ? waterfallSteps(chart.series[0]) : null;
  plan.steps = steps;
  const stacked = STACKED_KINDS.has(kind) ? stackPlan(chart, kind) : null;
  plan.stacks = stacked;
  /** @returns {{ x, y } | null} */
  plan.anchorPoint = ({ series, x }) => {
    if (CATEGORY_KINDS.has(kind)) {
      let i = catIndex(x);
      if (i < 0 && typeof x === 'number' && Number.isInteger(x) && x >= 0 && x < cats.length) i = x;
      if (i < 0) {
        const s = chart.series.find((se) => se.name === series) ?? chart.series[0];
        i = s.points.length ? catIndex(s.points.at(-1).x) : -1;
      }
      if (i < 0) return null;
      if (steps) return categoryToSlide(i, steps[i].top);
      if (stacked) {
        const si = chart.series.findIndex((s) => s.name === series);
        if (si < 0) return categoryToSlide(i, stacked[i].total);
        const seg = stacked[i].segments[si];
        return categoryToSlide(i, (seg.from + seg.to) / 2);
      }
      const si = Math.max(0, chart.series.findIndex((s) => s.name === series));
      const p = pointAt(chart.series[si], cats[i]);
      if (!p || p.y === null) return null;
      return categoryToSlide(i, p.y, kind === 'line' ? null : si);
    }
    const s = chart.series.find((se) => se.name === series) ?? chart.series[0];
    const p = s.points.find((q) => Number(q.x) === Number(x) || String(q.label ?? '') === String(x)) ?? s.points.at(-1);
    return p && p.y !== null ? xyToSlide(Number(p.x), p.y) : null;
  };

  addMarks(plan, chart);
  // The axis labels' strips are not free space for lead numbers, callouts or point labels.
  const axisStrip = (box) => box.w > 0 && box.h > 0 && plan.marks.push({ ...box, axis: true });
  if (kind === 'bar') axisStrip({ x: F.x, y: P.y, w: P.x - F.x, h: P.h });
  else {
    axisStrip({ x: P.x, y: P.y + P.h, w: P.w, h: F.y + F.h - (P.y + P.h) });
    if (plan.margins.left > 0.3) axisStrip({ x: F.x, y: P.y, w: P.x - F.x, h: P.h });
  }
  if (kind === 'bar') axisStrip({ x: P.x, y: P.y + P.h, w: P.w, h: F.y + F.h - (P.y + P.h) });
  addMarksOverlays(plan, chart, pt);
  addReferenceAndQuadrants(plan, spec, chart, pt);
  addLeadNumbers(plan, spec);
  addAnnotations(plan, spec);
  return plan;
}

/** Boxes the overlays keep clear of: bars, points, bubbles, and the labels PowerPoint draws itself. */
function addMarks(plan, chart) {
  const { kind } = plan;
  const cats = chart.categories;
  const vb = plan.valueBounds;
  const zero = Math.min(Math.max(0, vb.min), vb.max);
  const pt = R.chartFontSize;
  const lh = lineHeight(pt);
  const rect = (a, b, half) => (kind === 'bar'
    ? { x: Math.min(a.x, b.x), y: a.y - half, w: Math.abs(b.x - a.x), h: 2 * half }
    : { x: a.x - half, y: Math.min(a.y, b.y), w: 2 * half, h: Math.abs(b.y - a.y) });
  const labelled = (s) => chart.dataLabels === 'all' || (chart.dataLabels === 'subject' && s.role === 'subject');
  if (kind === 'column' || kind === 'bar') {
    chart.series.forEach((s, si) => cats.forEach((c, i) => {
      const p = pointAt(s, c);
      if (!p || p.y === null) return;
      const slot = plan.exclusive ? null : si;
      const end = plan.toSlide(i, p.y, slot);
      plan.marks.push(rect(plan.toSlide(i, zero, slot), end, plan.barW / 2));
      if (labelled(s)) {
        const w = textWidth(formatValue(p.y, plan.fmt), pt);
        const box = kind === 'bar'
          ? { x: p.y < 0 ? end.x - w - 0.04 : end.x + 0.04, y: end.y - lh / 2, w, h: lh }
          : { x: end.x - w / 2, y: p.y < 0 ? end.y + 0.04 : end.y - lh - 0.04, w, h: lh };
        plan.marks.push({ ...box, nativeLabel: { series: si, index: i } });
      }
    }));
  } else if (kind === 'line') {
    chart.series.forEach((s, si) => cats.forEach((c, i) => {
      const p = pointAt(s, c);
      if (!p || p.y === null) return;
      const at = plan.toSlide(i, p.y);
      plan.marks.push({ x: at.x - 0.06, y: at.y - 0.06, w: 0.12, h: 0.12 });
      if (labelled(s)) {
        const w = textWidth(formatValue(p.y, plan.fmt), pt);
        plan.marks.push({ x: at.x - w / 2, y: at.y - lh - 0.06, w, h: lh, nativeLabel: { series: si, index: i } });
      }
    }));
  } else if (plan.steps) {
    plan.steps.forEach((st, i) => plan.marks.push(rect(plan.toSlide(i, st.base), plan.toSlide(i, st.base + st.size), plan.barW / 2)));
  } else if (plan.stacks) {
    plan.stacks.forEach((st, i) => plan.marks.push(rect(plan.toSlide(i, 0), plan.toSlide(i, st.total), plan.barW / 2)));
  } else if (kind === 'scatter' || kind === 'bubble') {
    const P = plan.plot;
    const maxSize = Math.max(...chart.series.flatMap((s) => s.points.map((p) => p.size ?? 0)), 1);
    plan.bubbleRadius = (size) => Math.sqrt(Math.max(size ?? 0, 0) / maxSize) * 0.15 * Math.min(P.w, P.h);
    for (const s of chart.series) {
      for (const p of s.points) {
        if (p.y === null) continue;
        const at = plan.toSlide(Number(p.x), p.y);
        const r = kind === 'bubble' ? plan.bubbleRadius(p.size) : 0.07;
        plan.marks.push({ x: at.x - r, y: at.y - r, w: 2 * r, h: 2 * r });
      }
    }
  }
}

/** A category name broken at spaces so each line fits its slot (two lines at most). */
function wrapLabel(label, slot, pt) {
  if (textWidth(label, pt) <= slot || !label.includes(' ')) return label;
  const words = label.split(' ');
  let best = label;
  let bestW = Infinity;
  for (let i = 1; i < words.length; i++) {
    const two = `${words.slice(0, i).join(' ')}\n${words.slice(i).join(' ')}`;
    const w = textWidth(two, pt);
    if (w < bestW) {
      best = two;
      bestW = w;
    }
  }
  return best;
}

function subheadingBox(text) {
  const s = R.subheading;
  const upper = s.caps ? String(text).toUpperCase() : String(text);
  const fontSize = upper.length <= 52 ? s.fontSize : upper.length <= 64 ? 20 : upper.length <= 72 ? 18 : 16;
  return { ...s, text: upper, fontSize };
}

/** Cumulative segments per category for stacked kinds (100% stacks as fractions). */
function stackPlan(chart, kind) {
  return chart.categories.map((c) => {
    const vals = chart.series.map((s) => Math.max(0, pointAt(s, c)?.y ?? 0));
    const total = vals.reduce((a, b) => a + b, 0);
    let from = 0;
    const segments = vals.map((v) => {
      const size = kind === 'stacked100' ? (total ? v / total : 0) : v;
      const seg = { from, to: from + size, value: v };
      from += size;
      return seg;
    });
    return { total: kind === 'stacked100' ? 1 : total, rawTotal: total, segments };
  });
}

function text(plan, box) {
  plan.overlays.push({ fontSize: R.chartFontSize, bold: true, color: '000000', align: 'left', valign: 'middle', ...box });
}

function addMarksOverlays(plan, chart, pt) {
  const { kind, plot: P, colours, fmt } = plan;
  const cats = chart.categories;
  const h1 = lineHeight(pt) + 0.08;

  if (kind === 'line') {
    // Series labelled at the line end, in the series colour, with the CAGR for the period.
    const labels = chart.series.map((s, i) => {
      const last = [...s.points].reverse().find((p) => p.y !== null);
      if (!last) return null;
      const at = plan.toSlide(cats.findIndex((c) => String(c) === String(last.x)), last.y);
      const t = s.cagr ? `${s.name}\n${s.cagr} CAGR` : s.name;
      const h = h1 * (s.cagr ? 2 : 1);
      return { x: P.x + P.w + 0.08, y: at.y - h / 2, w: plan.margins.right - 0.1, h, text: t, color: colours[i], role: 'seriesLabel' };
    }).filter(Boolean);
    for (const l of spread(labels, plan.frame.y, plan.frame.y + plan.frame.h)) text(plan, l);
  }

  if ((kind === 'column' || kind === 'bar') && chart.series.length > 1) {
    // No legend: the series are named once, in their colours, at the top right of the plot area.
    chart.series.forEach((s, i) => {
      const w = textWidth(s.name, pt);
      text(plan, { x: P.x + P.w - w, y: plan.frame.y + 0.02 + i * h1, w, h: h1, text: s.name, color: colours[i], align: 'right', role: 'seriesLabel' });
    });
  }

  if (plan.stacks) {
    const stacks = plan.stacks;
    const first = 0;
    const barLeft = P.x + plan.band * 0.5 - plan.barW / 2;
    // Segment names left of the first column, in the segment's colour.
    const names = chart.series.map((s, si) => {
      const seg = stacks[first].segments[si];
      const at = plan.toSlide(first, (seg.from + seg.to) / 2);
      return { x: plan.frame.x, y: at.y - h1 / 2, w: barLeft - plan.frame.x - 0.08, h: h1, text: s.name, color: colours[si] === COLOURS.comparison ? '000000' : colours[si], align: 'right', role: 'segmentLabel' };
    });
    for (const l of spread(names, P.y, P.y + P.h)) text(plan, l);
    // Totals above each column (100% stacks show the absolute total, if it differs by column).
    stacks.forEach((st, i) => {
      const at = plan.toSlide(i, st.total);
      const t = formatValue(st.rawTotal, fmt);
      const w = textWidth(t, pt);
      text(plan, { x: at.x - w / 2, y: at.y - h1 - 0.02, w, h: h1, text: t, align: 'center', role: 'total' });
    });
    // 100% stacks show each segment's share (Chris, Q14); other stacks show values natively.
    if (kind === 'stacked100') {
      chart.series.forEach((s, si) => stacks.forEach((st, i) => {
        const seg = st.segments[si];
        if (!seg.value) return;
        const at = plan.toSlide(i, (seg.from + seg.to) / 2);
        const t = `${Math.round((seg.to - seg.from) * 100)}%`;
        const w = textWidth(t, pt);
        text(plan, { x: at.x - w / 2, y: at.y - h1 / 2, w, h: h1, text: t, color: labelColourOn(colours[si]), align: 'center', role: 'segmentValue' });
      }));
    }
    // CAGR per segment on the right of the last column.
    const lastI = stacks.length - 1;
    const cagrs = chart.series.map((s, si) => {
      if (!s.cagr || lastI < 0) return null;
      const seg = stacks[lastI].segments[si];
      const at = plan.toSlide(lastI, (seg.from + seg.to) / 2);
      return { x: at.x + plan.barW / 2 + 0.08, y: at.y - h1 / 2, w: 1.1, h: h1, text: s.cagr, color: colours[si] === COLOURS.comparison ? '000000' : colours[si], role: 'cagr' };
    }).filter(Boolean);
    for (const l of spread(cagrs, P.y, P.y + P.h)) text(plan, l);
  }

  if (kind === 'waterfall') {
    plan.steps.forEach((st, i) => {
      const at = plan.toSlide(i, st.top);
      const t = st.kind === 'total' ? formatValue(st.value, fmt) : `${st.value >= 0 ? '+' : ''}${formatValue(st.value, fmt)}`;
      const w = textWidth(t, pt);
      text(plan, { x: at.x - w / 2, y: at.y - h1 - 0.02, w, h: h1, text: t, align: 'center', role: 'dataLabel' });
    });
  }

  if (kind === 'scatter' || kind === 'bubble') {
    chart.series.forEach((s, si) => {
      for (const p of s.points) {
        if (!p.label || p.y === null) continue;
        const at = plan.toSlide(Number(p.x), p.y);
        const r = kind === 'bubble' ? plan.bubbleRadius(p.size) : 0.07;
        const w = textWidth(p.label, pt);
        const box = bestBox(plan, [
          { x: at.x + r + 0.08, y: at.y - h1 / 2 },
          { x: at.x - r - 0.08 - w, y: at.y - h1 / 2 },
          { x: at.x - w / 2, y: at.y - r - h1 - 0.02 },
          { x: at.x - w / 2, y: at.y + r + 0.02 },
          { x: at.x - w / 2, y: at.y - r - 2 * h1 },
          { x: at.x - w / 2, y: at.y + r + h1 },
        ].map((c) => ({ ...c, w, h: h1 })), plan.frame);
        text(plan, { ...box, text: p.label, color: colours[si] === COLOURS.comparison ? '000000' : colours[si], role: 'pointLabel' });
      }
    });
    if (chart.series.length > 1) {
      chart.series.forEach((s, si) => {
        const last = s.points.at(-1);
        if (!last || last.y === null || last.label) return;
        const at = plan.toSlide(Number(last.x), last.y);
        const w = textWidth(s.name, pt);
        const box = bestBox(plan, [{ x: at.x + 0.12, y: at.y - h1 / 2 }, { x: at.x - 0.12 - w, y: at.y - h1 / 2 }, { x: at.x - w / 2, y: at.y - h1 - 0.1 }, { x: at.x - w / 2, y: at.y + 0.1 }, { x: at.x - w, y: at.y - 2 * h1 - 0.1 }, { x: at.x - w, y: at.y + h1 + 0.1 }].map((c) => ({ ...c, w, h: h1 })), plan.frame);
        text(plan, { ...box, text: s.name, color: colours[si] === COLOURS.comparison ? '000000' : colours[si], role: 'seriesLabel' });
      });
    }
  }
}

function addReferenceAndQuadrants(plan, spec, chart, pt) {
  const P = plan.plot;
  const h1 = lineHeight(pt) + 0.08;
  const vb = plan.valueBounds;
  const q0 = chart.quadrants;
  for (const r of spec.referenceLines) {
    // A line the quadrant split already draws is not drawn twice.
    if (q0 && plan.xBounds && ((r.axis === 'x' && r.value === q0.xSplit) || (r.axis === 'y' && r.value === q0.ySplit))) continue;
    if (r.axis === 'y') {
      if (r.value < vb.min || r.value > vb.max) continue;
      if (plan.kind === 'bar') {
        const x = plan.toSlide(0, r.value).x;
        plan.lines.push({ x1: x, y1: P.y, x2: x, y2: P.y + P.h, dash: true, role: 'reference' });
        const w = textWidth(r.label, pt);
        text(plan, inside({ x: x - w / 2, y: P.y - h1, w, h: h1, text: r.label, align: 'center', role: 'referenceLabel' }, plan.frame));
      } else {
        const y = CATEGORY_KINDS.has(plan.kind) ? plan.toSlide(0, r.value).y : plan.toSlide(plan.xBounds.min, r.value).y;
        plan.lines.push({ x1: P.x, y1: y, x2: P.x + P.w, y2: y, dash: true, role: 'reference' });
        const w = textWidth(r.label, pt);
        const box = bestBox(plan, [{ x: P.x + P.w - w, y: y - h1 - 0.02 }, { x: P.x + P.w - w, y: y + 0.02 }, { x: P.x + 0.05, y: y - h1 - 0.02 }, { x: P.x + 0.05, y: y + 0.02 }].map((c) => ({ ...c, w, h: h1 })), plan.frame);
        text(plan, { ...box, text: r.label, align: 'right', role: 'referenceLabel' });
      }
    } else if (plan.xBounds && r.value >= plan.xBounds.min && r.value <= plan.xBounds.max) {
      const x = plan.toSlide(r.value, vb.min).x;
      plan.lines.push({ x1: x, y1: P.y, x2: x, y2: P.y + P.h, dash: true, role: 'reference' });
      const w = textWidth(r.label, pt);
      text(plan, inside({ x: x - w / 2, y: P.y - h1, w, h: h1, text: r.label, align: 'center', role: 'referenceLabel' }, plan.frame));
    }
  }
  const q = chart.quadrants;
  if (q && plan.xBounds) {
    const x = plan.toSlide(q.xSplit, vb.min).x;
    const y = plan.toSlide(plan.xBounds.min, q.ySplit).y;
    plan.lines.push({ x1: x, y1: P.y, x2: x, y2: P.y + P.h, dash: true, role: 'quadrant' });
    plan.lines.push({ x1: P.x, y1: y, x2: P.x + P.w, y2: y, dash: true, role: 'quadrant' });
    const wx = textWidth(q.xLabel, pt);
    const bx = bestBox(plan, [{ x: x - wx / 2, y: P.y - h1 }, { x: x + 0.05, y: P.y - h1 }, { x: x - wx - 0.05, y: P.y - h1 }].map((c) => ({ ...c, w: wx, h: h1 })), plan.frame);
    text(plan, { ...bx, text: q.xLabel, align: 'center', role: 'quadrantLabel' });
    const wy = textWidth(q.yLabel, pt);
    const by = bestBox(plan, [{ x: P.x + P.w - wy, y: y - h1 - 0.02 }, { x: P.x + P.w - wy, y: y + 0.02 }, { x: P.x + 0.05, y: y - h1 - 0.02 }, { x: P.x + 0.05, y: y + 0.02 }].map((c) => ({ ...c, w: wy, h: h1 })), plan.frame);
    text(plan, { ...by, text: q.yLabel, align: 'right', role: 'quadrantLabel' });
  }
}

const figure = (s) => String(s).replace(/[^\d.]/g, '').replace(/^\.|\.$/g, '');

/** The native data label at an anchor, if the chart shows one there: { series, index, text }. */
function nativeLabel(plan, spec, anchor) {
  const chart = spec.chart;
  if (!chart || !['line', 'column', 'bar'].includes(plan.kind)) return null;
  const si = chart.series.findIndex((s) => s.name === anchor.series);
  const s = chart.series[si];
  if (!s || !(chart.dataLabels === 'all' || (chart.dataLabels === 'subject' && s.role === 'subject'))) return null;
  const index = chart.categories.findIndex((c) => String(c) === String(anchor.x));
  const p = index >= 0 ? pointAt(s, chart.categories[index]) : null;
  return p && p.y !== null ? { series: si, index, text: formatValue(p.y, plan.fmt) } : null;
}

function addLeadNumbers(plan, spec) {
  const pt = R.leadNumberFontSize;
  const h = lineHeight(pt) + 0.1;
  const area = plan.frame;
  let loose = 0;
  for (const n of spec.leadNumbers) {
    const at = plan.anchorPoint ? plan.anchorPoint(n.anchor) : null;
    const w = textWidth(n.text, pt);
    if (!at) {
      // No mark to sit beside (a table, or an anchor the chart doesn't have): under the body.
      const below = plan.table ? plan.table.y + plan.table.h + 0.15 : area.y + 0.05;
      const x = plan.table ? plan.table.x : area.x + 0.2;
      plan.overlays.push({ ...inside({ x: x + loose, y: below, w, h }, plan.body), text: n.text, fontSize: pt, bold: true, color: R.colours.subject, align: 'left', valign: 'middle', role: 'leadNumber', anchor: null });
      loose += w + 0.2;
      continue;
    }
    const label = nativeLabel(plan, spec, n.anchor);
    const same = label && figure(label.text) === figure(n.text);
    if (same) {
      // The lead number replaces the mark's own data label (D70).
      plan.hiddenLabels.push({ series: label.series, index: label.index });
      plan.marks = plan.marks.filter((m) => !(m.nativeLabel && m.nativeLabel.series === label.series && m.nativeLabel.index === label.index));
    }
    // Beside the mark, beyond its end (bars) or above it; the least crowded of a few places.
    const d = 0.1;
    const negative = plan.kind === 'bar' && at.x < plan.toSlide(0, Math.min(Math.max(0, plan.valueBounds.min), plan.valueBounds.max)).x - 1e-9;
    const zeroX = plan.kind === 'bar' ? plan.toSlide(0, Math.min(Math.max(0, plan.valueBounds.min), plan.valueBounds.max)).x : 0;
    const candidates = plan.kind === 'bar'
      ? [negative ? { x: at.x - w - d, y: at.y - h / 2 } : { x: at.x + d, y: at.y - h / 2 },
        ...(label && !same ? [negative ? { x: at.x - w - d - textWidth(label.text, R.chartFontSize), y: at.y - h / 2 } : { x: at.x + d + textWidth(label.text, R.chartFontSize), y: at.y - h / 2 }] : []),
        ...(negative ? [{ x: zeroX + d, y: at.y - h / 2 }] : []), { x: at.x - w / 2, y: at.y - h - d }, { x: at.x - w / 2, y: at.y + d }]
      : [{ x: at.x - w / 2, y: at.y - h - d }, { x: at.x + d, y: at.y - h / 2 }, { x: at.x - w - d, y: at.y - h / 2 }, { x: at.x - w / 2, y: at.y + d }, { x: at.x - w / 2, y: at.y - h - 0.5 },
        // The clear band above the plot, straight above the mark.
        { x: at.x - w / 2, y: area.y }];
    // Near places only: a lead number belongs beside its mark, even if it overlaps a little.
    const box = bestBox(plan, candidates.map((c) => ({ ...c, w, h })), area);
    plan.overlays.push({ ...box, text: n.text, fontSize: pt, bold: true, color: R.colours.subject, align: 'center', valign: 'middle', role: 'leadNumber', anchor: at });
  }
}

function addAnnotations(plan, spec) {
  const pt = R.chartFontSize;
  const P = plan.plot;
  const area = { x: P.x, y: plan.frame.y, w: P.w, h: P.y + P.h - plan.frame.y };
  for (const a of spec.annotations) {
    const at = plan.anchorPoint(a.anchor) ?? { x: P.x + P.w / 2, y: P.y + P.h / 3 };
    const w = clamp(textWidth(a.text, pt), 1.4, 2.6);
    const perLine = Math.max(8, Math.floor((w - 0.2) / (pt * CHAR_W)));
    const lines = wrapCount(a.text, perLine);
    const h = lines * lineHeight(pt) + 0.18;
    const rightHalf = at.x > P.x + P.w / 2;
    const near = rightHalf ? (d) => at.x - w - d : (d) => at.x + d;
    const far = rightHalf ? (d) => at.x + d : (d) => at.x - w - d;
    const candidates = [0.35, 0.8, 1.4].flatMap((d) => [
      { x: near(d), y: at.y - h - d },
      { x: near(d), y: at.y + d },
      { x: far(d), y: at.y - h - d },
      { x: far(d), y: at.y + d },
      { x: near(d + 0.2), y: at.y - h / 2 },
      { x: far(d + 0.2), y: at.y - h / 2 },
    ]).map((c) => ({ ...c, w, h }));
    const box = bestBox(plan, [...candidates, ...gridCandidates(plan, w, h)], area);
    plan.overlays.push({ ...box, text: a.text, fontSize: pt, bold: true, color: '000000', align: 'center', valign: 'middle', role: 'annotation', anchor: at });
    // A pointer from the bubble's nearest edge to the mark it describes.
    const ex = clamp(at.x, box.x, box.x + box.w);
    const ey = clamp(at.y, box.y, box.y + box.h);
    plan.lines.push({ x1: ex, y1: ey, x2: at.x, y2: at.y, dash: false, role: 'pointer' });
  }
}

function wrapCount(textIn, perLine) {
  let lines = 1;
  let len = 0;
  for (const word of String(textIn).split(/\s+/)) {
    if (len && len + 1 + word.length > perLine) {
      lines += 1;
      len = word.length;
    } else len += (len ? 1 : 0) + word.length;
  }
  return lines;
}

function tablePlan(table, frame) {
  const cols = Math.max(table.headers.length, ...table.rows.map((r) => r.length), 1);
  const rows = table.rows.length + 1;
  const fontSize = rows > 10 ? 14 : 16;
  const rowH = lineHeight(fontSize) + 0.16;
  const widths = Array.from({ length: cols }, (_, c) => Math.max(
    String(table.headers[c] ?? '').length,
    ...table.rows.map((r) => String(r[c] ?? '').length),
  ) + 2);
  const total = widths.reduce((a, b) => a + b, 0);
  const w = Math.min(frame.w, Math.max(4, total * fontSize * CHAR_W * 1.05));
  return {
    x: frame.x, y: frame.y, w, rowH, fontSize,
    colW: widths.map((x) => (x / total) * w),
    h: Math.min(frame.h, rows * rowH),
  };
}
