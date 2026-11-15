// The stage engine (CM-4, CM-5, CM-12, spec §5). Plain JavaScript with no React, so the UI, the
// tests and the pilot harness share it. It owns the run: which stage is open, rounds and caps, the
// gate, the lead offer, declines and push-back, routes, the Stage 5 reopen and the planned page.
// The model only reviews. Every function takes the session and returns a new one (or an error);
// nothing is changed in place. It never imports config/rules.json: rule wording is prompt text and
// stays on the server (T-SEC-1); the server's review check enforces rules and severities (§7.1).
import { config, limits } from '../../shared/limits.js';

const caps = config.caps;

export const STAGE_STEP = { 1: 'lead', 2: 'data', 3: 'chart', 4: 'polish', 5: 'fit' };
export const STAGE_NAMES = { 1: 'Lead', 2: 'Data fit', 3: 'Chart choice', 4: 'Polish', 5: 'Fit check' };
const STEP_STAGE = { lead: 1, data: 2, chart: 3, polish: 4, fit: 5 };
const BLOCKING = new Set(['hardStop', 'major']);

// App-written lines this milestone adds (spec D41; student-visible, for Chris to confirm).
export const ENGINE_MESSAGES = {
  sameLead: config.messages.sameLead,
  movedOn: "We've used the rounds for this stage, so we'll move on. Your record lists what's still open.",
  confirmed: 'Good. The page is agreed: you can make the changes.',
};

let counter = 0;
const messageId = () => `m-${Date.now().toString(36)}-e${(counter += 1)}`;
const stamp = (now) => (now ?? new Date()).toISOString();
const daniel = (text, extra = {}, now) => ({ id: messageId(), from: 'daniel', at: stamp(now), text, ...extra });
const student = (text, extra = {}, now) => ({ id: messageId(), from: 'student', at: stamp(now), text, ...extra });

/** The engine's fields of a new run (spec §5.1). */
export function engineFields() {
  return {
    leads: [],
    agreedLead: null,
    offerMade: false,
    leadRoundsUsed: 0,
    comparison: null,
    stages: {
      1: { status: 'open', roundsAllowed: caps.leadRounds, roundsUsed: 0 },
      2: { status: 'locked', roundsAllowed: caps.dataFitRounds, roundsUsed: 0 },
      3: { status: 'locked', roundsAllowed: caps.chartChoiceRounds, roundsUsed: 0 },
      4: { status: 'locked', roundsAllowed: caps.polishRounds, roundsUsed: 0 },
      5: { status: 'locked', roundsAllowed: 1, roundsUsed: 0 },
    },
    reviews: [],
    findings: {},
    dataToSource: [],
    reopensLeft: caps.fitReopens,
    reuploadsLeft: caps.reuploads,
    // { stage, from: 2|5 }: a stage reopened by a route or by Stage 5 (spec §5.6, §5.7).
    reopen: null,
    // { stage, leadChanged? }: a review call is due (the UI makes it; "Ask Daniel again" repeats it).
    pending: null,
    // { stage, review }: route buttons are showing (spec §5.6).
    route: null,
    awaitingReupload: false,
    // Engine log: verdict mismatches, stripped fields, converted push-backs (pilot P-2 reports them).
    log: [],
  };
}

/** The run with the engine's fields, for sessions saved before they existed. */
export function withEngine(run) {
  return run.stages ? run : { ...run, ...engineFields() };
}

// ---------- small helpers ----------

export const isBlocking = (f) => BLOCKING.has(f.severity);
export const isResolved = (f) => ['accepted', 'closed', 'superseded'].includes(f.status);
export const currentStage = (session) => STEP_STAGE[session.step] ?? null;
export const activeUpload = (run) => run.uploads.find((u) => u.id === run.activeUpload) ?? null;

export function stageFindings(run, stage) {
  return Object.entries(run.findings).filter(([, f]) => f.stage === stage).map(([id, f]) => ({ id, ...f }));
}

/** Blocking findings in a stage still to be dealt with (spec §5.2). */
export function openBlocking(run, stage) {
  return stageFindings(run, stage).filter((f) => isBlocking(f) && !isResolved(f));
}

/** Minor fixes and suggestions in a stage the student hasn't accepted yet (D59). */
export function openMinors(run, stage) {
  return stageFindings(run, stage).filter((f) => !isBlocking(f) && f.status === 'open');
}

