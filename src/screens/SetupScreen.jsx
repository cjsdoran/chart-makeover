import { useState } from 'react';
import { config, limits } from '../../shared/limits.js';
import { checkAccessCode } from '../api.js';
import { withCode } from '../../shared/errorCodes.js';
import { cleanSetup, emptySetup, validateSetup } from '../setup/validate.js';
import { ErrorSummary, FieldError } from '../components/FormErrors.jsx';
import { openingMessage } from '../store/session.js';

// Step 1 (CMS-1, spec §2): one student. The access code is checked at once by /api/check.
export function SetupScreen({ session, updateSession, check = checkAccessCode }) {
  const [values, setValues] = useState(() => ({ ...emptySetup(), ...session.setup }));
  const [submitted, setSubmitted] = useState(false);
  const [checking, setChecking] = useState(false);
  const [serverError, setServerError] = useState(null);

  const { errors } = validateSetup(values);
  const shown = submitted ? errors : [];
  const errorFor = (field) => shown.find((e) => e.field === field)?.message;

  function change(next) {
    setValues(next);
    updateSession({ setup: next });
  }
  const set = (key) => (e) => change({ ...values, [key]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setSubmitted(true);
    setServerError(null);
    if (errors.length) return;
    const clean = cleanSetup(values);
    setChecking(true);
    const result = await check(clean.accessCode);
    setChecking(false);
    if (!result.ok) {
      setServerError({ field: result.status === 401 ? 'setup-accessCode' : null, message: withCode(result.message, result.code) });
      return;
    }
    updateSession((s) => ({
      setup: { ...clean, completedAt: new Date().toISOString() },
      step: 'upload',
      chat: s.chat.length ? s.chat : [openingMessage()],
    }), { immediate: true });
  }

  const accessError = errorFor('setup-accessCode') ?? (serverError?.field === 'setup-accessCode' ? serverError.message : null);

  return (
    <form className="step-form" onSubmit={submit} noValidate aria-labelledby="setup-heading">
      <h2 id="setup-heading">Set up</h2>
      <p>
        Work on one chart you have made, with {config.em.name}, an engagement manager at {config.firm}. Your name and
        student ID go on the record you download at the end.
      </p>

      <ErrorSummary errors={shown} />
      {serverError && !serverError.field && (
        <p className="form-error" role="alert"><strong>Error:</strong> {serverError.message}</p>
      )}

      <div className="field">
        <label htmlFor="setup-accessCode">Access code</label>
        <p className="hint" id="setup-accessCode-hint">From the Chart Makeover page on Canvas.</p>
        <input id="setup-accessCode" type="text" autoComplete="off" spellCheck="false" className="mono-input"
          value={values.accessCode} onChange={set('accessCode')}
          aria-invalid={accessError ? 'true' : undefined}
          aria-describedby={`setup-accessCode-hint${accessError ? ' setup-accessCode-error' : ''}`} />
        <FieldError id="setup-accessCode-error" message={accessError} />
      </div>

      <TextField id="setup-name" label="Your name" max={limits.nameMaxChars}
        hint="In English letters, as on Canvas, so it prints on the record."
        value={values.name} onChange={set('name')} error={errorFor('setup-name')} />
      <TextField id="setup-studentId" label="Student ID" max={limits.studentIdMaxChars} mono
        value={values.studentId} onChange={set('studentId')} error={errorFor('setup-studentId')} />
      <TextField id="setup-team" label="Team (optional)" max={limits.teamMaxChars}
        value={values.team} onChange={set('team')} error={errorFor('setup-team')} />
      <TextField id="setup-caseName" label="Case or project name" max={limits.caseMaxChars}
        hint="It goes in the file names of your redrawn slide and your record."
        value={values.caseName} onChange={set('caseName')} error={errorFor('setup-caseName')} />

      <p className="hint">Course: {config.course}</p>

      <div className="actions">
        <button type="submit" className="btn" disabled={checking}>
          {checking ? 'Checking access code…' : 'Continue to Daniel'}
        </button>
      </div>
    </form>
  );
}

function TextField({ id, label, hint, max, mono = false, value, onChange, error }) {
  const length = value.trim().length;
  const over = length > max;
  const describedBy = [hint && `${id}-hint`, `${id}-count`, error && `${id}-error`].filter(Boolean).join(' ');
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {hint && <p className="hint" id={`${id}-hint`}>{hint}</p>}
      <input id={id} type="text" autoComplete="off" className={mono ? 'mono-input' : undefined} value={value} onChange={onChange}
        aria-invalid={error ? 'true' : undefined} aria-describedby={describedBy} />
      <p className={`counter${over ? ' over' : ''}`} id={`${id}-count`}>
        {length} / {max} characters{over ? ' (too long)' : ''}
      </p>
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}
