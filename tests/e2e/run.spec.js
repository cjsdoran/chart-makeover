// T-E2E-1..2 (tests/test-plan.md): whole runs in a real browser with every /api call mocked, so
// nothing reaches the model. Stage reviews are the canned ones (src/engine/canned.js); the redraw
// plan is a fixed spec with the student's lead as its title. The .pptx and the record are built in
// the browser and downloaded, as for a student.
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { cannedReview } from '../../src/engine/canned.js';
import { SPECS } from '../helpers/redrawSpecs.js';

const config = JSON.parse(readFileSync('config/app.json', 'utf8'));
// RT-1's readings of the two calibration charts (model output, saved as fixtures).
const READINGS = { C07: 'tests/fixtures/readings/C07.reading.json', C08: 'tests/fixtures/readings/C08.reading.json' };
const ndjson = (event) => ({ status: 200, contentType: 'application/x-ndjson', body: `${JSON.stringify({ type: 'meta', promptVersion: 'e2e' })}\n${JSON.stringify(event)}\n` });

/** Mocks the four functions. `reviewFor(request)` can replace a canned review. */
async function mockApi(page, { caseId, reviewFor = () => null } = {}) {
  const calls = { read: 0, review: [], redraw: [] };
  await page.route('**/api/check', (route) => route.fulfill({ status: 204 }));
  await page.route('**/api/read-chart', (route) => {
    calls.read += 1;
    const reading = JSON.parse(readFileSync(READINGS[caseId], 'utf8'));
    return route.fulfill(ndjson({ type: 'result', reading, promptVersion: 'read-chart e2e', servedBy: 'mock' }));
  });
  await page.route('**/api/review', async (route) => {
    const req = route.request().postDataJSON();
    calls.review.push({ stage: req.stage, round: req.round, input: req.input });
    const data = reviewFor(req) ?? (await cannedReview(req, { delayMs: 0 })).result.data;
    return route.fulfill(ndjson({ type: 'result', data, promptVersion: `stage${req.stage} e2e`, rulesVersion: config.rulesVersion, servedBy: 'mock' }));
  });
  await page.route('**/api/redraw-plan', (route) => {
    const req = route.request().postDataJSON();
    calls.redraw.push(req.input);
    // Two calls (D80): the chart, then the whole slide.
    if (req.part === 'chart') return route.fulfill(ndjson({ type: 'result', part: 'chart', chart: { ...SPECS.line }, promptVersion: 'redraw-plan e2e', servedBy: 'mock' }));
    const spec = { ...SPECS.line, title: req.input.lead, leadNumbers: [], notes: { ...SPECS.line.notes, agreedLead: req.input.lead, declinedFixes: req.input.declinedFixes.map(({ fix, reason }) => ({ fix, reason })) } };
    return route.fulfill(ndjson({ type: 'result', part: 'finish', spec, promptVersion: 'redraw-plan e2e', servedBy: 'mock' }));
  });
  return calls;
}

/** T-A11Y-1: axe finds no serious or critical issue on the screen as it is. */
async function axe(page, where) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  const bad = violations.filter((v) => ['serious', 'critical'].includes(v.impact));
  expect(bad.map((v) => `${where}: ${v.id} (${v.nodes.length})`)).toEqual([]);
}

async function setup(page, { open = true } = {}) {
  if (open) await page.goto('/');
  await page.getByLabel('Access code').fill('class-code');
  await page.getByLabel('Your name').fill('Ada Lovelace');
  await page.getByLabel('Student ID').fill('20871234');
  await page.getByLabel('Case or project name').fill('Pearl River');
  await page.getByRole('button', { name: 'Continue to Daniel' }).click();
}

async function upload(page, file, audience) {
  await page.locator('#upload-file').setInputFiles(file);
  if (audience) await page.getByLabel(config.openers.setup).fill(audience);
  await page.getByRole('button', { name: 'Send to Daniel' }).click();
}

async function sendLead(page, text) {
  await page.getByLabel('The one thing you want them to remember').fill(text);
  await page.getByRole('button', { name: 'Send to Daniel' }).click();
  await expect(page.getByText(/Daniel is reading your lead/)).toHaveCount(0);
}

const fixes = (page) => page.getByLabel('Your fixes');
const card = (page, rule) => page.locator('article.finding').filter({ has: page.locator('.rule', { hasText: rule }) }).last();