/** The verdict from the findings' severities (D10): any hard stop, any major, else pass. */
export function computeVerdict(findings) {
  if (findings.some((f) => f.severity === 'hardStop')) return 'hardStop';
  if (findings.some((f) => f.severity === 'major')) return 'revise';
  return 'pass';
}

function patchRun(session, changes) {
  return { ...session, run: { ...session.run, ...changes } };
}

function setStage(run, n, changes) {
  return { ...run.stages, [n]: { ...run.stages[n], ...changes } };
}

function addChat(session, ...messages) {
  return { ...session, chat: [...session.chat, ...messages] };
}

const roundsLeft = (run, n) => run.stages[n].roundsAllowed - run.stages[n].roundsUsed;
const sameText = (a, b) => a.replace(/\s+/g, ' ').trim().toLowerCase() === b.replace(/\s+/g, ' ').trim().toLowerCase();

// ---------- Stage 1: the lead (spec §4) ----------

/**
 * The student sends a lead. Refused when empty, too long, or the same as the last one (Q6: no round
 * used). Otherwise the review call is due.
 * @returns {{ session } | { error: string }}
 */
export function submitLead(session, text, { now } = {}) {
  const run = session.run;
  const lead = (text ?? '').trim();
  if (session.step !== 'lead' || run.stages[1].status !== 'open' || run.pending) return { error: 'The lead box is not open.' };
  if (!lead) return { error: 'Write your lead first.' };
  if (lead.length > limits.leadMaxChars) return { error: `Keep the lead to ${limits.leadMaxChars} characters or fewer.` };
  const last = run.leads.at(-1);
  if (last && sameText(last.text, lead)) return { error: ENGINE_MESSAGES.sameLead };
  const entry = { text: lead, round: run.leads.length + 1, at: stamp(now) };
  const next = addChat(patchRun(session, { leads: [...run.leads, entry], pending: { stage: 1 } }), student(lead, { kind: 'lead' }, now));
  return { session: next };
}

// ---------- requests (spec §4, §6) ----------

function findingForHistory(f) {
  return {
    findingId: f.modelId, round: f.round, rules: f.rules, severity: f.severity, location: f.location, issue: f.issue, fix: f.fix,
    status: f.status, ...(f.reason ? { reason: f.reason } : {}), ...(f.pushBack ? { pushBack: f.pushBack } : {}),
    ...(f.finalChoice ? { finalChoice: f.finalChoice } : {}),
  };
}

function stageHistory(run, stage) {
  const reviews = run.reviews.filter((r) => r.stage === stage);
  return reviews.map((r) => ({
    round: r.round,
    ...(stage === 1 ? { lead: run.leads.find((l) => l.round === r.leadRound)?.text ?? null } : {}),
    findings: r.findingIds.map((id) => findingForHistory(run.findings[id])),
    message: r.message,
  }));
}

function acceptedFixes(run, stages) {
  return stages.flatMap((s) => stageFindings(run, s).filter((f) => f.status === 'accepted'))
    .map((f) => ({ stage: f.stage, rules: f.rules, location: f.location, fix: f.fix }));
}

/** The planned page (CMS-14, spec §5.8): built by the engine, the Stage 5 input and the redraw input. */
export function plannedPage(run) {
  const fixes = [2, 3, 4, 5].flatMap((s) => stageFindings(run, s));
  return {
    lead: run.agreedLead,
    acceptedFixes: fixes.filter((f) => f.status === 'accepted')
      .map((f) => ({ stage: f.stage, rules: f.rules, severity: f.severity, location: f.location, fix: f.fix })),
    declinedFixes: fixes.filter((f) => f.reason && f.status !== 'accepted' && f.status !== 'superseded')
      .map((f) => ({ stage: f.stage, rules: f.rules, severity: f.severity, location: f.location, fix: f.fix, reason: f.reason, finalChoice: f.finalChoice ?? null })),
    dataToSource: [...run.dataToSource],
  };
}

function declinesToSend(run, stage) {
  return stageFindings(run, stage).filter((f) => f.status === 'declined' && !f.sent);
}

/**
 * The /api/review body for the pending call (spec §4, §6): `{ stage, round, input }`.
 * Returns null when no call is due.
 */
