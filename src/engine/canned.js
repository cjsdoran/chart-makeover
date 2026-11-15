// Canned reviews for milestone 3 (build brief): fixed replies in the shape /api/review will return,
// so the chat, the checklist and the engine can be clicked through with no model. Milestone 4
// replaces this with the real call; the UI shows a notice while it is in use.

const f = (stage, n, rules, severity, location, issue, fix) => ({ id: `S${stage}-${n}`, rules, severity, location, issue, fix });

function base(stage, round, extra) {
  return {
    stage, round, verdict: 'pass', findings: [], whatWorks: null, declineResponses: [], offeredLead: null,
    route: null, reopenStage: null, impression: null, message: '', ...extra,
  };
}

// Daniel answers declines: the first one sent gets one push-back, the rest are accepted.
function answers(input) {
  return (input.declines ?? []).map((d, i) => (i === 0
    ? { findingId: d.findingId, decision: 'pushBack', message: 'I hear you, but a CFO will read it the other way in ten seconds. Are you sure?' }
    : { findingId: d.findingId, decision: 'accept', message: 'Fair enough: keep it, and be ready to defend it.' }));
}

const STAGE1 = [
  (input) => base(1, 1, {
    verdict: 'hardStop',
    findings: [
      f(1, 1, ['L2'], 'hardStop', 'Your lead', `"${input.lead}" describes the chart; it doesn't say what it shows.`, 'State the finding: what happened, and how big.'),
      f(1, 2, ['L4'], 'minor', 'Your lead', 'No number.', 'Put the number that proves it in the lead.'),
    ],
    message: "That's a label, not a lead. So what? If the CFO remembers one thing from this page, what should it be?",
  }),
  () => base(1, 2, {
    verdict: 'revise',
    findings: [f(1, 1, ['L1'], 'major', 'Your lead', 'Two messages joined by "and".', 'Pick the one that answers their decision; drop the other.')],
    whatWorks: 'There is a real finding in there now.',
    message: 'Better: there is a finding now. But you are making two points. Which one helps them decide?',
  }),
  () => base(1, 3, {
    verdict: 'revise',
    findings: [f(1, 1, ['L10'], 'major', 'Your lead', 'The punchline comes last.', 'Lead with the conclusion, then the evidence.')],
    whatWorks: 'One message, with a number.',
    offeredLead: "Man City's commercial revenue grew three times faster than its rivals' after 2009.",
    message: 'Nearly there. The point is buried at the end. Here is one way to put it first; make it yours.',
  }),
  () => base(1, 4, { whatWorks: 'Conclusion first, one message, with the number.', message: "That's a lead. Let's see if the chart proves it." }),
];

function stage2(input) {
  if (input.leadChanged) return base(2, 1, { message: 'With the new lead, this data does the job.', whatWorks: 'The data now matches the claim.' });
  if (input.history.length === 0) {
    return base(2, 1, {
      verdict: 'revise',
      findings: [
        f(2, 1, ['D1'], 'major', 'The whole chart', 'The chart shows revenue, but the lead claims the deals were inflated.', 'Show sponsorship value against what comparable clubs got, or soften the lead.'),
        f(2, 2, ['D6'], 'major', 'The chart', "The lead's growth figure isn't on the chart.", 'Add the growth rate for each club, or label the start and end values.'),
        f(2, 3, ['D4'], 'minor', 'Comparators', 'Only five clubs.', 'Add the rest of the league as a grey band.'),
      ],
      route: { options: ['rewriteLead', 'nameData'] },
      message: "I read the data, and it doesn't prove your lead yet. Either rewrite the lead to what this shows, or keep it and tell me the data you'd need.",
    });
  }
  return base(2, input.history.length + 1, { declineResponses: answers(input), message: 'Thanks for the reasons. My answers are against each fix.' });
}

function stage3(input) {
  if (input.history.length === 0) {
    return base(3, 1, {
      verdict: 'revise',
      findings: [
        f(3, 1, ['C3'], 'major', 'The chart', 'Absolute revenue hides the growth the lead is about.', 'Index each club to 100 in 2009, or show the growth rate.'),
        f(3, 2, ['C5'], 'minor', 'Series colours', 'Every line has its own colour.', 'Grey the others and colour Man City only.'),
      ],
      whatWorks: 'A line chart is the right family for change over time.',
      message: `A ${input.comparison?.type === 'other' ? 'comparison like yours' : `${(input.comparison?.type ?? 'time').toLowerCase()} comparison`} wants the change to jump out. Right now it doesn't.`,
    });
  }
  return base(3, input.history.length + 1, { declineResponses: answers(input), message: 'Noted. My answers are against each fix.' });
}

function stage4(input) {
  if (input.history.length === 0) {
    return base(4, 1, {
      verdict: 'hardStop',
      findings: [
        f(4, 1, ['P2'], 'hardStop', 'Bottom of the slide', 'No source line.', 'Add "Source: …" bottom left, 12 pt.'),
        f(4, 2, ['P4'], 'minor', 'Gridlines', 'Heavy gridlines.', 'Remove them; label the end points instead.'),
        f(4, 3, ['P6'], 'minor', 'Axis labels', 'Values to one decimal place.', 'Round to whole £m.'),
        f(4, 4, ['P12'], 'suggestion', 'Title area', 'The page is plain.', 'A small annotation at the 2009 takeover would help the story.'),
      ],
      message: "No source, so nobody can check it. Fix that first; the rest is tidying.",
    });
  }
  return base(4, input.history.length + 1, { declineResponses: answers(input), impression: 'Decisive and focused.', message: 'Clean. The page reads as decisive and focused.' });
}

function stage5(input) {
  return base(5, (input.history?.length ?? 0) + 1, {
    findings: [f(5, 1, ['F6'], 'minor', 'Placement', 'This could be the storyline page or an appendix.', 'Put it in the storyline: it carries the argument.')],
    whatWorks: 'In ten seconds the lead and the chart say the same thing.',
    message: 'I can see the point in ten seconds, and the chart backs it. Confirm it, or reopen a stage if you want another go.',
  });
}

/**
 * Same shape as the review call's browser result: `{ ok: true, result: { data } }`.
 * @param {{ stage: number, round: number, input: object }} request
 */
export async function cannedReview(request, { delayMs = 600 } = {}) {
  await new Promise((r) => setTimeout(r, delayMs));
  const { stage, round, input } = request;
  const data = stage === 1
    ? STAGE1[Math.min(round, STAGE1.length) - 1](input)
    : { 2: stage2, 3: stage3, 4: stage4, 5: stage5 }[stage](input);
  return { ok: true, result: { data: { ...data, round } } };
}
