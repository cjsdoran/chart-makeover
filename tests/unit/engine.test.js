// T-ENG-1..14 (CM-4, CM-5, CM-12, CMS-14; spec §5): the stage engine on canned reviews, no model.
import { describe, expect, it } from 'vitest';
import { createSession } from '../../src/store/session.js';
import { readingPatch } from '../../src/upload/sendChart.js';
import {
  acceptAllMinor, acceptFinding, applyReview, checklistState, chooseNameData, chooseRewriteLead, computeVerdict,
  confirmFit, confirmReading, declineFinding, finalChoice, moveOn, openBlocking, plannedPage, reopenStage,
  reviewRequest, sendDeclines, setComparison, stageFindings, submitLead,
} from '../../src/engine/engine.js';
import { config } from '../../shared/limits.js';

const READING = { readable: true, summary: 'I read this as revenue by club, 2009–24, in £m.', kind: 'data' };

function review(stage, findings = [], extra = {}) {
  const fs = findings.map((f, i) => ({ id: `S${stage}-${i + 1}`, location: 'chart', issue: 'issue', fix: `fix ${i + 1}`, ...f }));
  return {
    stage, round: 1, verdict: computeVerdict(fs), findings: fs, whatWorks: null, declineResponses: [],
    offeredLead: null, route: null, reopenStage: null, impression: null, message: `Stage ${stage} message`, ...extra,
  };
}
const major = (rule) => ({ rules: [rule], severity: 'major' });
const hard = (rule) => ({ rules: [rule], severity: 'hardStop' });
const minor = (rule) => ({ rules: [rule], severity: 'minor' });

/** A session with one confirmed-or-not upload, at Stage 1's lead box. */
function atLead({ isDummy = false } = {}) {
  const s = { ...createSession(), setup: { accessCode: 'x' }, step: 'upload' };
  const prepared = { meta: { fileName: 'c.pdf' }, upload: { kind: 'pdf' }, record: 'IMG' };
  return { ...s, ...readingPatch(s, { prepared, result: { reading: READING }, audience: 'The CFO', isDummy }).patch };
}

const ok = (r) => {
  if (r.error) throw new Error(r.error);
  return r.session;
};

function lead(s, text, rev) {
  return applyReview(ok(submitLead(s, text)), rev);
}

/** Through Stage 1 with a passing lead, into Stage 2 with the reading confirmed and the review due. */
function atDataFit() {
  const s = lead(atLead(), 'Man City outgrew its rivals', review(1));
  return ok(confirmReading(s));
}

function idsOf(s, stage) {
  return stageFindings(s.run, stage).map((f) => f.id);
}

describe('T-ENG-1: stages open strictly in order', () => {
  it('only Stage 1 is open at first; later stages are locked and refuse actions', () => {
    const s = atLead();
    expect(s.step).toBe('lead');
    expect(Object.values(s.run.stages).map((x) => x.status)).toEqual(['open', 'locked', 'locked', 'locked', 'locked']);
    expect(setComparison(s, 'Items').error).toBeTruthy();
    expect(confirmFit(s).error).toBeTruthy();
    expect(reopenStage(s, 2).error).toBeTruthy();
    expect(sendDeclines(s).error).toBeTruthy();
  });

  it('Stage 2 opens only after Stage 1 passes, with the reading to confirm and no call yet', () => {
    const s = lead(atLead(), 'A lead', review(1));
    expect(s.step).toBe('data');
    expect(s.run.stages[1].status).toBe('passed');
    expect(s.run.stages[2].status).toBe('open');
    expect(s.run.pending).toBeNull();
    expect(s.chat.at(-1)).toMatchObject({ kind: 'confirmReading', text: `${READING.summary} Right?` });
  });
});

