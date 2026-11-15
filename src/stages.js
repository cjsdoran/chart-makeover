// The stages on the tracker (CM-7, spec §1): to do, current, passed or moved on (cap reached).
import { trackerStatus } from './engine/engine.js';

export const STAGES = [
  { id: 'setup', label: 'Set-up' },
  { id: 'lead', label: 'Lead', n: 1 },
  { id: 'data', label: 'Data fit', n: 2 },
  { id: 'chart', label: 'Chart choice', n: 3 },
  { id: 'polish', label: 'Polish', n: 4 },
  { id: 'fit', label: 'Fit check', n: 5 },
  { id: 'changes', label: 'Changes' },
];

/** @returns {Record<string, 'passed'|'current'|'movedOn'|'toDo'>} */
export function stageStatuses(session) {
  const step = session?.step ?? 'setup';
  const inSetup = step === 'setup' || (step === 'upload' && !(session?.run?.uploads?.length));
  const atEnd = step === 'changes' || step === 'record';
  return Object.fromEntries(STAGES.map((s) => {
    if (s.id === 'setup') return [s.id, inSetup ? 'current' : 'passed'];
    if (s.id === 'changes') return [s.id, atEnd ? 'current' : 'toDo'];
    if (!session?.run?.stages) return [s.id, 'toDo'];
    return [s.id, trackerStatus(session, s.n)];
  }));
}
