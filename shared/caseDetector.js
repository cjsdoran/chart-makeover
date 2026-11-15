// Case detector (CMS-11, from QT and TS). Runs in the browser on the chart's text before anything is
// stored or sent, and again in every function that receives student text. Rules live in
// config/case-markers.json.
// A block is final: there is no override.
import caseMarkers from '../config/case-markers.json' with { type: 'json' };

export const CASE_BLOCK_MESSAGE = caseMarkers.blockMessage;

// Our own page markers and file headings are removed so they can't split a phrase.
const PAGE_MARKER = /\[\[(?:p\.|slide )\d+\]\]/g;
const FILE_HEADING = /^=== File: .* ===$/gm;

export function normaliseForDetection(text) {
  return String(text ?? '')
    .replace(FILE_HEADING, ' ')
    .replace(PAGE_MARKER, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function compileRules(rules = caseMarkers) {
  const markers = rules.markers.map((m) => ({ id: m.id, re: new RegExp(m.pattern, 'i') }));
  const titles = (rules.chrisCaseTitles?.titles ?? [])
    .map((t) => String(t).trim())
    .filter(Boolean)
    .map((t, i) => ({ id: `case_title_${i + 1}`, re: new RegExp(escapeRegExp(t).replace(/\s+/g, '\\s+'), 'i') }));
  const s = rules.structural;
  return {
    markers: [...markers, ...titles],
    exhibit: new RegExp(s.exhibitPattern, 'gi'),
    exhibitThreshold: s.exhibitThreshold,
    teachingPhrases: s.teachingPhrases.map((p) => p.toLowerCase()),
  };
}

const DEFAULT_RULES = compileRules();

/**
 * @returns {{ blocked: boolean, reasons: string[] }} reasons are rule IDs, safe to log.
 */
export function detectCase(text, rules = DEFAULT_RULES) {
  const flat = normaliseForDetection(text);
  if (!flat) return { blocked: false, reasons: [] };

  const reasons = rules.markers.filter((m) => m.re.test(flat)).map((m) => m.id);

  // Structural rule: enough distinct numbered exhibits AND a teaching-case phrase.
  const exhibits = new Set();
  for (const match of flat.matchAll(rules.exhibit)) exhibits.add(match[0].toLowerCase().replace(/\s+/g, ' '));
  if (exhibits.size >= rules.exhibitThreshold) {
    const lower = flat.toLowerCase();
    if (rules.teachingPhrases.some((p) => lower.includes(p))) reasons.push('structural');
  }

  return { blocked: reasons.length > 0, reasons };
}

// Every piece of student text a request can carry (spec §12): the audience line, the lead and its
// drafts, the reading correction, the comparison, decline reasons, data to source, and the chart's
// own text (PDF text layer, slide shapes and chart XML).
export function collectStudentText(body) {
  if (!body || typeof body !== 'object') return '';
  const input = body.input && typeof body.input === 'object' ? body.input : body;
  const pptx = body.upload?.pptx ?? {};
  const pieces = [
    body.upload?.pdfText,
    pptx.shapes,
    pptx.charts,
    pptx.tables,
    input.audience,
    input.lead,
    input.readingCorrection,
    input.comparison,
    input.comparison?.other,
    ...(Array.isArray(input.dataToSource) ? input.dataToSource : []),
    ...(Array.isArray(input.declines) ? input.declines.map((d) => d?.reason) : []),
  ];
  return pieces.filter((v) => typeof v === 'string').join('\n');
}