describe('T-ENG-2: the verdict comes from the severities', () => {
  it('any hard stop → hardStop; any major → revise; else pass', () => {
    expect(computeVerdict([{ severity: 'minor' }, { severity: 'hardStop' }, { severity: 'major' }])).toBe('hardStop');
    expect(computeVerdict([{ severity: 'minor' }, { severity: 'major' }])).toBe('revise');
    expect(computeVerdict([{ severity: 'minor' }, { severity: 'suggestion' }])).toBe('pass');
    expect(computeVerdict([])).toBe('pass');
  });

  it("a model verdict that disagrees is overridden and logged", () => {
    const s = lead(atLead(), 'A lead', { ...review(1, [minor('L3')]), verdict: 'revise' });
    expect(s.run.reviews[0]).toMatchObject({ verdict: 'pass', modelVerdict: 'revise' });
    expect(s.run.log).toContainEqual(expect.objectContaining({ type: 'verdictMismatch', model: 'revise', engine: 'pass' }));
    expect(s.run.stages[1].status).toBe('passed');
  });
});

describe('T-ENG-3: Stage 1 gate', () => {
  it('passes only when the latest review has no blocking finding; earlier findings close on the rewrite', () => {
    let s = lead(atLead(), 'Revenue by club', review(1, [hard('L2'), minor('L3')]));
    expect(s.run.stages[1].status).toBe('open');
    expect(s.step).toBe('lead');
    const first = idsOf(s, 1);
    s = lead(s, 'Man City grew fastest', review(1, [minor('L4')]));
    expect(first.map((id) => s.run.findings[id].status)).toEqual(['closed', 'closed']);
    expect(s.run.stages[1].status).toBe('passed');
    expect(s.run.agreedLead).toBe('Man City grew fastest');
  });

  it('Stage 1 findings have no accept or decline', () => {
    const s = lead(atLead(), 'Revenue by club', review(1, [major('L1')]));
    expect(acceptFinding(s, idsOf(s, 1)[0]).error).toMatch(/rewrite the lead/);
  });
});

describe('T-ENG-4: the lead offer (CM-5)', () => {
  const offer = (s, text) => lead(s, text, review(1, [major('L1')], { offeredLead: 'Offered version' }));

  it('is stripped in rounds 1–2, kept in round 3 with a blocking finding, stripped the second time', () => {
    let s = offer(atLead(), 'one');
    expect(s.run.reviews[0].offeredLead).toBeNull();
    s = offer(s, 'two');
    expect(s.run.reviews[1].offeredLead).toBeNull();
    s = offer(s, 'three');
    expect(s.run.reviews[2].offeredLead).toBe('Offered version');
    expect(s.run.offerMade).toBe(true);
    s = offer(s, 'four');
    expect(s.run.reviews[3].offeredLead).toBeNull();
    expect(s.run.log.filter((l) => l.type === 'offerStripped')).toHaveLength(3);
  });

  it('is stripped on a pass, even in round 3', () => {
    let s = lead(atLead(), 'one', review(1, [major('L1')]));
    s = lead(s, 'two', review(1, [major('L1')]));
    s = lead(s, 'three', review(1, [], { offeredLead: 'Offered version' }));
    expect(s.run.reviews[2].offeredLead).toBeNull();
    expect(s.run.offerMade).toBe(false);
  });
});

describe('T-ENG-5: Stage 1 cap', () => {
  it('after round 5 moves on with the latest lead, flagged as moved on', () => {
    let s = atLead();
    for (let i = 1; i <= config.caps.leadRounds; i++) s = lead(s, `lead ${i}`, review(1, [major('L1')]));
    expect(s.run.stages[1].status).toBe('cappedOpen');
    expect(s.run.agreedLead).toBe('lead 5');
    expect(s.step).toBe('data');
    expect(s.chat.some((m) => m.kind === 'movedOn' && m.stage === 1)).toBe(true);
    expect(openBlocking(s.run, 1)).toHaveLength(1);
  });
});

describe('T-ENG-6: lead rounds count across a reopen', () => {
  it('2 rounds, pass, route back from Stage 2: the next lead is round 3 and may carry the offer', () => {
    let s = lead(atLead(), 'one', review(1, [major('L1')]));
    s = lead(s, 'two', review(1));
    s = ok(confirmReading(s));
    s = applyReview(s, review(2, [major('D1')], { route: { options: ['rewriteLead', 'nameData'] } }));
    s = ok(chooseRewriteLead(s));
    expect(s.step).toBe('lead');
    expect(s.run.stages[1]).toMatchObject({ status: 'open', roundsAllowed: 2 + config.caps.reopenedLeadRounds });
    const req = reviewRequest(ok(submitLead(s, 'three')));
    expect(req.round).toBe(3);
    s = lead(s, 'three', review(1, [major('L1')], { offeredLead: 'Offered version' }));
    expect(s.run.reviews.at(-1).offeredLead).toBe('Offered version');
  });
});

