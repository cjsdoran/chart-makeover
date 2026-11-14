// The chart upload in the browser (CM-1, CM-2, spec §3.2–3.3): T-UP-1..7, T-UP-9, T-PDF-1..3 and
// T-DET-1 on the upload. Runs the browser code with the Node canvas, as the read test does.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadImage } from '@napi-rs/canvas';
import { prepareUpload, sniff, fileType } from '../../src/upload/upload.js';
import { exifOrientation } from '../../src/upload/image.js';
import { pdfjsAssets } from '../../src/upload/pdfPage.js';
import { nodeDeps } from '../../scripts/read-test.mjs';
import { config } from '../../shared/limits.js';
import { asFile, box, chartPptx, chartXml, makeImage, makePdf, makePptx, picture, tableFrame, withExifOrientation } from '../helpers/charts.js';

const MB = 1024 * 1024;
const input = (name) => asFile(readFileSync(`calibration/inputs/${name}`), name);
const truth = JSON.parse(readFileSync('calibration/read-truth.json', 'utf8')).cases;
const LINE = chartXml({ categories: ['2023', '2024'], groups: [{ type: 'lineChart', series: [{ name: 'Sales', values: [1, 2] }] }] });
const prep = (file, opts = {}) => prepareUpload(file, { deps: nodeDeps, ...opts });
const size = async (image) => {
  const img = await loadImage(Buffer.from(image.base64, 'base64'));
  return [img.width, img.height];
};

afterEach(() => vi.restoreAllMocks());

describe('T-UP-1: each accepted type opens', () => {
  it('a .pptx slide: shapes and chart text, the thumbnail as its image', async () => {
    const r = await prep(input('C01_man_city_big_five.pptx'));
    expect(r.ok).toBe(true);
    expect(r.upload).toMatchObject({ kind: 'pptx', imageRole: 'thumbnail', image: { mediaType: 'image/jpeg' } });
    expect(r.upload.pptx.shapes).toContain('Commercial revenue of the Big Five, 2008/09–2024/25');
    expect(r.upload.pptx.charts).toMatch(/^CHART 1 lineChart, 5 series, 17 categories/);
    expect(r.record).toBeNull();
  });

  it('a PDF page: the image, the text layer and the stored copy', async () => {
    const r = await prep(input('C09_kaze_asean_growth.pdf'));
    expect(r.ok).toBe(true);
    expect(r.upload).toMatchObject({ kind: 'pdf', imageRole: 'page' });
    expect(r.upload.pdfText).toContain('Phillipines');
    expect(r.record.mediaType).toBe('image/jpeg');
  }, 30000);

  it('a screenshot (.png) and a photo (.jpg)', async () => {
    for (const name of ['C08_aster_moss_dual_axis.png', 'C06_lumen_sketch_photo.jpg']) {
      const r = await prep(input(name));
      expect(r.ok, name).toBe(true);
      expect(r.upload).toMatchObject({ kind: 'image', imageRole: 'photo', image: { mediaType: 'image/jpeg' } });
      expect(r.upload.pdfText).toBeUndefined();
    }
  });

  it('a .heic photo, converted to JPEG first (T-UP-6)', async () => {
    const jpeg = readFileSync('calibration/inputs/C06_lumen_sketch_photo.jpg');
    const heic = Uint8Array.from([0, 0, 0, 24, ...Buffer.from('ftypheic'), 0, 0, 0, 0, ...Buffer.from('mif1heic')]);
    const convertHeic = vi.fn(async () => new Uint8Array(jpeg));
    const r = await prepareUpload(asFile(heic, 'IMG_0001.HEIC'), { deps: { ...nodeDeps, convertHeic } });
    expect(convertHeic).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ ok: true, upload: { kind: 'image', image: { mediaType: 'image/jpeg' } } });
  });
});

