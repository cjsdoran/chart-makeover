# Opening prompt for Claude Code

Paste this into Claude Code with the `Chart Makeover App` folder open.

---

We're building Chart Makeover, the third MGMT 5760 practice app. Everything you need is in this folder: start with `CLAUDE.md` and `BUILD_BRIEF.md`, then `docs/prd.md`, the prompts in `prompts/`, `config/`, `schemas/` and `calibration/README.md`. Question Time is in `../Question Time App`; reuse its code by copying, as the brief says.

Do milestone 0 only: read everything, read Question Time's `CLAUDE.md`, `docs/spec.md` and code, then write `docs/spec.md`, `tests/test-plan.md` and `scripts/rules-from-prd.mjs`. List every assumption and open question, including the nine in the brief, and stop for me. Don't scaffold or install anything yet.

---

# Next prompt: milestones 1 and 2

Paste this after milestone 0 (done 15 Nov 2026; Chris's answers are spec D27–D32 and the PRD change-log row "Build M0").

---

Milestone 0 is done and I've answered every question: see `docs/spec.md` §14 (D27–D32) and the "Build M0" row in `docs/prd.md`. Do milestones 1 and 2 as `BUILD_BRIEF.md` and `docs/spec.md` describe:

1. Scaffold from `../Tree Surgery App` (then `../Question Time App` where Tree Surgery has nothing), renamed to Chart Makeover. `git init`, a private GitHub repo `chart-makeover`, and move `docs/prd-update-command.md` to `.claude/commands/prd-update.md`.
2. Intake and reading: setup, the set-up chat, the upload checks, PDF page and photo preparation, .pptx shapes and chart XML (spec §3.4), the optional same-slide PDF or picture, the case detector, and `/api/read-chart`, with the tests for these in `tests/test-plan.md`.

Then run the read test (RT-1) on `calibration/inputs/` with real model calls (I approve those ten calls) and stop with the results, case by case.