export function reviewRequest(session) {
  const run = session.run;
  const pending = run.pending;
  if (!pending) return null;
  const stage = pending.stage;
  const upload = activeUpload(run);
  const reading = upload?.reading ?? null;
  const history = stageHistory(run, stage);
  if (stage === 1) {
    const round = run.leads.length;
    return {
      stage, round,
      input: { audience: run.audience, lead: run.leads.at(-1)?.text ?? '', round, cap: run.stages[1].roundsAllowed, history, reading, offerMade: run.offerMade },
    };
  }
  const round = run.stages[stage].roundsUsed + 1;
  const declines = declinesToSend(run, stage).map((f) => ({ findingId: f.modelId, reason: f.reason }));
  const base = { audience: run.audience, lead: run.agreedLead, reading, readingCorrection: upload?.readingCorrection ?? null };
  const image = upload?.image1600 ? { image: upload.image1600 } : {};
  const common = { ...base, ...image, cap: run.stages[stage].roundsAllowed, history, ...(declines.length ? { declines } : {}) };
  const input = {
    2: () => ({ ...common, leadChanged: Boolean(pending.leadChanged), reuploadsLeft: run.reuploadsLeft, dataToSource: run.dataToSource, isDummy: run.isDummy }),
    3: () => ({ ...common, comparison: run.comparison, acceptedFixes: acceptedFixes(run, [2]) }),
    4: () => ({ ...common, comparison: run.comparison, isDummy: run.isDummy, acceptedFixes: acceptedFixes(run, [2, 3]) }),
    5: () => ({ ...base, plannedPage: plannedPage(run), reopensLeft: run.reopensLeft, history, ...(declines.length ? { declines } : {}) }),
  }[stage]();
  return { stage, round, input };
}

// ---------- applying a review (spec §5.2–5.7) ----------

/**
 * Applies a review that has passed the schema (and, from milestone 4, the review check) to the run:
 * namespaced findings, the engine's verdict, the offer rule, decline responses, routes and
 * Stage 5's reopen suggestion. Then the gate is checked.
 */
