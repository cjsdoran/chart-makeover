// .pptx shapes and native chart XML (CM-2, spec §3.4): T-PPTX-1..6, on the calibration files and
// synthetic slides.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { chartText, parseChart } from '../../src/upload/chartXml.js';
import { listSlides, openPptx, readSlide, shapesText } from '../../src/upload/pptx.js';
import { prepareUpload } from '../../src/upload/upload.js';
import { nodeDeps } from '../../scripts/read-test.mjs';
import { limits } from '../../shared/limits.js';
import { asFile, box, chartPptx, chartXml } from '../helpers/charts.js';

const calibration = async (name) => {
  const zip = await JSZip.loadAsync(readFileSync(`calibration/inputs/${name}.pptx`));
  return { zip, chart: parseChart(await zip.file('ppt/charts/chart1.xml').async('string')) };
};
const prep = (bytes, name = 'chart.pptx') => prepareUpload(asFile(bytes, name), { deps: nodeDeps });

describe('T-PPTX-1: C01 line chart', () => {
  it('lineChart, 5 series, 17 categories, legend and gridlines, values as in the XML', async () => {
    const { chart } = await calibration('C01_man_city_big_five');
    expect(chart.groups.map((g) => g.type)).toEqual(['lineChart']);
    expect(chart.series).toHaveLength(5);
    expect(chart.series[0].categories).toHaveLength(17);
    expect(chart.series[0].categories[0]).toBe('2008/09');
    expect(chart.legend.shown).toBe(true);
    expect(chart.axes.find((a) => a.role === 'y1').gridlines).toBe(true);
    const city = chart.series.find((s) => s.name === 'Man City');
    expect(city.values[0]).toBe('18');
    expect(city.values.at(-1)).toBe('340.4');
    expect(chart.title).toBe('Commercial revenue (£m)');
    const text = chartText(chart);
    expect(text.split('\n')[0]).toBe('CHART 1 lineChart, 5 series, 17 categories');
    expect(text).toContain('S2 "Man City" colour auto axis y1 labels none values 18, 46.7, 57.8');
    expect(text).toContain('LEGEND yes (b) · TITLE "Commercial revenue (£m)" · 3D no · dual axis no · chart text 18 pt');
  });
});

describe('T-PPTX-2: C03 stacked columns, C04 3D pie', () => {
  it('C03: barChart, columns, stacked, data labels "0.0" at 11 pt, series colours', async () => {
    const { chart } = await calibration('C03_kettle_crumb_formats');
    expect(chart.groups[0]).toMatchObject({ type: 'barChart', barDir: 'col', grouping: 'stacked' });
    expect(chart.series[3]).toMatchObject({ name: 'Transit-station kiosks', colour: 'FFC000', values: ['101.9', '111.1', '121.1', '132.0'] });
    expect(chart.series[0].labels).toMatchObject({ shown: true, parts: ['val'], numFmt: '0.0', sizes: [11] });
    expect(chartText(chart)).toContain('CHART 1 barChart vertical columns, grouping stacked, 5 series, 4 categories');
  });

  it('C04: pie3DChart with view3D → 3D yes; value and percent labels', async () => {
    const { chart } = await calibration('C04_kestrel_revenue_pie');
    expect(chart.groups[0].type).toBe('pie3DChart');
    expect(chart.is3D).toBe(true);
    expect(chart.series[0].labels.parts).toEqual(['val', 'percent']);
    expect(chartText(chart)).toContain('3D yes');
  });
});

describe('T-PPTX-3: C10 bubble chart', () => {
  it('x, y and size for each point; the typed-over point labels; axis titles verbatim with "→"', async () => {
    const { chart } = await calibration('C10_kestrel_portfolio_map');
    const s = chart.series[0];
    expect(s.chartType).toBe('bubbleChart');
    expect(s.x).toEqual(['2.8', '1.9', '4.4', '1.0', '4.6']);
    expect(s.y).toEqual(['4.0', '1.3', '2.3', '2.0', '4.7']);
    expect(s.size).toEqual(['2400', '3100', '900', '1200', '700']);
    expect(s.labels.custom.map((c) => c.text)).toEqual(['Beverages', 'Health & beauty retail', 'Cold-chain logistics', 'Office supplies', 'Elderly care: 4.6 / 4.7']);
    expect(s.pointColours.at(-1)).toEqual({ idx: 4, colour: '033D93' });
    const titles = chart.axes.map((a) => a.title);
    expect(titles).toContain('Market attractiveness (score 1–5): low → high');
    expect(titles).toContain('Competitive position (score 1–5): low → high');
    expect(chartText(chart)).toContain('(4.6, 4.7, size 700)');
  });
});

