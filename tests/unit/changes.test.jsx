// @vitest-environment jsdom
// Make these changes and the record on screen (CM-8, CM-9, CMS-15): build, preview, download,
// change choices and build again, a failed plan call, a concept chart, the record ending the run
// and a new run (T-RD-8, T-RD-9, T-SAV-3). Browser functions faked; no model, no files.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '../../src/App.jsx';
import { loadSaved, saveSession } from '../../src/store/session.js';
import { config } from '../../shared/limits.js';
import { memoryStorage } from '../helpers/storage.js';
import { SPECS } from '../helpers/redrawSpecs.js';
import { atChanges } from '../helpers/runs.js';

afterEach(cleanup);

function fakeRedraw({ plan } = {}) {
  return {
    // One call per part (D80): the chart, then the whole slide.
    plan: vi.fn(plan ?? (async (body) => ({ ok: true, result: body.part === 'chart' ? { chart: { ...SPECS.line } } : { spec: SPECS.line, promptVersion: 'redraw-plan 1.3', servedBy: 'claude-opus-5-5' } }))),
    download: vi.fn(async () => {}),
    preview: vi.fn(async () => 'data:image/png;base64,iVBORw0KGgo='),
    record: vi.fn(async (session) => ({ fileName: `${session.attemptId}.pdf`, pageCount: 4, replacedCharacters: 0 })),
  };
}

function start(redraw = fakeRedraw()) {
  const storage = memoryStorage();
  saveSession(atChanges(), storage);
  render(<App storage={storage} screens={{ redraw }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Resume where you left off' }));
  return { storage, redraw };
}

async function build() {
  fireEvent.click(screen.getByRole('button', { name: 'Make these changes' }));
  await screen.findByText(/Here's the slide:/);
}

describe('Make these changes on screen', () => {
  it('builds the slide, shows the preview and the download, then Daniel\'s last line', async () => {
    const { redraw, storage } = start();
    await build();
    expect(redraw.plan).toHaveBeenCalledTimes(2);
    expect(redraw.plan.mock.calls.map(([b]) => b.part)).toEqual(['chart', 'finish']);
    const [request, code] = redraw.plan.mock.calls[0];
    expect(request.input.lead).toBe(SPECS.line.title);
    expect(request.input.declinedFixes).toHaveLength(1);
    expect(code).toBe('x');
    expect(await screen.findByAltText(/Preview of version 1 of the slide/)).toBeTruthy();
    expect(screen.getByText(config.openers.lastMessage)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Download version 1 (.pptx)' }));
    await waitFor(() => expect(redraw.download).toHaveBeenCalledTimes(1));
    expect(redraw.download.mock.calls[0][0].fileName).toMatch(/_illustrative\.pptx$/);
    expect(loadSaved(storage).session.run.redraws).toHaveLength(1);
  });

  it('Change my choices reopens the fixes; Build again makes version 2 from the new choices', async () => {
    const { redraw } = start();
    await build();
    fireEvent.click(screen.getByRole('button', { name: 'Change my choices' }));
    const editor = screen.getByRole('region', { name: 'Change your choices' });
    fireEvent.click(within(editor).getAllByRole('button', { name: 'Accept' })[0]);
    fireEvent.click(within(editor).getByRole('button', { name: 'Build again' }));
    await screen.findByText(/Version 2 of the slide/);
    expect(redraw.plan).toHaveBeenCalledTimes(4);
    expect(redraw.plan.mock.calls[2][0].input.declinedFixes).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Download version 2 (.pptx)' })).toBeTruthy();
  });

  it('a failed plan call offers Ask Daniel again', async () => {
    let calls = 0;
    const redraw = fakeRedraw({
      plan: async (body) => {
        calls += 1;
        if (body.part === 'chart') return { ok: true, result: { chart: { ...SPECS.line } } };
        return calls === 2 ? { ok: false, message: "Daniel couldn't reply just now. Try again in a minute.", code: 'CM-S05', final: false }
          : { ok: true, result: { spec: SPECS.line } };
      },
    });
    start(redraw);
    fireEvent.click(screen.getByRole('button', { name: 'Make these changes' }));
    expect(await screen.findByText(/CM-S05/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ask Daniel again' }));
    await screen.findByText(/Here's the slide:/);
  });

  it('a concept chart gets Daniel\'s reason and no download (T-RD-9)', async () => {
    const redraw = fakeRedraw({ plan: async () => ({ ok: true, result: { chart: { ...SPECS.line, redrawable: false, reason: 'It is a process diagram.', chart: null } } }) });
    start(redraw);
    fireEvent.click(screen.getByRole('button', { name: 'Make these changes' }));
    await screen.findByText(/I can't build this one as a slide: It is a process diagram\./);
    expect(screen.queryByRole('button', { name: /Download version/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Download the record (PDF)' })).toBeTruthy();
  });

  it('downloading the record ends the run; Start a new run keeps the setup (T-SAV-3)', async () => {
    const { redraw, storage } = start();
    await build();
    fireEvent.click(screen.getByRole('button', { name: 'Download the record (PDF)' }));
    await screen.findByText(/This run has ended/);
    expect(redraw.record).toHaveBeenCalledTimes(1);
    expect(loadSaved(storage).session.endedAt).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Change my choices' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Start a new run (another chart)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, start a new run' }));
    const fresh = loadSaved(storage).session;
    expect(fresh.step).toBe('upload');
    expect(fresh.setup.name).toBe('Ada Lovelace');
    expect(fresh.run.redraws).toHaveLength(0);
  });
});
