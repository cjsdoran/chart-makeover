import { useEffect, useId, useRef, useState } from 'react';
import { config, limits } from '../../shared/limits.js';
import { withCode } from '../../shared/errorCodes.js';
import {
  STAGE_NAMES, applyRedraw, buildAgain, changeChoice, changeableFindings, isBlocking, plannedPage, redrawRequest, startChangingChoices,
} from '../engine/engine.js';
import { redrawFileName, recordFileName } from '../redraw/fileName.js';
import { PlannedPage } from './Findings.jsx';
import { planInTwoCalls } from '../redraw/twoCalls.js';
import { Waiting } from './Waiting.jsx';

const SEVERITY_WORDS = { hardStop: 'Hard stop', major: 'Major', minor: 'Minor', suggestion: 'Suggestion' };

/**
 * Make these changes (CM-8, spec §9): build the slide, download it, change choices and build again;
 * then the record (CM-9) and a new run (CMS-15). `redraw` holds the browser functions
 * (src/redraw/browser.js; tests pass fakes).
 */
export function Changes({ session, act, updateSession, redraw, onNewRun }) {
  const run = session.run;
  const [planning, setPlanning] = useState(false);
  const [error, setError] = useState(null);
  const latest = run.redraws.at(-1) ?? null;
  const ended = Boolean(session.endedAt);

  // The chart from the first of the two calls, kept so a retry repeats only the second (D80).
  const plannedChart = useRef(null);

  async function plan({ retry = false } = {}) {
    if (!retry) plannedChart.current = null;
    setPlanning(true);
    setError(null);
    const call = (body) => redraw.plan(body, session.setup?.accessCode);
    const r = await planInTwoCalls(redrawRequest(session), call, { chart: plannedChart.current });
    setPlanning(false);
    plannedChart.current = r.ok ? null : r.chart;
    if (!r.ok) {
      setError({ message: withCode(r.message, r.code), retry: !r.final });
      return;
    }
    updateSession((s) => {
      const fileName = redrawFileName(s, s.run.redraws.length + 1);
      const out = applyRedraw(s, { spec: r.result.spec, promptVersion: r.result.promptVersion, servedBy: r.result.servedBy }, { fileName });
      return out.error ? {} : out.session;
    }, { immediate: true });
  }

  if (planning) return <div className="composer"><Waiting label="Daniel is building your slide" /></div>;

  return (
    <div className="composer">
      {error && (
        <div role="alert">
          <p className="form-error"><strong>Error:</strong> {error.message}</p>
          {error.retry && <div className="actions"><button type="button" className="btn secondary" onClick={() => plan({ retry: true })}>Ask Daniel again</button></div>}
        </div>
      )}

      {!ended && !run.notRedrawable && !latest && !error && (
        <>
          <h2>Make these changes</h2>
          <p className="hint">Daniel builds one editable PowerPoint slide from your lead and the fixes you accepted, with illustrative values.</p>
          <div className="actions"><button type="button" className="btn" onClick={() => plan()}>Make these changes</button></div>
        </>
      )}

      {!ended && run.editingChoices && <ChoiceEditor session={session} act={act} onBuild={() => { if (!act(buildAgain)) plan(); }} />}

      {!ended && latest && !run.editingChoices && (
        <div className="actions">
          <button type="button" className="btn secondary" onClick={() => act(startChangingChoices)}>Change my choices</button>
        </div>
      )}

      {(latest || run.notRedrawable) && !run.editingChoices && (
        <RecordPanel session={session} updateSession={updateSession} redraw={redraw} onNewRun={onNewRun} />
      )}
    </div>
  );
}

/** Builds a version's .pptx in the browser and saves it. */
export function DownloadButton({ version, session, redraw, label }) {
  const [state, setState] = useState({ busy: false, error: null });
  async function go() {
    setState({ busy: true, error: null });
    try {
      await redraw.download(version, session);
      setState({ busy: false, error: null });
    } catch {
      setState({ busy: false, error: "We couldn't build the slide. Try again, or try another browser." });
    }
  }
  return (
    <>
      <button type="button" className="btn" onClick={go} disabled={state.busy}>
        {state.busy ? 'Building your slide…' : label ?? `Download the slide (.pptx)`}
      </button>
      {state.error && <p className="form-error" role="alert">{state.error}</p>}
    </>
  );
}

/** Change my choices: accept or decline each fix again (no new review), then Build again. */
function ChoiceEditor({ session, act, onBuild }) {
  const findings = changeableFindings(session.run);
  const [error, setError] = useState(null);
  return (
    <section aria-label="Change your choices">
      <h2>Change your choices</h2>
      <p className="hint">Accept or decline each fix. Daniel builds the slide again from your new choices; he doesn&rsquo;t review them again.</p>
      <ul className="choice-list">
        {findings.map((f) => <ChoiceRow key={f.id} finding={f} act={act} />)}
      </ul>
      <PlannedPage page={plannedPage(session.run)} />
      <div className="actions">
        <button type="button" className="btn" onClick={() => setError(onBuild())}>Build again</button>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
    </section>
  );
}

