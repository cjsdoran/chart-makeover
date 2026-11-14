import { config } from '../../shared/limits.js';
import { formatTime } from '../time.js';

/** The chat thread (CM-7): Daniel's messages on the left, the student's turns on the right. */
export function ChatView({ messages }) {
  return (
    <ol className="chat" aria-label="Conversation with Daniel">
      {messages.map((m) => (
        <li key={m.id} className={`msg ${m.from}`}>
          <span className="who">
            {m.from === 'daniel' ? config.em.name : 'You'}
            {m.at && <span className="when"> · <span className="mono">{formatTime(m.at)}</span></span>}
          </span>
          {m.files?.length > 0 && (
            <p>Attached: {m.files.map((f, i) => <span key={f}>{i ? ' and ' : ''}<span className="file">{f}</span></span>)}</p>
          )}
          {m.text && <p>{m.text}</p>}
        </li>
      ))}
    </ol>
  );
}
