import { config } from '../../shared/limits.js';
import { formatTime } from '../time.js';
import { PlannedPage, ReviewAttachments } from './Findings.jsx';

/**
 * The chat thread (CM-7): Daniel's messages on the left, the student's turns on the right, and the
 * fix checklists as cards under the message that raised them. `session` and `act` are needed only
 * for the stage messages; the set-up chat renders with `messages` alone.
 */
export function ChatView({ messages, session, act, onUseOffer }) {
  return (
    <ol className="chat" aria-label="Conversation with Daniel">
      {messages.map((m) => (
        <li key={m.id} className={`msg ${m.from}${m.kind === 'review' || m.kind === 'plannedPage' ? ' wide' : ''}`}>
          <span className="who">
            {m.from === 'daniel' ? config.em.name : 'You'}
            {m.at && <span className="when"> · <span className="mono">{formatTime(m.at)}</span></span>}
          </span>
          {m.files?.length > 0 && (
            <p>Attached: {m.files.map((f, i) => <span key={f}>{i ? ' and ' : ''}<span className="file">{f}</span></span>)}</p>
          )}
          {m.text && m.text.split('\n').map((line, i) => <p key={i}>{line}</p>)}
          {m.kind === 'review' && session && <ReviewAttachments message={m} session={session} act={act} onUseOffer={onUseOffer} />}
          {m.kind === 'plannedPage' && <PlannedPage page={m.page} />}
        </li>
      ))}
    </ol>
  );
}
