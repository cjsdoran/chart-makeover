// The redraw check (spec §9.1, T-RD-1): runs on a redraw plan after the schema. As the review check
// (§7.1), what code can fix is fixed and logged (the title and the notes' lead and declined fixes
// come from the student's own run, never from the model); the rest is sent back for regeneration.
// Shared by /api/redraw-plan and the pilot; no rule wording here, so it may also run in the browser.

const YEAR = /^(19|20)\d\d$/;

/**
 * The numbers a lead states, which the slide must show (PRD "Lead numbers"): money, percentages,
 * multiples and counts. Years ("by 2027") and season or period labels ("09/10") are not lead
 * numbers; neither are numbers written as words ("Three").
 * @returns {string[]} the tokens as written, e.g. ["HK$15m", "HK$35m"]
 */
export function leadNumberTokens(lead) {
  const out = [];
  const text = String(lead ?? '');
  const re = /(?:HK\$|US\$|S\$|[£$€¥])?\d[\d,]*(?:\.\d+)?(?:\s?(?:%|x|bn|m|k|pp|pts?)\b|%)?/gi;
  for (const m of text.matchAll(re)) {
    const token = m[0].trim();
    const before = text[m.index - 1] ?? '';
    const after = text[m.index + m[0].length] ?? '';
    if (before === '/' || after === '/') continue; // 09/10, 2024/25
    if (YEAR.test(token)) continue;
    out.push(token);
  }
  return out;
}

const bare = (s) => String(s).toLowerCase().replace(/[\s,]/g, '');
const digits = (s) => String(s).replace(/[^\d.]/g, '').replace(/\.$/, '');

/** A lead number is shown when some leadNumbers text carries its digits (and its unit, if any). */
function shown(token, leadNumbers) {
  const want = bare(token);
  const core = digits(token);
  return leadNumbers.some((n) => {
    const have = bare(n.text);
    return have.includes(want) || (core && new RegExp(`(^|[^\\d.])${core.replace('.', '\\.')}(?![\\d])`).test(have));
  });
}

export const REDRAW_REGENERATE = {
  twoKinds: 'Give either chart or table, not both: the slide has one chart.',
  noBody: 'A redrawable slide needs chart (or table, for a table).',
  subject: (n) => `Mark exactly one series as role "subject" (you marked ${n}).`,
  leadNumber: (t) => `The lead's number "${t}" must appear in leadNumbers, anchored to the mark it describes.`,
  anchor: (name) => `An anchor names series "${name}", which is not in chart.series.`,
  reason: 'A slide that is not redrawable needs one sentence of reason.',
  points: (name) => `Series "${name}" has no points.`,
  axis: 'valueAxis.min must be below valueAxis.max.',
  bubble: 'A bubble chart needs a size on every point.',
};

/** What the chart (or table) itself must get right: the first of the plan's two calls checks this. */
function chartErrors(data) {
  const errors = [];
  if (data.chart && data.table) errors.push(REDRAW_REGENERATE.twoKinds);
  if (!data.chart && !data.table) errors.push(REDRAW_REGENERATE.noBody);
  const chart = data.chart;
  if (!chart) return errors;
  const subjects = chart.series.filter((s) => s.role === 'subject').length;
  if (subjects !== 1) errors.push(REDRAW_REGENERATE.subject(subjects));
  for (const s of chart.series) if (!s.points.length) errors.push(REDRAW_REGENERATE.points(s.name));
  const { min, max } = chart.valueAxis;
  if (min !== null && max !== null && !(min < max)) errors.push(REDRAW_REGENERATE.axis);
  if (chart.kind === 'bubble' && chart.series.some((s) => s.points.some((p) => typeof p.size !== 'number'))) errors.push(REDRAW_REGENERATE.bubble);
  return errors;
}

/**
 * The first call's check (spec D80): the chart part alone, `{ redrawable, reason, subheading, chart,
 * table, source }`. Lead numbers, anchors and notes are checked on the merged slide after the second.
 */
export function checkRedrawChart(part) {
  const fixes = [];
  const data = structuredClone(part);
  if (!data.redrawable) {
    return data.reason?.trim() ? { ok: true, data, fixes } : { ok: false, errors: [REDRAW_REGENERATE.reason], fixes };
  }
  if (data.reason !== null) {
    fixes.push({ type: 'reasonStripped' });
    data.reason = null;
  }
  const errors = chartErrors(data);
  return errors.length ? { ok: false, errors: [...new Set(errors)], fixes } : { ok: true, data, fixes };
}

/** The slide from the two calls: the planned chart, the agreed lead as title, the overlays and notes. */
export function mergeRedraw(lead, chartPart, finishPart) {
  return {
    redrawable: true, reason: null, title: lead,
    subheading: chartPart.subheading, chart: chartPart.chart, table: chartPart.table,
    leadNumbers: finishPart.leadNumbers, annotations: finishPart.annotations, referenceLines: finishPart.referenceLines,
    source: chartPart.source, notes: finishPart.notes,
  };
}

/**
 * @param {object} spec a schema-valid redraw spec
 * @param {{ lead: string, declinedFixes?: object[] }} input what was sent
 * @returns {{ ok: true, data: object, fixes: object[] } | { ok: false, errors: string[], fixes: object[] }}
 */
export function checkRedraw(spec, input) {
  const fixes = [];
  const errors = [];
  const data = structuredClone(spec);
  const lead = String(input.lead ?? '');
  const declined = (input.declinedFixes ?? []).map((d) => ({ fix: d.fix, reason: d.reason }));

  // Fixed in code: the title is the agreed lead, word for word; the notes carry the run's own lead
  // and declines.
  if (data.title !== lead) {
    fixes.push({ type: 'titleReset' });
    data.title = lead;
  }
  if (data.notes.agreedLead !== lead) {
    fixes.push({ type: 'notesLeadReset' });
    data.notes.agreedLead = lead;
  }
  if (JSON.stringify(data.notes.declinedFixes) !== JSON.stringify(declined)) {
    fixes.push({ type: 'notesDeclinedReset' });
    data.notes.declinedFixes = declined;
  }

  if (!data.redrawable) {
    if (!data.reason?.trim()) errors.push(REDRAW_REGENERATE.reason);
    return errors.length ? { ok: false, errors, fixes } : { ok: true, data, fixes };
  }
  if (data.reason !== null) {
    fixes.push({ type: 'reasonStripped' });
    data.reason = null;
  }
  // The slide carries its own "Illustrative data" label; a bubble that only repeats it is dropped.
  const kept = data.annotations.filter((a) => !/^\s*illustrative( data| values)?\.?\s*$/i.test(a.text));
  if (kept.length !== data.annotations.length) {
    fixes.push({ type: 'illustrativeAnnotationDropped' });
    data.annotations = kept;
  }

  errors.push(...chartErrors(data));
  const chart = data.chart;
  if (chart) {
    const names = new Set(chart.series.map((s) => s.name));
    for (const a of [...data.leadNumbers, ...data.annotations]) {
      if (a.anchor.series !== null && !names.has(a.anchor.series)) errors.push(REDRAW_REGENERATE.anchor(a.anchor.series));
    }
  }

  for (const token of leadNumberTokens(lead)) {
    if (!shown(token, data.leadNumbers)) errors.push(REDRAW_REGENERATE.leadNumber(token));
  }

  return errors.length ? { ok: false, errors: [...new Set(errors)], fixes } : { ok: true, data, fixes };
}