function ChoiceRow({ finding: f, act }) {
  const ids = useId();
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState(f.reason ?? '');
  const [error, setError] = useState(null);
  const accepted = f.status === 'accepted';
  const run = (...args) => {
    const err = act(changeChoice, f.id, ...args);
    setError(err);
    return err;
  };
  return (
    <li className={`finding ${isBlocking(f) ? 'blocking' : 'minor'}`}>
      <p className="finding-head"><strong>{SEVERITY_WORDS[f.severity]}</strong> <span className="mono">{STAGE_NAMES[f.stage]}</span> <span className="where">{f.location}</span></p>
      <p><strong>Fix:</strong> {f.fix}</p>
      <p className="finding-status">{accepted ? '✓ In the slide' : `✗ Not in the slide${f.reason ? `: “${f.reason}”` : ''}`}</p>
      {!declining && (
        <div className="actions">
          {!accepted && <button type="button" className="btn small" onClick={() => run('accept')}>Accept</button>}
          {accepted && (isBlocking(f)
            ? <button type="button" className="btn small secondary" onClick={() => setDeclining(true)}>Decline</button>
            : <button type="button" className="btn small secondary" onClick={() => run('decline')}>Leave it out</button>)}
        </div>
      )}
      {declining && (
        <form className="field" noValidate onSubmit={(e) => { e.preventDefault(); if (!run('decline', reason)) setDeclining(false); }}>
          <label htmlFor={`${ids}-reason`}>Why are you keeping it as it is?</label>
          <textarea id={`${ids}-reason`} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} aria-describedby={`${ids}-count`} />
          <p className="counter" id={`${ids}-count`}>{reason.trim().length} / {limits.declineReasonMaxChars} characters (at least {config.caps.declineReasonMinChars})</p>
          <div className="actions">
            <button type="submit" className="btn small">Decline this fix</button>
            <button type="button" className="btn small secondary" onClick={() => setDeclining(false)}>Cancel</button>
          </div>
        </form>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
    </li>
  );
}

/** The record (CM-9, CMS-15): downloading it ends the run; then a new run, after a confirm. */
function RecordPanel({ session, updateSession, redraw, onNewRun }) {
  const [state, setState] = useState({ busy: false, error: null, done: null });
  const [confirmNewRun, setConfirmNewRun] = useState(false);
  async function download() {
    setState({ busy: true, error: null, done: null });
    try {
      const result = await redraw.record(session);
      updateSession((s) => ({ endedAt: s.endedAt ?? new Date().toISOString() }), { immediate: true });
      setState({ busy: false, error: null, done: result });
    } catch {
      setState({ busy: false, error: "We couldn't make the PDF. Try again, or try another browser.", done: null });
    }
  }
  return (
    <section className="panel record-panel" aria-labelledby="record-heading">
      <h2 id="record-heading">Your record</h2>
      <p>
        The record holds your chart, every lead draft, Daniel&rsquo;s messages, your decisions on each fix and the slide
        {session.run.redraws.length > 1 ? 's' : ''} he built. Nothing is kept on our servers: this PDF is the only lasting copy.
        Downloading it ends this run.
      </p>
      <p className="mono">{recordFileName(session)}</p>
      <div className="actions">
        <button type="button" className="btn" onClick={download} disabled={state.busy}>
          {state.busy ? 'Making your PDF…' : 'Download the record (PDF)'}
        </button>
      </div>
      <p role="status" aria-live="polite" className="status">{state.done ? `Downloaded ${state.done.fileName} (${state.done.pageCount} pages).` : ''}</p>
      {state.done?.replacedCharacters > 0 && (
        <p className="field-warning"><strong>Note:</strong> some characters, such as Chinese names, can&rsquo;t be printed in the PDF and appear as &ldquo;?&rdquo;.</p>
      )}
      {state.error && <p className="form-error" role="alert"><strong>Error:</strong> {state.error}</p>}
      {session.endedAt && (
        <>
          <p className="notice">This run has ended. Start a new run to work on another chart.</p>
          {!confirmNewRun ? (
            <div className="actions"><button type="button" className="btn secondary" onClick={() => setConfirmNewRun(true)}>Start a new run (another chart)</button></div>
          ) : (
            <div role="group" aria-labelledby="confirm-new-run">
              <p id="confirm-new-run"><strong>Start a new run?</strong> This run is deleted from this browser; your setup details are kept. Keep the record you downloaded.</p>
              <div className="actions">
                <button type="button" className="btn" onClick={onNewRun}>Yes, start a new run</button>
                <button type="button" className="btn secondary" onClick={() => setConfirmNewRun(false)}>Cancel</button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** Under Daniel's "Here's the slide" message: the preview and that version's download. */
export function RedrawCard({ session, index, redraw }) {
  const version = session.run.redraws[index];
  const [src, setSrc] = useState(null);
  const [failed, setFailed] = useState(false);
  const drawn = useRef(null);
  useEffect(() => {
    if (!version || drawn.current === version.at || !redraw?.preview) return;
    drawn.current = version.at;
    redraw.preview(version.spec).then(setSrc, () => setFailed(true));
  }, [version, redraw]);
  if (!version) return null;
  return (
    <figure className="redraw">
      {src
        ? <img src={src} alt={`Preview of version ${version.version} of the slide: ${version.spec.title}`} />
        : <p className="hint">{failed ? 'The preview could not be drawn; the slide itself is not affected.' : 'Drawing the preview…'}</p>}
      <figcaption>
        Preview of the content, not a render of the .pptx. Version {version.version}: {version.acceptedFixes.length} accepted fix{version.acceptedFixes.length === 1 ? '' : 'es'} applied.
      </figcaption>
      {!session.endedAt && <div className="actions"><DownloadButton version={version} session={session} redraw={redraw} label={`Download version ${version.version} (.pptx)`} /></div>}
    </figure>
  );
}
