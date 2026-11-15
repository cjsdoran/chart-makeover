// Loads the runtime prompts from prompts/ (bundled with `included_files`). Server-side only:
// the browser receives the prompt version, never the text.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const cache = new Map();

// Netlify runs functions from LAMBDA_TASK_ROOT with included files beside them; netlify dev
// and the tests run from the repository root.
function locate(file) {
  const roots = [process.env.LAMBDA_TASK_ROOT, process.cwd()].filter(Boolean);
  for (const root of roots) {
    const path = join(root, 'prompts', file);
    if (existsSync(path)) return path;
  }
  throw new Error(`Prompt not found: prompts/${file}`);
}

export function promptVersion(text) {
  return /version:\s*([\d.]+)/.exec(text)?.[1] ?? 'unknown';
}

/** @returns {{ text: string, version: string }} the HTML comment header is kept out of the text. */
export function loadPrompt(name) {
  if (!cache.has(name)) {
    const raw = readFileSync(locate(`${name}.md`), 'utf8');
    const text = raw.replace(/^<!--[\s\S]*?-->\s*/, '').trim();
    cache.set(name, { text, version: promptVersion(raw) });
  }
  return cache.get(name);
}

/** System prompt for an EM call: the shared persona, then the task prompt. */
export function emSystemPrompt(name) {
  const persona = loadPrompt('persona');
  const task = loadPrompt(name);
  return { text: `${persona.text}\n\n${task.text}`, version: `${name} ${task.version}; persona ${persona.version}` };
}

/** System prompt for a task that is not in Daniel's voice: reading the chart, the redraw plan (CMS-7). */
export function taskSystemPrompt(name) {
  const task = loadPrompt(name);
  return { text: task.text, version: `${name} ${task.version}` };
}

/**
 * The text of a prompt between two headings: from the line starting `from` up to (not including)
 * the line starting `to`. Used to share the calibrated Stage 2 rules word for word.
 */
export function promptSection(text, from, to) {
  const start = text.indexOf(`\n${from}`);
  const end = to ? text.indexOf(`\n${to}`, start + 1) : text.length;
  if (start < 0 || end < 0) throw new Error(`Prompt section not found: ${from}`);
  return text.slice(start + 1, end).trim();
}


export const STAGE_PROMPTS = { 1: 'stage1-lead', 2: 'stage2-data-fit', 3: 'stage3-chart-choice', 4: 'stage4-polish', 5: 'stage5-fit-check' };

/** One stage's section of the rule library: from its "### Stage n" heading to the next heading. */
export function stageRules(library, stage) {
  const start = library.indexOf(`\n### Stage ${stage} `);
  if (start < 0) throw new Error(`Rule library has no Stage ${stage} section`);
  const next = library.indexOf('\n### ', start + 1);
  return library.slice(start + 1, next < 0 ? library.length : next).trim();
}

/** The L8 and L11 rows of Stage 1's table, with the table header (Stage 5 re-checks them). */
export function rulesL8L11(library) {
  const lines = stageRules(library, 1).split('\n');
  const header = lines.filter((l) => l.startsWith('| ID') || l.startsWith('| ---'));
  return [...header, ...lines.filter((l) => /^\| L(8|11) \|/.test(l))].join('\n');
}

/**
 * A stage's system prompt (spec §8): persona + overlay + the stage prompt with its placeholders
 * filled from prompts/shared/, then the review schema (the prompts name it; the model must see it,
 * as for the read call, D49). Each part's version goes into promptVersion (CM-11).
 */
export function stageSystemPrompt(stage, schema) {
  const name = STAGE_PROMPTS[stage];
  const parts = { persona: loadPrompt('persona'), overlay: loadPrompt('overlay-chart-makeover'), stage: loadPrompt(name) };
  const library = loadPrompt('shared/rule-library');
  const faults = loadPrompt('shared/fault-library');
  const format = loadPrompt('shared/feedback-format');
  const fill = {
    [`{{RULES_STAGE_${stage}}}`]: stageRules(library.text, stage),
    '{{RULES_L8_L11}}': rulesL8L11(library.text),
    '{{FAULT_LIBRARY}}': faults.text.replace(/^# .*\n+/, ''),
    '{{FEEDBACK_FORMAT}}': format.text.replace(/^# .*\n+/, ''),
  };
  let text = parts.stage.text;
  for (const [key, value] of Object.entries(fill)) text = text.split(key).join(value);
  const left = text.match(/\{\{[A-Z0-9_]+\}\}/);
  if (left) throw new Error(`Unfilled placeholder in ${name}: ${left[0]}`);
  const system = `${parts.persona.text}\n\n${parts.overlay.text}\n\n${text}\n\n\`\`\`json\n${schema}\n\`\`\``
    + '\n\nUse exactly the schema\'s property names, no others, and every required property. If the message ends with `<previous_errors>`, your last reply failed those checks: return a corrected JSON object.';
  const version = `${name} ${parts.stage.version}; persona ${parts.persona.version}; overlay ${parts.overlay.version}; `
    + `rules ${library.version}; faults ${faults.version}; format ${format.version}`;
  return { text: system, version };
}
