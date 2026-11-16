// The redraw preview (spec §9.3, D19): the same spec drawn with Chart.js on an off-screen canvas,
// with the title, subheading, overlays and template background, for the screen and the record. It
// is a preview of the content, not a render of the .pptx. Placement comes from src/redraw/layout.js,
// as in the .pptx, so the two agree. Runs in the browser and, for the tests, in Node with
// @napi-rs/canvas (the caller passes createCanvas and the loaded background image).
import { Chart, registerables } from 'chart.js';
import { config } from '../../shared/limits.js';
import { STACKED_KINDS, labelColourOn, planSlide, pointAt } from './layout.js';
import { formatValue } from './format.js';

Chart.register(...registerables);

const R = config.redraw;
const FONT_STACK = 'Calibri, Carlito, "Segoe UI", Arial, sans-serif';
const hex = (c) => `#${c}`;

/**
 * Draws the slide.
 * @param {object} spec a checked, redrawable redraw spec
 * @param {{ createCanvas: (w: number, h: number) => any, background?: any, ppi?: number }} deps
 *   background: a drawable image of the template background
 * @returns {any} the canvas (call toDataURL / toBlob / encode on it)
 */
export function renderPreview(spec, { createCanvas, background = null, ppi = 120 }) {
  const plan = planSlide(spec);
  const W = Math.round(R.slide.width * ppi);
  const H = Math.round(R.slide.height * ppi);
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const px = (inches) => inches * ppi;
  const fontPx = (pt) => (pt / 72) * ppi;

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, W, H);
  if (background) ctx.drawImage(background, 0, 0, W, H);

  const box = (b, opts = {}) => drawText(ctx, { ...b, ...opts }, px, fontPx);
  box(plan.title, { color: R.title.color, bold: true, align: 'left', valign: 'middle' });
  box(plan.subheading, { color: '000000', bold: true, align: 'left', valign: 'middle' });
  box(plan.illustrative);
  box({ ...plan.source, bold: false, color: '000000', valign: 'top' });
  box({ ...R.slideNumber, text: '1', fontSize: 12, bold: false, color: '000000', align: 'right', valign: 'middle' });

  if (plan.table) drawTable(ctx, spec.table, plan.table, px, fontPx);
  else {
    const F = plan.frame;
    const sub = createCanvas(Math.round(px(F.w)), Math.round(px(F.h)));
    const chart = new Chart(sub.getContext('2d'), chartConfig(spec.chart, plan, px, fontPx));
    chart.draw();
    ctx.drawImage(sub, px(F.x), px(F.y));
    chart.destroy();
    drawDataLabels(ctx, spec.chart, plan, px, fontPx);
  }

  for (const l of plan.lines) {
    ctx.save();
    ctx.strokeStyle = l.role === 'pointer' ? '#000000' : '#595959';
    ctx.lineWidth = fontPx(l.role === 'pointer' ? 0.75 : 1.25);
    ctx.setLineDash(l.dash ? [px(0.08), px(0.05)] : []);
    ctx.beginPath();
    ctx.moveTo(px(l.x1), px(l.y1));
    ctx.lineTo(px(l.x2), px(l.y2));
    ctx.stroke();
    ctx.restore();
  }
  for (const o of plan.overlays) {
    if (o.role === 'annotation') {
      ctx.save();
      ctx.fillStyle = '#FFFFFF';
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = fontPx(0.75);
      roundRect(ctx, px(o.x), px(o.y), px(o.w), px(o.h), px(0.12));
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    box(o);
  }
  return canvas;
}