export function applyReview(session, review, { now } = {}) {
  const run = session.run;
  const pending = run.pending;
  if (!pending) throw new Error('No review is due.');
  const stage = pending.stage;
  const upload = run.activeUpload;
  const round = stage === 1 ? run.leads.length : run.stages[stage].roundsUsed + 1;
  const log = [];
  const findings = { ...run.findings };

  // Decline responses (spec §5.5): accept closes; one push-back, then the student's final choice.
  const answered = new Set();
  const sent = declinesToSend(run, stage);
  for (const f of sent) findings[f.id] = { ...findings[f.id], sent: true };
  for (const response of review.declineResponses ?? []) {
    const target = sent.find((f) => f.modelId === response.findingId);
    if (!target) {
      log.push({ type: 'declineResponseUnmatched', stage, round, findingId: response.findingId });
      continue;
    }
    answered.add(target.modelId);
    const pushedBefore = Boolean(findings[target.id].pushBack);
    if (response.decision === 'pushBack' && !pushedBefore && caps.pushBacksPerFinding > 0) {
      findings[target.id] = { ...findings[target.id], status: 'pushedBack', pushBack: response.message };
    } else {
      if (response.decision === 'pushBack') log.push({ type: 'secondPushBackConverted', stage, round, findingId: target.modelId });
      findings[target.id] = { ...findings[target.id], status: 'closed', reply: response.message };
    }
  }
  for (const f of sent) {
    if (!answered.has(f.modelId)) {
      log.push({ type: 'declineUnanswered', stage, round, findingId: f.modelId });
      findings[f.id] = { ...findings[f.id], status: 'closed' };
    }
  }

  // Earlier findings this review replaces: Stage 1's close with the rewrite (D13). In Stages 2–5 an
  // undecided blocking finding is superseded by the new round (after a rewritten lead, say); minor
  // fixes stay open, so the student can still accept them for the redraw.
  for (const f of stageFindings({ findings }, stage)) {
    if (f.status !== 'open') continue;
    if (stage === 1) findings[f.id] = { ...findings[f.id], status: 'closed' };
    else if (isBlocking(f)) findings[f.id] = { ...findings[f.id], status: 'superseded' };
  }

  // New findings, namespaced by upload and round (spec §5.1). A finding that repeats a decline
  // Daniel has just answered is dropped: the response governs.
  const findingIds = [];
  (review.findings ?? []).forEach((f, i) => {
    if (answered.has(f.id)) {
      log.push({ type: 'repeatOfAnsweredDecline', stage, round, findingId: f.id });
      return;
    }
    const id = `${upload}-s${stage}-r${round}-${i + 1}`;
    findings[id] = { stage, upload, round, modelId: f.id, rules: f.rules, severity: f.severity, location: f.location, issue: f.issue, fix: f.fix, status: 'open' };
    findingIds.push(id);
  });

  const newFindings = findingIds.map((id) => findings[id]);
  const verdict = computeVerdict(newFindings);
  if (review.verdict !== verdict) log.push({ type: 'verdictMismatch', stage, round, model: review.verdict, engine: verdict });

  // The lead offer (CM-5, spec §5.4).
  let offeredLead = review.offeredLead ?? null;
  let offerMade = run.offerMade;
  const leadRoundsUsed = stage === 1 ? run.leads.length : run.leadRoundsUsed;
  if (offeredLead) {
    const allowed = stage === 1 && leadRoundsUsed >= caps.offerAtRound && !offerMade && verdict !== 'pass';
    if (allowed) offerMade = true;
    else {
      log.push({ type: 'offerStripped', stage, round });
      offeredLead = null;
    }
  }

  // Fields that belong to one stage only (spec §7.1).
  let route = review.route ?? null;
  if (route === 'reupload' && !(stage === 2 && run.reuploadsLeft > 0)) {
    log.push({ type: 'reuploadStripped', stage, round });
    route = null;
  }
  if (route && route !== 'reupload' && !(stage === 2 || (stage === 5 && run.reopensLeft > 0))) {
    log.push({ type: 'routeStripped', stage, round });
    route = null;
  }
  if (route && route !== 'reupload' && verdict === 'pass') {
    log.push({ type: 'routeStripped', stage, round });
    route = null;
  }
  let reopenStage = review.reopenStage ?? null;
  if (reopenStage && (stage !== 5 || run.reopensLeft < 1)) {
    log.push({ type: 'reopenStripped', stage, round });
    reopenStage = null;
  }
  let impression = review.impression ?? null;
  if (impression && !(stage === 4 && verdict === 'pass')) {
    log.push({ type: 'impressionStripped', stage, round });
    impression = null;
  }

  const record = {
    stage, round, upload, at: stamp(now), verdict, modelVerdict: review.verdict, findingIds,
    message: review.message, whatWorks: verdict === 'hardStop' ? null : (review.whatWorks ?? null),
    offeredLead, route, reopenStage, impression, ...(stage === 1 ? { leadRound: run.leads.length } : {}),
    ...(pending.leadChanged ? { leadChanged: true } : {}),
  };
  const reviewIndex = run.reviews.length;
  let next = patchRun(session, {
    findings,
    reviews: [...run.reviews, record],
    stages: setStage(run, stage, { roundsUsed: run.stages[stage].roundsUsed + 1 }),
    leadRoundsUsed,
    offerMade,
    pending: null,
    route: route && route !== 'reupload' ? { stage, review: reviewIndex, options: route.options } : null,
    log: [...run.log, ...log],
  });
  next = addChat(next, daniel(review.message, { kind: 'review', stage, round, review: reviewIndex }, now));

  if (route === 'reupload') {
    next = patchRun(next, { reuploadsLeft: next.run.reuploadsLeft - 1, awaitingReupload: true });
    next = addChat(next, daniel(config.messages.reupload, { kind: 'reupload' }, now));
    return { ...next, step: 'upload' };
  }
  return settle(next, stage, { now });
}

// ---------- the gate (spec §5.2, §5.3) ----------

/**
 * What the student can do now in a stage's checklist: 'decide' (a blocking fix needs Accept or
 * Decline, or a push-back needs a final choice), 'send' (declines to send, a round left), 'moveOn'
 * (declines but no round left), 'minors' (the stage has passed its gate but minor fixes are still
 * to accept or leave, D59) or 'done'.
 */