async function throughStages3to5(page) {
  // Stage 3: the comparison, then decline the major fix; Daniel pushes back once; keep the choice.
  await page.getByLabel('Time', { exact: true }).check();
  await page.getByRole('button', { name: 'Send to Daniel' }).click();
  await card(page, 'C3').getByRole('button', { name: 'Decline' }).click();
  await card(page, 'C3').getByLabel('Why are you keeping it as it is?').fill('The CFO wants absolute tonnes, not an index');
  await card(page, 'C3').getByRole('button', { name: 'Decline this fix' }).click();
  await fixes(page).getByRole('button', { name: 'Send to Daniel' }).click();
  await card(page, 'C3').getByRole('button', { name: 'Keep my choice' }).click();
  await fixes(page).getByRole('button', { name: 'Accept all minor fixes' }).click();
  // Stage 4: accept the hard stop and the minors.
  await card(page, 'P2').getByRole('button', { name: 'Accept' }).click();
  await fixes(page).getByRole('button', { name: 'Accept all minor fixes' }).click();
  // Stage 5: the planned page, Daniel's check, confirm.
  await expect(page.getByRole('region', { name: 'The planned page' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'The page works: confirm it' }).click();
}

async function buildAndDownload(page, calls) {
  await page.getByRole('button', { name: 'Make these changes' }).click();
  await expect(page.getByText(/Here's the slide:/)).toBeVisible();
  await expect(page.getByText(config.openers.lastMessage)).toBeVisible();
  await expect(page.getByAltText(/Preview of version 1 of the slide/)).toBeVisible();
  const pptxDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download version 1 (.pptx)' }).click();
  const pptx = await pptxDownload;
  expect(pptx.suggestedFilename()).toMatch(/^MGMT5760_PearlRiver_ChartMakeover_20871234_[A-Z2-7]{8}_illustrative\.pptx$/);
  const pptxBytes = readFileSync(await pptx.path());
  expect(pptxBytes.subarray(0, 2).toString()).toBe('PK');
  expect(calls.redraw).toHaveLength(2);

  const recordDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download the record (PDF)' }).click();
  const record = await recordDownload;
  expect(record.suggestedFilename()).toMatch(/^MGMT5760_PearlRiver_ChartMakeover_20871234_[A-Z2-7]{8}\.pdf$/);
  expect(readFileSync(await record.path()).subarray(0, 5).toString()).toBe('%PDF-');
  await expect(page.getByText('This run has ended. Start a new run to work on another chart.')).toBeVisible();
  return readFileSync(await record.path());
}

test('T-E2E-1: setup → upload C07 → five stages with a decline and push-back → the slide → the record', async ({ page }) => {
  const calls = await mockApi(page, { caseId: 'C07' });
  await page.goto('/');
  await axe(page, 'setup');
  await setup(page, { open: false });
  await upload(page, 'calibration/inputs/C07_pearl_river_margin.pptx', 'The CFO, deciding whether to push price rises in 2026');
  await expect(page.getByText(config.openers.stage1)).toBeVisible();
  for (const lead of ['Price and cost by quarter', 'Margin fell and costs rose', 'Costs rose and margin fell', 'Push price rises in 2026 to recover margin']) await sendLead(page, lead);
  await page.getByRole('button', { name: 'Yes' }).click();

  // Stage 2: the route; keep the lead and name the data, then the minor fix.
  await page.getByRole('button', { name: 'Keep it and name the data' }).click();
  await page.getByLabel('What data would prove your lead?').fill('Competitor price moves, 2024–2025');
  await page.getByRole('button', { name: 'Keep the lead' }).click();
  await axe(page, 'Stage 2');
  await fixes(page).getByRole('button', { name: 'Accept all minor fixes' }).click();

  await throughStages3to5(page);
  await buildAndDownload(page, calls);
  await axe(page, 'Changes and record');
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await axe(page, 'Changes at 375 px');

  expect(calls.read).toBe(1);
  expect(calls.review.map((c) => c.stage)).toEqual([1, 1, 1, 1, 2, 3, 3, 4, 5]);
  const plan = calls.redraw[0];
  expect(plan.lead).toBe('Push price rises in 2026 to recover margin');
  expect(plan.declinedFixes).toHaveLength(1);
  expect(plan.declinedFixes[0].reason).toBe('The CFO wants absolute tonnes, not an index');
  expect(plan.dataToSource).toEqual(['Competitor price moves, 2024–2025']);
});

test('T-E2E-2: C08 → rewrite the lead → re-upload → Stages 3–5 on the new chart', async ({ page }) => {
  const calls = await mockApi(page, {
    caseId: 'C08',
    // After the rewritten lead, Stage 2 asks for a redrawn chart (CM-12).
    reviewFor: (req) => (req.stage === 2 && req.input.leadChanged
      ? { stage: 2, round: req.round, verdict: 'pass', findings: [], whatWorks: null, declineResponses: [], offeredLead: null, route: 'reupload', reopenStage: null, impression: null, message: 'The new lead needs a scatter, not two lines. Redraw it and send it to me.' }
      : null),
  });
  await setup(page);
  await upload(page, 'calibration/inputs/C08_aster_moss_dual_axis.png', 'The CMO, deciding next year\'s marketing budget');
  for (const lead of ['Spend and sales by month', 'Spend rose and sales rose', 'Sales rose and spend rose', 'Marketing spend drives sales']) await sendLead(page, lead);
  await page.getByRole('button', { name: 'Yes' }).click();

  await page.getByRole('button', { name: 'Rewrite the lead' }).click();
  await sendLead(page, 'Marketing spend has a weak correlation with sales');
  await expect(page.getByText(config.messages.reupload)).toBeVisible();
  await upload(page, 'calibration/inputs/C08_aster_moss_dual_axis.png');
  await page.getByRole('button', { name: 'Yes' }).click();

  await throughStages3to5(page);
  const record = await buildAndDownload(page, calls);

  expect(calls.read).toBe(2);
  const stage2 = calls.review.filter((c) => c.stage === 2);
  expect(stage2.at(-1).input.leadChanged).toBe(true);
  expect(calls.review.filter((c) => c.stage === 3)[0].input.reading).toBeTruthy();
  expect(record.length).toBeGreaterThan(20000);
});