describe('T-ENG-7: accepting every blocking fix passes with no further call', () => {
  it('passes Stage 2 and opens Stage 3 with no review due', () => {
    let s = applyReview(atDataFit(), review(2, [major('D1'), hard('D10'), minor('D4')]));
    expect(checklistState(s.run, 2)).toBe('decide');
    const [a, b] = idsOf(s, 2);
    s = ok(acceptFinding(s, a));
    expect(s.run.stages[2].status).toBe('open');
    s = ok(acceptFinding(s, b));
    expect(s.run.stages[2].status).toBe('passed');
    expect(s.run.stages[2].roundsUsed).toBe(1);
    expect(s.step).toBe('chart');
    expect(s.run.pending).toBeNull();
  });

  it('refuses a decline with a reason under 10 characters', () => {
    const s = applyReview(atDataFit(), review(2, [major('D1')]));
    const id = idsOf(s, 2)[0];
    expect(declineFinding(s, id, 'too short').error).toMatch(/at least 10 characters/);
    expect(ok(declineFinding(s, id, 'The board asked for this cut')).run.findings[id]).toMatchObject({ status: 'declined', sent: false });
  });

  it('minor fixes never gate; Accept all accepts them', () => {
    let s = applyReview(atDataFit(), review(2, [major('D1'), minor('D4'), { rules: ['D8'], severity: 'suggestion' }]));
    const [m, a, b] = idsOf(s, 2);
    s = ok(acceptAllMinor(s, 2));
    expect([a, b].map((id) => s.run.findings[id].status)).toEqual(['accepted', 'accepted']);
    expect(s.run.stages[2].status).toBe('open');
    s = ok(acceptFinding(s, m));
    expect(s.run.stages[2].status).toBe('passed');
  });
});

describe('T-ENG-8: declines and push-back', () => {
  function declined() {
    let s = applyReview(atDataFit(), review(2, [major('D1'), major('D2')]));
    const [a, b] = idsOf(s, 2);
    s = ok(declineFinding(s, a, 'We only have this measure'));
    s = ok(declineFinding(s, b, 'The client defined it this way'));
    expect(checklistState(s.run, 2)).toBe('send');
    return { s: ok(sendDeclines(s)), a, b };
  }

  it('the next call carries the declines with their reasons', () => {
    const { s } = declined();
    expect(reviewRequest(s).input.declines).toEqual([
      { findingId: 'S2-1', reason: 'We only have this measure' },
      { findingId: 'S2-2', reason: 'The client defined it this way' },
    ]);
    expect(reviewRequest(s).round).toBe(2);
  });

  it('accept closes; pushBack shows two choices; either closes with finalChoice and no call', () => {
    let { s, a, b } = declined();
    s = applyReview(s, review(2, [], {
      declineResponses: [
        { findingId: 'S2-1', decision: 'accept', message: 'Fair enough.' },
        { findingId: 'S2-2', decision: 'pushBack', message: 'The board will read it the other way.' },
      ],
    }));
    expect(s.run.findings[a]).toMatchObject({ status: 'closed', reply: 'Fair enough.' });
    expect(s.run.findings[b]).toMatchObject({ status: 'pushedBack', pushBack: 'The board will read it the other way.' });
    expect(s.run.stages[2].status).toBe('open');
    expect(checklistState(s.run, 2)).toBe('decide');
    const kept = ok(finalChoice(s, b, 'keep'));
    expect(kept.run.findings[b]).toMatchObject({ status: 'closed', finalChoice: 'keep' });
    expect(kept.run.stages[2].status).toBe('passed');
    expect(kept.run.pending).toBeNull();
    const accepted = ok(finalChoice(s, b, 'acceptFix'));
    expect(accepted.run.findings[b]).toMatchObject({ status: 'accepted', finalChoice: 'acceptFix' });
  });

  it('a second push-back on the same finding is converted to accept and logged', () => {
    let { s, a } = declined();
    s = applyReview(s, review(2, [], {
      declineResponses: [
        { findingId: 'S2-1', decision: 'pushBack', message: 'Really?' },
        { findingId: 'S2-2', decision: 'accept', message: 'OK.' },
      ],
    }));
    // A finding that already has a push-back on record gets pushed back again.
    s = { ...s, run: { ...s.run, findings: { ...s.run.findings, [a]: { ...s.run.findings[a], status: 'declined', sent: false } } } };
    s = ok(sendDeclines(s));
    s = applyReview(s, review(2, [], { declineResponses: [{ findingId: 'S2-1', decision: 'pushBack', message: 'Again.' }] }));
    expect(s.run.findings[a].status).toBe('closed');
    expect(s.run.log).toContainEqual(expect.objectContaining({ type: 'secondPushBackConverted', findingId: 'S2-1' }));
  });
});

