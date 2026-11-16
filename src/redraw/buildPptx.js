// Make these changes (CM-8, spec §9.2): one editable slide in the HKUST class template, built in the
// browser with PptxGenJS from the checked redraw spec. The same code runs in Node for the tests and
// the redraw QA (P-3). Overlays are placed from src/redraw/layout.js; a few things PptxGenJS can't
// set (an invisible waterfall base, per-series data labels, the table style) are patched into the
// XML afterwards with JSZip.
import PptxGenJS from 'pptxgenjs';
import JSZip from 'jszip';
import { config } from '../../shared/limits.js';
import { CATEGORY_KINDS, STACKED_KINDS, labelColourOn, planSlide, pointAt, seriesColours } from './layout.js';

const R = config.redraw;
const FONT = R.font;
export const TABLE_STYLE_ID = '{93296810-A885-4BE3-A3E7-6D5BEEA58F35}';
const MASTER = 'CM_TITLE_ONLY';
const BAND_FILLS = ['CFD5EA', 'E9EBF5'];

/** Speaker notes (spec §9.2): the lead, accepted fixes, declined fixes and reasons, data to source. */
export function speakerNotes(spec, { dataToSource = [] } = {}) {
  const n = spec.notes;
  const invented = (spec.chart?.series ?? []).filter((s) => s.illustrative).map((s) => `${s.name}: invented values; find the real series.`);
  const toSource = [...new Set([...n.dataToSource, ...invented, ...dataToSource])];
  return [
    `Agreed lead: ${n.agreedLead}`,
    '',
    'Accepted fixes:',
    ...(n.acceptedFixes.length ? n.acceptedFixes.map((f) => `- ${f}`) : ['- None']),
    '',
    'Declined fixes:',
    ...(n.declinedFixes.length ? n.declinedFixes.map((d) => `- ${d.fix} (your reason: ${d.reason})`) : ['- None']),
    '',
    'Data you must source:',
    ...(toSource.length ? toSource.map((d) => `- ${d}`) : ['- Every value on this slide is illustrative: replace it with real data.']),
    '',
    `${R.illustrativeLabel}. ${config.openers.lastMessage}`,
  ].join('\n');
}

const textOpts = (box) => ({
  x: box.x, y: box.y, w: box.w, h: box.h,
  fontFace: FONT, fontSize: box.fontSize, bold: box.bold !== false, color: box.color ?? '000000',
  align: box.align ?? 'left', valign: box.valign ?? 'middle', margin: 0, fit: 'none', wrap: true,
});

function chartData(chart, kind, plan) {
  const cats = kind === 'bar' ? [...chart.categories].reverse() : chart.categories;
  if (kind === 'waterfall') return null; // built from the steps
  if (kind === 'scatter' || kind === 'bubble') {
    // PptxGenJS shares one X list across series: the union, each series null where it has no point.
    const xs = [...new Set(chart.series.flatMap((s) => s.points.map((p) => Number(p.x))))];
    const order = [];
    for (const s of chart.series) for (const p of s.points) order.push(Number(p.x));
    const data = [{ name: 'X-Axis', values: chart.joinInTimeOrder ? order : xs }];
    let offset = 0;
    for (const s of chart.series) {
      const values = (chart.joinInTimeOrder ? order : xs).map((x, i) => {
        if (chart.joinInTimeOrder) return i >= offset && i < offset + s.points.length ? s.points[i - offset].y : null;
        return s.points.find((p) => Number(p.x) === x)?.y ?? null;
      });
      const entry = { name: s.name, values };
      if (kind === 'bubble') {
        entry.sizes = (chart.joinInTimeOrder ? order : xs).map((x, i) => {
          if (chart.joinInTimeOrder) return i >= offset && i < offset + s.points.length ? s.points[i - offset].size ?? 0 : null;
          return s.points.find((p) => Number(p.x) === x)?.size ?? null;
        });
      }
      offset += s.points.length;
      data.push(entry);
    }
    return data;
  }
  return chart.series.map((s) => ({
    name: s.name,
    // Vertical charts use the layout's wrapped names (a line break inside a long category name).
    labels: kind === 'bar' ? cats.map(String) : plan.categoryLabels,
    values: cats.map((c) => pointAt(s, c)?.y ?? null),
  }));
}

