// The record PDF (CM-9, spec §13), built in the browser with pdf-lib: the run's details, the
// set-up with each chart, every lead draft with Daniel's reply, each chart stage's rounds with the
// student's decision on every fix, each slide version built with its preview, and Daniel's last
// line. Never prompt text. The layout (A4, Helvetica, footer on every page) is Tree Surgery's.
import { config, footerText } from '../../shared/limits.js';
import { STAGE_NAMES, plannedPage, stageFindings } from '../engine/engine.js';
import { recordFileName } from '../redraw/fileName.js';
import { formatTime } from '../time.js';
import { Layout } from './layout.js';

export const APP_VERSION = config.appVersion;
const SEVERITY_WORDS = { hardStop: 'Hard stop', major: 'Major', minor: 'Minor', suggestion: 'Suggestion' };
const VERDICT_WORDS = { hardStop: 'Hard stop', revise: 'Revise', pass: 'Pass' };
const unique = (values) => [...new Set(values.filter(Boolean))];
const plural = (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'}`;

/** How each stage ended: passed in round N, moved on at the cap, or not reached. */
export function stageOutcome(run, n) {
  const s = run.stages[n];
  const rounds = n === 1 ? run.leads.length : s.roundsUsed;
  if (s.status === 'passed') return rounds ? `passed in round ${rounds}` : 'passed';
  if (s.status === 'cappedOpen') return `moved on at the cap (${plural(rounds, 'round')}), fixes still open`;
  if (s.status === 'open') return rounds ? `open after ${plural(rounds, 'round')}` : 'open';
  return 'not reached';
}

/** What happened to one fix, in words (accepted; declined with reason; Daniel's answer; final choice). */
export function decisionWords(f) {
  const parts = [];
  if (f.resolution === 'nameData') return `Closed: you kept the lead and named the data to source ("${f.dataToSource}").`;
  if (f.status === 'superseded') return 'Replaced by a later round.';
  if (f.status === 'accepted' && !f.reason && !f.finalChoice) parts.push('Accepted.');
  if (f.reason) parts.push(`Declined: "${f.reason}"`);
  if (f.pushBack) parts.push(`Daniel pushed back: ${f.pushBack}`);
  if (f.reply) parts.push(`Daniel: ${f.reply}`);
  if (f.finalChoice === 'keep') parts.push('You kept your choice.');
  if (f.finalChoice === 'acceptFix' || (f.status === 'accepted' && f.reason)) parts.push('You accepted the fix.');
  if (f.status === 'open') parts.push(['hardStop', 'major'].includes(f.severity) ? 'Still open.' : 'Not accepted (left out of the slide).');
  if (f.status === 'declined' && !f.sent) parts.push('Not sent to Daniel.');
  if (f.changedAfterFit) parts.push('(Changed after the fit check.)');
  return parts.join(' ');
}

function writeDetails(L, session) {
  const s = session.setup ?? {};
  const run = session.run;
  const reviews = run.reviews;
  const uploads = run.uploads;
  L.field('Tool', `${config.appName}, ${config.firm} practice tool, ${config.course}`);
  L.field('Case or project', s.caseName);
  L.field('Student', `${s.name} (${s.studentId})${s.team ? `, team ${s.team}` : ''}`);
  L.field('Attempt ID', session.attemptId);
  L.field('Started', formatTime(session.startedAt));
  L.field('Finished', formatTime(session.endedAt) || formatTime(new Date().toISOString()));
  for (const n of [1, 2, 3, 4, 5]) L.field(`Stage ${n} ${STAGE_NAMES[n]}`, stageOutcome(run, n), { gap: 1 });
  L.space(3);
  L.field('Slide versions built', String(run.redraws.length));
  L.field('App version', APP_VERSION);
  L.field('Prompt versions', unique([...uploads.map((u) => u.readPromptVersion), ...reviews.map((r) => r.promptVersion), ...run.redraws.map((r) => r.promptVersion)]).join(' · ') || 'None recorded');
  L.field('Rules version', unique(reviews.map((r) => r.rulesVersion)).join(' · ') || config.rulesVersion);
  L.field('Models', unique([...uploads.map((u) => u.readModel), ...reviews.map((r) => r.servedBy), ...run.redraws.map((r) => r.servedBy)]).join(', ') || 'None recorded');
  const blocked = session.blockedUploads ?? [];
  L.field('Blocked uploads', blocked.length ? `${blocked.length}: ${blocked.map((b) => `${formatTime(b.at)} (${b.code})`).join('; ')}` : '0');
  L.field('Charts Daniel could not read', run.unreadable.length
    ? `${run.unreadable.length}: ${run.unreadable.map((u) => `${formatTime(u.at)} (${u.fileName}: ${u.reason})`).join('; ')}`
    : '0');
}

async function embedImage(doc, image) {
  const bytes = Uint8Array.from(atob(image.base64), (c) => c.charCodeAt(0));
  return image.mediaType === 'image/png' ? doc.embedPng(bytes) : doc.embedJpg(bytes);
}

function keyValues(reading) {
  const series = reading?.chart?.series ?? [];
  return series.slice(0, 6).map((s) => {
    const vals = s.values.filter((v) => v.y !== null);
    const shown = vals.length > 8 ? [...vals.slice(0, 3), null, ...vals.slice(-3)] : vals;
    return `${s.name}: ${shown.map((v) => (v ? `${v.x} ${v.y}` : '…')).join(', ')}`;
  });
}

async function writeSetup(L, doc, session) {
  const run = session.run;
  L.heading('Set-up', 2);
  L.field('Who it is for, and what they need to decide', run.audience);
  L.field('Illustrative values', run.isDummy ? 'Yes: a dummy chart, not real data yet' : 'No: real data');
  for (const [i, u] of run.uploads.entries()) {
    L.heading(i === 0 ? 'Your chart' : `Your redrawn chart (upload ${i + 1})`, 3);
    L.field('File', `${u.fileName}${u.sameSlideName ? `, with ${u.sameSlideName}` : ''}`);
    L.field('Sent', formatTime(u.at));
    if (u.image1600?.base64) {
      L.image(await embedImage(doc, u.image1600), { maxHeight: 360 });
    } else {
      L.text("PowerPoint slide: see Daniel's reading.", { color: L.colors.grey });
      for (const line of keyValues(u.reading)) L.rich([{ text: line }], { bullet: '•', gap: 2, size: 9 });
    }
    L.field("Daniel's reading", u.reading?.summary ?? '');
    if (u.readingConfirmed) L.field('Your answer', u.readingCorrection ? `Corrected: "${u.readingCorrection}"` : 'Yes, that is right.');
  }
}

function writeFinding(L, f, { decisions = true } = {}) {
  L.rich([
    { text: `${SEVERITY_WORDS[f.severity]} `, font: L.fonts.bold },
    { text: `[${f.rules.join(', ')}] `, font: L.fonts.bold, color: L.colors.navy },
    { text: f.location, font: L.fonts.italic },
  ], { bullet: '•', gap: 1 });
  L.text(f.issue, { indent: 12, gap: 1 });
  L.rich([{ text: 'Fix: ', font: L.fonts.bold }, { text: f.fix }], { indent: 12, gap: 1 });
  if (decisions) L.rich([{ text: 'Decision: ', font: L.fonts.bold }, { text: decisionWords(f) }], { indent: 12, gap: 5 });
  else L.space(4);
}

function danielSays(L, review) {
  L.text(`Daniel · ${formatTime(review.at)} · ${VERDICT_WORDS[review.verdict] ?? review.verdict}`, { color: L.colors.grey, size: 9, gap: 2 });
  L.text(review.message);
  if (review.whatWorks) L.field('What works', review.whatWorks);
  if (review.impression) L.field('Impression', review.impression);
}

function writeStage1(L, session) {
  const run = session.run;
  L.heading('Stage 1: Lead', 2);
  const reviews = run.reviews.filter((r) => r.stage === 1);
  run.leads.forEach((lead, i) => {
    L.heading(`Draft ${i + 1} · ${formatTime(lead.at)}`, 3);
    L.rich([{ text: lead.text, font: L.fonts.bold }]);
    const review = reviews.find((r) => r.leadRound === lead.round) ?? reviews[i];
    if (!review) return;
    danielSays(L, review);
    for (const id of review.findingIds) writeFinding(L, run.findings[id], { decisions: false });
    if (review.offeredLead) L.field('One stronger version Daniel offered', `"${review.offeredLead}"`);
  });
  L.field('Agreed lead', run.agreedLead ?? 'None: Stage 1 moved on at the cap with the latest draft');
}

function writeChartStage(L, session, n) {
  const run = session.run;
  const reviews = run.reviews.filter((r) => r.stage === n);
  if (!reviews.length && run.stages[n].status === 'locked') return;
  L.heading(`Stage ${n}: ${STAGE_NAMES[n]}`, 2);
  if (n === 3 && run.comparison) L.field('Your comparison', run.comparison.type === 'other' ? run.comparison.other : run.comparison.type);
  if (n === 5) {
    const page = plannedPage(run);
    L.field('Planned page', `${page.acceptedFixes.length} accepted fix${page.acceptedFixes.length === 1 ? '' : 'es'}, ${page.declinedFixes.length} declined`);
  }
  for (const review of reviews) {
    L.heading(`Round ${review.round}${review.leadChanged ? ' (after the new lead)' : ''}`, 3);
    danielSays(L, review);
    for (const id of review.findingIds) writeFinding(L, { id, ...run.findings[id] });
    if (review.route === 'reupload') L.field('Route', 'Daniel asked for the chart to be redrawn for the new lead and uploaded again.');
    else if (review.route) L.field('Route offered', 'Rewrite the lead, or keep it and name the data.');
    if (review.reopenStage) L.field('Daniel suggested reopening', STAGE_NAMES[review.reopenStage]);
  }
  const open = stageFindings(run, n).filter((f) => ['hardStop', 'major'].includes(f.severity) && !['accepted', 'closed', 'superseded'].includes(f.status));
  if (run.stages[n].status === 'cappedOpen' && open.length) {
    L.field('Still open at the cap', open.map((f) => `${f.rules.join('/')} ${f.location}`).join('; '));
  }
}

async function writeRedraws(L, doc, session, previewPng) {
  const run = session.run;
  L.newPage();
  L.heading('Make these changes', 2);
  if (run.notRedrawable) {
    L.text(`Daniel did not build a slide: ${run.notRedrawable}`);
    return;
  }
  if (!run.redraws.length) {
    L.text('No slide was built in this run.', { color: L.colors.grey });
    return;
  }
  L.text('Each preview shows the content of the slide Daniel built, drawn in the browser; it is not a render of the .pptx file.', { color: L.colors.grey, size: 9 });
  for (const v of run.redraws) {
    L.heading(`Version ${v.version} · ${formatTime(v.at)}`, 3);
    L.field('File', v.fileName);
    let png = null;
    try {
      png = previewPng ? await previewPng(v.spec) : null;
    } catch {
      png = null;
    }
    if (png) L.image(await doc.embedPng(png), { maxHeight: 330 });
    else L.text('(Preview not available.)', { color: L.colors.grey });
    L.text('Fixes applied:', { font: L.fonts.bold, gap: 2 });
    if (v.acceptedFixes.length) for (const f of v.acceptedFixes) L.rich([{ text: `${STAGE_NAMES[f.stage]} [${f.rules.join(', ')}]: `, font: L.fonts.bold }, { text: f.fix }], { bullet: '•', gap: 2, size: 9 });
    else L.text('None.', { size: 9 });
    if (v.declinedFixes.length) {
      L.text('Fixes left out (declined):', { font: L.fonts.bold, gap: 2 });
      for (const f of v.declinedFixes) L.rich([{ text: f.fix }, { text: ` Your reason: "${f.reason}"`, font: L.fonts.italic }], { bullet: '•', gap: 2, size: 9 });
    }
    const toSource = unique([...v.dataToSource, ...v.spec.notes.dataToSource]);
    if (toSource.length) {
      L.text('Data you must source:', { font: L.fonts.bold, gap: 2 });
      for (const d of toSource) L.rich([{ text: d }], { bullet: '•', gap: 2, size: 9 });
    }
  }
  L.space(8);
  L.rich([{ text: 'Daniel: ', font: L.fonts.bold }, { text: config.openers.lastMessage }]);
}

/**
 * @param {object} session the run
 * @param {{ previewPng?: (spec) => Promise<Uint8Array>, lib?: object, now?: Date }} [deps]
 * @returns {Promise<{ bytes: Uint8Array, fileName: string, pageCount: number, replacedCharacters: number }>}
 */
export async function buildRecord(session, { previewPng = null, lib = null } = {}) {
  const pdfLib = lib ?? (await import('pdf-lib'));
  const { PDFDocument, StandardFonts } = pdfLib;
  const s = session.setup ?? {};
  const doc = await PDFDocument.create();
  doc.setTitle(`Chart Makeover record: ${s.name}, ${s.caseName}`);
  doc.setAuthor(s.name ?? '');
  doc.setSubject(`${config.course} Chart Makeover record, attempt ${session.attemptId}`);
  doc.setCreator(`${config.appName} ${APP_VERSION}`);
  doc.setProducer(`${config.appName} ${APP_VERSION}`);
  const fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
  };
  const L = new Layout(pdfLib, doc, fonts, {
    runningHeader: `${config.firm} · ${config.appName} · ${s.caseName ?? ''} · ${s.name ?? ''}`,
    footer: footerText(),
  });

  L.heading('Chart Makeover record', 1);
  writeDetails(L, session);
  L.newPage();
  await writeSetup(L, doc, session);
  writeStage1(L, session);
  for (const n of [2, 3, 4, 5]) writeChartStage(L, session, n);
  const dataToSource = session.run.dataToSource;
  if (dataToSource.length) {
    L.heading('Data you must source', 3);
    for (const d of dataToSource) L.rich([{ text: d }], { bullet: '•', gap: 2 });
  }
  await writeRedraws(L, doc, session, previewPng);

  L.finish();
  if (L.replaced.size > 0) {
    const list = [...L.replaced].map((ch) => `U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`).join(', ');
    doc.getPages().at(-1).drawText(L.clean(`Note: ${L.replaced.size} character${L.replaced.size === 1 ? '' : 's'} outside Western European scripts print as "?" in this PDF: ${list}.`).slice(0, 160), {
      x: 56, y: 60, size: 7, font: fonts.regular, color: L.colors.grey,
    });
  }
  const bytes = await doc.save();
  return { bytes, fileName: recordFileName(session), pageCount: doc.getPageCount(), replacedCharacters: L.replaced.size };
}