describe('T-ENG-9: Stage 2 routes', () => {
  const routed = () => applyReview(atDataFit(), review(2, [major('D1'), major('D3')], { route: { options: ['rewriteLead', 'nameData'] } }));

  it('Rewrite the lead reopens Stage 1 with 3 rounds; on its pass Stage 2 runs with leadChanged outside its cap', () => {
    let s = ok(chooseRewriteLead(routed()));
    expect(s.run.stages[1]).toMatchObject({ status: 'open', roundsAllowed: 1 + 3 });
    s = lead(s, 'A weaker but true lead', review(1));
    expect(s.step).toBe('data');
    expect(s.run.pending).toEqual({ stage: 2, leadChanged: true });
    expect(s.run.stages[2].roundsAllowed).toBe(config.caps.dataFitRounds + 1);
    expect(reviewRequest(s).input).toMatchObject({ leadChanged: true, lead: 'A weaker but true lead' });
    s = applyReview(s, review(2));
    expect(s.run.stages[2].status).toBe('passed');
    expect(stageFindings(s.run, 2).filter((f) => f.round === 1).map((f) => f.status)).toEqual(['superseded', 'superseded']);
  });

  it('Keep it and name the data adds to dataToSource and closes the data finding', () => {
    let s = routed();
    expect(chooseNameData(s, '  ').error).toBeTruthy();
    s = ok(chooseNameData(s, 'Club-level sponsorship values, 2009–24'));
    expect(s.run.dataToSource).toEqual(['Club-level sponsorship values, 2009–24']);
    expect(stageFindings(s.run, 2).map((f) => f.status)).toEqual(['closed', 'closed']);
    expect(s.run.stages[2].status).toBe('passed');
  });
});

describe('T-ENG-9 (cont.): decisions already made stand', () => {
  it('naming the data closes only undecided fixes; a decline keeps its own path', () => {
    let s = applyReview(atDataFit(), review(2, [major('D1'), major('D6')], { route: { options: ['rewriteLead', 'nameData'] } }));
    const [a, b] = idsOf(s, 2);
    s = ok(declineFinding(s, b, 'The CFO only needs the end values'));
    s = ok(chooseNameData(s, 'Sponsorship deal values'));
    expect(s.run.findings[a]).toMatchObject({ status: 'closed', resolution: 'nameData' });
    expect(s.run.findings[b]).toMatchObject({ status: 'declined', sent: false });
    expect(checklistState(s.run, 2)).toBe('send');
  });

  it('minor fixes stay open across rounds, so they can still be accepted', () => {
    let s = applyReview(atDataFit(), review(2, [major('D1'), minor('D4')]));
    const [m, n] = idsOf(s, 2);
    s = ok(sendDeclines(ok(declineFinding(s, m, 'We only have this measure'))));
    s = applyReview(s, review(2, [], { declineResponses: [{ findingId: 'S2-1', decision: 'accept', message: 'OK.' }] }));
    expect(s.run.stages[2].status).toBe('passed');
    expect(s.run.findings[n].status).toBe('open');
  });
});