function waterfallData(plan, chart) {
  const labels = plan.categoryLabels;
  const steps = plan.steps;
  const pick = (k) => steps.map((s) => (s.kind === k ? s.size : 0));
  return {
    data: [
      { name: 'Base', labels, values: steps.map((s) => s.base) },
      { name: chart.series[0].name, labels, values: pick('total') },
      { name: 'Increase', labels, values: pick('up') },
      { name: 'Decrease', labels, values: pick('down') },
    ],
    colours: ['FFFFFF', R.colours.subject, R.colours.comparison, R.colours.others[0]],
  };
}

function chartOptions(plan, chart) {
  const { frame: F, plot: P, kind, valueBounds: vb } = plan;
  const pt = R.chartFontSize;
  const axisText = { fontFace: FONT, fontSize: pt, bold: true, color: '000000' };
  const valueShown = chart.valueAxis.shown && !STACKED_KINDS.has(kind) && kind !== 'waterfall';
  const opts = {
    x: F.x, y: F.y, w: F.w, h: F.h,
    layout: { x: (P.x - F.x) / F.w, y: (P.y - F.y) / F.h, w: P.w / F.w, h: P.h / F.h },
    showLegend: false, showTitle: false,
    valGridLine: { style: 'none' }, catGridLine: { style: 'none' },
    catAxisLabelFontFace: axisText.fontFace, catAxisLabelFontSize: pt, catAxisLabelFontBold: true, catAxisLabelColor: '000000',
    valAxisLabelFontFace: axisText.fontFace, valAxisLabelFontSize: pt, valAxisLabelFontBold: true, valAxisLabelColor: '000000',
    catAxisLineColor: '000000', valAxisLineColor: '000000', catAxisLineShow: true, valAxisLineShow: true,
    catAxisMajorTickMark: 'none', valAxisMajorTickMark: 'out',
    valAxisMinVal: vb.min, valAxisMaxVal: vb.max,
    ...(vb.unit ? { valAxisMajorUnit: vb.unit } : {}),
    ...(vb.log ? { valAxisLogScaleBase: 10 } : {}),
    valAxisHidden: !valueShown,
    catAxisHidden: !chart.categoryAxis.shown,
    valAxisLabelFormatCode: plan.fmt.excel,
    dataLabelFormatCode: plan.fmt.excel,
    dataLabelFontFace: FONT, dataLabelFontSize: pt, dataLabelFontBold: true, dataLabelColor: '000000',
    chartColors: plan.colours,
    lineDataSymbol: 'none', lineSize: 3,
    barGapWidthPct: 150,
  };
  if (chart.valueAxis.title && valueShown) Object.assign(opts, { showValAxisTitle: true, valAxisTitle: chart.valueAxis.title, valAxisTitleFontFace: FONT, valAxisTitleFontSize: pt, valAxisTitleColor: '000000' });
  if (chart.categoryAxis.title && chart.categoryAxis.shown) Object.assign(opts, { showCatAxisTitle: true, catAxisTitle: chart.categoryAxis.title, catAxisTitleFontFace: FONT, catAxisTitleFontSize: pt, catAxisTitleColor: '000000' });
  if (kind === 'scatter' || kind === 'bubble') {
    const xb = plan.xBounds;
    Object.assign(opts, { catAxisMinVal: xb.min, catAxisMaxVal: xb.max, catAxisMajorUnit: xb.unit, catAxisMajorTickMark: 'out', catAxisLabelFormatCode: 'General' });
    if (kind === 'scatter') Object.assign(opts, { lineSize: chart.joinInTimeOrder ? 2 : 0, lineDataSymbol: 'circle', lineDataSymbolSize: 9 });
  }
  if (kind === 'column' || kind === 'bar' || STACKED_KINDS.has(kind) || kind === 'waterfall') {
    opts.barDir = kind === 'bar' ? 'bar' : 'col';
    opts.barGrouping = kind === 'stackedColumn' || kind === 'waterfall' ? 'stacked' : kind === 'stacked100' ? 'percentStacked' : 'clustered';
    if (opts.barGrouping !== 'clustered' || plan.exclusive) opts.barOverlapPct = 100;
    // Bars below zero: the category names sit at the low end of the axis, clear of the bars.
    if (vb.min < 0) opts.catAxisLabelPos = 'low';
  }
  const labels = chart.dataLabels;
  if (kind === 'stackedColumn') {
    // Rounded segment values, centred in each segment (colour set per series afterwards). A 100%
    // stack shows shares instead, as text boxes from the layout plan.
    Object.assign(opts, { showValue: true, dataLabelPosition: 'ctr' });
  } else if (!['waterfall', 'scatter', 'bubble'].includes(kind) && (labels === 'all' || labels === 'subject')) {
    // Scatter and bubble points are named by the layout's labels; PowerPoint's would print y values.
    Object.assign(opts, { showValue: true, dataLabelPosition: kind === 'line' || kind === 'scatter' ? 't' : 'outEnd' });
  }
  return opts;
}