export function checklistState(run, stage) {
  const open = openBlocking(run, stage);
  if (open.some((f) => f.status === 'open' || f.status === 'pushedBack')) return 'decide';
  if (open.some((f) => f.status === 'declined' && !f.sent)) return roundsLeft(run, stage) > 0 ? 'send' : 'moveOn';
  if (!open.length && stage >= 2 && stage <= 4 && openMinors(run, stage).length) return 'minors';
  return 'done';
}

/** Checks the gate after a review or a checklist change, and moves on when the stage is done. */
export function settle(session, stage, { now } = {}) {
  const run = session.run;
  if (run.pending || run.route || run.awaitingReupload) return session;
  if (run.stages[stage].status !== 'open') return session;
  if (stage === 1) {
    const latest = run.reviews.filter((r) => r.stage === 1).at(-1);
    if (!latest || run.pending) return session;
    if (latest.verdict === 'pass') return finishStage(session, 1, 'passed', { now });
    if (roundsLeft(run, 1) <= 0) return finishStage(session, 1, 'cappedOpen', { now });
    return session;
  }
  // Stage 5 waits for the student's confirm or reopen (spec §5.7).
  if (stage === 5) return session;
  if (run.stages[stage].roundsUsed === 0) return session;
  // With minor fixes still open, the stage waits for Accept all or Continue (D59), so they can
  // still go into the redraw.
  if (openBlocking(run, stage).length === 0 && openMinors(run, stage).length === 0) return finishStage(session, stage, 'passed', { now });
  return session;
}

function finishStage(session, stage, status, { now } = {}) {
  let run = session.run;
  let next = patchRun(session, { stages: setStage(run, stage, { status }) });
  if (stage === 1) next = patchRun(next, { agreedLead: run.leads.at(-1)?.text ?? null });
  if (status === 'cappedOpen') next = addChat(next, daniel(ENGINE_MESSAGES.movedOn, { kind: 'movedOn', stage }, now));
  run = next.run;

  // A stage reopened from Stage 5 goes straight back to Stage 5 (D18).
  if (run.reopen?.stage === stage && run.reopen.from === 5) {
    next = patchRun(next, { reopen: null });
    return enterStage(next, 5, { now, again: true });
  }
  // A lead rewritten from Stage 2's route: Stage 2 runs once more with leadChanged, outside its cap.
  if (run.reopen?.stage === 1 && run.reopen.from === 2) {
    next = patchRun(next, {
      reopen: null,
      stages: setStage(next.run, 2, { status: 'open', roundsAllowed: next.run.stages[2].roundsAllowed + 1 }),
      pending: { stage: 2, leadChanged: true },
    });
    return { ...next, step: 'data' };
  }
  if (stage < 5) return enterStage(next, stage + 1, { now });
  return { ...next, step: 'changes' };
}

/** Opens a stage with its opener (spec §6). */
export function enterStage(session, stage, { now, again = false } = {}) {
  const run = session.run;
  let next = patchRun(session, { stages: setStage(run, stage, { status: 'open' }) });
  next = { ...next, step: STAGE_STEP[stage] };
  if (stage === 2) {
    const upload = activeUpload(run);
    if (upload && !upload.readingConfirmed) {
      return addChat(next, daniel(config.openers.stage2.replace('{summary}', upload.reading?.summary ?? ''), { kind: 'confirmReading', upload: upload.id }, now));
    }
    next = addChat(next, daniel(config.openers.stage2Then, { kind: 'opener', stage: 2 }, now));
    return patchRun(next, { pending: { stage: 2 } });
  }
  if (stage === 3) {
    next = addChat(next, daniel(config.openers.stage3, { kind: 'opener', stage: 3 }, now));
    return run.comparison ? patchRun(next, { pending: { stage: 3 } }) : next;
  }
  if (stage === 4) {
    if (config.openers.stage4) next = addChat(next, daniel(config.openers.stage4, { kind: 'opener', stage: 4 }, now));
    return patchRun(next, { pending: { stage: 4 } });
  }
  if (stage === 5) {
    const stages = again
      ? setStage(next.run, 5, { status: 'open', roundsAllowed: next.run.stages[5].roundsUsed + 1 })
      : next.run.stages;
    next = patchRun(next, { stages, pending: { stage: 5 } });
    return addChat(next, daniel(config.openers.stage5, { kind: 'plannedPage', page: plannedPage(next.run) }, now));
  }
  return next;
}

