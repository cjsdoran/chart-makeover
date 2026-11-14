// T-RULES-1 (CMS-10, CM-11): config/rules.json and the prompt rule library match the PRD, and a
// changed severity in either is caught.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { buildRulesFile, checkPromptLibrary } from '../../scripts/rules-from-prd.mjs';

const prd = readFileSync('docs/prd.md', 'utf8');
const library = readFileSync('prompts/shared/rule-library.md', 'utf8');

describe('T-RULES-1', () => {
  it('node scripts/rules-from-prd.mjs --check passes', () => {
    const out = execFileSync(process.execPath, ['scripts/rules-from-prd.mjs', '--check'], { encoding: 'utf8' });
    expect(out).toMatch(/^OK: 53 rules match docs\/prd.md/);
  });

  it('config/rules.json is what the PRD generates', () => {
    expect(JSON.parse(readFileSync('config/rules.json', 'utf8'))).toEqual(buildRulesFile(prd));
  });

  it('a changed severity in the PRD changes the generated rules', () => {
    const row = prd.split('\n').find((l) => /^\| P2 \|/.test(l));
    expect(row).toBeTruthy();
    const changed = prd.replace(row, row.replace(/Hard stop/i, 'Minor'));
    expect(buildRulesFile(changed)).not.toEqual(buildRulesFile(prd));
  });

  it('a changed severity in the prompt rule library fails the check', () => {
    const rules = buildRulesFile(prd).rules;
    expect(checkPromptLibrary(library, rules)).toEqual([]);
    const row = library.split('\n').find((l) => /^\| P2 \|/.test(l));
    const changed = library.replace(row, row.replace(/Hard stop/i, 'Minor'));
    expect(checkPromptLibrary(changed, rules)).toEqual(['P2 differs from the PRD (name or severity)']);
  });
});