describe('T-UP-2, T-UP-3: type and size', () => {
  it.each([
    ['deck.ppt', 'CM-U02', 'deck.ppt is an older PowerPoint file. Save it as .pptx, or export the slide to PDF, and upload again.'],
    ['notes.docx', 'CM-U01', null],
    ['data.xlsx', 'CM-U01', null],
    ['chart.gif', 'CM-U01', "chart.gif isn't a PowerPoint slide, a PDF or a photo. Upload a .pptx, .pdf, .png, .jpg or .heic file."],
  ])('%s → %s', async (name, code, message) => {
    const r = await prep(asFile(new Uint8Array([1, 2, 3]), name));
    expect(r).toMatchObject({ ok: false, code });
    if (message) expect(r.message).toBe(message);
  });

  it('a file whose bytes are not what its name says → CM-U01', async () => {
    expect(await prep(asFile(new TextEncoder().encode('hello'), 'chart.pdf'))).toMatchObject({ ok: false, code: 'CM-U01' });
    expect(sniff(new TextEncoder().encode('%PDF-1.7'))).toBe('pdf');
    expect(fileType('Photo.JPEG')).toBe('jpg');
  });

  it('21 MB → CM-U03', async () => {
    const r = await prep(asFile(new Uint8Array(21 * MB), 'big.pdf'));
    expect(r).toMatchObject({ ok: false, code: 'CM-U03', message: 'big.pdf is 21.0 MB. A chart file is limited to 20 MB. Compress the pictures, or export the slide to PDF, and upload again.' });
  });
});

describe('T-UP-4: one chart, please (CM-U04)', () => {
  it('a two-page PDF', async () => {
    const r = await prep(asFile(await makePdf(['Page one', 'Page two']), 'two-pages.pdf'));
    expect(r).toMatchObject({ ok: false, code: 'CM-U04', message: 'One chart, please.', hint: 'This PDF has 2 pages. Upload a one-page PDF or a one-slide .pptx.' });
  });

  it('a two-slide .pptx', async () => {
    const bytes = await makePptx([{ shapes: box(2, 'A', 10, 10) }, { shapes: box(2, 'B', 10, 10) }]);
    const r = await prep(asFile(bytes, 'two-slides.pptx'));
    expect(r).toMatchObject({ ok: false, code: 'CM-U04', message: 'One chart, please.', hint: 'This file has 2 slides. Upload a one-page PDF or a one-slide .pptx.' });
  });

  it('a slide with two native charts', async () => {
    const r = await prep(asFile(await chartPptx([LINE, LINE]), 'two-charts.pptx'));
    expect(r).toMatchObject({ ok: false, code: 'CM-U04', message: 'One chart, please.' });
    expect(r.hint).toMatch(/^This slide has 2 charts\./);
  });
});

describe('T-UP-5: password and damaged PDFs', () => {
  it('a password-protected PDF → CM-U08', async () => {
    const loadPdfjs = async () => ({ getDocument: () => ({ promise: Promise.reject(Object.assign(new Error('No password given'), { name: 'PasswordException' })), destroy() {} }) });
    const r = await prepareUpload(asFile(new TextEncoder().encode('%PDF-1.7 locked'), 'locked.pdf'), { deps: { ...nodeDeps, loadPdfjs } });
    expect(r).toMatchObject({ ok: false, code: 'CM-U08', message: 'locked.pdf is password-protected. Remove the password, or export it again without one, and upload again.' });
  });

  it('a damaged PDF → CM-U07 with the error name', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await prep(asFile(new TextEncoder().encode('%PDF-1.7\nnot really a pdf'), 'broken.pdf'));
    expect(r).toMatchObject({ ok: false, code: 'CM-U07' });
    expect(r.detail).toMatch(/^\w+$/);
  });

  it('a damaged .pptx → CM-U07', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await prep(asFile(Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]), 'broken.pptx'));
    expect(r).toMatchObject({ ok: false, code: 'CM-U07' });
  });
});

describe('T-UP-6: HEIC conversion failure → CM-U05', () => {
  it('shows the export-as-JPEG message', async () => {
    const heic = Uint8Array.from([0, 0, 0, 24, ...Buffer.from('ftypheic'), 0, 0, 0, 0]);
    const r = await prepareUpload(asFile(heic, 'photo.heic'), { deps: { ...nodeDeps, convertHeic: async () => { throw new Error('ERR_LIBHEIF'); } } });
    expect(r).toMatchObject({ ok: false, code: 'CM-U05', message: 'Export the photo as JPEG and upload again.' });
  });
});

