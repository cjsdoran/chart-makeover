// The set-up chat's send (spec §3): T-READ-3 (unreadable: Daniel's message, tries counted, then the
// try-later message), T-READ-4 (a readable chart is stored and Stage 1 opens), T-UP-8 (refusals
// recorded) and T-SU-2 (the illustrative-values answer is stored).
import { describe, expect, it } from 'vitest';
import { readingPatch, refusalPatch, studentTurn, unreadableTries } from '../../src/upload/sendChart.js';
import { createSession } from '../../src/store/session.js';
import { config } from '../../shared/limits.js';

const READING = { readable: true, unreadableReason: null, kind: 'data', summary: 'I read this as revenue by business, 2025, in HK$m.' };
const prepared = { ok: true, upload: { kind: 'pptx', pptx: { shapes: 'S' } }, record: { mediaType: 'image/jpeg', base64: '/9j/', width: 1600, height: 900 }, meta: { fileName: 'C04.pptx', sameSlideName: 'C04.pdf' } };
const start = () => ({ ...createSession(), step: 'upload', chat: [{ id: 'm-opening', from: 'daniel', text: 'Send me…' }] });
const apply = (s, patch) => ({ ...s, ...patch });

describe('T-READ-4: a readable chart', () => {
  it('is stored with its reading and image; the audience and illustrative answer are kept; Stage 1 opens', () => {
    const s = start();
    const { outcome, patch } = readingPatch(s, { prepared, result: { reading: READING, promptVersion: 'read-chart 1.0', servedBy: 'claude-opus-5-5' }, audience: 'The CEO, deciding on capital', isDummy: true });
    expect(outcome).toBe('read');
    const next = apply(s, patch);
    expect(next.step).toBe('lead');
    expect(next.run).toMatchObject({ audience: 'The CEO, deciding on capital', isDummy: true, activeUpload: 'u1' });
    expect(next.run.uploads[0]).toMatchObject({
      id: 'u1', fileName: 'C04.pptx', sameSlideName: 'C04.pdf', kind: 'pptx', reading: READING, readingConfirmed: false,
      readingCorrection: null, image1600: prepared.record, readPromptVersion: 'read-chart 1.0', readModel: 'claude-opus-5-5',
    });
    expect(next.chat.at(-1)).toMatchObject({ from: 'daniel', text: config.openers.stage1, kind: 'opener', stage: 1 });
    expect(next.draft).toEqual({ audience: '', isDummy: false });
  });
});

describe('T-READ-3: an unreadable chart', () => {
  const unreadable = { reading: { readable: false, unreadableReason: 'Retake the photo straight on, in good light.' } };

  it("gets Daniel's message with the reason, the card again, and doesn't open Stage 1", () => {
    const s = start();
    const { outcome, patch } = readingPatch(s, { prepared, result: unreadable, audience: 'CEO', isDummy: false });
    expect(outcome).toBe('unreadable');
    const next = apply(s, patch);
    expect(next.step).toBe('upload');
    expect(next.run.uploads).toEqual([]);
    expect(next.chat.at(-1)).toMatchObject({ from: 'daniel', kind: 'unreadable', text: "I can't read the chart you sent. Retake the photo straight on, in good light." });
    expect(next.run.unreadable[0]).toMatchObject({ slot: 0, fileName: 'C04.pptx', reason: 'Retake the photo straight on, in good light.' });
  });

  it(`after ${config.caps.unreadablePerUpload} tries Daniel says to export to PDF and try later; a readable upload starts the count again`, () => {
    let s = start();
    for (let i = 0; i < config.caps.unreadablePerUpload; i++) s = apply(s, readingPatch(s, { prepared, result: unreadable, audience: 'CEO', isDummy: false }).patch);
    expect(unreadableTries(s)).toBe(3);
    expect(s.chat.at(-1).text).toBe('I still can\'t read it. Export the slide to PDF and try once more later.');
    s = apply(s, readingPatch(s, { prepared, result: { reading: READING }, audience: 'CEO', isDummy: false }).patch);
    expect(unreadableTries(s)).toBe(0);
  });
});

describe('T-UP-8: refusals', () => {
  it('each refusal is recorded with its time and code; CM-U04 adds Daniel\'s "One chart, please."', () => {
    const s = start();
    const a = apply(s, refusalPatch(s, { code: 'CM-U01', reason: 'wrong_type' }));
    expect(a.blockedUploads).toEqual([{ at: expect.any(String), code: 'CM-U01', reason: 'wrong_type' }]);
    expect(a.chat).toHaveLength(1);
    const b = apply(a, refusalPatch(a, { code: 'CM-U04', reason: 'pages' }));
    expect(b.blockedUploads.map((x) => x.code)).toEqual(['CM-U01', 'CM-U04']);
    expect(b.chat.at(-1)).toMatchObject({ from: 'daniel', text: 'One chart, please.' });
  });
});

describe("the student's turn", () => {
  it('names the file(s) sent and carries the audience line', () => {
    expect(studentTurn({ fileName: 'chart.pptx', sameSlideName: 'chart.pdf', audience: 'The CFO' })).toMatchObject({ from: 'student', files: ['chart.pptx', 'chart.pdf'], text: 'The CFO' });
    expect(studentTurn({ fileName: 'photo.jpg', audience: 'The CFO' }).files).toEqual(['photo.jpg']);
  });
});
