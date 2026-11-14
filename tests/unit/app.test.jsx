// @vitest-environment jsdom
// The setup screen and the set-up chat in the app: T-SET-1, T-SU-1, T-SU-2, T-READ-3/4 on screen,
// T-UP-4 on screen, T-CHAT-7's waiting line and Ask Daniel again, T-SAV-1 (resume), CM-7's tracker.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '../../src/App.jsx';
import { validateSetup, emptySetup } from '../../src/setup/validate.js';
import { checkAccessCode } from '../../src/api.js';
import { loadSaved, saveSession, createSession } from '../../src/store/session.js';
import { config } from '../../shared/limits.js';
import { memoryStorage } from '../helpers/storage.js';

afterEach(cleanup);

const valid = () => ({ accessCode: 'code', name: 'Mei Chan', studentId: '20871234', team: '', caseName: 'Kestrel Pacific' });
const READING = { readable: true, unreadableReason: null, kind: 'data', summary: 'I read this as revenue by business, 2025, in HK$m.' };
const PREPARED = { ok: true, upload: { kind: 'pptx', pptx: { shapes: 'S' } }, record: null, meta: { fileName: 'C04.pptx' } };

describe('T-SET-1: validateSetup', () => {
  it('accepts a complete setup; team is optional', () => {
    expect(validateSetup(valid())).toEqual({ ok: true, errors: [] });
  });

  it('names every missing required field, in screen order', () => {
    expect(validateSetup(emptySetup()).errors.map((e) => e.message)).toEqual([
      'Enter the access code from Canvas.',
      'Enter your name.',
      'Enter your student ID.',
      'Enter the case or project name.',
    ]);
  });

  it('applies the 60-, 20-, 40- and 40-character limits', () => {
    expect(validateSetup({ ...valid(), name: 'n'.repeat(60), studentId: 's'.repeat(20), team: 't'.repeat(40), caseName: 'c'.repeat(40) }).ok).toBe(true);
    const errs = validateSetup({ ...valid(), name: 'n'.repeat(61), studentId: 's'.repeat(21), team: 't'.repeat(41), caseName: 'c'.repeat(41) }).errors;
    expect(errs.map((e) => e.field)).toEqual(['setup-name', 'setup-studentId', 'setup-team', 'setup-caseName']);
    expect(errs[3].message).toBe('Case or project name must be 40 characters or fewer.');
  });
});

describe('T-SET-1: checkAccessCode', () => {
  it('maps 204 to ok and 401 to the Canvas message with CM-S02; sends the code in X-CM-Access-Code', async () => {
    expect(await checkAccessCode('x', async () => new Response(null, { status: 204 }))).toEqual({ ok: true });
    expect(await checkAccessCode('x', async () => new Response('{}', { status: 401 }))).toEqual({
      ok: false, status: 401, code: 'CM-S02', message: "That access code isn't recognised. Check Canvas.",
    });
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    await checkAccessCode('secret', fetchImpl);
    expect(fetchImpl.mock.calls[0][1].headers['X-CM-Access-Code']).toBe('secret');
  });
});

function fillSetup(values) {
  const set = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
  set('Access code', values.accessCode);
  set('Your name', values.name);
  set('Student ID', values.studentId);
  set('Team (optional)', values.team);
  set('Case or project name', values.caseName);
}

async function toChat(storage, screens = {}) {
  render(<App storage={storage} screens={{ check: vi.fn(async () => ({ ok: true })), ...screens }} />);
  fillSetup(valid());
  fireEvent.click(screen.getByRole('button', { name: 'Continue to Daniel' }));
  await screen.findByRole('heading', { name: 'Your chart' });
}

const pick = (label, name) => fireEvent.change(screen.getByLabelText(label), { target: { files: [new File(['x'], name)] } });
const audience = (text) => fireEvent.change(screen.getByLabelText(config.openers.setup), { target: { value: text } });
const send = () => screen.getByRole('button', { name: 'Send to Daniel' });

