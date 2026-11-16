// Redraw specs for the builder tests (T-RD-2..10): one per kind, valid against
// schemas/redraw-spec.json and the redraw check.
const notes = (lead) => ({ agreedLead: lead, acceptedFixes: ['Index both series to the league average'], declinedFixes: [], dataToSource: ['League average commercial revenue, 2009–2025'] });
const axis = (over = {}) => ({ title: null, min: null, max: null, log: false, shown: true, ...over });
const cat = (over = {}) => ({ title: null, min: null, max: null, shown: true, ...over });
const base = (lead, chart, extra = {}) => ({
  redrawable: true, reason: null, title: lead, subheading: 'Commercial revenue index vs league average, 2009–2025',
  chart, table: null, leadNumbers: [], annotations: [], referenceLines: [], source: 'Source: Deloitte Football Money League', notes: notes(lead), ...extra,
});
const years = ['2019', '2020', '2021', '2022', '2023', '2024'];
const pts = (vals, xs = years) => vals.map((y, i) => ({ x: xs[i], y }));
const chart = (kind, series, over = {}) => ({
  kind, categories: years, series, valueAxis: axis(), categoryAxis: cat(), dataLabels: 'none', numberFormat: '0', sort: 'none', joinInTimeOrder: false, quadrants: null, ...over,
});
const s = (name, role, vals, over = {}) => ({ name, role, points: pts(vals), illustrative: false, cagr: null, ...over });

export const LEAD = 'Man City grew commercial revenue 9.8% a year, twice the league';

export const SPECS = {
  line: base(LEAD, chart('line', [s('Man City', 'subject', [100, 120, 135, 150, 170, 190], { cagr: '9.8%' }), s('League average', 'comparison', [100, 104, 108, 112, 117, 122], { cagr: '4.0%', illustrative: true })]), {
    leadNumbers: [{ text: '9.8%', anchor: { series: 'Man City', x: '2024' } }],
    annotations: [{ text: 'Gap opens after 2021', anchor: { series: 'Man City', x: '2021' } }],
    referenceLines: [{ axis: 'y', value: 100, label: 'Base year = 100' }],
  }),
  column: base('Three of our 12 stores lose money after rent', { ...chart('column', [s('Profit after rent', 'subject', [12, -4, 8, -2, 15, -6])]), dataLabels: 'all' }, {
    leadNumbers: [{ text: '12', anchor: { series: 'Profit after rent', x: '2023' } }],
  }),
  bar: base('Vietnam is the fastest growing market at 9.8% CAGR', { ...chart('bar', [{ name: 'CAGR', role: 'subject', points: [{ x: 'Vietnam', y: 9.8 }, { x: 'Thailand', y: 6.1 }, { x: 'Indonesia', y: 5.2 }], illustrative: false, cagr: null }]), categories: ['Vietnam', 'Thailand', 'Indonesia'], numberFormat: '0.0"%"', dataLabels: 'all', sort: 'descending' }, {
    leadNumbers: [{ text: '9.8%', anchor: { series: 'CAGR', x: 'Vietnam' } }],
  }),
  stackedColumn: base('Transit stations drive growth for K&C with 9% CAGR', chart('stackedColumn', [s('Transit', 'subject', [10, 12, 14, 16, 18, 20], { cagr: '15%' }), s('High street', 'comparison', [30, 30, 31, 31, 32, 32], { cagr: '1%' })]), {
    leadNumbers: [{ text: '9% CAGR', anchor: { series: null, x: '2024' } }],
  }),
  stacked100: base('Transit is now a third of K&C sales', chart('stacked100', [s('Transit', 'subject', [10, 12, 14, 16, 18, 20]), s('High street', 'comparison', [30, 30, 31, 31, 32, 32])])),
  waterfall: base('Fund pricing first: it delivers HK$15m of the HK$35m programme gain by 2027', { ...chart('waterfall', [{ name: 'Gain', role: 'subject', points: [{ x: '2025 profit', y: 100 }, { x: 'Pricing', y: 15 }, { x: 'Sourcing', y: 12 }, { x: 'Mix', y: 8 }, { x: 'Costs', y: -3 }, { x: '2027 profit', y: 132 }], illustrative: true, cagr: null }]), categories: ['2025 profit', 'Pricing', 'Sourcing', 'Mix', 'Costs', '2027 profit'], numberFormat: '"HK$"0"m"' }, {
    leadNumbers: [{ text: 'HK$15m', anchor: { series: 'Gain', x: 'Pricing' } }, { text: 'HK$35m', anchor: { series: 'Gain', x: '2027 profit' } }],
  }),
  scatter: base('Marketing spend has a weak correlation with sales', { ...chart('scatter', [{ name: 'Quarters', role: 'subject', points: [{ x: 2, y: 10, label: 'Q1 2023' }, { x: 3, y: 12, label: null }, { x: 5, y: 11, label: 'Q3 2023' }, { x: 4, y: 14, label: null }, { x: 6, y: 13, label: 'Q1 2024' }], illustrative: false, cagr: null }]), categories: [], joinInTimeOrder: true, valueAxis: axis({ title: 'Sales, £m' }), categoryAxis: cat({ title: 'Marketing spend, £m' }) }),
  bubble: base('Kestrel should fully invest in elderly care as our most attractive business', { ...chart('bubble', [{ name: 'Businesses', role: 'subject', points: [{ x: 4, y: 4.2, size: 30, label: 'Elderly care' }, { x: 2.5, y: 2.1, size: 50, label: 'Hotels' }, { x: 1.8, y: 3.2, size: 20, label: 'Logistics' }], illustrative: false, cagr: null }]), categories: [], valueAxis: axis({ title: 'Market attractiveness', min: 1, max: 5 }), categoryAxis: cat({ title: 'Competitive position', min: 1, max: 5 }), quadrants: { xSplit: 3, ySplit: 3, xLabel: 'Strong position →', yLabel: 'Attractive ↑' } }, {
    annotations: [{ text: 'Most attractive market', anchor: { series: 'Businesses', x: 4 } }],
  }),
  table: { ...base('Three of our 12 stores lose money after rent', null), table: { headers: ['Store', 'Sales, £k', 'Profit after rent, £k'], rows: [['Kowloon Bay', '820', '-40'], ['Mong Kok', '1,240', '160'], ['Sha Tin', '700', '-15']], highlightColumn: 2 }, leadNumbers: [{ text: '12', anchor: { series: null, x: null } }] },
};
