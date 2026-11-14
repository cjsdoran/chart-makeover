import { STAGES, stageStatuses } from '../stages.js';

const ICONS = { passed: '✓', current: '●', movedOn: '→', toDo: '○' };
const WORDS = { passed: 'passed', current: 'current', movedOn: 'moved on', toDo: 'to do' };

/** The stage tracker (CM-7): each stage's status in words and an icon, never colour alone. */
export function StageTracker({ session }) {
  const statuses = stageStatuses(session);
  return (
    <nav aria-label="Stages">
      <ol className="tracker">
        {STAGES.map((stage) => {
          const status = statuses[stage.id];
          return (
            <li key={stage.id} aria-current={status === 'current' ? 'step' : undefined}>
              <span className="icon" aria-hidden="true">{ICONS[status]}</span>
              <span className="name">{stage.label}</span>
              <span className="state">({WORDS[status]})</span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