function chartConfig(chart, plan, px, fontPx) {
  const { kind, plot: P, frame: F, valueBounds: vb, colours } = plan;
  const pt = R.chartFontSize;
  const tickFont = { family: FONT_STACK, size: fontPx(pt), weight: 'bold' };
  const left = px(P.x - F.x);
  const bottom = px(F.y + F.h - (P.y + P.h));
  const padding = { top: px(P.y - F.y), right: px(F.x + F.w - (P.x + P.w)), left: 0, bottom: 0 };
  const axisLine = { display: true, color: '#000000', width: 1 };
  const title = (t) => (t ? { display: true, text: t, font: { family: FONT_STACK, size: fontPx(pt) }, color: '#000000' } : { display: false });
  const valueShown = chart.valueAxis.shown && !STACKED_KINDS.has(kind) && kind !== 'waterfall';
  const valueScale = (axis) => ({
    type: vb.log ? 'logarithmic' : 'linear',
    min: vb.min, max: vb.max,
    display: valueShown,
    grid: { display: false, drawTicks: valueShown },
    border: axisLine,
    ticks: { font: tickFont, color: '#000000', ...(vb.unit ? { stepSize: vb.unit } : {}), callback: (v) => formatValue(Number(v), plan.fmt) },
    title: title(valueShown ? chart.valueAxis.title : null),
    stacked: STACKED_KINDS.has(kind) || kind === 'waterfall',
    afterFit: (s) => { if (axis === 'y') s.width = left; else s.height = bottom; },
  });
  const categoryScale = (axis) => ({
    type: 'category', offset: true,
    display: chart.categoryAxis.shown,
    grid: { display: false, drawTicks: false },
    border: axisLine,
    ticks: { font: tickFont, color: '#000000', autoSkip: false, maxRotation: 45 },
    title: title(chart.categoryAxis.title),
    stacked: STACKED_KINDS.has(kind) || kind === 'waterfall',
    afterFit: (s) => { if (axis === 'y') s.width = left; else s.height = bottom; },
  });
  const numberScale = (axis, b, t) => ({
    type: 'linear', min: b.min, max: b.max,
    grid: { display: false }, border: axisLine,
    ticks: { font: tickFont, color: '#000000', ...(b.unit ? { stepSize: b.unit } : {}) },
    title: title(t),
    afterFit: (s) => { if (axis === 'y') s.width = left; else s.height = bottom; },
  });
  const base = {
    responsive: false, animation: false, devicePixelRatio: 1,
    layout: { padding },
    plugins: { legend: { display: false }, title: { display: false }, tooltip: { enabled: false } },
  };
  // Chart.js draws an array label on several lines, as PowerPoint draws the wrapped names.
  const cats = (plan.categoryLabels ?? chart.categories.map(String)).map((l) => (l.includes('\n') ? l.split('\n') : l));
  const values = (s) => chart.categories.map((c) => pointAt(s, c)?.y ?? null);
  const barShape = { categoryPercentage: 1 / 2.5, barPercentage: 1, borderWidth: 0 };

  if (kind === 'line') {
    return {
      type: 'line',
      data: { labels: cats, datasets: chart.series.map((s, i) => ({ data: values(s), borderColor: hex(colours[i]), borderWidth: fontPx(3), pointRadius: 0, spanGaps: true })) },
      options: { ...base, scales: { x: categoryScale('x'), y: valueScale('y') } },
    };
  }
  if (kind === 'column' || kind === 'bar') {
    const horizontal = kind === 'bar';
    return {
      type: 'bar',
      data: { labels: cats, datasets: chart.series.map((s, i) => ({ data: values(s), backgroundColor: hex(colours[i]), ...barShape, ...(plan.exclusive ? { grouped: false } : {}) })) },
      options: { ...base, indexAxis: horizontal ? 'y' : 'x', scales: horizontal ? { y: categoryScale('y'), x: valueScale('x') } : { x: categoryScale('x'), y: valueScale('y') } },
    };
  }
  if (STACKED_KINDS.has(kind)) {
    return {
      type: 'bar',
      data: { labels: cats, datasets: chart.series.map((s, si) => ({ data: plan.stacks.map((st) => st.segments[si].to - st.segments[si].from), backgroundColor: hex(colours[si]), ...barShape })) },
      options: { ...base, scales: { x: categoryScale('x'), y: valueScale('y') } },
    };
  }
  if (kind === 'waterfall') {
    const fill = { total: R.colours.subject, up: R.colours.comparison, down: R.colours.others[0] };
    return {
      type: 'bar',
      data: { labels: cats, datasets: [{ data: plan.steps.map((s) => [s.base, s.base + s.size]), backgroundColor: plan.steps.map((s) => hex(fill[s.kind])), ...barShape }] },
      options: { ...base, scales: { x: { ...categoryScale('x'), stacked: false }, y: { ...valueScale('y'), stacked: false } } },
    };
  }
  // scatter and bubble
  const isBubble = kind === 'bubble';
  return {
    type: isBubble ? 'bubble' : 'scatter',
    data: {
      datasets: chart.series.map((s, i) => ({
        data: s.points.filter((p) => p.y !== null).map((p) => ({ x: Number(p.x), y: p.y, ...(isBubble ? { r: px(plan.bubbleRadius(p.size)) } : {}) })),
        backgroundColor: hex(colours[i]), borderColor: hex(colours[i]),
        showLine: !isBubble && chart.joinInTimeOrder, borderWidth: fontPx(2), pointRadius: isBubble ? undefined : fontPx(4.5),
      })),
    },
    options: { ...base, scales: { x: numberScale('x', plan.xBounds, chart.categoryAxis.title), y: valueScale('y') } },
  };
}