// ---------- Stage 2 reading, Stage 3 comparison ----------

/**
 * The student confirms Daniel's reading (CMS-12): Yes, or a correction of up to 300 characters.
 * After a re-upload, Stage 3 opens on the new chart (spec §5.6).
 */
export function confirmReading(session, correction = null, { now } = {}) {
  const run = session.run;
  const upload = activeUpload(run);
  if (!upload || upload.readingConfirmed) return { error: 'There is no reading to confirm.' };
  const text = correction?.trim() || null;
  if (correction !== null && !text) return { error: 'Write what Daniel got wrong, or choose Yes.' };
  if (text && text.length > limits.correctionMaxChars) return { error: `Keep the correction to ${limits.correctionMaxChars} characters or fewer.` };
  const uploads = run.uploads.map((u) => (u.id === upload.id ? { ...u, readingConfirmed: true, readingCorrection: text } : u));
  let next = addChat(patchRun(session, { uploads }), student(text ?? 'Yes', { kind: 'readingConfirm' }, now));
  const reuploaded = run.uploads.length > 1 && upload.id === run.uploads.at(-1).id && run.stages[3].status === 'locked';
  if (reuploaded) return { session: enterStage(next, 3, { now }) };
  next = addChat(next, daniel(config.openers.stage2Then, { kind: 'opener', stage: 2 }, now));
  return { session: patchRun(next, { pending: { stage: 2 } }) };
}

/** The comparison picker (CMS-13): one of the six options, or "Something else" with text. */
export function setComparison(session, type, other = '', { now } = {}) {
  const options = config.comparisonOptions;
  if (session.step !== 'chart' || session.run.comparison) return { error: 'The comparison is already set.' };
  if (type === 'other') {
    const text = other.trim();
    if (!text) return { error: 'Say what kind of comparison it is.' };
    if (text.length > limits.comparisonMaxChars) return { error: `Keep it to ${limits.comparisonMaxChars} characters or fewer.` };
    const next = addChat(patchRun(session, { comparison: { type: 'other', other: text }, pending: { stage: 3 } }), student(text, { kind: 'comparison' }, now));
    return { session: next };
  }
  if (!options.includes(type)) return { error: 'Choose a kind of comparison.' };
  const next = addChat(patchRun(session, { comparison: { type, other: null }, pending: { stage: 3 } }), student(type, { kind: 'comparison' }, now));
  return { session: next };
}

// ---------- the checklist (spec §5.2, §5.5) ----------

function findingUpdate(session, id, change, { now } = {}) {
  const f = session.run.findings[id];
  if (!f) return { error: 'No such finding.' };
  if (f.stage === 1) return { error: 'Stage 1 findings close when you rewrite the lead.' };
  if (f.stage !== currentStage(session) || session.run.pending || session.run.stages[f.stage].status !== 'open') {
    return { error: 'That stage is closed.' };
  }
  const next = patchRun(session, { findings: { ...session.run.findings, [id]: { ...f, ...change(f) } } });
  return { session: settle(next, f.stage, { now }) };
}

export function acceptFinding(session, id, opts) {
  const f = session.run.findings[id];
  if (f && (f.status === 'closed' || f.status === 'superseded' || (f.status === 'declined' && f.sent))) return { error: 'That fix is already closed.' };
  if (f?.status === 'pushedBack') return finalChoice(session, id, 'acceptFix', opts);
  return findingUpdate(session, id, () => ({ status: 'accepted', reason: undefined }), opts);
}

export function declineFinding(session, id, reason, opts) {
  const f = session.run.findings[id];
  const text = (reason ?? '').trim();
  if (!f) return { error: 'No such finding.' };
  if (!isBlocking(f)) return { error: 'Minor fixes are accepted or left; they are not declined.' };
  if (!['open', 'accepted', 'declined'].includes(f.status) || f.sent) return { error: 'That fix is already closed.' };
  if (text.length < caps.declineReasonMinChars) return { error: `Give a reason of at least ${caps.declineReasonMinChars} characters.` };
  if (text.length > limits.declineReasonMaxChars) return { error: `Keep the reason to ${limits.declineReasonMaxChars} characters or fewer.` };
  return findingUpdate(session, id, () => ({ status: 'declined', reason: text, sent: false }), opts);
}

