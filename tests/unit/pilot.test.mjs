// The pilot's Stage 1 judge (milestone 4): mustCatch by rule and severity, rule-named mustNot items,
// and the global checks; the rest is listed for Chris.
import { describe, expect, it } from 'vitest';
import { judgeStage1, stage1Request } from '../../scripts/pilot-run.mjs';

const f = (rules, severity) => ({ id: 'S1-1', rules, severity, location: 'lead', issue: 'i', fix: 'f' });
const data = (findings, extra = {}) => ({ verdict: 'hardStop', findings, whatWorks: null, offeredLead: null, message: 'Short message.', ...extra });
const exp = {
  verdict: 'hardStop',
  mustCatch: [{ stages: [1], rules: ['L2', 'L6'], severity: 'hardStop', point: 'p' }, { stages: [1], rules: ['L9', 'L10'], severity: 'major', point: 'p' }],
  mustNot: ['L7 as a fault (Chris: it is insightful)', 'Any comment on the chart'],
};

describe('judgeStage1', () => {
  it('passes when every mustCatch is raised at its severity and no rule-named mustNot is', () => {
    const j = judgeStage1(exp, data([f(['L6'], 'hardStop'), f(['L9', 'L10'], 'major')]), []);
    expect(j.ok).toBe(true);
    expect(j.forChris).toEqual(['Any comment on the chart']);
  });

  it('misses a wrong severity, a rule-named mustNot and the verdict', () => {
    const j = judgeStage1(exp, data([f(['L6'], 'major'), f(['L10'], 'major'), f(['L7'], 'hardStop')], { verdict: 'revise' }), []);
    expect(j.checks.filter((c) => c.ok === false).map((c) => c.check)).toEqual([
      'verdict', 'mustCatch L2/L6 (hardStop)', 'mustNot: L7 as a fault (Chris: it is insightful)',
    ]);
  });

  it('builds one round with the student’s lead', () => {
    expect(stage1Request({ audience: 'a', studentLead: 'b' }, { summary: 's' })).toEqual({
      stage: 1, round: 1, input: { audience: 'a', lead: 'b', round: 1, cap: 5, history: [], reading: { summary: 's' }, offerMade: false },
    });
  });
});
