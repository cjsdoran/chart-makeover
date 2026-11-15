import { useEffect, useId, useRef, useState } from 'react';
import { config, limits } from '../../shared/limits.js';
import { withCode } from '../../shared/errorCodes.js';
import {
  STAGE_NAMES, activeUpload, applyReview, checklistState, chooseNameData, chooseRewriteLead, confirmFit,
  confirmReading, currentStage, moveOn, plannedPage, reopenStage, reviewRequest, sendDeclines, setComparison, submitLead,
} from '../engine/engine.js';
import { PlannedPage } from './Findings.jsx';
import { Waiting } from './Waiting.jsx';

/**
 * The input area under the chat (CM-7, spec §1): it changes with the step. `act(fn, ...args)` runs
 * an engine function on the session and returns its error, if any. `review(request, accessCode)`
 * makes the review call (canned in milestone 3).
 */
export function StageInput({ session, act, updateSession, review }) {
  const run = session.run;
  if (run.pending) return <ReviewRunner session={session} updateSession={updateSession} review={review} />;
  if (run.route) return <RouteChoice session={session} act={act} />;
  const stage = currentStage(session);
  if (session.step === 'lead') return <LeadBox session={session} act={act} updateSession={updateSession} />;
  if (session.step === 'data' && activeUpload(run) && !activeUpload(run).readingConfirmed) return <ReadingConfirm act={act} />;
  if (session.step === 'chart' && !run.comparison) return <ComparisonPicker act={act} />;
  if (session.step === 'fit') return <FitActions session={session} act={act} />;
  if (stage >= 2 && stage <= 4) return <ChecklistBar session={session} act={act} stage={stage} />;
  if (session.step === 'changes') return <Changes session={session} />;
  return null;
}

function ErrorLine({ error }) {
  return error ? <p className="form-error" role="alert"><strong>Error:</strong> {error}</p> : null;
}

function Counter({ id, value, max, min }) {
  const n = value.trim().length;
  const over = n > max;
  return (
    <p className={`counter${over ? ' over' : ''}`} id={id}>
      {n} / {max} characters{min ? ` (at least ${min})` : ''}{over ? ' (too long)' : ''}
    </p>
  );
}

