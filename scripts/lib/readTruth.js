// RT-1 comparator (build brief "Read test"; test plan RT-1): checks a reading against one case of
// calibration/read-truth.json. Plain functions, so the unit tests can check the checker.

// Accepted alternatives for chartType (test plan RT-1; read-truth "about").
export const CHART_TYPE_ALTERNATIVES = {
  C06: ['waterfall', 'column', 'stackedColumn'],
  C09: ['bar', 'column'],
};

const collapse = (s) => String(s).replace(/\s+/g, ' ').trim();
const norm = (s) => collapse(s).toLowerCase().normalize('NFKC').replace(/[‘’]/g, "'").replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Every string in a reading, labelled by where it sits, for the verbatim checks. */
export function readingStrings(r) {
  const out = [];
  const add = (where, v) => {
    if (typeof v === 'string' && v.trim()) out.push({ where, text: collapse(v) });
  };
  const t = r.texts ?? {};
  for (const k of ['title', 'subheading', 'chartTitle', 'source']) add(`texts.${k}`, t[k]);
  for (const o of t.other ?? []) add('texts.other', o.text);
  const c = r.chart;
  if (c) {
    for (const x of c.categories ?? []) add('chart.categories', x);
    for (const s of c.series ?? []) {
      add('chart.series.name', s.name);
      for (const v of s.values ?? []) {
        add('chart.series.x', typeof v.x === 'string' ? v.x : null);
        add('chart.series.label', v.label);
      }
    }
    for (const a of c.axes ?? []) {
      add('chart.axes.title', a.title);
      add('chart.axes.unit', a.unit);
    }
    for (const l of c.referenceLines ?? []) add('chart.referenceLines', l.label);
    for (const a of c.annotations ?? []) add('chart.annotations', a);
  }
  if (r.table) {
    for (const h of r.table.headers ?? []) add('table.headers', h);
    for (const row of r.table.rows ?? []) for (const cell of row) add('table.rows', cell);
    add('table.highlighted', r.table.highlighted);
  }
  for (const u of r.uncertain ?? []) add('uncertain', u);
  return out;
}

/** The value the reading gives for a category or point label, or undefined. */
export function findValue(reading, label) {
  const key = norm(label);
  const series = reading.chart?.series ?? [];
  const cats = reading.chart?.categories ?? [];
  for (const s of series) {
    for (const [i, v] of (s.values ?? []).entries()) {
      const x = typeof v.x === 'string' ? v.x : cats[i] ?? String(v.x);
      if ((norm(x) === key || norm(v.label ?? '') === key) && typeof v.y === 'number') return v.y;
    }
    if (norm(s.name) === key && s.values?.length === 1 && typeof s.values[0].y === 'number') return s.values[0].y;
  }
  return undefined;
}

const FLAG_PATHS = {
  gridlines: (c) => c?.gridlines,
  legend: (c) => c?.legend,
  is3D: (c) => c?.is3D,
  dualAxis: (c) => c?.dualAxis,
  panels: (c) => c?.panels,
  logScale: (c) => c?.logScale,
};

/**
 * @param {string} id case ID, eg 'C06'
 * @param {object} truth read-truth.json's entry for the case
 * @param {object} reading the model's reading (schemas/read-chart.json)
 * @param {{ photo?: boolean }} [opts] photos get ±10% on key values, others ±5%
 * @returns {{ ok: boolean, checks: { check: string, ok: boolean, expected: any, got: any, note?: string }[] }}
 */
export function compareReading(id, truth, reading, { photo = false } = {}) {
  const checks = [];
  const add = (check, ok, expected, got, note) => checks.push({ check, ok: Boolean(ok), expected, got, ...(note ? { note } : {}) });

  add('readable', reading.readable === true, true, reading.readable, reading.readable ? undefined : reading.unreadableReason);
  add('kind', reading.kind === truth.kind, truth.kind, reading.kind);

  if (truth.chartType) {
    const allowed = CHART_TYPE_ALTERNATIVES[id] ?? [truth.chartType];
    add('chartType', allowed.includes(reading.chart?.type), allowed.join(' or '), reading.chart?.type ?? null);
  }
  for (const [flag, expected] of Object.entries(truth.flags ?? {})) {
    const got = FLAG_PATHS[flag]?.(reading.chart);
    add(`flag ${flag}`, got === expected, expected, got ?? null);
  }
  if (truth.seriesCount !== undefined) add('seriesCount', reading.chart?.series?.length === truth.seriesCount, truth.seriesCount, reading.chart?.series?.length ?? null);
  if (truth.valuesSource) add('valuesSource', reading.valuesSource === truth.valuesSource, truth.valuesSource, reading.valuesSource);
  if (Object.hasOwn(truth, 'source')) add('source', (reading.texts?.source ?? null) === truth.source, truth.source, reading.texts?.source ?? null);
  if (truth.smallestTextPtMax !== undefined) {
    add('smallestTextPt', typeof reading.smallestTextPt === 'number' && reading.smallestTextPt <= truth.smallestTextPtMax, `≤ ${truth.smallestTextPtMax}`, reading.smallestTextPt);
  }

  const strings = readingStrings(reading);
  for (const must of truth.mustRead ?? []) {
    const wanted = collapse(must);
    const hit = strings.find((s) => s.text.includes(wanted));
    const loose = hit ? null : strings.find((s) => norm(s.text).includes(norm(wanted)));
    add(`mustRead "${must}"`, Boolean(hit), must, hit ? hit.where : loose ? `${loose.where}: "${loose.text}"` : 'not found',
      !hit && loose ? 'found only with different punctuation or case' : undefined);
  }

  const tolerance = photo ? 0.10 : 0.05;
  for (const [label, expected] of Object.entries(truth.keyValues ?? {})) {
    const got = findValue(reading, label);
    const ok = typeof got === 'number' && (expected === 0 ? got === 0 : Math.abs(got - expected) <= Math.abs(expected) * tolerance);
    add(`value ${label}`, ok, `${expected} ±${tolerance * 100}%`, got ?? 'not found');
  }
  return { ok: checks.every((c) => c.ok), checks };
}