/** After a push-back (spec §5.5): Accept the fix, or Keep my choice. Either closes it; no call. */
export function finalChoice(session, id, choice, opts) {
  const f = session.run.findings[id];
  if (!f || f.status !== 'pushedBack') return { error: 'There is no push-back to answer.' };
  if (choice === 'acceptFix') return findingUpdate(session, id, () => ({ status: 'accepted', finalChoice: 'acceptFix' }), opts);
  if (choice === 'keep') return findingUpdate(session, id, () => ({ status: 'closed', finalChoice: 'keep' }), opts);
  return { error: 'Choose Accept the fix or Keep my choice.' };
}

/** Accept all the minor fixes and suggestions in a stage (Q9). They never gate. */
export function acceptAllMinor(session, stage, opts) {
  const run = session.run;
  if (stage !== currentStage(session) || run.pending) return { error: 'That stage is closed.' };
  const findings = { ...run.findings };
  for (const f of stageFindings(run, stage)) {
    if (!isBlocking(f) && f.status === 'open') findings[f.id] = { ...run.findings[f.id], status: 'accepted' };
  }
  return { session: settle(patchRun(session, { findings }), stage, opts) };
}

/** Send to Daniel: the declines with their reasons go in the next round (spec §5.3). */
export function sendDeclines(session, { now } = {}) {
  const stage = currentStage(session);
  const run = session.run;
  if (!stage || stage === 1 || checklistState(run, stage) !== 'send') return { error: 'There is nothing to send yet.' };
  const declines = declinesToSend(run, stage);
  const text = declines.map((f) => `I'm declining the ${f.rules.join('/')} fix (${f.location}): ${f.reason}`).join('\n');
  const next = addChat(patchRun(session, { pending: { stage } }), student(text, { kind: 'declines' }, now));
  return { session: next };
}

/** Continue with minor fixes left unaccepted (D59): the stage passes; they stay out of the redraw. */
export function continueStage(session, { now } = {}) {
  const stage = currentStage(session);
  if (!stage || session.run.pending || checklistState(session.run, stage) !== 'minors') return { error: 'You can’t move on yet.' };
  return { session: finishStage(session, stage, 'passed', { now }) };
}

/** At a cap with declined fixes unanswered: the stage moves on as cappedOpen (spec §5.3). */
export function moveOn(session, { now } = {}) {
  const stage = currentStage(session);
  if (!stage || stage === 1 || stage === 5 || checklistState(session.run, stage) !== 'moveOn') return { error: 'You can’t move on yet.' };
  return { session: finishStage(session, stage, 'cappedOpen', { now }) };
}

// ---------- routes (spec §5.6) ----------

/** Rewrite the lead: Stage 1 reopens with reopenedLeadRounds more rounds. */
export function chooseRewriteLead(session, { now } = {}) {
  const run = session.run;
  if (!run.route?.options.includes('rewriteLead')) return { error: 'That route is not offered.' };
  const from = run.route.stage;
  if (from === 5 && run.reopensLeft < 1) return { error: 'Stage 5 has already reopened a stage.' };
  let next = patchRun(session, {
    route: null,
    reopen: { stage: 1, from },
    reopensLeft: from === 5 ? run.reopensLeft - 1 : run.reopensLeft,
    stages: setStage(run, 1, { status: 'open', roundsAllowed: run.stages[1].roundsUsed + caps.reopenedLeadRounds }),
  });
  next = addChat(next, student('I’ll rewrite the lead.', { kind: 'route' }, now), daniel(config.openers.stage1, { kind: 'opener', stage: 1 }, now));
  return { session: { ...next, step: 'lead' } };
}