describe('T-PPTX-4: dual axis and log scale', () => {
  it('dual-axis.pptx: a combo on two value axes → dual axis yes, each series on its axis', () => {
    const chart = parseChart(chartXml({
      categories: ['Jan', 'Feb', 'Mar'],
      groups: [
        { type: 'barChart', series: [{ name: 'Marketing spend (HK$m)', values: [1.2, 1.4, 2.1] }] },
        { type: 'lineChart', series: [{ name: 'Online sales (HK$m)', values: [3, 3.2, 6] }] },
      ],
    }));
    expect(chart.dualAxis).toBe(true);
    expect(chart.series.map((s) => s.axis)).toEqual(['primary', 'secondary']);
    const text = chartText(chart);
    expect(text.split('\n')[0]).toBe('CHART 1 combo of barChart vertical columns, grouping clustered + lineChart, 2 series, 3 categories');
    expect(text).toContain('S2 "Online sales (HK$m)" (lineChart) colour auto axis y2');
    expect(text).toContain('dual axis yes');
  });

  it('log-axis.pptx: a log value axis → log scale base 10', () => {
    const chart = parseChart(chartXml({ categories: ['A', 'B'], logBase: 10, groups: [{ type: 'lineChart', series: [{ name: 'Index', values: [1, 100] }] }] }));
    expect(chart.axes.find((a) => a.role === 'y1').logBase).toBe(10);
    expect(chartText(chart)).toContain('log scale base 10');
  });
});

describe('T-PPTX-5: colours and the thumbnail', () => {
  it('theme-colours.pptx: a scheme colour is "theme", not a guessed hex; no fill is "auto"', () => {
    const chart = parseChart(chartXml({ categories: ['A'], groups: [{ type: 'barChart', series: [{ name: 'S1', values: [1], colour: 'scheme' }, { name: 'S2', values: [2] }, { name: 'S3', values: [3], colour: '033D93' }] }] }));
    expect(chart.series.map((s) => s.colour)).toEqual(['theme', 'auto', '033D93']);
  });

  it('with-thumbnail.pptx sends the thumbnail as a layout guide; without one, no image', async () => {
    const thumb = readFileSync('calibration/inputs/C06_lumen_sketch_photo.jpg');
    const line = chartXml({ categories: ['A'], groups: [{ type: 'lineChart', series: [{ name: 'S', values: [1] }] }] });
    const withThumb = await prep(await chartPptx([line], { files: { 'docProps/thumbnail.jpeg': thumb } }));
    expect(withThumb.upload).toMatchObject({ imageRole: 'thumbnail', image: { mediaType: 'image/jpeg', base64: thumb.toString('base64') } });
    const without = await prep(await chartPptx([line]));
    expect(without.upload.image).toBeUndefined();
    expect(without.upload.imageRole).toBeUndefined();
  });
});

describe('T-PPTX-6: shapes text', () => {
  it('keeps the slide title verbatim with its inherited font size (C04 "Revenue mix 2025", 44 pt from the master)', async () => {
    const zip = await openPptx(readFileSync('calibration/inputs/C04_kestrel_revenue_pie.pptx'));
    const deck = await listSlides(zip);
    const read = await readSlide(zip, deck.slides[0].path, deck);
    const text = shapesText(read, deck);
    expect(text).toContain('S2 [title placeholder] "Revenue mix 2025" x=36 y=22 w=648 h=90 font 44 pt');
  });

  it('keeps run font sizes, bold and typeface (C07)', async () => {
    const zip = await openPptx(readFileSync('calibration/inputs/C07_pearl_river_margin.pptx'));
    const deck = await listSlides(zip);
    const text = shapesText(await readSlide(zip, deck.slides[0].path, deck), deck);
    expect(text).toContain('"PRICE AND UNIT COST PER TONNE, 2019–2025, HK$" x=29 y=71 w=720 h=36 font 24 pt bold Calibri');
    expect(text).toContain('"Source: Pearl River Packaging finance, 2019–25 annual accounts" x=22 y=500 w=734 h=25 font 12 pt Calibri');
  });

  it(`refuses a slide with more than ${limits.pptxTextMaxChars.toLocaleString('en-GB')} characters of text`, async () => {
    const line = chartXml({ categories: ['A'], groups: [{ type: 'lineChart', series: [{ name: 'S', values: [1] }] }] });
    const long = box(9, 'x'.repeat(limits.pptxTextMaxChars), 10, 10);
    const r = await prep(await chartPptx([line], { extraShapes: long }));
    expect(r).toMatchObject({ ok: false, code: 'CM-U03', message: 'Your slide has too much text to send. Upload just the chart.' });
  });
});
