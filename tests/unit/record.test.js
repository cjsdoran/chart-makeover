// The record PDF (CM-9, spec §13): T-REC-1..5 in tests/test-plan.md. Built in Node from a run
// driven through the real engine on canned reviews; text read back with pdf.js.
import { readFileSync, readdirSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import * as pdfLib from 'pdf-lib';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { buildRecord, decisionWords, stageOutcome } from '../../src/record/buildRecord.js';
import { A4 } from '../../src/record/layout.js';
import { renderPreview } from '../../src/redraw/preview.js';
import { recordFileName } from '../../src/redraw/fileName.js';
import { afterReupload, startChangingChoices } from '../../src/engine/engine.js';
import { config } from '../../shared/limits.js';
import { atChanges, ok, withSlide, SETUP } from '../helpers/runs.js';

let jpeg;
let previewPng;
beforeAll(async () => {
  const c = createCanvas(800, 450);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 800, 450);
  ctx.fillStyle = '#033d93';
  ctx.fillRect(40, 200, 200, 120);
  jpeg = Buffer.from(await c.encode('jpeg', 85)).toString('base64');
  const background = await loadImage(readFileSync('assets/template/title-only-bg.jpg'));
  previewPng = async (spec) => new Uint8Array(await renderPreview(spec, { createCanvas, background, ppi: 60 }).encode('png'));
});

async function textOf(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, isEvalSupported: false }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    pages.push(content.items.map((x) => x.str).join(' ').replace(/\s+/g, ' '));
  }
  return pages;
}

const finished = () => {
  const s = withSlide({ image: { mediaType: 'image/jpeg', base64: jpeg } });
  return { ...s, endedAt: new Date('2026-11-16T03:00:00Z').toISOString() };
};

describe('T-REC-1: the record opens, A4, footer on every page', () => {
  it('builds an A4 PDF with the footer and page numbers on each page', async () => {
    const r = await buildRecord(finished(), { previewPng, lib: pdfLib });
    const doc = await pdfLib.PDFDocument.load(r.bytes);
    expect(r.pageCount).toBeGreaterThanOrEqual(3);
    for (const page of doc.getPages()) {
      expect(page.getWidth()).toBeCloseTo(A4.width, 1);
      expect(page.getHeight()).toBeCloseTo(A4.height, 1);
    }
    const pages = await textOf(r.bytes);
    pages.forEach((p, i) => {
      expect(p).toContain(config.record.footer);
      expect(p).toContain(`Page ${i + 1} of ${pages.length}`);
    });
  });
});

describe('T-REC-2: the header', () => {
  it('names the student, case, attempt, outcome per stage, versions and models', async () => {
    const s = finished();
    const [first] = await textOf((await buildRecord(s, { previewPng, lib: pdfLib })).bytes);
    for (const t of [SETUP.name, SETUP.studentId, SETUP.team, SETUP.caseName, s.attemptId, `App version: ${config.appVersion}`,
      'Stage 1 Lead: passed in round 2', 'Stage 2 Data fit: passed in round 2', 'Stage 5 Fit check: passed in round 1',
      'stage 1.2', 'redraw-plan 1.1', 'read-chart 1.1', 'Rules version: 1.0 (PRD rev 58)', 'claude-opus-5-5']) {
      expect(first).toContain(t);
    }
  });

  it('says how a stage ended at its cap', () => {
    const run = { leads: [], stages: { 2: { status: 'cappedOpen', roundsUsed: 3 } } };
    expect(stageOutcome(run, 2)).toBe('moved on at the cap (3 rounds), fixes still open');
  });
});