/** Keep the lead and name the data: adds to dataToSource and closes the route's data findings. */
export function chooseNameData(session, text, { now } = {}) {
  const run = session.run;
  if (!run.route?.options.includes('nameData')) return { error: 'That route is not offered.' };
  const data = (text ?? '').trim();
  if (!data) return { error: 'Name the data you need.' };
  if (data.length > limits.dataToSourceMaxChars) return { error: `Keep it to ${limits.dataToSourceMaxChars} characters or fewer.` };
  const stage = run.route.stage;
  const review = run.reviews[run.route.review];
  const family = stage === 2 ? 'D' : 'F';
  // Only fixes the student hasn't decided: an accept or a decline already made stands.
  const open = review.findingIds.map((id) => ({ id, ...run.findings[id] })).filter((f) => isBlocking(f) && f.status === 'open');
  const targets = open.some((f) => f.rules.some((r) => r.startsWith(family))) ? open.filter((f) => f.rules.some((r) => r.startsWith(family))) : open;
  const findings = { ...run.findings };
  for (const f of targets) findings[f.id] = { ...run.findings[f.id], status: 'closed', resolution: 'nameData', dataToSource: data };
  const next = addChat(patchRun(session, { route: null, findings, dataToSource: [...run.dataToSource, data] }), student(`I'll keep the lead. Data to source: ${data}`, { kind: 'route' }, now));
  return { session: settle(next, stage, { now }) };
}

// ---------- re-upload (spec §5.6) ----------

/** After the redrawn chart is read: old open Stage 2 findings are superseded; its reading is confirmed next. */
export function afterReupload(session, { now } = {}) {
  const run = session.run;
  const findings = { ...run.findings };
  for (const f of stageFindings(run, 2)) {
    if (!isResolved(f) && f.upload !== run.activeUpload) findings[f.id] = { ...run.findings[f.id], status: 'superseded' };
  }
  const upload = activeUpload(run);
  let next = patchRun(session, { findings, awaitingReupload: false, stages: setStage(run, 2, { status: 'passed' }) });
  next = addChat(next, daniel(config.openers.stage2.replace('{summary}', upload.reading?.summary ?? ''), { kind: 'confirmReading', upload: upload.id }, now));
  return { ...next, step: 'data' };
}

// ---------- Stage 5 (spec §5.7) ----------

/** Reopen one of Stages 1–4: one more round (three for Stage 1), then straight back to Stage 5. */
export function reopenStage(session, stage, { now } = {}) {
  const run = session.run;
  if (session.step !== 'fit' || run.pending || run.stages[5].roundsUsed < 1) return { error: 'Daniel hasn’t checked the page yet.' };
  if (run.reopensLeft < 1) return { error: 'You have already reopened a stage.' };
  if (![1, 2, 3, 4].includes(stage)) return { error: 'Choose a stage from 1 to 4.' };
  const extra = stage === 1 ? caps.reopenedLeadRounds : 1;
  let next = patchRun(session, {
    reopensLeft: run.reopensLeft - 1,
    reopen: { stage, from: 5 },
    route: null,
    stages: setStage(run, stage, { status: 'open', roundsAllowed: run.stages[stage].roundsUsed + extra }),
  });
  next = addChat(next, student(`Let's reopen ${STAGE_NAMES[stage]}.`, { kind: 'reopen' }, now));
  next = { ...next, step: STAGE_STEP[stage] };
  if (stage === 1) return { session: addChat(next, daniel(config.openers.stage1, { kind: 'opener', stage: 1 }, now)) };
  return { session: patchRun(next, { pending: { stage } }) };
}

/** Confirm the planned page: Stage 5 closes (passed, or moved on with fixes open) and Changes opens. */
export function confirmFit(session, { now } = {}) {
  const run = session.run;
  if (session.step !== 'fit' || run.pending || run.stages[5].roundsUsed < 1) return { error: 'Daniel hasn’t checked the page yet.' };
  if (run.route) return { error: 'Choose one of Daniel’s two routes first.' };
  const status = openBlocking(run, 5).length ? 'cappedOpen' : 'passed';
  let next = patchRun(session, { stages: setStage(run, 5, { status }), route: null });
  next = addChat(next, student('The page works.', { kind: 'confirm' }, now), daniel(ENGINE_MESSAGES.confirmed, { kind: 'confirmed' }, now));
  if (run.isDummy) next = addChat(next, daniel(config.openers.lastMessage, { kind: 'lastMessage' }, now));
  return { session: { ...next, step: 'changes' } };
}

// ---------- the tracker ----------

/** Stage n's status for the tracker: passed, movedOn (cap reached), current or toDo. */
export function trackerStatus(session, n) {
  const run = session.run;
  if (!run?.stages) return null;
  if (currentStage(session) === n) return 'current';
  const s = run.stages[n].status;
  if (s === 'passed') return 'passed';
  if (s === 'cappedOpen') return 'movedOn';
  return 'toDo';
}