/** Runs the pending review call; "Ask Daniel again" after a failure reruns only that call (T-CHAT-7). */
function ReviewRunner({ session, updateSession, review }) {
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const inFlight = useRef(null);
  const request = reviewRequest(session);
  const key = `${JSON.stringify(session.run.pending)}#${session.run.reviews.length}#${attempt}`;

  useEffect(() => {
    // One call per key: StrictMode's second effect run must not pay for a second model call.
    if (inFlight.current === key) return;
    inFlight.current = key;
    setError(null);
    const due = JSON.stringify(session.run.pending);
    review(request, session.setup?.accessCode).then((r) => {
      if (!r.ok) {
        setError({ message: withCode(r.message, r.code), retry: !r.final });
        return;
      }
      // Applied only if this call is still the one due (no stale reply after a reset).
      updateSession((s) => (JSON.stringify(s.run.pending) === due ? applyReview(s, r.result.data) : {}), { immediate: true });
    });
    // The key covers what the call depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const label = request.stage === 1 ? 'Daniel is reading your lead' : `Daniel is reviewing ${STAGE_NAMES[request.stage].toLowerCase()}`;
  if (!error) return <div className="composer"><Waiting label={label} /></div>;
  return (
    <div className="composer" role="alert">
      <p className="form-error"><strong>Error:</strong> {error.message}</p>
      {error.retry && (
        <div className="actions">
          <button type="button" className="btn secondary" onClick={() => setAttempt((a) => a + 1)}>Ask Daniel again</button>
        </div>
      )}
    </div>
  );
}

/** Stage 1's lead box (spec §4): required, 300 characters, "Round n of 5". */
function LeadBox({ session, act, updateSession }) {
  const run = session.run;
  const [error, setError] = useState(null);
  const id = useId();
  const text = session.draft?.lead ?? '';
  const round = run.leads.length + 1;
  const tooLong = text.trim().length > limits.leadMaxChars;
  const setText = (value) => updateSession((s) => ({ draft: { ...(s.draft ?? {}), lead: value } }));

  const send = (e) => {
    e.preventDefault();
    const err = act(submitLead, text);
    setError(err);
    if (!err) setText('');
  };
  return (
    <form className="composer" onSubmit={send} noValidate aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>Your lead</h2>
      <p className="hint">Round {round} of {run.stages[1].roundsAllowed}</p>
      <div className="field">
        <label htmlFor={`${id}-lead`}>The one thing you want them to remember</label>
        <textarea id={`${id}-lead`} rows={3} value={text} onChange={(e) => setText(e.target.value)}
          aria-invalid={tooLong ? 'true' : undefined} aria-describedby={`${id}-count`} />
        <Counter id={`${id}-count`} value={text} max={limits.leadMaxChars} />
      </div>
      <ErrorLine error={error} />
      <div className="actions"><button type="submit" className="btn" disabled={!text.trim() || tooLong}>Send to Daniel</button></div>
    </form>
  );
}

/** Stage 2 opens with Daniel's reading (CMS-12): Yes, or Correct it (300 characters). */
function ReadingConfirm({ act }) {
  const [correcting, setCorrecting] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState(null);
  const id = useId();
  if (!correcting) {
    return (
      <div className="composer" aria-label="Is Daniel's reading right?">
        <div className="actions">
          <button type="button" className="btn" onClick={() => setError(act(confirmReading, null))}>Yes</button>
          <button type="button" className="btn secondary" onClick={() => setCorrecting(true)}>Correct it</button>
        </div>
        <ErrorLine error={error} />
      </div>
    );
  }
  const tooLong = text.trim().length > limits.correctionMaxChars;
  return (
    <form className="composer" noValidate onSubmit={(e) => { e.preventDefault(); setError(act(confirmReading, text)); }}>
      <div className="field">
        <label htmlFor={`${id}-fix`}>What did Daniel get wrong?</label>
        <textarea id={`${id}-fix`} rows={2} value={text} onChange={(e) => setText(e.target.value)}
          aria-invalid={tooLong ? 'true' : undefined} aria-describedby={`${id}-count`} />
        <Counter id={`${id}-count`} value={text} max={limits.correctionMaxChars} />
      </div>
      <ErrorLine error={error} />
      <div className="actions">
        <button type="submit" className="btn" disabled={!text.trim() || tooLong}>Send the correction</button>
        <button type="button" className="btn secondary" onClick={() => setCorrecting(false)}>Back</button>
      </div>
    </form>
  );
}

/** Stage 3's comparison picker (CMS-13): six kinds or "Something else" with text; required. */
function ComparisonPicker({ act }) {
  const [choice, setChoice] = useState('');
  const [other, setOther] = useState('');
  const [error, setError] = useState(null);
  const id = useId();
  const send = (e) => {
    e.preventDefault();
    setError(choice ? act(setComparison, choice, other) : 'Choose a kind of comparison.');
  };
  return (
    <form className="composer" onSubmit={send} noValidate>
      <fieldset className="field">
        <legend>{config.openers.stage3}</legend>
        {[...config.comparisonOptions, 'other'].map((o) => (
          <div className="field checkbox" key={o}>
            <input type="radio" id={`${id}-${o}`} name={`${id}-cmp`} value={o} checked={choice === o} onChange={() => setChoice(o)} />
            <label htmlFor={`${id}-${o}`}>{o === 'other' ? 'Something else' : o}</label>
          </div>
        ))}
        {choice === 'other' && (
          <div className="field">
            <label htmlFor={`${id}-other-text`}>What kind of comparison?</label>
            <input type="text" id={`${id}-other-text`} value={other} onChange={(e) => setOther(e.target.value)} aria-describedby={`${id}-count`} />
            <Counter id={`${id}-count`} value={other} max={limits.comparisonMaxChars} />
          </div>
        )}
      </fieldset>
      <ErrorLine error={error} />
      <div className="actions"><button type="submit" className="btn">Send to Daniel</button></div>
    </form>
  );
}

/** Under the checklist: what's left to do, Send to Daniel (declines), or Move on at the cap. */
function ChecklistBar({ session, act, stage }) {
  const [error, setError] = useState(null);
  const state = checklistState(session.run, stage);
  return (
    <div className="composer" aria-label="Your fixes">
      {state === 'decide' && <p className="hint">Accept or decline each fix above. A decline needs a reason; Daniel will answer it.</p>}
      {state === 'send' && (
        <>
          <p className="hint">Daniel will answer your reasons for the fixes you declined.</p>
          <div className="actions"><button type="button" className="btn" onClick={() => setError(act(sendDeclines))}>Send to Daniel</button></div>
        </>
      )}
      {state === 'moveOn' && (
        <>
          <p className="hint">That was the last round for this stage. Your declined fixes stay open in the record.</p>
          <div className="actions"><button type="button" className="btn" onClick={() => setError(act(moveOn))}>Move on</button></div>
        </>
      )}
      <ErrorLine error={error} />
    </div>
  );
}

/** Routes back (CM-12, spec §5.6): Rewrite the lead, or Keep it and name the data. */
function RouteChoice({ session, act }) {
  const [naming, setNaming] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState(null);
  const id = useId();
  const options = session.run.route.options;
  if (!naming) {
    return (
      <div className="composer" aria-label="Choose a route">
        <p className="hint">The data doesn't prove the lead yet. Choose one:</p>
        <div className="actions">
          {options.includes('rewriteLead') && <button type="button" className="btn" onClick={() => setError(act(chooseRewriteLead))}>Rewrite the lead</button>}
          {options.includes('nameData') && <button type="button" className="btn secondary" onClick={() => setNaming(true)}>Keep it and name the data</button>}
        </div>
        <ErrorLine error={error} />
      </div>
    );
  }
  const tooLong = text.trim().length > limits.dataToSourceMaxChars;
  return (
    <form className="composer" noValidate onSubmit={(e) => { e.preventDefault(); setError(act(chooseNameData, text)); }}>
      <div className="field">
        <label htmlFor={`${id}-data`}>What data would prove your lead?</label>
        <p className="hint">It goes on the "data you must source" list, and the redraw shows illustrative values.</p>
        <textarea id={`${id}-data`} rows={2} value={text} onChange={(e) => setText(e.target.value)}
          aria-invalid={tooLong ? 'true' : undefined} aria-describedby={`${id}-count`} />
        <Counter id={`${id}-count`} value={text} max={limits.dataToSourceMaxChars} />
      </div>
      <ErrorLine error={error} />
      <div className="actions">
        <button type="submit" className="btn" disabled={!text.trim() || tooLong}>Keep the lead</button>
        <button type="button" className="btn secondary" onClick={() => setNaming(false)}>Back</button>
      </div>
    </form>
  );
}

/** Stage 5 (spec §5.7): confirm the page, or reopen one of Stages 1–4 once. */
function FitActions({ session, act }) {
  const run = session.run;
  const suggested = run.reviews.filter((r) => r.stage === 5).at(-1)?.reopenStage ?? '';
  const [stage, setStage] = useState(String(suggested || ''));
  const [error, setError] = useState(null);
  const id = useId();
  return (
    <div className="composer" aria-label="Fit check">
      <div className="actions">
        <button type="button" className="btn" onClick={() => setError(act(confirmFit))}>The page works: confirm it</button>
      </div>
      {run.reopensLeft > 0 && (
        <form className="field" noValidate onSubmit={(e) => { e.preventDefault(); setError(stage ? act(reopenStage, Number(stage)) : 'Choose a stage to reopen.'); }}>
          <label htmlFor={`${id}-stage`}>Or reopen one stage (once)</label>
          <select id={`${id}-stage`} value={stage} onChange={(e) => setStage(e.target.value)}>
            <option value="">Choose a stage</option>
            {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n} {STAGE_NAMES[n]}</option>)}
          </select>
          <div className="actions"><button type="submit" className="btn secondary">Reopen this stage</button></div>
        </form>
      )}
      <ErrorLine error={error} />
    </div>
  );
}

/** Make these changes arrives in milestone 6; until then the planned page is shown here. */
function Changes({ session }) {
  return (
    <div className="composer">
      <p className="notice" role="status">Make these changes (the redrawn .pptx) and the record arrive in later builds (milestones 6–7).</p>
      <PlannedPage page={plannedPage(session.run)} />
    </div>
  );
}
