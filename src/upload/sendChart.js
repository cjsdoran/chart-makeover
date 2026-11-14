// The set-up chat's send (CM-1, CM-3, spec §3): the student's turn, the upload checks, the read
// call, and what each outcome adds to the session. Plain JavaScript, so it is tested without React.
import { config } from '../../shared/limits.js';
import { CODES } from '../../shared/errorCodes.js';
import { askDaniel } from '../daniel/askDaniel.js';

let counter = 0;
const messageId = () => `m-${Date.now().toString(36)}-${(counter += 1)}`;
const daniel = (text, extra = {}) => ({ id: messageId(), from: 'daniel', at: new Date().toISOString(), text, ...extra });

/** The student's turn in the chat: the file(s) sent and the audience line. */
export function studentTurn({ fileName, sameSlideName, audience }) {
  return {
    id: messageId(),
    from: 'student',
    at: new Date().toISOString(),
    files: [fileName, sameSlideName].filter(Boolean),
    text: audience,
  };
}

/** Records a refused upload: time and code only (spec §3.2), and Daniel's line for CM-U04. */
export function refusalPatch(session, refusal) {
  const blocked = [...session.blockedUploads, { at: new Date().toISOString(), code: refusal.code, reason: refusal.reason }];
  const chat = refusal.code === CODES.oneChart ? [...session.chat, daniel(config.upload.oneChartMessage)] : session.chat;
  return { blockedUploads: blocked, chat };
}

/** How many unreadable tries since the last readable upload (spec §3.5, caps.unreadablePerUpload). */
export function unreadableTries(session) {
  const slot = session.run.uploads.length;
  return session.run.unreadable.filter((u) => u.slot === slot).length;
}

/**
 * The session changes for a read call's result (spec §3.5): a readable chart is stored and Stage 1
 * opens; an unreadable one gets Daniel's message and the upload card again, at no cost.
 */
export function readingPatch(session, { prepared, result, audience, isDummy }) {
  const now = new Date().toISOString();
  const reading = result.reading;
  if (!reading.readable) {
    const slot = session.run.uploads.length;
    const tries = unreadableTries(session) + 1;
    const text = tries >= config.caps.unreadablePerUpload
      ? config.messages.unreadableTryLater
      : `${config.messages.unreadable} ${reading.unreadableReason}`;
    return {
      outcome: 'unreadable',
      patch: {
        run: { ...session.run, unreadable: [...session.run.unreadable, { at: now, slot, fileName: prepared.meta.fileName, reason: reading.unreadableReason }] },
        chat: [...session.chat, daniel(text, { kind: 'unreadable' })],
      },
    };
  }
  const id = `u${session.run.uploads.length + 1}`;
  const upload = {
    id,
    fileName: prepared.meta.fileName,
    sameSlideName: prepared.meta.sameSlideName ?? null,
    kind: prepared.upload.kind,
    at: now,
    reading,
    readingCorrection: null,
    readingConfirmed: false,
    image1600: prepared.record ?? null,
    readPromptVersion: result.promptVersion ?? null,
    readModel: result.servedBy ?? null,
  };
  const first = session.run.uploads.length === 0;
  return {
    outcome: 'read',
    patch: {
      run: { ...session.run, audience: first ? audience : session.run.audience, isDummy: first ? isDummy : session.run.isDummy, uploads: [...session.run.uploads, upload], activeUpload: id },
      chat: first ? [...session.chat, daniel(config.openers.stage1, { kind: 'opener', stage: 1 })] : session.chat,
      step: first ? 'lead' : session.step,
      draft: { audience: '', isDummy: false },
    },
  };
}

/** Sends a prepared upload to /api/read-chart, with the browser's retries (spec §7 step 5). */
export function readChart(prepared, accessCode, { call } = {}) {
  return askDaniel('/api/read-chart', { upload: prepared.upload }, accessCode, call ? { call } : {});
}
