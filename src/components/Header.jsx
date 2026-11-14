import { config } from '../../shared/limits.js';

export function Header({ session }) {
  const caseName = session?.setup?.caseName;
  const name = session?.setup?.name;
  return (
    <header className="app-header">
      <ul className="crumbs" aria-label="Engagement">
        <li className="firm">{config.firm}</li>
        <li>{config.appName}</li>
        {caseName && <li>{caseName}</li>}
        {name && <li>{name}</li>}
      </ul>
      {session && (
        <span className="attempt mono">
          Attempt <span data-testid="attempt-id">{session.attemptId}</span>
        </span>
      )}
    </header>
  );
}