describe('T-UP-7: something to read on a slide', () => {
  it('text-only.pptx (two text boxes, no chart) → CM-U09', async () => {
    const bytes = await makePptx([{ shapes: box(2, 'Title', 10, 10) + box(3, 'A note', 10, 60) }]);
    expect(await prep(asFile(bytes, 'text-only.pptx'))).toMatchObject({ ok: false, code: 'CM-U09', message: "We couldn't find a chart on that slide. Export it to PDF and upload that." });
  });

  it('table-slide.pptx passes, with the table as text and its font size', async () => {
    const bytes = await makePptx([{ shapes: box(2, 'FY25 Store P&L', 10, 10) + tableFrame(5, [['Store', 'Sales'], ['Boston', '2,846,310']]) }]);
    const r = await prep(asFile(bytes, 'table-slide.pptx'));
    expect(r.ok).toBe(true);
    expect(r.upload.pptx.tables).toBe('TABLE 1 x=40 y=100 w=600 h=300, 2 rows × 2 columns, font 9 pt\nrow 1: Store | Sales\nrow 2: Boston | 2,846,310');
  });

  it('picture-chart.pptx passes and sends the picture itself, prepared as a photo', async () => {
    const png = await makeImage(1200, 700, 'png');
    const bytes = await makePptx([{ shapes: box(2, 'Sales by region', 10, 10) + picture(4, 'rIdP', 40, 80, 880, 430), rels: { rIdP: '../media/image1.png' }, files: { 'ppt/media/image1.png': png } }]);
    const r = await prep(asFile(bytes, 'picture-chart.pptx'));
    expect(r.ok).toBe(true);
    expect(r.upload).toMatchObject({ kind: 'pptx', imageRole: 'picture', image: { mediaType: 'image/jpeg' } });
    expect(await size(r.upload.image)).toEqual([1200, 700]);
    expect(r.record).toMatchObject({ mediaType: 'image/jpeg', width: 1200, height: 700 });
  });
});

describe('the optional same-slide PDF or picture (spec §15 assumption 3)', () => {
  it('replaces the thumbnail as the image and gives the record a copy', async () => {
    const shot = await makeImage(1600, 900, 'png');
    const r = await prep(input('C01_man_city_big_five.pptx'), { sameSlide: asFile(shot, 'slide.png') });
    expect(r.ok).toBe(true);
    expect(r.upload.imageRole).toBe('sameSlide');
    expect(r.upload.pptx.charts).toContain('Man City');
    expect(r.record).toMatchObject({ mediaType: 'image/jpeg', width: 1600, height: 900 });
    expect(r.meta.sameSlideName).toBe('slide.png');
  });

  it('a same-slide PDF is rendered and its text layer left out', async () => {
    const r = await prep(input('C01_man_city_big_five.pptx'), { sameSlide: asFile(await makePdf(['Commercial revenue']), 'slide.pdf') });
    expect(r.ok).toBe(true);
    expect(r.upload.imageRole).toBe('sameSlide');
    expect(r.upload.pdfText).toBeUndefined();
  });

  it('refuses a same-slide file that is not a PDF or picture, or has two pages', async () => {
    const a = await prep(input('C01_man_city_big_five.pptx'), { sameSlide: asFile(new Uint8Array([1]), 'slide.pptx') });
    expect(a).toMatchObject({ ok: false, code: 'CM-U01', sameSlide: true });
    const b = await prep(input('C01_man_city_big_five.pptx'), { sameSlide: asFile(await makePdf(['a', 'b']), 'slides.pdf') });
    expect(b).toMatchObject({ ok: false, code: 'CM-U04', sameSlide: true });
  });
});

