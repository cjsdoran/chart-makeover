// The read test's comparator (RT-1): checks the checker on hand-made readings.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { compareReading, findValue, readingStrings } from '../../scripts/lib/readTruth.js';

const truth = JSON.parse(readFileSync('calibration/read-truth.json', 'utf8')).cases;

const bars = (pairs) => ({
  type: 'bar', orientation: 'horizontal', stacking: 'none', is3D: false, dualAxis: false, panels: 1, logScale: false, logLabelled: false, sorted: 'descending',
  categories: pairs.map(([k]) => k),
  series: [{ name: 'Growth', colour: '033D93', values: pairs.map(([x, y]) => ({ x, y })), labelledDirectly: true, axis: 'primary' }],
  axes: [], referenceLines: [], annotations: [], gridlines: false, legend: false, dataLabels: 'all',
});

const C09 = {
  readable: true, unreadableReason: null, kind: 'data',
  texts: { title: 'Enter Vietnam first: its room air-conditioner market grows 9.8% a year to 2030, the fastest in ASEAN', subheading: 'ROOM AIR-CONDITIONER DEMAND, ANUAL GROWTH 2025–30', chartTitle: null, source: 'Source: ChatGPT analysis, October 2026', illustrativeLabel: false, other: [] },
  chart: bars([['Vietnam', 9.8], ['Phillipines', 8.1], ['Indonesia', 7.4], ['Thailand', 4.2], ['Malaysia', 3.1]]),
  table: null, emphasis: 'Vietnam in blue', smallestTextPt: 12, valuesSource: 'labels', uncertain: [], summary: 'I read this as growth by market.',
};

describe('compareReading', () => {
  it('passes a reading that matches C09', () => {
    const r = compareReading('C09', truth.C09, C09);
    expect(r.checks.filter((c) => !c.ok)).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('accepts "column" for C09 and fails "line"', () => {
    expect(compareReading('C09', truth.C09, { ...C09, chart: { ...C09.chart, type: 'column' } }).ok).toBe(true);
    expect(compareReading('C09', truth.C09, { ...C09, chart: { ...C09.chart, type: 'line' } }).ok).toBe(false);
  });

  it('fails a corrected typo, and says when only punctuation or case differs', () => {
    const fixed = { ...C09, chart: bars([['Vietnam', 9.8], ['Philippines', 8.1], ['Indonesia', 7.4], ['Thailand', 4.2], ['Malaysia', 3.1]]) };
    const miss = compareReading('C09', truth.C09, fixed).checks.find((c) => c.check === 'mustRead "Phillipines"');
    expect(miss).toMatchObject({ ok: false, got: 'not found' });
    const lower = { ...C09, texts: { ...C09.texts, subheading: 'Room air-conditioner demand, anual growth 2025–30' } };
    const loose = compareReading('C09', truth.C09, lower).checks.find((c) => c.check.startsWith('mustRead "ROOM'));
    expect(loose).toMatchObject({ ok: false, note: 'found only with different punctuation or case' });
  });

  it('checks key values at ±5%, and ±10% for a photo', () => {
    const off = { ...C09, chart: bars([['Vietnam', 9.8], ['Phillipines', 8.1], ['Indonesia', 7.4], ['Thailand', 4.2], ['Malaysia', 3.36]]) };
    expect(compareReading('C09', truth.C09, off).checks.find((c) => c.check === 'value Malaysia').ok).toBe(false);
    expect(compareReading('C09', truth.C09, off, { photo: true }).checks.find((c) => c.check === 'value Malaysia').ok).toBe(true);
  });

  it('checks flags, series count, values source, a missing source and the smallest text', () => {
    const r = compareReading('C05', truth.C05, { ...C09, kind: 'table', chart: null, table: { headers: ['Store', 'Contrib. $ (adj.)'], rows: [['Boston', '133,497']], highlighted: null }, texts: { ...C09.texts, title: 'FY25 Store P&L', source: 'Source: Northfield Footwear finance, FY25 store P&L (unaudited)' }, smallestTextPt: 9 });
    expect(r.ok).toBe(true);
    const c04 = compareReading('C04', truth.C04, { ...C09, texts: { ...C09.texts, source: 'Source: someone' } });
    expect(c04.checks.find((c) => c.check === 'source')).toMatchObject({ ok: false, expected: null });
    expect(c04.checks.find((c) => c.check === 'flag is3D').ok).toBe(false);
  });
});

describe('helpers', () => {
  it('finds a value by category or point label, and every string with where it sits', () => {
    expect(findValue(C09, 'phillipines')).toBe(8.1);
    expect(findValue(C09, 'Laos')).toBeUndefined();
    expect(readingStrings(C09).find((s) => s.text === 'Phillipines').where).toBe('chart.categories');
  });
});
