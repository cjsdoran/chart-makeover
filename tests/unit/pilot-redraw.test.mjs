// P-3's harness (CMS-9): the saved P-2 runs replay through the engine to the planned page with no
// model calls, and the code QA checks judge a spec. The plan call itself runs only when Chris asks.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { latestChartRun, qaChecks, replay } from '../../scripts/pilot-redraw.mjs';
import { redrawRequest } from '../../src/engine/engine.js';
import { planSlide } from '../../src/redraw/layout.js';
import { SPECS } from '../helpers/redrawSpecs.js';

const expected = JSON.parse(readFileSync('calibration/expected.json', 'utf8'));

// pilot/ is git-ignored: these run where the P-2 runs are saved (Chris's machine), and skip elsewhere.
describe.skipIf(!existsSync('pilot/read-test'))('P-3 replay (dry)', () => {
  it.each(['C02', 'C07', 'C08', 'C10'])('%s reaches Changes from its saved P-2 run, with the agreed lead', async (id) => {
    const c = expected.cases[id];
    const run = latestChartRun(id);
    expect(run).toBeTruthy();
    const reading = JSON.parse(readFileSync(`pilot/read-test/${id}.reading.json`, 'utf8'));
    const session = await replay(c, id, run.saved, reading);
    expect(session.step).toBe('changes');
    const { input } = redrawRequest(session);
    expect(input.lead).toBe((c.agreedLead ?? c.pilotLead).text);
    expect(input.acceptedFixes.length).toBeGreaterThan(0);
  });

  it('the code QA checks pass a good slide and catch a changed title', () => {
    const input = { lead: SPECS.line.title, declinedFixes: [] };
    expect(qaChecks(SPECS.line, planSlide(SPECS.line), input).filter((x) => !x.ok)).toEqual([]);
    const changed = { ...SPECS.line, title: 'Another title' };
    expect(qaChecks(changed, planSlide(changed), input).find((x) => x.check.startsWith('title is the agreed lead')).ok).toBe(false);
  });
});
