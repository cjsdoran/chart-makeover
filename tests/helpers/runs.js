// Runs driven through the real stage engine on canned reviews (no model), for the redraw and record
// tests: a session at the fit check, and one at Changes with a slide built.
import { createSession } from '../../src/store/session.js';
import { readingPatch } from '../../src/upload/sendChart.js';
import {
  acceptAllMinor, acceptFinding, applyRedraw, applyReview, computeVerdict, confirmFit, confirmReading, declineFinding, finalChoice,
  sendDeclines, setComparison, stageFindings, submitLead,
} from '../../src/engine/engine.js';
import { redrawFileName } from '../../src/redraw/fileName.js';
import { SPECS } from './redrawSpecs.js';

export const READING = {
  readable: true, kind: 'data', summary: 'I read this as revenue by club, 2009–24, in £m.',
  chart: { series: [{ name: 'Man City', values: [{ x: '2009', y: 100 }, { x: '2024', y: 190 }] }] },
};
export const SETUP = { accessCode: 'x', name: 'Ada Lovelace', studentId: '20871234', team: 'Team 4', caseName: 'Man City' };
const META = { promptVersion: 'stage 1.2', rulesVersion: '1.0 (PRD rev 58)', servedBy: 'claude-opus-5-5' };

export function review(stage, findings = [], extra = {}) {
  const fs = findings.map((f, i) => ({ id: `S${stage}-${i + 1}`, location: 'chart', issue: 'issue text', fix: `fix ${stage}.${i + 1}`, ...f }));
  return {
    stage, round: 1, verdict: computeVerdict(fs), findings: fs, whatWorks: null, declineResponses: [],
    offeredLead: null, route: null, reopenStage: null, impression: null, message: `Stage ${stage} message`, ...extra,
  };
}
export const major = (rule) => ({ rules: [rule], severity: 'major' });
export const hard = (rule) => ({ rules: [rule], severity: 'hardStop' });
export const minor = (rule) => ({ rules: [rule], severity: 'minor' });

export const ok = (r) => {
  if (r.error) throw new Error(r.error);
  return r.session;
};
const apply = (s, r) => applyReview(s, r, { meta: META });
export const idsOf = (s, stage) => stageFindings(s.run, stage).map((f) => f.id);

/** At Stage 5 with its review due: Stage 2 one accept and one decline (answered), Stage 3 and 4 accepted. */
export function atFit({ image = { mediaType: 'image/jpeg', base64: null } } = {}) {
  let s = { ...createSession(), setup: SETUP, step: 'upload' };
  const prepared = { meta: { fileName: 'man-city.pdf' }, upload: { kind: 'pdf' }, record: image.base64 ? image : null };
  s = { ...s, ...readingPatch(s, { prepared, result: { reading: READING, promptVersion: 'read-chart 1.1', servedBy: 'claude-opus-5-5' }, audience: 'The board of a rival club', isDummy: false }).patch };
  s = apply(ok(submitLead(s, 'City grew')), review(1, [hard('L2')]));
  s = apply(ok(submitLead(s, SPECS.line.title)), review(1));
  s = ok(confirmReading(s, 'It is £m, not €m'));
  s = apply(s, review(2, [major('D1'), major('D3')]));
  const [a, b] = idsOf(s, 2);
  s = ok(acceptFinding(s, a));
  s = ok(declineFinding(s, b, 'Like-for-like is fine here'));
  s = ok(sendDeclines(s));
  s = apply(s, review(2, [], { declineResponses: [{ findingId: 'S2-2', decision: 'pushBack', message: 'The board will ask.' }] }));
  return s;
}

/** Past the fit check, at Changes, before any slide. */
export function atChanges(opts) {
  let s = atFit(opts);
  const pushed = idsOf(s, 2).find((id) => s.run.findings[id].status === 'pushedBack');
  if (pushed) {
    s = ok(finalChoice(s, pushed, 'keep')); // the student keeps the decline: it stays out of the slide
  }
  s = ok(setComparison(s, 'Time'));
  s = apply(s, review(3, [major('C2')]));
  s = ok(acceptFinding(s, idsOf(s, 3)[0]));
  s = apply(s, review(4, [hard('P2'), minor('P4')]));
  s = ok(acceptAllMinor(s, 4));
  s = ok(acceptFinding(s, idsOf(s, 4)[0]));
  s = apply(s, review(5));
  return ok(confirmFit(s));
}

/** At Changes with the first slide built from SPECS.line. */
export function withSlide(opts) {
  const s = atChanges(opts);
  return ok(applyRedraw(s, { spec: SPECS.line, promptVersion: 'redraw-plan 1.1', servedBy: 'claude-opus-5-5' }, { fileName: redrawFileName(s, 1) }));
}