describe('T-UP-9: image sizes (CMS-8)', () => {
  it('a PDF page renders at 2,000 px on its long side, PNG; the stored copy is a 1,600 px JPEG', async () => {
    const r = await prep(asFile(await makePdf(['A chart page']), 'page.pdf'));
    expect(r.upload.image.mediaType).toBe('image/png');
    const [w, h] = await size(r.upload.image);
    expect(Math.max(w, h)).toBe(2000);
    expect(Math.max(r.record.width, r.record.height)).toBe(1600);
  });

  it('falls back to JPEG when the PNG is over the image limit', async () => {
    const limit = config.upload.imageMaxBytes;
    config.upload.imageMaxBytes = 1000;
    try {
      const r = await prep(asFile(await makePdf(['A chart page']), 'page.pdf'));
      expect(r.upload.image.mediaType).toBe('image/jpeg');
    } finally {
      config.upload.imageMaxBytes = limit;
    }
  });

  it('a large screenshot is resized to 2,000 px, a small one is not enlarged', async () => {
    const big = await prep(asFile(await makeImage(4000, 1000), 'wide.png'));
    expect(await size(big.upload.image)).toEqual([2000, 500]);
    expect([big.record.width, big.record.height]).toEqual([1600, 400]);
    const small = await prep(asFile(await makeImage(800, 600), 'small.png'));
    expect(await size(small.upload.image)).toEqual([800, 600]);
  });

  it('a photo with EXIF orientation 6 comes out upright (portrait)', async () => {
    const jpeg = withExifOrientation(await makeImage(600, 200, 'jpeg'), 6);
    expect(exifOrientation(jpeg)).toBe(6);
    const r = await prep(asFile(jpeg, 'photo-rotated.jpg'));
    expect(await size(r.upload.image)).toEqual([200, 600]);
    expect([r.record.width, r.record.height]).toEqual([200, 600]);
    // The dark bar was on the left of the stored image, so it is now along the top.
    const img = await loadImage(Buffer.from(r.upload.image.base64, 'base64'));
    const { createCanvas } = await import('@napi-rs/canvas');
    const c = createCanvas(img.width, img.height);
    c.getContext('2d').drawImage(img, 0, 0);
    const px = (x, y) => c.getContext('2d').getImageData(x, y, 1, 1).data[0];
    expect(px(100, 5)).toBeLessThan(80);
    expect(px(100, 590)).toBeGreaterThan(180);
  });

  it('turns the photo itself when the decoder leaves EXIF alone', async () => {
    const plain = await makeImage(600, 200, 'jpeg');
    // A decoder that ignores EXIF: it decodes the same pixels without the APP1 segment.
    const decodeImage = async () => {
      const image = await loadImage(Buffer.from(plain));
      return { image, width: image.width, height: image.height, exifApplied: false };
    };
    const r = await prepareUpload(asFile(withExifOrientation(plain, 8), 'turned.jpg'), { deps: { ...nodeDeps, decodeImage } });
    expect(await size(r.upload.image)).toEqual([200, 600]);
  });

  it('reads no orientation from a JPEG without EXIF, or from a PNG', async () => {
    expect(exifOrientation(await makeImage(10, 10, 'jpeg'))).toBe(1);
    expect(exifOrientation(await makeImage(10, 10, 'png'))).toBe(1);
  });
});

describe('T-PDF-1..3: the PDF text layer', () => {
  it.each(['C02', 'C05', 'C09'])('%s: the text layer carries every mustRead string, typos included', async (id) => {
    const file = { C02: 'C02_man_city_two_panels.pdf', C05: 'C05_northfield_store_pl.pdf', C09: 'C09_kaze_asean_growth.pdf' }[id];
    const r = await prep(input(file));
    const flat = r.upload.pdfText.split('\n').map((l) => /^"(.*)" x=/.exec(l)?.[1] ?? '').join(' ');
    for (const s of truth[id].mustRead) expect(flat, s).toContain(s.replace(/"/g, "'"));
  }, 30000);

  it('each line has its position and font size', async () => {
    const r = await prep(input('C09_kaze_asean_growth.pdf'));
    expect(r.upload.pdfText.split('\n')[0]).toBe('Page 780 × 540 pt');
    expect(r.upload.pdfText).toMatch(/"Source: ChatGPT analysis, October 2026" x=\d+ y=\d+ w=\d+ size=12/);
  });

  it('T-PDF-2: a scanned page sends the image only', async () => {
    const r = await prep(asFile(await makePdf(['']), 'scan.pdf'));
    expect(r.ok).toBe(true);
    expect(r.upload.image).toBeTruthy();
    expect(r.upload.pdfText).toBeUndefined();
  });

  it('T-PDF-3: pdf.js fonts, CMaps and wasm come from /pdfjs/', () => {
    expect(pdfjsAssets('/pdfjs/')).toEqual({ standardFontDataUrl: '/pdfjs/standard_fonts/', cMapUrl: '/pdfjs/cmaps/', cMapPacked: true, wasmUrl: '/pdfjs/wasm/' });
  });
});

describe('T-DET-1: the case detector on the chart text (CMS-11)', () => {
  const CASE = 'This case was written by Professor Lee solely as a basis for class discussion.';
  it('blocks a PDF page from a published case (CM-U06)', async () => {
    const r = await prep(asFile(await makePdf([`Exhibit 3 Revenue by region\n${CASE}`]), 'exhibit.pdf'));
    expect(r).toMatchObject({ ok: false, code: 'CM-U06', message: "This looks like a page from a published teaching case, which can't go into an AI tool. Upload a chart you made yourself." });
  });

  it('blocks a slide whose text or chart carries case markers', async () => {
    const r = await prep(asFile(await chartPptx([LINE], { texts: ['Revenue', CASE] }), 'case.pptx'));
    expect(r).toMatchObject({ ok: false, code: 'CM-U06' });
  });

  it('lets the ten calibration charts through', async () => {
    for (const c of JSON.parse(readFileSync('calibration/cases.json', 'utf8'))) {
      const r = await prep(input(c.file));
      expect(r.ok, c.id).toBe(true);
    }
  }, 60000);
});