/** The labels the .pptx draws natively: point values, and segment values in stacks. */
function drawDataLabels(ctx, chart, plan, px, fontPx) {
  const pt = R.chartFontSize;
  const { kind } = plan;
  const label = (textIn, x, y, colour, align = 'center') => drawText(ctx, { x: x - 1, y: y - 0.16, w: 2, h: 0.32, text: textIn, fontSize: pt, bold: true, color: colour, align }, px, fontPx);
  if (plan.stacks) {
    if (kind === 'stacked100') return; // shares are overlays (layout.js)
    chart.series.forEach((s, si) => plan.stacks.forEach((st, i) => {
      const seg = st.segments[si];
      if (!seg.value) return;
      const at = plan.toSlide(i, (seg.from + seg.to) / 2);
      label(formatValue(seg.value, plan.fmt), at.x, at.y, labelColourOn(plan.colours[si]));
    }));
    return;
  }
  if (!['line', 'column', 'bar'].includes(kind) || !(chart.dataLabels === 'all' || chart.dataLabels === 'subject')) return;
  const hidden = new Set(plan.hiddenLabels.map((h) => `${h.series}:${h.index}`));
  chart.series.forEach((s, si) => {
    if (chart.dataLabels === 'subject' && s.role !== 'subject') return;
    chart.categories.forEach((c, i) => {
      const p = pointAt(s, c);
      if (!p || p.y === null || hidden.has(`${si}:${i}`)) return;
      const at = plan.toSlide(i, p.y, kind === 'line' || plan.exclusive ? null : si);
      const t = formatValue(p.y, plan.fmt);
      if (kind === 'bar') drawText(ctx, p.y < 0 ? { x: at.x - 1.56, y: at.y - 0.16, w: 1.5, h: 0.32, text: t, fontSize: pt, bold: true, color: '000000', align: 'right' } : { x: at.x + 0.06, y: at.y - 0.16, w: 1.5, h: 0.32, text: t, fontSize: pt, bold: true, color: '000000', align: 'left' }, px, fontPx);
      else label(t, at.x, p.y < 0 ? at.y + 0.2 : at.y - 0.2, '000000');
    });
  });
}

function drawTable(ctx, table, t, px, fontPx) {
  const rows = [table.headers, ...table.rows];
  let y = t.y;
  rows.forEach((row, ri) => {
    let x = t.x;
    row.forEach((cell, ci) => {
      const w = t.colW[ci] ?? 1;
      ctx.fillStyle = ri === 0 ? hex(R.colours.subject) : ri % 2 ? '#CFD5EA' : '#E9EBF5';
      ctx.fillRect(px(x), px(y), px(w), px(t.rowH));
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 1;
      ctx.strokeRect(px(x), px(y), px(w), px(t.rowH));
      const head = ri === 0;
      const highlight = !head && ci === table.highlightColumn && ci !== 0;
      drawText(ctx, {
        x: x + 0.06, y, w: w - 0.12, h: t.rowH, text: cell, fontSize: t.fontSize,
        bold: head || ci === 0 || ci === table.highlightColumn, color: head ? 'FFFFFF' : highlight ? R.colours.subject : '000000', align: 'left',
      }, px, fontPx);
      x += w;
    });
    y += t.rowH;
  });
}

/** Text in a box: wrapped to its width, aligned, vertically placed. */
function drawText(ctx, b, px, fontPx) {
  const size = fontPx(b.fontSize ?? R.chartFontSize);
  ctx.save();
  ctx.font = `${b.bold === false ? 'normal' : 'bold'} ${size}px ${FONT_STACK}`;
  ctx.fillStyle = hex(b.color ?? '000000');
  ctx.textBaseline = 'middle';
  const maxW = px(b.w);
  const lines = String(b.text ?? '').split('\n').flatMap((para) => wrap(ctx, para, maxW));
  const lh = size * 1.2;
  const blockH = lines.length * lh;
  const top = b.valign === 'top' ? px(b.y) : b.valign === 'bottom' ? px(b.y + b.h) - blockH : px(b.y) + (px(b.h) - blockH) / 2;
  lines.forEach((line, i) => {
    const w = ctx.measureText(line).width;
    const x = b.align === 'right' ? px(b.x + b.w) - w : b.align === 'center' ? px(b.x) + (maxW - w) / 2 : px(b.x);
    ctx.fillText(line, x, top + lh * (i + 0.5));
  });
  ctx.restore();
}

function wrap(ctx, textIn, maxW) {
  const words = textIn.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (line && ctx.measureText(next).width > maxW) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  lines.push(line);
  return lines;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