describe('T-ENG-10: re-upload', () => {
  function reuploadRouted() {
    let s = applyReview(atDataFit(), review(2, [major('D1'), minor('D4')], { route: 'reupload' }));
    expect(s.step).toBe('upload');
    expect(s.run.reuploadsLeft).toBe(0);
    expect(s.chat.at(-1).text).toBe(config.messages.reupload);
    const prepared = { meta: { fileName: 'new.pdf' }, upload: { kind: 'pdf' }, record: 'IMG2' };
    s = { ...s, ...readingPatch(s, { prepared, result: { reading: { ...READING, summary: 'I read this as a scatter.' } } }).patch };
    return s;
  }

  it('the new upload is read and confirmed, Stage 3 opens on it, and old open Stage 2 findings are superseded', () => {
    let s = reuploadRouted();
    expect(s.run.activeUpload).toBe('u2');
    expect(s.step).toBe('data');
    expect(stageFindings(s.run, 2).map((f) => f.status)).toEqual(['superseded', 'superseded']);
    expect(s.chat.at(-1)).toMatchObject({ kind: 'confirmReading', text: 'I read this as a scatter. Right?' });
    s = ok(confirmReading(s));
    expect(s.step).toBe('chart');
    s = ok(setComparison(s, 'Relationship'));
    expect(reviewRequest(s).input.image).toBe('IMG2');
    expect(s.run.uploads).toHaveLength(2);
  });

  it('a second reupload route is refused when reuploadsLeft is 0', () => {
    let s = ok(confirmReading(reuploadRouted()));
    s = ok(setComparison(s, 'Relationship'));
    s = applyReview(s, { ...review(3, [major('C7')]), route: 'reupload' });
    expect(s.step).toBe('chart');
    expect(s.run.log).toContainEqual(expect.objectContaining({ type: 'reuploadStripped' }));
  });
});

describe('T-ENG-11: caps', () => {
  it('a stage at its cap with blocking findings open becomes cappedOpen and moves on', () => {
    let s = atDataFit();
    for (let round = 1; round <= config.caps.dataFitRounds; round++) {
      s = applyReview(s, review(2, [major('D1')]));
      const id = idsOf(s, 2).at(-1);
      s = ok(declineFinding(s, id, 'We disagree with this one'));
      if (round < config.caps.dataFitRounds) s = ok(sendDeclines(s));
    }
    expect(checklistState(s.run, 2)).toBe('moveOn');
    expect(sendDeclines(s).error).toBeTruthy();
    s = ok(moveOn(s));
    expect(s.run.stages[2].status).toBe('cappedOpen');
    expect(s.step).toBe('chart');
  });
});

function atFit() {
  let s = applyReview(atDataFit(), review(2, [major('D1'), major('D3')]));
  const [a, b] = idsOf(s, 2);
  s = ok(acceptFinding(s, a));
  s = ok(declineFinding(s, b, 'Like-for-like is fine here'));
  s = ok(sendDeclines(s));
  s = applyReview(s, review(2, [], { declineResponses: [{ findingId: 'S2-2', decision: 'accept', message: 'OK.' }] }));
  s = ok(setComparison(s, 'other', 'Share of wallet'));
  s = applyReview(s, review(3, [major('C2')]));
  s = ok(acceptFinding(s, idsOf(s, 3)[0]));
  s = applyReview(s, review(4, [hard('P2'), minor('P4')]));
  s = ok(acceptAllMinor(s, 4));
  s = ok(acceptFinding(s, idsOf(s, 4)[0]));
  return s;
}

describe('T-ENG-12: the planned page', () => {
  it('lists the agreed lead, accepted fixes in stage order, declines with reasons, data to source; it is the Stage 5 input', () => {
    const s = atFit();
    expect(s.step).toBe('fit');
    const page = plannedPage(s.run);
    expect(page.lead).toBe('Man City outgrew its rivals');
    expect(page.acceptedFixes.map((f) => [f.stage, f.rules[0]])).toEqual([[2, 'D1'], [3, 'C2'], [4, 'P2'], [4, 'P4']]);
    expect(page.declinedFixes).toEqual([expect.objectContaining({ stage: 2, rules: ['D3'], reason: 'Like-for-like is fine here' })]);
    expect(page.dataToSource).toEqual([]);
    expect(reviewRequest(s).input.plannedPage).toEqual(page);
    expect(s.chat.at(-1)).toMatchObject({ kind: 'plannedPage', page });
  });
});

