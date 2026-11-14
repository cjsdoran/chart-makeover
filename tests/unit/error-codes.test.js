// T-ERR-1: error codes for server failures (spec §12.1). Upload codes are tested with the
// upload code in milestones 2 and 4.
import { describe, expect, it } from 'vitest';
import { CODES, codeForOutcome, codeForServerError, withCode } from '../../shared/errorCodes.js';

describe('T-ERR-1: codes', () => {
  it('has every code in spec §12.1', () => {
    expect(Object.values(CODES).sort()).toEqual([
      'CM-S01', 'CM-S02', 'CM-S03', 'CM-S04', 'CM-S05',
      'CM-U01', 'CM-U02', 'CM-U03', 'CM-U04', 'CM-U05', 'CM-U06', 'CM-U07', 'CM-U08', 'CM-U09',
    ]);
  });

  it('withCode adds the code, and the error name when there is one', () => {
    expect(withCode('Too long.', 'CM-U04')).toBe('Too long. (Error code: CM-U04)');
    expect(withCode("We couldn't open x.pdf.", 'CM-U07', 'InvalidPDFException')).toBe("We couldn't open x.pdf. (Error code: CM-U07 InvalidPDFException)");
    expect(withCode('Plain.', null)).toBe('Plain.');
  });

  it.each([
    [{ status: 500, error: 'server_misconfigured' }, 'CM-S01'],
    [{ status: 401, error: 'bad_access_code' }, 'CM-S02'],
    [{ status: 504, error: 'timeout' }, 'CM-S03'],
    [{ status: 200, error: 'timeout' }, 'CM-S03'],
    [{ status: 422, error: 'case_blocked' }, 'CM-U06'],
    [{ status: 502, error: 'model_error' }, 'CM-S05'],
    [{ status: 200, error: 'refusal' }, 'CM-S05'],
    [{ status: 200, error: 'truncated' }, 'CM-S05'],
    [{ status: 0, error: 'network' }, 'CM-S05'],
    [{ status: 413, error: 'too_large' }, 'CM-S05'],
  ])('%j → %s', (failure, code) => {
    expect(codeForServerError(failure)).toBe(code);
  });

  it('maps function log outcomes to codes', () => {
    expect(codeForOutcome('ok')).toBeNull();
    expect(codeForOutcome(204)).toBeNull();
    expect(codeForOutcome('no_api_key')).toBe('CM-S01');
    expect(codeForOutcome(500)).toBe('CM-S01');
    expect(codeForOutcome(401)).toBe('CM-S02');
    expect(codeForOutcome('timeout')).toBe('CM-S03');
    expect(codeForOutcome('invalid')).toBe('CM-S04');
    expect(codeForOutcome(422)).toBe('CM-U06');
    expect(codeForOutcome('model_error')).toBe('CM-S05');
  });
});
