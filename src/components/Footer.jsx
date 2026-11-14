import { footerText } from '../../shared/limits.js';

export function Footer() {
  return (
    <footer className="app-footer">
      <p>{footerText()}</p>
    </footer>
  );
}
