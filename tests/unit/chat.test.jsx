// @vitest-environment jsdom
// T-CHAT-1..6 and 8 (CM-5, CM-7, CMS-12, CMS-13): the stage chat on canned reviews, no model.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '../../src/App.jsx';
import { createSession, loadSaved, saveSession } from '../../src/store/session.js';
import { readingPatch } from '../../src/upload/sendChart.js';
import { cannedReview } from '../../src/engine/canned.js';
import { config } from '../../shared/limits.js';
import { memoryStorage } from '../helpers/storage.js';

afterEach(cleanup);

const READING = { readable: true, kind: 'data', summary: 'I read this as commercial revenue by club, 2008/09 to 2024/25, in £m.' };

function seeded() {
  const s = { ...createSession(), setup: { accessCode: 'code', name: 'Mei Chan', studentId: '1', team: '', caseName: 'Man City' }, step: 'upload' };
  const prepared = { meta: { fileName: 'C01.pptx' }, upload: { kind: 'pptx' }, record: null };
  const session = { ...s, ...readingPatch(s, { prepared, result: { reading: READING }, audience: 'The CFO', isDummy: false }).patch };
  const storage = memoryStorage();
  saveSession(session, storage);
  return storage;
}

function start() {
  const storage = seeded();
  const review = vi.fn((req) => cannedReview(req, { delayMs: 0 }));
  render(<App storage={storage} screens={{ review }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Resume where you left off' }));
  return { storage, review };
}

async function sendLead(text) {
  fireEvent.change(screen.getByLabelText('The one thing you want them to remember'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Send to Daniel' }));
  await waitFor(() => expect(screen.queryByText(/Daniel is reading your lead/)).toBeNull());
}

/** Through Stage 1 (4 canned rounds) and the reading, to Stage 2's checklist. */
async function toDataFit() {
  const ctx = start();
  for (const t of ['Revenue by club', 'Man City grew and others fell', 'Others fell while Man City grew', 'Man City grew three times faster']) await sendLead(t);
  fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
  await screen.findByText(/doesn't prove your lead yet/);
  return ctx;
}

describe('T-CHAT-8 and T-CHAT-6: Stage 1 on screen', () => {
  it('findings show as a compact list with rule and severity in words, and no accept or decline', async () => {
    start();
    expect(screen.getByText('Round 1 of 5')).toBeTruthy();
    await sendLead('Revenue by club');
    const list = screen.getByRole('list', { name: 'What Daniel found' });
    expect(within(list).getByText('L2')).toBeTruthy();
    expect(within(list).getByText('Hard stop')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Decline' })).toBeNull();
    expect(screen.getByText('Round 2 of 5')).toBeTruthy();
  });

  it('the offer shows in a quoted box; Use this as a starting point fills the lead box but sends nothing', async () => {
    const { review } = start();
    for (const t of ['one', 'two', 'three']) await sendLead(t);
    const offer = config.caps.offerAtRound && "Man City's commercial revenue grew three times faster than its rivals' after 2009.";
    expect(screen.getByText(offer).closest('blockquote')).toBeTruthy();
    const calls = review.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Use this as a starting point' }));
    expect(screen.getByLabelText('The one thing you want them to remember').value).toBe(offer);
    expect(review.mock.calls.length).toBe(calls);
  });

  it('the same lead twice is refused without a call', async () => {
    const { review } = start();
    await sendLead('Revenue by club');
    fireEvent.change(screen.getByLabelText('The one thing you want them to remember'), { target: { value: 'revenue BY club' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send to Daniel' }));
    expect(screen.getByRole('alert').textContent).toContain(config.messages.sameLead);
    expect(review).toHaveBeenCalledTimes(1);
  });
});

describe('T-CHAT-7: a failed review call', () => {
  it('shows the error with its code; Ask Daniel again reruns only that call', async () => {
    const storage = seeded();
    const review = vi.fn()
      .mockResolvedValueOnce({ ok: false, message: "Daniel couldn't reply just now. Try again in a minute.", code: 'CM-S03', final: false })
      .mockImplementation((req) => cannedReview(req, { delayMs: 0 }));
    render(<App storage={storage} screens={{ review }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Resume where you left off' }));
    fireEvent.change(screen.getByLabelText('The one thing you want them to remember'), { target: { value: 'Revenue by club' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send to Daniel' }));
    expect((await screen.findByRole('alert')).textContent).toContain('CM-S03');
    fireEvent.click(screen.getByRole('button', { name: 'Ask Daniel again' }));
    await screen.findByRole('list', { name: 'What Daniel found' });
    expect(review).toHaveBeenCalledTimes(2);
    expect(review.mock.calls[1][0]).toEqual(review.mock.calls[0][0]);
    expect(loadSaved(storage).session.run.leads).toHaveLength(1);
  });
});

describe('T-CHAT-4: reading confirmation', () => {
  it('Correct it takes up to 300 characters, stored and sent as readingCorrection', async () => {
    const { review, storage } = start();
    for (const t of ['a', 'b', 'c', 'd']) await sendLead(t);
    expect(screen.getByText(`${READING.summary} Right?`)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Correct it' }));
    const box = screen.getByLabelText('What did Daniel get wrong?');
    fireEvent.change(box, { target: { value: 'x'.repeat(301) } });
    expect(screen.getByRole('button', { name: 'Send the correction' }).disabled).toBe(true);
    fireEvent.change(box, { target: { value: 'It is in £bn, not £m' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send the correction' }));
    await waitFor(() => expect(review.mock.calls.at(-1)[0].stage).toBe(2));
    expect(review.mock.calls.at(-1)[0].input.readingCorrection).toBe('It is in £bn, not £m');
    expect(loadSaved(storage).session.run.uploads[0]).toMatchObject({ readingConfirmed: true, readingCorrection: 'It is in £bn, not £m' });
  });
});

describe('T-CHAT-3 and T-CHAT-1: the checklist', () => {
  it('Accept and Decline per blocking fix; Decline needs a reason; minors collapsed with Accept all', async () => {
    await toDataFit();
    const cards = screen.getAllByRole('article').filter((a) => !a.closest('details'));
    expect(cards).toHaveLength(2);
    for (const c of cards) {
      expect(within(c).getByRole('button', { name: 'Accept' })).toBeTruthy();
      expect(within(c).getByRole('button', { name: 'Decline' })).toBeTruthy();
      expect(within(c).getByText('Major')).toBeTruthy();
    }
    const minors = screen.getByText(/Minor fixes \(1\)/).closest('details');
    expect(minors.open).toBe(false);
    expect(within(minors).getByRole('button', { name: 'Accept all minor fixes' })).toBeTruthy();

    fireEvent.click(within(cards[0]).getByRole('button', { name: 'Decline' }));
    fireEvent.change(within(cards[0]).getByLabelText('Why are you keeping it as it is?'), { target: { value: 'too short' } });
    fireEvent.click(within(cards[0]).getByRole('button', { name: 'Decline this fix' }));
    expect(within(cards[0]).getByRole('alert').textContent).toMatch(/at least 10 characters/);
  });

  it('messages render in order, Daniel and the student alternating, severity in words', async () => {
    await toDataFit();
    const items = within(screen.getByRole('list', { name: 'Conversation with Daniel' })).getAllByRole('listitem')
      .filter((li) => li.classList.contains('msg'));
    const who = items.map((li) => (li.classList.contains('daniel') ? 'D' : 'S')).join('');
    // Opener; four leads and reviews; the reading; Yes; "Does this data prove your lead?"; the review.
    expect(who).toBe('D' + 'SD'.repeat(4) + 'D' + 'S' + 'DD');
  });

  it('accepting both blocking fixes passes Data fit with no further call and opens the comparison picker', async () => {
    const { review } = await toDataFit();
    fireEvent.click(screen.getByRole('button', { name: 'Keep it and name the data' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    // The route buttons replace the input; the checklist above stays live.
    const calls = review.mock.calls.length;
    const cards = screen.getAllByRole('article').filter((a) => !a.closest('details'));
    fireEvent.click(within(cards[0]).getByRole('button', { name: 'Accept' }));
    fireEvent.click(within(cards[1]).getByRole('button', { name: 'Accept' }));
    // The route is still offered, so the stage waits for the student's choice.
    fireEvent.click(screen.getByRole('button', { name: 'Keep it and name the data' }));
    fireEvent.change(screen.getByLabelText('What data would prove your lead?'), { target: { value: 'Sponsorship values for comparable clubs' } });
    fireEvent.click(screen.getByRole('button', { name: 'Keep the lead' }));
    expect(review.mock.calls.length).toBe(calls);
    expect(screen.getByRole('group', { name: config.openers.stage3 })).toBeTruthy();
  });
});

describe('T-CHAT-5: comparison picker', () => {
  it('six options and Something else with text; required', async () => {
    const { review } = await toDataFit();
    for (const c of screen.getAllByRole('article').filter((a) => !a.closest('details'))) fireEvent.click(within(c).getByRole('button', { name: 'Accept' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep it and name the data' }));
    fireEvent.change(screen.getByLabelText('What data would prove your lead?'), { target: { value: 'Comparable sponsorship deals' } });
    fireEvent.click(screen.getByRole('button', { name: 'Keep the lead' }));
    const group = screen.getByRole('group', { name: config.openers.stage3 });
    expect(within(group).getAllByRole('radio').map((r) => r.labels[0].textContent)).toEqual([...config.comparisonOptions, 'Something else']);
    fireEvent.click(screen.getByRole('button', { name: 'Send to Daniel' }));
    expect(screen.getByRole('alert').textContent).toMatch(/Choose a kind of comparison/);
    fireEvent.click(within(group).getByLabelText('Something else'));
    fireEvent.click(screen.getByRole('button', { name: 'Send to Daniel' }));
    expect(screen.getByRole('alert').textContent).toMatch(/Say what kind/);
    fireEvent.change(screen.getByLabelText('What kind of comparison?'), { target: { value: 'Growth against peers' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send to Daniel' }));
    await waitFor(() => expect(review.mock.calls.at(-1)[0].stage).toBe(3));
    expect(review.mock.calls.at(-1)[0].input.comparison).toEqual({ type: 'other', other: 'Growth against peers' });
  });
});

describe('T-CHAT-2: the tracker', () => {
  it('shows passed, current and to do in words', async () => {
    start();
    for (const t of ['a', 'b', 'c', 'd']) await sendLead(t);
    const tracker = screen.getByRole('navigation', { name: 'Stages' });
    const text = tracker.textContent;
    expect(text).toContain('Lead(passed)');
    expect(text).toContain('Data fit(current)');
    expect(text).toContain('Polish(to do)');
  });

  it('shows moved on for a stage that hit its cap', async () => {
    start();
    // Canned Stage 1 passes at round 4; cap Stage 1 at 3 rounds by making every lead fail.
    cleanup();
    const storage = seeded();
    const review = vi.fn((req) => cannedReview({ ...req, round: Math.min(req.round, 2) }, { delayMs: 0 }));
    render(<App storage={storage} screens={{ review }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Resume where you left off' }));
    for (let i = 1; i <= config.caps.leadRounds; i++) await sendLead(`lead ${i}`);
    expect(screen.getByRole('navigation', { name: 'Stages' }).textContent).toContain('Lead(moved on)');
  });
});
