import { useEffect, useRef, useState } from 'react';
import { config, limits } from '../../shared/limits.js';
import { withCode } from '../../shared/errorCodes.js';
import { prepareUpload, fileType } from '../upload/upload.js';
import { readChart, readingPatch, refusalPatch, studentTurn } from '../upload/sendChart.js';
import { Waiting } from './Waiting.jsx';

const ACCEPT = config.upload.accept.join(',');
const SAME_SLIDE_ACCEPT = '.pdf,.png,.jpg,.jpeg,.heic';

async function browserDeps() {
  const [{ loadPdfjs }, canvas] = await Promise.all([import('../extract/loadPdfjs.js'), import('../upload/browserCanvas.js')]);
  return { loadPdfjs, assetsBase: '/pdfjs/', ...canvas.browserDeps };
}

/**
 * The set-up chat's input (CM-1, CM-3, CMS-16, spec §3.1): one chart, an optional picture of the
 * same slide for a .pptx, the audience line and the illustrative-values tickbox. Send to Daniel
 * runs the upload checks and the read call.
 * `deps` lets the tests replace the file preparation and the model call.
 */
export function UploadCard({ session, updateSession, deps = {} }) {
  const [file, setFile] = useState(null);
  const [sameSlide, setSameSlide] = useState(null);
  const [busy, setBusy] = useState(null); // null | 'checking' | 'reading'
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(null);
  const fileInput = useRef(null);
  const sameInput = useRef(null);
  const draft = session.draft ?? { audience: '', isDummy: false };
  const audience = draft.audience;
  const tooLong = audience.trim().length > limits.audienceMaxChars;
  const isPptx = fileType(file?.name) === 'pptx';
  const canSend = Boolean(file) && audience.trim().length > 0 && !tooLong && !busy;

  useEffect(() => {
    if (!isPptx && sameSlide) {
      setSameSlide(null);
      if (sameInput.current) sameInput.current.value = '';
    }
  }, [isPptx, sameSlide]);

  const setDraft = (patch) => updateSession((s) => ({ draft: { ...(s.draft ?? {}), ...patch } }));

  async function ask(prepared) {
    setBusy('reading');
    setError(null);
    const r = await readChart(prepared, session.setup?.accessCode, deps.call ? { call: deps.call } : {});
    setBusy(null);
    if (!r.ok) {
      setPending(r.final ? null : prepared);
      setError({ message: withCode(r.message, r.code), retry: !r.final });
      return;
    }
    setPending(null);
    updateSession((s) => readingPatch(s, { prepared, result: r.result, audience: audience.trim(), isDummy: draft.isDummy }).patch, { immediate: true });
    setFile(null);
    setSameSlide(null);
    if (fileInput.current) fileInput.current.value = '';
    if (sameInput.current) sameInput.current.value = '';
  }

  async function send(e) {
    e.preventDefault();
    if (!canSend) return;
    setError(null);
    setPending(null);
    updateSession((s) => ({ chat: [...s.chat, studentTurn({ fileName: file.name, sameSlideName: isPptx ? sameSlide?.name : null, audience: audience.trim() })] }), { immediate: true });
    setBusy('checking');
    let prepared;
    try {
      const prepare = deps.prepare ?? (async (f, opts) => prepareUpload(f, { ...opts, deps: await browserDeps() }));
      prepared = await prepare(file, { sameSlide: isPptx ? sameSlide : null });
    } catch (err) {
      prepared = { ok: false, code: 'CM-U07', message: `We couldn't open ${file.name}. Export it to PDF and upload again.`, detail: err?.name };
    }
    if (!prepared.ok) {
      setBusy(null);
      updateSession((s) => refusalPatch(s, prepared), { immediate: true });
      const message = prepared.hint ?? prepared.message;
      setError({ message: withCode(message, prepared.code, prepared.detail), field: prepared.sameSlide ? 'same' : 'file' });
      return;
    }
    await ask(prepared);
  }

  const counterId = 'upload-audience-count';
  return (
    <form className="composer" onSubmit={send} noValidate aria-labelledby="upload-heading">
      <h2 id="upload-heading">Your chart</h2>
      <div className="field">
        <label htmlFor="upload-file">One chart</label>
        <p className="hint" id="upload-file-hint">
          One chart: a .pptx with one slide, a one-page PDF, or a photo or screenshot (.png, .jpg, .heic). Up to {config.upload.maxMB} MB.
        </p>
        <input id="upload-file" ref={fileInput} type="file" accept={ACCEPT} disabled={Boolean(busy)}
          aria-describedby="upload-file-hint" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setError(null); }} />
      </div>

      {isPptx && (
        <div className="field">
          <label htmlFor="upload-same">A PDF or picture of the same slide (optional)</label>
          <p className="hint" id="upload-same-hint">
            Daniel reads the words and numbers from the .pptx. A PDF export or screenshot of the slide lets him see how it looks, and puts an image in your record.
          </p>
          <input id="upload-same" ref={sameInput} type="file" accept={SAME_SLIDE_ACCEPT} disabled={Boolean(busy)}
            aria-describedby="upload-same-hint" onChange={(e) => { setSameSlide(e.target.files?.[0] ?? null); setError(null); }} />
        </div>
      )}

      <div className="field">
        <label htmlFor="upload-audience">{config.openers.setup}</label>
        <textarea id="upload-audience" rows={3} value={audience} disabled={Boolean(busy)}
          placeholder="e.g. The CFO, deciding whether to push price rises in the 2026 contract round"
          aria-invalid={tooLong ? 'true' : undefined} aria-describedby={counterId}
          onChange={(e) => setDraft({ audience: e.target.value })} />
        <p className={`counter${tooLong ? ' over' : ''}`} id={counterId}>
          {audience.trim().length} / {limits.audienceMaxChars} characters{tooLong ? ' (too long)' : ''}
        </p>
      </div>

      <div className="field checkbox">
        <input id="upload-dummy" type="checkbox" checked={draft.isDummy} disabled={Boolean(busy)}
          onChange={(e) => setDraft({ isDummy: e.target.checked })} />
        <label htmlFor="upload-dummy">These values are illustrative: it&rsquo;s a dummy chart, not real data yet.</label>
      </div>

      {error && (
        <div role="alert">
          <p className="form-error"><strong>Error:</strong> {error.message}</p>
          {error.retry && pending && (
            <div className="actions">
              <button type="button" className="btn secondary" onClick={() => ask(pending)}>Ask Daniel again</button>
            </div>
          )}
        </div>
      )}

      {busy ? (
        <Waiting label={busy === 'checking' ? 'Checking your file' : 'Daniel is reading your chart'} />
      ) : (
        <div className="actions">
          <button type="submit" className="btn" disabled={!canSend}>Send to Daniel</button>
        </div>
      )}
    </form>
  );
}
