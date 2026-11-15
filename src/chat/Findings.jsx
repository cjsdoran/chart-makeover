import { useId, useState } from 'react';
import { config, limits } from '../../shared/limits.js';
import { STAGE_NAMES, acceptAllMinor, acceptFinding, currentStage, declineFinding, finalChoice, isBlocking } from '../engine/engine.js';

// Severity in words, never colour alone (CM-7, T-CHAT-1).
export const SEVERITY_WORDS = { hardStop: 'Hard stop', major: 'Major', minor: 'Minor', suggestion: 'Suggestion' };

const STATUS_WORDS = {
  open: null,
  accepted: '✓ Accepted: this goes into the redraw.',
  declined: '✗ Declined',
  pushedBack: '? Daniel pushed back',
  closed: '✓ Closed',
  superseded: '– Replaced by a later review',
};

function RuleChips({ rules }) {
  return <span className="rules">{rules.map((r) => <span key={r} className="rule mono">{r}</span>)}</span>;
}

/** Stage 1's findings: a compact list (rule, severity word, the issue), no accept or decline (Q11). */
export function CompactFindings({ findings }) {
  if (!findings.length) return null;
  return (
    <ul className="findings compact" aria-label="What Daniel found">
      {findings.map((f) => (
        <li key={f.id}>
          <RuleChips rules={f.rules} /> <strong>{SEVERITY_WORDS[f.severity]}</strong>: {f.issue}
        </li>
      ))}
    </ul>
  );
}

