// File names (spec §9.2, §13): MGMT5760_<Case>_ChartMakeover_<StudentID>_<AttemptID>…, with
// characters outside A–Z, a–z, 0–9, _ and - stripped.
import { config } from '../../shared/limits.js';

const clean = (s) => String(s ?? '').replace(/[^A-Za-z0-9_-]/g, '');

function fill(template, session) {
  return template
    .replace('{case}', clean(session.setup?.caseName))
    .replace('{studentId}', clean(session.setup?.studentId))
    .replace('{attemptId}', clean(session.attemptId));
}

/** The redrawn slide's file name; a rebuilt version adds _v2, _v3… before "_illustrative". */
export function redrawFileName(session, version = 1) {
  const name = fill(config.redraw.fileName, session);
  return version > 1 ? name.replace(/_illustrative\.pptx$/, `_v${version}_illustrative.pptx`) : name;
}

export function recordFileName(session) {
  return fill(config.record.fileName, session);
}