describe('setup screen', () => {
  it('shows the error summary on submit and does not call the server', () => {
    const check = vi.fn();
    render(<App storage={memoryStorage()} screens={{ check }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue to Daniel' }));
    expect(screen.getByRole('heading', { name: 'Fix these 4 things to continue' })).toBeTruthy();
    expect(check).not.toHaveBeenCalled();
  });

  it('shows a bad access code against its field', async () => {
    const check = vi.fn(async () => ({ ok: false, status: 401, code: 'CM-S02', message: "That access code isn't recognised. Check Canvas." }));
    render(<App storage={memoryStorage()} screens={{ check }} />);
    fillSetup(valid());
    fireEvent.click(screen.getByRole('button', { name: 'Continue to Daniel' }));
    await screen.findByText("That access code isn't recognised. Check Canvas. (Error code: CM-S02)");
    expect(screen.getByLabelText('Access code').getAttribute('aria-invalid')).toBe('true');
  });

  it("opens the set-up chat with Daniel's opening message; header, tracker and footer", async () => {
    const storage = memoryStorage();
    await toChat(storage);
    expect(screen.getByText(config.messages.opening)).toBeTruthy();
    const crumbs = within(screen.getByRole('list', { name: 'Engagement' })).getAllByRole('listitem').map((li) => li.textContent);
    expect(crumbs).toEqual(['Halden & Rowe', 'Chart Makeover', 'Kestrel Pacific', 'Mei Chan']);
    const tracker = screen.getByRole('navigation', { name: 'Stages' });
    expect(tracker.textContent).toContain('Set-up(current)');
    expect(tracker.textContent).toContain('Lead(to do)');
    expect(screen.getByRole('contentinfo').textContent).toBe('MGMT 5760 practice tool. Feedback is AI-generated; you remain responsible for your work.');
    const saved = loadSaved(storage).session;
    expect(saved).toMatchObject({ step: 'upload', setup: { name: 'Mei Chan', caseName: 'Kestrel Pacific', team: '' } });
  });
});

describe('T-SU-1: Send to Daniel', () => {
  it('stays disabled until a file and an audience line of 1–300 characters are in', async () => {
    await toChat(memoryStorage());
    expect(send().disabled).toBe(true);
    pick('One chart', 'chart.pdf');
    expect(send().disabled).toBe(true);
    audience('   ');
    expect(send().disabled).toBe(true);
    audience('a'.repeat(301));
    expect(send().disabled).toBe(true);
    expect(screen.getByText('301 / 300 characters (too long)')).toBeTruthy();
    audience('The CEO, deciding how to split HK$2bn');
    expect(send().disabled).toBe(false);
  });

  it('offers the same-slide PDF or picture only for a .pptx', async () => {
    await toChat(memoryStorage());
    pick('One chart', 'chart.pdf');
    expect(screen.queryByLabelText('A PDF or picture of the same slide (optional)')).toBeNull();
    pick('One chart', 'chart.pptx');
    expect(screen.getByLabelText('A PDF or picture of the same slide (optional)')).toBeTruthy();
  });
});

describe('sending the chart', () => {
  it('T-READ-4, T-SU-2: a readable chart is stored with the audience and illustrative answer, and Stage 1 opens', async () => {
    const storage = memoryStorage();
    const prepare = vi.fn(async () => PREPARED);
    const call = vi.fn(async () => ({ ok: true, result: { reading: READING, promptVersion: 'read-chart 1.0', servedBy: 'claude-opus-5-5' } }));
    await toChat(storage, { upload: { prepare, call } });
    pick('One chart', 'C04.pptx');
    pick('A PDF or picture of the same slide (optional)', 'C04.pdf');
    audience('The CEO, deciding how to split HK$2bn');
    fireEvent.click(screen.getByLabelText(/These values are illustrative/));
    fireEvent.click(send());
    await screen.findByText(config.openers.stage1);
    expect(prepare.mock.calls[0][1].sameSlide.name).toBe('C04.pdf');
    expect(call.mock.calls[0][0]).toBe('/api/read-chart');
    expect(call.mock.calls[0][1]).toMatchObject({ upload: PREPARED.upload, attempt: 1 });
    expect(call.mock.calls[0][2]).toBe('code');
    const chat = screen.getByRole('list', { name: 'Conversation with Daniel' });
    expect(within(chat).getByText('C04.pptx')).toBeTruthy();
    expect(within(chat).getByText('The CEO, deciding how to split HK$2bn')).toBeTruthy();
    const saved = loadSaved(storage).session;
    expect(saved.step).toBe('lead');
    expect(saved.run).toMatchObject({ audience: 'The CEO, deciding how to split HK$2bn', isDummy: true, activeUpload: 'u1' });
    expect(saved.run.uploads[0].reading).toEqual(READING);
    expect(screen.getByRole('navigation', { name: 'Stages' }).textContent).toContain('Set-up(passed)');
  });

  it("T-READ-3: an unreadable chart gets Daniel's message with the reason and the card again", async () => {
    const call = vi.fn(async () => ({ ok: true, result: { reading: { readable: false, unreadableReason: 'Retake the photo straight on, in good light.' } } }));
    await toChat(memoryStorage(), { upload: { prepare: async () => ({ ...PREPARED, upload: { kind: 'image', image: {} } }), call } });
    pick('One chart', 'photo.jpg');
    audience('The CEO');
    fireEvent.click(send());
    await screen.findByText("I can't read the chart you sent. Retake the photo straight on, in good light.");
    expect(screen.getByRole('heading', { name: 'Your chart' })).toBeTruthy();
  });

  it('T-UP-4: "One chart, please." in the chat, the hint and code on the card, recorded as blocked', async () => {
    const storage = memoryStorage();
    const prepare = async () => ({ ok: false, reason: 'pages', code: 'CM-U04', message: 'One chart, please.', hint: 'This PDF has 2 pages. Upload a one-page PDF or a one-slide .pptx.' });
    const call = vi.fn();
    await toChat(storage, { upload: { prepare, call } });
    pick('One chart', 'two-pages.pdf');
    audience('The CEO');
    fireEvent.click(send());
    await screen.findByText('One chart, please.');
    expect(screen.getByRole('alert').textContent).toBe('Error: This PDF has 2 pages. Upload a one-page PDF or a one-slide .pptx. (Error code: CM-U04)');
    expect(call).not.toHaveBeenCalled();
    await waitFor(() => expect(loadSaved(storage).session.blockedUploads).toEqual([{ at: expect.any(String), code: 'CM-U04', reason: 'pages' }]));
  });

  it('T-CHAT-7: a failed call shows the code and Ask Daniel again reruns only the read call', async () => {
    const prepare = vi.fn(async () => PREPARED);
    const call = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 200, error: 'timeout', message: 'Daniel is taking too long to reply. Try again.' })
      .mockResolvedValueOnce({ ok: false, status: 200, error: 'timeout', message: 'Daniel is taking too long to reply. Try again.' })
      .mockResolvedValueOnce({ ok: false, status: 200, error: 'timeout', message: 'Daniel is taking too long to reply. Try again.' })
      .mockResolvedValue({ ok: true, result: { reading: READING } });
    await toChat(memoryStorage(), { upload: { prepare, call } });
    pick('One chart', 'C04.pptx');
    audience('The CEO');
    fireEvent.click(send());
    await screen.findByText('Error:', { exact: false });
    expect(screen.getByRole('alert').textContent).toContain('Daniel is taking too long to reply. Try again. (Error code: CM-S03)');
    fireEvent.click(screen.getByRole('button', { name: 'Ask Daniel again' }));
    await screen.findByText(config.openers.stage1);
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  it('shows the waiting line while Daniel reads', async () => {
    let finish;
    const call = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    await toChat(memoryStorage(), { upload: { prepare: async () => PREPARED, call } });
    pick('One chart', 'C04.pptx');
    audience('The CEO');
    fireEvent.click(send());
    expect((await screen.findByRole('status')).textContent).toMatch(/^Daniel is reading your chart… 0 s$/);
    finish({ ok: true, result: { reading: READING } });
    await screen.findByText(config.openers.stage1);
  });
});

describe('T-SAV-1: resume', () => {
  it('a saved run resumes at the same step with the chat intact; the audience draft is kept', async () => {
    const storage = memoryStorage();
    const s = { ...createSession(), step: 'upload', setup: { ...valid(), completedAt: 'x' }, chat: [{ id: 'm1', from: 'daniel', at: null, text: config.messages.opening }], draft: { audience: 'Half-typed line', isDummy: false } };
    saveSession(s, storage);
    render(<App storage={storage} />);
    fireEvent.click(screen.getByRole('button', { name: 'Resume where you left off' }));
    expect(screen.getByText(config.messages.opening)).toBeTruthy();
    expect(screen.getByLabelText(config.openers.setup).value).toBe('Half-typed line');
  });
});