describe('T-ENG-13: Stage 5 reopen', () => {
  it('one round in the reopened stage, then straight back to Stage 5, which can’t reopen again', () => {
    let s = applyReview(atFit(), review(5, [major('F4')], { reopenStage: 3 }));
    expect(s.run.reviews.at(-1).reopenStage).toBe(3);
    s = ok(reopenStage(s, 3));
    expect(s.step).toBe('chart');
    expect(s.run.stages[3].roundsAllowed).toBe(s.run.stages[3].roundsUsed + 1);
    s = applyReview(s, review(3, [major('C5')]));
    s = ok(declineFinding(s, idsOf(s, 3).at(-1), 'Emphasis is right as it is'));
    expect(checklistState(s.run, 3)).toBe('moveOn');
    s = ok(moveOn(s));
    expect(s.step).toBe('fit');
    expect(s.run.pending).toEqual({ stage: 5 });
    expect(s.run.reopensLeft).toBe(0);
    s = applyReview(s, review(5, [major('F4')], { reopenStage: 2 }));
    expect(s.run.reviews.at(-1).reopenStage).toBeNull();
    expect(reopenStage(s, 2).error).toMatch(/already reopened/);
    s = ok(confirmFit(s));
    expect(s.step).toBe('changes');
    expect(s.run.stages[5].status).toBe('cappedOpen');
  });

  it('a reopened Stage 1 gets three rounds, then returns to Stage 5', () => {
    let s = applyReview(atFit(), review(5));
    s = ok(reopenStage(s, 1));
    expect(s.step).toBe('lead');
    expect(s.run.stages[1].roundsAllowed).toBe(s.run.stages[1].roundsUsed + 3);
    s = lead(s, 'A sharper lead', review(1));
    expect(s.step).toBe('fit');
    expect(reviewRequest(s).input.plannedPage.lead).toBe('A sharper lead');
  });

  it('confirming a passing check opens Changes, with the dummy-chart line when the values are illustrative', () => {
    let s = applyReview(atFit(), review(5));
    s = { ...s, run: { ...s.run, isDummy: true } };
    s = ok(confirmFit(s));
    expect(s.run.stages[5].status).toBe('passed');
    expect(s.step).toBe('changes');
    expect(s.chat.at(-1).text).toBe(config.openers.lastMessage);
  });
});

describe('T-ENG-14: same lead twice', () => {
  it('is not sent and uses no round', () => {
    const s = lead(atLead(), 'Man City outgrew its rivals', review(1, [major('L1')]));
    const r = submitLead(s, '  man city OUTGREW its   rivals ');
    expect(r.error).toBe(config.messages.sameLead);
    expect(s.run.leads).toHaveLength(1);
    expect(s.run.pending).toBeNull();
  });
});

describe('requests (spec §6)', () => {
  it('Stage 2 sends the reading, the correction, the image and the cap', () => {
    let s = lead(atLead(), 'A lead', review(1));
    s = ok(confirmReading(s, 'It is £bn, not £m'));
    expect(reviewRequest(s)).toMatchObject({
      stage: 2, round: 1,
      input: { audience: 'The CFO', lead: 'A lead', reading: READING, readingCorrection: 'It is £bn, not £m', image: 'IMG', cap: 3, leadChanged: false, reuploadsLeft: 1, dataToSource: [] },
    });
  });

  it('Stage 4 adds isDummy and the accepted fixes from Stages 2–3', () => {
    let s = applyReview(atDataFit(), review(2, [major('D1')]));
    s = ok(acceptFinding(s, idsOf(s, 2)[0]));
    s = ok(setComparison(s, 'Time'));
    s = applyReview(s, review(3));
    expect(s.step).toBe('polish');
    expect(reviewRequest(s).input).toMatchObject({ isDummy: false, comparison: { type: 'Time', other: null }, acceptedFixes: [{ stage: 2, rules: ['D1'] }] });
  });
});
