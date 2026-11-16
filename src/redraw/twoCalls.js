// The redraw plan's two calls (spec §9.1, D80): the chart first, then the lead numbers, annotations,
// reference lines and notes on it, so each call ends well inside the function's time budget. Plain
// JavaScript, so the screen, the tests and the pilot share it.

/**
 * @param {{ input: object }} request from redrawRequest(session)
 * @param {(body: object) => Promise<{ ok: boolean, result?: object, message?: string, code?: string, final?: boolean }>} call
 *   one call to /api/redraw-plan (with the browser's retries)
 * @param {{ chart?: object|null }} [opts] a chart already planned, after a failed second call: only
 *   the second call is made again
 * @returns {Promise<{ ok: true, result: { spec, promptVersion, servedBy }, chart: object }
 *   | { ok: false, message, code, final, chart: object|null }>}
 */
export async function planInTwoCalls(request, call, { chart = null } = {}) {
  let planned = chart;
  if (!planned) {
    const first = await call({ part: 'chart', ...request });
    if (!first.ok) return { ...first, chart: null };
    planned = first.result.chart;
    if (!planned.redrawable) {
      // A concept chart: Daniel's reason, no second call (PRD "Out of scope").
      return { ok: true, chart: planned, result: { spec: { ...planned, title: request.input.lead }, promptVersion: first.result.promptVersion, servedBy: first.result.servedBy } };
    }
  }
  const second = await call({ part: 'finish', ...request, plannedChart: planned });
  if (!second.ok) return { ...second, chart: planned };
  return { ok: true, chart: planned, result: { spec: second.result.spec, promptVersion: second.result.promptVersion, servedBy: second.result.servedBy } };
}
