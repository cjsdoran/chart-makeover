import { useCallback, useEffect, useRef, useState } from 'react';
import { Header } from './components/Header.jsx';
import { Footer } from './components/Footer.jsx';
import { StageTracker } from './components/StageTracker.jsx';
import { ResumePrompt } from './components/ResumePrompt.jsx';
import { StorageWarning } from './components/StorageWarning.jsx';
import { SetupScreen } from './screens/SetupScreen.jsx';
import { ChatView } from './chat/ChatView.jsx';
import { UploadCard } from './chat/UploadCard.jsx';
import { StageInput } from './chat/StageInput.jsx';
import { askDaniel } from './daniel/askDaniel.js';

// Every stage review goes to /api/review (milestone 5). Tests pass their own review (canned.js).
const defaultReview = (request, accessCode) => askDaniel('/api/review', request, accessCode);
import { clearSaved, createAutosaver, createSession, defaultStorage, loadSaved, newRunFrom, saveSession } from './store/session.js';

export const OUTDATED_NOTICE =
  "Chart Makeover has been updated since your last visit, so your earlier attempt in this browser can't be resumed. Start again.";

function initialState(storage) {
  const { session, ok, outdated } = loadSaved(storage);
  if (session) return { phase: 'resume', saved: session, session: null, storageOk: ok };
  // A session from another version is deleted, with a notice; a fresh run starts.
  if (outdated) clearSaved(storage);
  const fresh = createSession();
  return { phase: 'active', saved: null, session: fresh, storageOk: saveSession(fresh, storage), outdated: Boolean(outdated) };
}

/**
 * The app shell (CM-7, spec §1): header, stage tracker, then the setup form or the chat with the
 * input for the current step. `screens` lets the tests replace the access-code check, the upload
 * preparation and the model calls.
 */
export default function App({ storage = defaultStorage(), screens = {} }) {
  const [state, setState] = useState(() => initialState(storage));

  const autosaver = useRef(null);
  if (!autosaver.current) {
    autosaver.current = createAutosaver({
      storage,
      onResult: (ok) => setState((s) => (s.storageOk === ok ? s : { ...s, storageOk: ok })),
    });
  }
  useEffect(() => () => autosaver.current.cancel(), []);

  // `patch` is an object or a function of the latest session. Edits save after a 1 s pause;
  // steps, sends and readings save at once.
  const updateSession = useCallback((patch, { immediate = false } = {}) => {
    setState((s) => {
      const changes = typeof patch === 'function' ? patch(s.session) : patch;
      const session = { ...s.session, ...changes, updatedAt: new Date().toISOString() };
      if (immediate) autosaver.current.flush(session);
      else autosaver.current.schedule(session);
      return { ...s, session };
    });
  }, []);

  const resume = () => setState((s) => ({ ...s, phase: 'active', session: s.saved, saved: null }));
  const replaceSession = (fresh) => {
    autosaver.current.cancel();
    clearSaved(storage);
    const ok = saveSession(fresh, storage);
    setState({ phase: 'active', saved: null, session: fresh, storageOk: ok });
  };
  const startAgain = () => replaceSession(createSession());
  const newRun = () => replaceSession(newRunFrom(state.session));

  const { phase, session, saved, storageOk, outdated } = state;

  return (
    <div className="app">
      <Header session={session} />
      {!storageOk && <StorageWarning />}
      {outdated && <p className="notice" role="status" aria-label="Update notice">{OUTDATED_NOTICE}</p>}
      {phase === 'resume' ? (
        <main className="pane">
          <ResumePrompt saved={saved} onResume={resume} onStartAgain={startAgain} />
        </main>
      ) : (
        <>
          <StageTracker session={session} />
          <main className="pane">
            <StepScreen session={session} updateSession={updateSession} screens={screens} onNewRun={newRun} />
          </main>
        </>
      )}
      <Footer />
    </div>
  );
}

function StepScreen({ session, updateSession, screens }) {
  if (session.step === 'setup') return <SetupScreen session={session} updateSession={updateSession} check={screens.check} />;
  // Runs an engine function (src/engine/engine.js) on the session; returns its error, if any.
  const act = (fn, ...args) => {
    const r = fn(session, ...args);
    if (r.error) return r.error;
    updateSession(() => r.session, { immediate: true });
    return null;
  };
  const useOffer = (text) => updateSession((s) => ({ draft: { ...(s.draft ?? {}), lead: text } }));
  const review = screens.review ?? defaultReview;
  return (
    <section aria-label="Chat">
      <ChatView messages={session.chat} session={session} act={act} onUseOffer={useOffer} />
      {session.step === 'upload'
        ? <UploadCard session={session} updateSession={updateSession} deps={screens.upload} />
        : <StageInput session={session} act={act} updateSession={updateSession} review={review} />}
    </section>
  );
}