/** Splits a chart part into its <c:ser> blocks, patches each, and joins it again. */
function patchSeries(xml, fn) {
  let i = -1;
  return xml.replace(/<c:ser>[\s\S]*?<\/c:ser>/g, (ser) => {
    i += 1;
    return fn(ser, i);
  });
}

const NO_LABELS = (ser) => ser.replace(/<c:showVal val="1"\/>/, '<c:showVal val="0"/>');
const labelColour = (ser, hex) => ser.replace(/(<c:dLbls>[\s\S]*?<a:defRPr[^>]*>\s*<a:solidFill>\s*<a:srgbClr val=")[0-9A-Fa-f]{6}/, `$1${hex}`);

/** The XML changes PptxGenJS has no option for. */
async function patchFile(buffer, plan, chart) {
  const zip = await JSZip.loadAsync(buffer);
  const chartFiles = Object.keys(zip.files).filter((f) => /^ppt\/charts\/chart\d+\.xml$/.test(f));
  for (const f of chartFiles) {
    let xml = await zip.file(f).async('string');
    xml = xml.replace('<c:roundedCorners val="1"/>', '<c:roundedCorners val="0"/>');
    if (plan.kind === 'waterfall') {
      // The base series carries the steps up and is never seen.
      xml = patchSeries(xml, (ser, i) => (i === 0
        ? ser.replace(/<c:spPr>[\s\S]*?<\/c:spPr>/, '<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>')
        : ser));
    }
    if (chart && chart.dataLabels === 'subject' && !STACKED_KINDS.has(plan.kind)) {
      xml = patchSeries(xml, (ser, i) => (chart.series[i]?.role === 'subject' ? ser : NO_LABELS(ser)));
    }
    if (STACKED_KINDS.has(plan.kind)) {
      xml = patchSeries(xml, (ser, i) => labelColour(ser, labelColourOn(plan.colours[i])));
    }
    if (plan.hiddenLabels.length) {
      // A lead number shown at a point replaces that point's own data label.
      const n = chart.categories.length;
      xml = patchSeries(xml, (ser, i) => {
        const hide = plan.hiddenLabels.filter((h) => h.series === i).map((h) => (plan.kind === 'bar' ? n - 1 - h.index : h.index));
        if (!hide.length) return ser;
        return ser.replace('<c:dLbls>', `<c:dLbls>${hide.map((idx) => `<c:dLbl><c:idx val="${idx}"/><c:delete val="1"/></c:dLbl>`).join('')}`);
      });
    }
    // Chart text in Calibri, never the default Arial.
    xml = xml.replace(/typeface="Arial"/g, `typeface="${FONT}"`);
    zip.file(f, xml);
  }
  if (plan.table) {
    for (const f of Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))) {
      const xml = await zip.file(f).async('string');
      zip.file(f, xml.replace(/<a:tblPr\/>/g, `<a:tblPr firstRow="1" bandRow="1"><a:tableStyleId>${TABLE_STYLE_ID}</a:tableStyleId></a:tblPr>`));
    }
  }
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

/**
 * Builds the slide.
 * @param {object} spec a checked redraw spec (redrawable)
 * @param {{ background: string, dataToSource?: string[] }} opts background as a data URL (or
 *   "image/jpeg;base64,…") of assets/template/title-only-bg.jpg
 * @returns {Promise<{ bytes: Uint8Array, plan: object }>}
 */
export async function buildPptx(spec, { background, dataToSource = [] }) {
  if (!spec.redrawable) throw new Error('This chart is not redrawable.');
  const plan = planSlide(spec);
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'A4_LANDSCAPE', width: R.slide.width, height: R.slide.height });
  pptx.layout = 'A4_LANDSCAPE';
  pptx.theme = { headFontFace: FONT, bodyFontFace: FONT };
  // No title or company in the document properties: PptxGenJS doesn't escape them, and a lead
  // with "&" ("K&C") would make the file unreadable.
  const bg = background.replace(/^data:/, '');
  pptx.defineSlideMaster({
    title: MASTER,
    background: { data: bg },
    objects: [{
      placeholder: {
        options: { name: 'title', type: 'title', x: R.title.x, y: R.title.y, w: R.title.w, h: R.title.h, fontFace: FONT, fontSize: R.title.fontSize, bold: true, color: R.title.color, align: 'left', valign: 'middle', margin: 0 },
        text: '',
      },
    }],
    slideNumber: { x: R.slideNumber.x, y: R.slideNumber.y, w: R.slideNumber.w, h: R.slideNumber.h, fontFace: FONT, fontSize: 12, color: '000000', align: 'right' },
  });
  const slide = pptx.addSlide({ masterName: MASTER });
  slide.addText(spec.title, { placeholder: 'title', fontFace: FONT, fontSize: R.title.fontSize, bold: true, color: R.title.color, align: 'left', valign: 'middle', margin: 0 });
  slide.addText(plan.subheading.text, textOpts({ ...plan.subheading, color: plan.subheading.color, align: 'left' }));
  slide.addText(plan.illustrative.text, textOpts(plan.illustrative));
  slide.addText(spec.source, textOpts({ ...plan.source, bold: false, color: '000000', valign: 'top' }));

  const chart = spec.chart;
  if (plan.table) {
    const t = spec.table;
    const t0 = plan.table;
    const head = t.headers.map((h) => ({ text: h, options: { bold: true, color: 'FFFFFF', fill: { color: R.colours.subject } } }));
    const rows = t.rows.map((r, ri) => r.map((cell, ci) => ({
      text: cell,
      options: {
        bold: ci === 0 || ci === t.highlightColumn,
        color: ci === t.highlightColumn && ci !== 0 ? R.colours.subject : '000000',
        fill: { color: BAND_FILLS[ri % 2] },
      },
    })));
    slide.addTable([head, ...rows], {
      x: t0.x, y: t0.y, w: t0.w, colW: t0.colW, rowH: t0.rowH,
      fontFace: FONT, fontSize: t0.fontSize, valign: 'middle', margin: 0.06,
      border: { type: 'solid', pt: 1, color: 'FFFFFF' },
    });
  } else {
    const kind = plan.kind;
    const opts = chartOptions(plan, chart);
    if (kind === 'waterfall') {
      const w = waterfallData(plan, chart);
      slide.addChart(pptx.ChartType.bar, w.data, { ...opts, chartColors: w.colours });
    } else {
      const type = { line: 'line', column: 'bar', bar: 'bar', stackedColumn: 'bar', stacked100: 'bar', scatter: 'scatter', bubble: 'bubble' }[kind];
      slide.addChart(pptx.ChartType[type], chartData(chart, kind, plan), opts);
    }
    for (const l of plan.lines) {
      slide.addShape(pptx.ShapeType.line, {
        x: Math.min(l.x1, l.x2), y: Math.min(l.y1, l.y2), w: Math.max(Math.abs(l.x2 - l.x1), 0.001), h: Math.max(Math.abs(l.y2 - l.y1), 0.001),
        flipH: (l.x2 - l.x1) * (l.y2 - l.y1) < 0,
        line: { color: l.role === 'pointer' ? '000000' : '595959', width: l.role === 'pointer' ? 0.75 : 1.25, dashType: l.dash ? 'dash' : 'solid' },
      });
    }
  }
  for (const o of plan.overlays) {
    if (o.role === 'annotation') {
      slide.addText(o.text, {
        ...textOpts(o), shape: pptx.ShapeType.roundRect, rectRadius: 0.12,
        fill: { color: 'FFFFFF' }, line: { color: '000000', width: 0.75 }, margin: 0.06,
      });
    } else {
      slide.addText(o.text, textOpts(o));
    }
  }
  slide.addNotes(speakerNotes(spec, { dataToSource }));

  const raw = await pptx.write({ outputType: 'arraybuffer' });
  const bytes = await patchFile(raw, plan, chart);
  return { bytes, plan };
}