/** One fix on the checklist (spec §5.2, §5.5): Accept, or Decline with a reason; the push-back choice. */
export function FindingCard({ finding: f, session, act, live }) {
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState(f.reason ?? '');
  const [error, setError] = useState(null);
  const ids = useId();
  const blocking = isBlocking(f);
  const editable = live && (f.status === 'open' || f.status === 'accepted' || (f.status === 'declined' && !f.sent));
  const status = f.status === 'declined' && f.sent ? 'declined' : f.status;

  const run = (fn, ...args) => {
    const err = act(fn, ...args);
    setError(err);
    return err;
  };
  const saveDecline = (e) => {
    e.preventDefault();
    if (!run(declineFinding, f.id, reason)) setDeclining(false);
  };

  return (
    <article className={`finding ${blocking ? 'blocking' : 'minor'}`} aria-label={`${SEVERITY_WORDS[f.severity]} fix: ${f.location}`}>
      <p className="finding-head">
        <strong>{SEVERITY_WORDS[f.severity]}</strong> <RuleChips rules={f.rules} /> <span className="where">{f.location}</span>
      </p>
      <p>{f.issue}</p>
      <p><strong>Fix:</strong> {f.fix}</p>
      {f.resolution === 'nameData'
        ? <p className="finding-status">✓ Closed: you kept the lead and will source the data (“{f.dataToSource}”).</p>
        : STATUS_WORDS[status] && <p className="finding-status">{STATUS_WORDS[status]}{f.reason && status !== 'accepted' ? `: “${f.reason}”` : ''}</p>}
      {f.pushBack && <p className="daniel-reply"><strong>{config.em.name}:</strong> {f.pushBack}</p>}
      {f.reply && <p className="daniel-reply"><strong>{config.em.name}:</strong> {f.reply}</p>}
      {f.finalChoice && <p className="finding-status">{f.finalChoice === 'keep' ? 'You kept your choice.' : 'You accepted the fix.'}</p>}

      {live && f.status === 'pushedBack' && (
        <div className="actions">
          <button type="button" className="btn small" onClick={() => run(finalChoice, f.id, 'acceptFix')}>Accept the fix</button>
          <button type="button" className="btn small secondary" onClick={() => run(finalChoice, f.id, 'keep')}>Keep my choice</button>
        </div>
      )}

      {editable && !declining && (
        <div className="actions">
          {f.status !== 'accepted' && <button type="button" className="btn small" onClick={() => run(acceptFinding, f.id)}>Accept</button>}
          {blocking && <button type="button" className="btn small secondary" onClick={() => setDeclining(true)}>{f.status === 'declined' ? 'Change reason' : 'Decline'}</button>}
        </div>
      )}

      {declining && (
        <form className="field" onSubmit={saveDecline} noValidate>
          <label htmlFor={`${ids}-reason`}>Why are you keeping it as it is?</label>
          <textarea id={`${ids}-reason`} rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
            aria-describedby={`${ids}-count`} />
          <p className="counter" id={`${ids}-count`}>{reason.trim().length} / {limits.declineReasonMaxChars} characters (at least {config.caps.declineReasonMinChars})</p>
          <div className="actions">
            <button type="submit" className="btn small">Decline this fix</button>
            <button type="button" className="btn small secondary" onClick={() => { setDeclining(false); setError(null); }}>Cancel</button>
          </div>
        </form>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
    </article>
  );
}

/** A review's fixes (Stages 2–5): blocking ones as cards, minors collapsed with Accept all (Q9). */
export function Checklist({ findings, session, act, stage, live }) {
  const blocking = findings.filter(isBlocking);
  const minors = findings.filter((f) => !isBlocking(f));
  const openMinors = minors.filter((f) => f.status === 'open');
  const [error, setError] = useState(null);
  if (!findings.length) return null;
  return (
    <div className="checklist" aria-label={`Fixes for ${STAGE_NAMES[stage]}`}>
      {blocking.map((f) => <FindingCard key={f.id} finding={f} session={session} act={act} live={live} />)}
      {minors.length > 0 && (
        <details className="minors">
          <summary>Minor fixes ({minors.length}){openMinors.length ? `, ${openMinors.length} not yet accepted` : ''}</summary>
          {live && openMinors.length > 0 && (
            <div className="actions">
              <button type="button" className="btn small" onClick={() => setError(act(acceptAllMinor, stage))}>Accept all minor fixes</button>
            </div>
          )}
          {error && <p className="form-error" role="alert">{error}</p>}
          {minors.map((f) => <FindingCard key={f.id} finding={f} session={session} act={act} live={live} />)}
        </details>
      )}
    </div>
  );
}

/** The planned page (CMS-14): the agreed lead, the accepted fixes in stage order, declines, data to source. */
export function PlannedPage({ page }) {
  return (
    <section className="planned" aria-label="The planned page">
      <h3>The planned page</h3>
      <p><strong>Lead:</strong> {page.lead ?? '(no lead agreed)'}</p>
      <h4>Fixes you accepted</h4>
      {page.acceptedFixes.length ? (
        <ol>{page.acceptedFixes.map((f, i) => <li key={i}><span className="mono">{STAGE_NAMES[f.stage]}</span> · <RuleChips rules={f.rules} /> {f.fix}</li>)}</ol>
      ) : <p>None.</p>}
      {page.declinedFixes.length > 0 && (
        <>
          <h4>Fixes you declined</h4>
          <ol>{page.declinedFixes.map((f, i) => <li key={i}><RuleChips rules={f.rules} /> {f.fix} <em>Your reason: “{f.reason}”</em></li>)}</ol>
        </>
      )}
      {page.dataToSource.length > 0 && (
        <>
          <h4>Data you must source</h4>
          <ul>{page.dataToSource.map((d) => <li key={d}>{d}</li>)}</ul>
        </>
      )}
    </section>
  );
}

/** What goes under one of Daniel's review messages. */
export function ReviewAttachments({ message, session, act, onUseOffer }) {
  const run = session.run;
  const review = run.reviews[message.review];
  if (!review) return null;
  const findings = review.findingIds.map((id) => ({ id, ...run.findings[id] }));
  const live = currentStage(session) === review.stage && !run.pending && run.stages[review.stage].status === 'open';
  const latestStage1 = run.reviews.filter((r) => r.stage === 1).at(-1) === review;
  const offerUsable = review.offeredLead && latestStage1 && session.step === 'lead' && run.stages[1].status === 'open';
  return (
    <>
      {review.stage === 1
        ? <CompactFindings findings={findings} />
        : <Checklist findings={findings} session={session} act={act} stage={review.stage} live={live} />}
      {review.offeredLead && (
        <figure className="offer">
          <blockquote><p>{review.offeredLead}</p></blockquote>
          <figcaption>One stronger version, from your own words. You still write the final lead.</figcaption>
          {offerUsable && (
            <div className="actions">
              <button type="button" className="btn small secondary" onClick={() => onUseOffer(review.offeredLead)}>Use this as a starting point</button>
            </div>
          )}
        </figure>
      )}
      {review.reopenStage && session.step === 'fit' && run.reopensLeft > 0 && (
        <p className="hint">Daniel suggests reopening {STAGE_NAMES[review.reopenStage]}.</p>
      )}
    </>
  );
}