describe('T-REC-3: every lead, message and decision', () => {
  it('has both lead drafts, Daniel’s messages, every finding with its decision, reason and push-back', async () => {
    const all = (await textOf((await buildRecord(finished(), { previewPng, lib: pdfLib })).bytes)).join(' ');
    for (const t of ['Draft 1', 'City grew', 'Draft 2', 'Agreed lead', 'Stage 1 message', 'Stage 2 message', 'Stage 4 message',
      '[D1]', '[D3]', 'Like-for-like is fine here', 'Daniel pushed back: The board will ask.', 'You kept your choice.',
      'Corrected: "It is £m, not €m"', 'Your comparison: Time', 'Hard stop [P2]', 'Minor [P4]']) {
      expect(all).toContain(t);
    }
  });

  it('words each kind of decision', () => {
    expect(decisionWords({ status: 'accepted', severity: 'major' })).toBe('Accepted.');
    expect(decisionWords({ status: 'open', severity: 'minor' })).toBe('Not accepted (left out of the slide).');
    expect(decisionWords({ status: 'closed', reason: 'No room', reply: 'Fair.', severity: 'major' })).toBe('Declined: "No room" Daniel: Fair.');
    expect(decisionWords({ status: 'accepted', reason: 'x', finalChoice: 'acceptFix', pushBack: 'Sure?', severity: 'major' })).toContain('You accepted the fix.');
  });
});

describe('T-REC-4: both uploads after a re-upload', () => {
  it('prints each upload with its image or, for a .pptx, its reading', async () => {
    const s = finished();
    const second = { ...s.run.uploads[0], id: 'u2', fileName: 'redrawn.pptx', kind: 'pptx', image1600: null, reading: { ...s.run.uploads[0].reading, summary: 'I read this as the redrawn chart.' } };
    const run = { ...s.run, uploads: [...s.run.uploads, second] };
    const all = (await textOf((await buildRecord({ ...s, run }, { previewPng, lib: pdfLib })).bytes)).join(' ');
    expect(all).toContain('man-city.pdf');
    expect(all).toContain('Your redrawn chart (upload 2)');
    expect(all).toContain("PowerPoint slide: see Daniel's reading.");
    expect(all).toContain('I read this as the redrawn chart.');
    expect(all).toContain('Man City: 2009 100, 2024 190');
    expect(typeof afterReupload).toBe('function');
  });
});

describe('T-REC-5: redraw previews, no prompt text, the file name', () => {
  it('has each version with its preview image and the fixes it applied', async () => {
    const r = await buildRecord(finished(), { previewPng, lib: pdfLib });
    const all = (await textOf(r.bytes)).join(' ');
    expect(all).toContain('Make these changes');
    expect(all).toContain('Version 1');
    expect(all).toContain('_illustrative.pptx');
    expect(all).toContain('not a render of the .pptx file');
    expect(all).toContain('Like-for-like is fine here');
    expect(all).toContain(config.openers.lastMessage);
    const doc = await pdfLib.PDFDocument.load(r.bytes);
    const images = doc.context.enumerateIndirectObjects().filter(([, o]) => o?.dict?.get?.(pdfLib.PDFName.of('Subtype'))?.toString() === '/Image');
    expect(images.length).toBeGreaterThanOrEqual(2); // the uploaded chart and the preview
  });

  it('contains no prompt text', async () => {
    const all = (await textOf((await buildRecord(finished(), { previewPng, lib: pdfLib })).bytes)).join(' ');
    for (const f of readdirSync('prompts').filter((n) => n.endsWith('.md'))) {
      const lines = readFileSync(`prompts/${f}`, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l.length > 60 && !l.startsWith('<!--'));
      for (const line of lines.slice(0, 40)) expect(all).not.toContain(line.slice(0, 60));
    }
  });

  it('is named MGMT5760_<Case>_ChartMakeover_<StudentID>_<AttemptID>.pdf', async () => {
    const s = finished();
    expect(recordFileName(s)).toBe(`MGMT5760_ManCity_ChartMakeover_20871234_${s.attemptId}.pdf`);
    expect((await buildRecord(s, { previewPng, lib: pdfLib })).fileName).toBe(recordFileName(s));
  });

  it('still builds when no slide was made, or the preview fails', async () => {
    const r1 = await buildRecord(atChanges(), { lib: pdfLib });
    expect((await textOf(r1.bytes)).join(' ')).toContain('No slide was built in this run.');
    const r2 = await buildRecord(ok(startChangingChoices(withSlide())), { previewPng: async () => { throw new Error('no canvas'); }, lib: pdfLib });
    expect((await textOf(r2.bytes)).join(' ')).toContain('(Preview not available.)');
  });
});
