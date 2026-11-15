// The review check (spec §7.1, D11): runs on a stage review after the schema. Cheap fixes are made
// in code and logged by type; what code can't fix is sent back for regeneration (the browser's
// retry with previousErrors). Server-side only: it reads config/rules.json, whose wording is shared
// with the prompts and must never reach the browser (T-SEC-1, D47).
import rulesFile from '../config/rules.json' with { type: 'json' };
import { config } from './limits.js';

const caps = config.caps;
const RULES = Object.fromEntries(rulesFile.rules.map((r) => [r.id, r]));
const ORDER = ['hardStop', 'major', 'minor', 'suggestion'];
const BLOCKING = new Set(['hardStop', 'major']);

export const REGENERATE = {
  tooMany: 'Raise at most three hard-stop or major findings; group them by root cause.',
  tooLong: (n) => `Your message is ${n} words. Keep it to about ${caps.messageWords} words, and never more than ${caps.messageWordsMax}.`,
  score: 'Never give a score, grade or rating.',
  leadRewrite: "Don't write the lead for the student before round 3: say what the lead must do, and ask one question.",
  declineMissing: (ids) => `Answer every declined fix in declineResponses (accept or pushBack): missing ${ids.join(', ')}.`,
};

export const wordCount = (text) => (text.match(/[A-Za-z0-9£$€%][^\s]*/g) ?? []).length;

/** The verdict from the severities (D10). */
export function verdictOf(findings) {
  if (findings.some((f) => f.severity === 'hardStop')) return 'hardStop';
  if (findings.some((f) => f.severity === 'major')) return 'revise';
  return 'pass';
}

const normalise = (s) => s.toLowerCase().replace(/[“”"‘’'`]/g, '').replace(/[^a-z0-9£$%.]+/g, ' ').trim();

/** Quoted passages of six or more words in a message (straight or curly quotes). */
export function quotedPassages(message) {
  const out = [];
  for (const m of message.matchAll(/[“"]([^”"]+)[”"]/g)) if (wordCount(m[1]) >= 6) out.push(m[1]);
  return out;
}

const SCORE = /\b\d+(\.\d+)?\s*(\/|out of)\s*(5|10|100)\b/i;
const SCORE_WORDS = /\b(scor(e|es|ed|ing)|grade[sd]?|grading|rating|rated)\b/i;

/**
 * @param {object} review a schema-valid stage review
 * @param {{ stage: number, round: number, input: object }} request what was sent
 * @returns {{ ok: true, data: object, fixes: object[] } | { ok: false, errors: string[], fixes: object[] }}
 */
export function checkReview(review, { stage, round, input = {} }) {
  const fixes = [];
  const fix = (type, extra = {}) => fixes.push({ type, ...extra });
  const data = structuredClone(review);
  data.stage = stage;
  data.round = round;

  // Rule IDs exist and belong to this stage; severities are allowed (multi-rule: the most severe
  // value any of its rules allows).
  data.findings = data.findings.flatMap((f) => {
    const rules = f.rules.filter((id) => RULES[id]?.stages.includes(stage));
    if (rules.length < f.rules.length) fix('ruleNotInStage', { rules: f.rules.filter((id) => !rules.includes(id)) });
    if (!rules.length) {
      fix('findingDropped', { id: f.id });
      return [];
    }
    // A finding is at least as severe as the strictest rule it cites requires (L6 grouped with L1 is
    // a hard stop), and at most the most severe value any of its rules allows.
    const allowed = [...new Set(rules.flatMap((id) => RULES[id].allowed))];
    const floor = rules.map((id) => RULES[id].allowed.slice().sort((a, b) => ORDER.indexOf(b) - ORDER.indexOf(a))[0])
      .sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b))[0];
    let severity = f.severity;
    if (ORDER.indexOf(severity) > ORDER.indexOf(floor)) {
      severity = floor;
      fix('severityRaised', { id: f.id, from: f.severity, to: severity });
    } else if (!allowed.includes(severity)) {
      severity = rules.map((id) => RULES[id].severity).sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b))[0];
      fix('severityCorrected', { id: f.id, from: f.severity, to: severity });
    }
    return [{ ...f, rules, severity }];
  });

  const verdict = verdictOf(data.findings);
  if (data.verdict !== verdict) {
    fix('verdictMismatch', { model: data.verdict, engine: verdict });
    data.verdict = verdict;
  }
  if (verdict === 'hardStop' && data.whatWorks !== null) {
    fix('whatWorksStripped');
    data.whatWorks = null;
  }

  // Fields that belong to one stage only.
  const offerAllowed = stage === 1 && round >= caps.offerAtRound && !input.offerMade && verdict !== 'pass';
  if (data.offeredLead && !offerAllowed) {
    fix('offerStripped');
    data.offeredLead = null;
  }
  if (data.route !== null && !(stage === 2 || stage === 5)) {
    fix('routeStripped');
    data.route = null;
  }
  if (data.route === 'reupload' && !(stage === 2 && input.reuploadsLeft > 0)) {
    fix('reuploadStripped');
    data.route = null;
  }
  if (data.reopenStage !== null && !(stage === 5 && input.reopensLeft > 0)) {
    fix('reopenStripped');
    data.reopenStage = null;
  }
  if (data.impression !== null && !(stage === 4 && verdict === 'pass')) {
    fix('impressionStripped');
    data.impression = null;
  }

  // Decline responses: unknown ones dropped; a second push-back becomes an accept.
  const declined = (input.declines ?? []).map((d) => d.findingId);
  const pushedBefore = new Set((input.history ?? []).flatMap((h) => h.findings ?? []).filter((f) => f.pushBack).map((f) => f.findingId));
  data.declineResponses = data.declineResponses.filter((r) => {
    if (declined.includes(r.findingId)) return true;
    fix('declineResponseDropped', { findingId: r.findingId });
    return false;
  }).map((r) => {
    if (r.decision === 'pushBack' && pushedBefore.has(r.findingId)) {
      fix('secondPushBackConverted', { findingId: r.findingId });
      return { ...r, decision: 'accept' };
    }
    return r;
  });

  // What code can't fix: regenerate.
  const errors = [];
  if (data.findings.filter((f) => BLOCKING.has(f.severity)).length > caps.issuesShown) errors.push(REGENERATE.tooMany);
  const words = wordCount(data.message);
  if (words > caps.messageWordsMax) errors.push(REGENERATE.tooLong(words));
  const studentText = `${input.lead ?? ''} ${input.audience ?? ''}`;
  if (SCORE.test(data.message) || (SCORE_WORDS.test(data.message) && !SCORE_WORDS.test(studentText))) errors.push(REGENERATE.score);
  const missing = declined.filter((id) => !data.declineResponses.some((r) => r.findingId === id));
  if (missing.length) errors.push(REGENERATE.declineMissing(missing));
  if (stage === 1 && round < caps.offerAtRound) {
    const own = normalise(`${input.lead ?? ''} ${(input.history ?? []).map((h) => h.lead ?? '').join(' ')}`);
    if (quotedPassages(data.message).some((q) => !own.includes(normalise(q)))) errors.push(REGENERATE.leadRewrite);
  }
  return errors.length ? { ok: false, errors, fixes } : { ok: true, data, fixes };
}
