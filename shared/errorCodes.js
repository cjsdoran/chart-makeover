// Error codes the student can quote to Chris (spec §12.1, CMS-4; from TS and QT). Shared by the
// browser, which shows them, and the functions, which log them. Never pass file content to any
// of these. CM-Uxx and CM-Sxx are distinct from the CM-n requirement IDs by their letter.

export const CODES = {
  wrongType: 'CM-U01',
  oldFormat: 'CM-U02',
  tooBig: 'CM-U03',
  oneChart: 'CM-U04',
  heic: 'CM-U05',
  caseBlocked: 'CM-U06',
  unreadable: 'CM-U07',
  password: 'CM-U08',
  noChart: 'CM-U09',
  serverMisconfigured: 'CM-S01',
  badAccessCode: 'CM-S02',
  timeout: 'CM-S03',
  formatFailed: 'CM-S04',
  other: 'CM-S05',
};

/** "Message. (Error code: CM-U07 InvalidPDFException)" */
export function withCode(message, code, detail) {
  if (!code) return message;
  return `${message} (Error code: ${code}${detail ? ` ${detail}` : ''})`;
}

/** The code for a failed call to a function, from its HTTP status and `error` field. */
export function codeForServerError({ status, error } = {}) {
  if (error === 'server_misconfigured') return CODES.serverMisconfigured;
  if (status === 401 || error === 'bad_access_code') return CODES.badAccessCode;
  if (error === 'timeout') return CODES.timeout;
  if (error === 'case_blocked') return CODES.caseBlocked;
  return CODES.other;
}

/** The code for a function log line's outcome (an HTTP status or a model outcome); null on success. */
export function codeForOutcome(outcome) {
  if (outcome === 'ok' || outcome === 200 || outcome === 204) return null;
  if (outcome === 'no_api_key' || outcome === 500) return CODES.serverMisconfigured;
  if (outcome === 401) return CODES.badAccessCode;
  if (outcome === 'timeout' || outcome === 504) return CODES.timeout;
  if (outcome === 422) return CODES.caseBlocked;
  if (outcome === 'invalid') return CODES.formatFailed;
  return CODES.other;
}
