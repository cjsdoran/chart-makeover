// The stages on the tracker (CM-7, spec §1). Milestone 3's engine adds "moved on" (cap reached).
export const STAGES = [
  { id: 'setup', label: 'Set-up' },
  { id: 'lead', label: 'Lead' },
  { id: 'data', label: 'Data fit' },
  { id: 'chart', label: 'Chart choice' },
  { id: 'polish', label: 'Polish' },
  { id: 'fit', label: 'Fit check' },
  { id: 'changes', label: 'Changes' },
];

// Which tracker stage each session step belongs to.
const STEP_STAGE = { setup: 'setup', upload: 'setup', lead: 'lead', data: 'data', chart: 'chart', polish: 'polish', fit: 'fit', changes: 'changes', record: 'changes' };

/** @returns {Record<string, 'passed'|'current'|'movedOn'|'toDo'>} */
export function stageStatuses(session) {
  const current = STAGES.findIndex((s) => s.id === (STEP_STAGE[session?.step] ?? 'setup'));
  const moved = session?.run?.movedOn ?? [];
  return Object.fromEntries(STAGES.map((s, i) => {
    if (i === current) return [s.id, 'current'];
    if (i < current) return [s.id, moved.includes(s.id) ? 'movedOn' : 'passed'];
    return [s.id, 'toDo'];
  }));
}
