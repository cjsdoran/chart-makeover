// Session state and autosave (CMS-2, spec §11; copied from Tree Surgery). The whole session lives
// in localStorage under one key; nothing is stored server-side. Every storage call is wrapped so a
// blocked or full store degrades to a warning rather than breaking the app.
import { config } from '../../shared/limits.js';

export const STORAGE_KEY = 'cm.v1.session';
// A session saved by another version is not resumed (as QT D17).
export const SESSION_VERSION = 1;
export const AUTOSAVE_DELAY_MS = 1000;

// RFC 4648 base32 alphabet: upper case and digits only, so it survives the record file name rules.
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function makeAttemptId(randomBytes = defaultRandomBytes) {
  const bytes = randomBytes(8);
  let id = '';
  for (let i = 0; i < 8; i++) id += BASE32[bytes[i] % 32];
  return id;
}

function defaultRandomBytes(n) {
  const bytes = new Uint8Array(n);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

export function createSession({ now = new Date(), randomBytes } = {}) {
  return {
    version: SESSION_VERSION,
    attemptId: makeAttemptId(randomBytes),
    startedAt: now.toISOString(),
    endedAt: null,
    // 'setup' | 'upload' (the set-up chat) | 'lead' | … (spec §5.1)
    step: 'setup',
    updatedAt: now.toISOString(),
    setup: null,
    // The upload card's draft, so a reload keeps the audience line (the file can't be kept).
    draft: { audience: '', isDummy: false },
    // The run (spec §5.1). Milestone 3 adds the stage engine's fields.
    run: {
      audience: '',
      isDummy: false,
      uploads: [],
      activeUpload: null,
      // Uploads the read call couldn't read: time, file name, reason (spec §3.5).
      unreadable: [],
    },
    // The chat thread: Daniel's messages and the student's turns, in order (CM-7).
    chat: [],
    // Refused uploads: time and error code only, never the file (spec §3.2).
    blockedUploads: [],
  };
}

/**
 * A fresh run for another chart (CMS-15): new attempt ID, the setup fields kept, the set-up chat
 * opened again. The access code was checked when the setup was done.
 */
export function newRunFrom(session, opts) {
  const fresh = createSession(opts);
  if (!session.setup) return fresh;
  return { ...fresh, setup: session.setup, step: 'upload', chat: [openingMessage(opts?.now ?? new Date())] };
}

/** Daniel's opening message in the set-up chat (spec §3.1). */
export function openingMessage(now = new Date()) {
  return { id: 'm-opening', from: 'daniel', at: now.toISOString(), text: config.messages.opening };
}

export function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function isSession(value) {
  return Boolean(value) && typeof value === 'object' && value.version === SESSION_VERSION
    && typeof value.attemptId === 'string' && typeof value.step === 'string';
}

// A Chart Makeover session from another version: right shape, different version number.
function isOutdated(value) {
  return Boolean(value) && typeof value === 'object' && Number.isInteger(value.version) && value.version !== SESSION_VERSION
    && typeof value.attemptId === 'string';
}

/**
 * @returns {{ session: object|null, ok: boolean, outdated?: true }} ok is false when storage could
 * not be read; outdated when the saved session is from another version and can't be resumed.
 */
export function loadSaved(storage = defaultStorage()) {
  if (!storage) return { session: null, ok: false };
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return { session: null, ok: true };
    const parsed = JSON.parse(raw);
    if (isOutdated(parsed)) return { session: null, ok: true, outdated: true };
    return { session: isSession(parsed) ? parsed : null, ok: true };
  } catch {
    return { session: null, ok: false };
  }
}

/** @returns {boolean} true if saved. */
export function saveSession(session, storage = defaultStorage()) {
  if (!storage) return false;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(session));
    return true;
  } catch {
    return false;
  }
}

export function clearSaved(storage = defaultStorage()) {
  if (!storage) return false;
  try {
    storage.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

/**
 * Debounced saver for form edits; call flush() after each step so steps save at once.
 * onResult(ok) reports every save so the app can show or clear the storage warning.
 */
export function createAutosaver({ storage = defaultStorage(), delay = AUTOSAVE_DELAY_MS, onResult = () => {} } = {}) {
  let timer = null;
  let pending = null;

  function write() {
    timer = null;
    if (pending === null) return;
    const ok = saveSession(pending, storage);
    pending = null;
    onResult(ok);
  }

  return {
    schedule(session) {
      pending = session;
      if (timer) clearTimeout(timer);
      timer = setTimeout(write, delay);
    },
    flush(session) {
      if (session !== undefined) pending = session;
      if (timer) clearTimeout(timer);
      write();
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = null;
    },
  };
}
