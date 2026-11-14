---
description: Apply the latest PRD change (docs/prd.md) to spec, rules, prompts, config, tests and code — only what changed
---

Follow "Changing the app: PRD updates" in BUILD_BRIEF.md.

1. Diff `docs/prd.md` against the last commit that touched it on `main`.
2. Run `node scripts/rules-from-prd.mjs --check`. If rules changed, regenerate `config/rules.json` and update `prompts/shared/rule-library.md` to match.
3. Classify each change (prompt, rules, config, schema, flow, architecture) and show me a table (CM ID · change · files · tests), plus any questions. Stop and wait for my confirmation.
4. After I confirm: update `docs/spec.md` for the affected IDs only, tests first, then the smallest code, prompt or config change.
5. Run `npm test` and `npm run e2e`. Ask before running the pilot script.
6. Bump `appVersion`, `rulesVersion` and any edited prompt versions, commit "PRD vX.Y: <summary> (CM-…)", push the branch, and give me the deploy-preview link.

$ARGUMENTS
