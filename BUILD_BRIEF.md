# Chart Makeover — build brief for Claude Code

Chart Makeover is a web app for HKUST MGMT 5760 students. Each student works alone on one chart they have already made. They upload it (.pptx, .pdf or a photo), say who it is for and what that audience must decide, and a fictional engagement manager (EM), Daniel Hart of Halden & Rowe, coaches them in a chat thread through five gated stages: **lead → data fit → chart choice → polish → fit check**. Daniel gives issues first, then fixes; the student rewrites the lead and accepts or declines each fix. At the end, "Make these changes" builds an editable PowerPoint slide in the HKUST class template with illustrative data, and the student downloads a record PDF. No score.

It is Question Time's and Tree Surgery's sibling: same firm, same EM, same stack, same Netlify limits, same house style. **Reuse Question Time's code wherever it fits** (sibling folder `../Question Time App`), and Tree Surgery's where it exists (`../Tree Surgery App`): copy, then adapt. Don't import across folders.

Owner: Chris Doran (course instructor). British English everywhere: UI copy, prompts, code comments.

## Source of truth

1. `docs/prd.md`: Markdown export of the master PRD (a Claude Doc, "PRD — Chart Makeover", rev 58, 14 Nov 2026). Chris owns it and re-exports it for each release; never edit it here. It says what and why. Requirement IDs CM-1 to CM-12.
2. `docs/spec.md`: how. **You write it in milestone 0** from the PRD and this brief. Keep the PRD's CM-n IDs; add CMS-n IDs for anything the spec adds.
3. `config/rules.json`: the 53 rules, with stage, default severity and allowed severities, generated from the PRD's rule tables. The stage engine and the review check read it. In milestone 0, write `scripts/rules-from-prd.mjs` that regenerates it from `docs/prd.md`, and a test that fails if they drift.
4. `prompts/`: the runtime prompts (table below). The **rules and severities are calibrated** (Chris, run 1); the **prompt wording is a draft** for calibration run 2. Change wording freely until Chris has marked run 2; after that, only with his agreement. `persona.md` is Question Time's shared persona: copy it from `../Question Time App/prompts/persona.md`.
5. `schemas/`: JSON contracts for the model's outputs. Validate every model output against them.
6. `config/app.json`: models, caps, openers, upload limits, redraw geometry, file names. Chris edits these without touching code.
7. `calibration/`: the ten test charts, Chris's run 1 feedback, `expected.json` (what Daniel must and must not say), `read-truth.json` (for the read test). See `calibration/README.md`. No student work, so nothing is private.
8. `docs/class-slide-style-guide.md`: the class slide rules the redraw follows. `assets/template/title-only-bg.jpg`: the template's Title Only background (HKUST crest), taken from Chris's Man City exercise deck, which uses the class template. Never draw or recreate the crest.

## Stack

Copy Question Time's choices and pinned versions (`../Question Time App/package.json`):

- Vite + React 19 single-page app, published from `dist/`.
- Netlify Functions in `netlify/functions/`, ESM, current API (`export default async (req, context) => Response`).
- `@anthropic-ai/sdk` on the server only. `ANTHROPIC_API_KEY` from Netlify environment variables, and from a git-ignored `.env` locally.
- Browser-side file handling: `pdfjs-dist` (render the page to an image; read the text layer), `jszip` (.pptx slide and chart XML), and `heic2any` (HEIC photos to JPEG). New for this app.
- Redraw: `pptxgenjs` in the browser (CM-8). New.
- Record PDF with `pdf-lib`; the redraw preview drawn with `chart.js` on an off-screen canvas and embedded as PNG (CM-9). New.
- Tests: `vitest` for units; Playwright for one end-to-end run with the model calls mocked.

## What to reuse

| Reuse (copy, then rename and trim) | Replace or add |
| --- | --- |
| QT `netlify/lib/anthropic.mjs` (client, timeout, duration log), `guard.mjs` (access code, size limits), `prompts.mjs` (extend to assemble the parts below) | QT's `review.mjs` and its five-part review |
| QT `shared/errorCodes.js`, `limits.js`, `schemaCheck.js`, `modelJson.js` | QT's `formatCheck.js`, `reviewParts.js` and `caseDetector.js` (no case text here: students upload only their own chart) |
| QT `src/store/session.js` (autosave), `Header`, `StepBar`, `Footer`, `StorageWarning`, `ResumePrompt`, `FormErrors`; `src/styles/tokens.css`, `app.css` (Praxis tokens, Halden & Rowe style); `src/record/layout.js` | QT's `Inbox` and `EmailView`: this app is a **chat view** with a stage tracker (CM-7) |
| QT `src/extract/*` PDF handling; Tree Surgery's PDF page render and .pptx shape extraction, if built | Tree Surgery's tree-specific parsing |
| QT `netlify.toml` (headers, CSP, functions settings), `docs/deploy.md`, `scripts/pilot-run.mjs` pattern, test helpers (`fakeAnthropic`, `storage`) | — |

## Layout

```
netlify/functions/   check.mjs         access code at setup; no model call
                     read-chart.mjs    reads the upload into a structured reading: one call
                     review.mjs        one stage review (stage 1–5 in the body): one call
                     redraw-plan.mjs   turns lead and accepted fixes into a chart spec: one call
netlify/lib/         anthropic.mjs  guard.mjs  prompts.mjs
shared/              errorCodes.js  limits.js  schemaCheck.js  modelJson.js  reviewCheck.js  rules.js
src/                 chat view, stage tracker, fix checklist, upload and extraction,
                     src/engine/ (stage engine), src/redraw/ (PptxGenJS builder), src/record/
prompts/ schemas/ config/   bundled into functions with included_files in netlify.toml
assets/template/     slide background for the redraw (served from public/ at build)
scripts/             rules-from-prd.mjs, pilot-run.mjs
calibration/         test charts, feedback, expected results
tests/               unit and e2e tests; tests/test-plan.md lists them
```

## The flow (PRD "Stage specifications", "Flow")

| Step | Screen | Model call |
| --- | --- | --- |
| 1 | Setup: access code, name, student ID, team, case (Common Module session setup) | `/api/check` |
| 2 | Set-up in the chat: Daniel asks "Who is this for, and what do they need to decide?"; the student uploads one chart and writes the audience line (CM-1, CM-3) | `/api/read-chart` |
| 3 | Stage 1 Lead: lead box; up to 5 rounds; one offered version from round 3 (CM-5) | `/api/review` stage 1 |
| 4 | Stage 2 Data fit: Daniel's reading ("I read this as …. Right?") with Yes / Correct it; then the review, fix checklist, and route buttons when offered | `/api/review` stage 2 |
| 5 | Re-upload, if routed (CM-12): new chart, new reading, then Stage 3 | `/api/read-chart` |
| 6 | Stage 3 Chart choice: comparison picker (config `comparisonOptions`, plus free text), then the review | `/api/review` stage 3 |
| 7 | Stage 4 Polish: the review; closing impression line on pass | `/api/review` stage 4 |
| 8 | Stage 5 Fit check: the planned page (agreed lead, accepted fixes, declined fixes); confirm or reopen one stage | `/api/review` stage 5 |
| 9 | Make these changes: build the .pptx in the browser; download; change fix choices and rebuild (CM-8) | `/api/redraw-plan` |
| 10 | Record PDF (CM-9) | none |

## Stage engine (`src/engine/`, CM-4)

The engine is plain JavaScript with no React, so it can be unit-tested and driven by the pilot harness. It owns the run's state; the model only reviews.

- **Gate.** A stage passes when no hard-stop or major finding is open. A finding closes when the student accepts its fix, or declines it with a reason and Daniel has answered (accept, or one push-back followed by the student's final choice). The engine computes the verdict from the findings' severities and `config/rules.json`; if the model's verdict disagrees, the engine's wins and the mismatch is logged.
- **Rounds.** A round is one review call. Caps from `config/app.json`: lead 5, offer from round 3; data fit, chart choice and polish 3 each; fit check 1 reopen; 1 re-upload; 1 push-back per finding. At a cap the stage moves on and the record flags what is still open.
- **Stage 1** findings close by rewriting the lead, not by ticking. `offeredLead` is shown only from round 3, once (CM-5); the engine strips it otherwise. The student always types the final lead.
- **Routes.** Stage 2 or 5 `route.options` shows two buttons: "Rewrite the lead" (back to Stage 1, with `reopenedLeadRounds` more rounds) and "Keep it and name the data" (a text box; adds to `dataToSource`; closes the finding). After a rewrite, Stage 2 runs once more with `leadChanged: true`; `route: "reupload"` then asks for a new chart (CM-12), and Stages 3–5 review the new upload. The record keeps both charts.
- **Logic first.** The review check drops any Stage 1–2 finding that cites a C or P rule, and any Stage 3 finding that cites a P rule, and logs it.
- **Stage 5 reopen** sends the student to the named stage with one more round there, then back to Stage 5.

## Hard constraints

- **Function wall clock.** Netlify stops this project's functions at about 26–30 seconds (Question Time spec D21); keep `functionBudgetSeconds` at 24. One model call per function invocation. Set `max_tokens` so each call finishes well inside the limit; log every call's duration and tokens. CM-10 targets: EM reply within 20 s, redraw within 60 s, for 95% of turns.
- **No server-side storage.** No database or Netlify Blobs. State lives in the browser's `localStorage`, including 1,600 px JPEG copies of the page images (spec D7). The record PDF is the only lasting copy.
- **API key never reaches the browser.** Every function checks the access code (`CM_ACCESS_CODE`) before calling the model.
- **Prompts are server-side.** Functions load `prompts/*.md`; the browser never receives them. Findings (rule IDs, severity, issue, fix) **do** go to the browser: the student sees them as the checklist.
- **What the model sees.** Every review call sends the reading (JSON) and the run so far. Stages 2–4 also send the page image when there is one; Stage 1, Stage 5 and the redraw plan are text only.
- **Reading the upload** (CM-1, CM-2), in the browser:
  - PDF: one page only. Render it to JPEG (long side about 2,000 px) and send the text layer (`getTextContent`: each string with position and font size), so typos are read from the file, not guessed from pixels.
  - Image: .png, .jpg; .heic converted with `heic2any`. Resize to a long side of about 2,000 px.
  - .pptx: one slide only. Extract each shape's text, position, size, font and font size; and each native chart from `ppt/charts/chartN.xml`: chart type, bar direction, grouping, 3D (`view3D`, `pie3DChart`), series names, categories and values (`strCache`, `numCache`), series colours, axes (title, min, max, log base, deleted), gridlines, legend, data labels, secondary axis. Send `docProps/thumbnail.jpeg` if present (python-pptx files, like the calibration set, have none). If the chart is a picture pasted onto the slide, send that picture as the image.
  - Reject more than one page or slide, or more than one chart, with "One chart, please." The read call's `readable: false` reasons are shown in Daniel's voice with a re-upload that doesn't count against anything.
- **Accessibility.** WCAG AA contrast, responsive down to phone width, nothing that depends on colour alone (the checklist uses words as well as colour for severity).

## Prompts

| Prompt | File | Status |
| --- | --- | --- |
| Shared persona | `prompts/persona.md` | Copy from Question Time; unchanged |
| Tool overlay | `prompts/overlay-chart-makeover.md` | Draft. Prepended to every stage prompt |
| Chart reading | `prompts/read-chart.md` | Draft. No persona. Check with the read test |
| Stage 1 Lead | `prompts/stage1-lead.md` | Draft for run 2 |
| Stage 2 Data fit | `prompts/stage2-data-fit.md` | Draft for run 2 |
| Stage 3 Chart choice | `prompts/stage3-chart-choice.md` | Draft for run 2 |
| Stage 4 Polish | `prompts/stage4-polish.md` | Draft for run 2 |
| Stage 5 Fit check | `prompts/stage5-fit-check.md` | Draft for run 2 |
| Redraw plan | `prompts/redraw-plan.md` | Draft. No persona. Check with the redraw QA |
| Shared parts | `prompts/shared/rule-library.md`, `fault-library.md`, `feedback-format.md` | From the PRD; the rule and fault tables are versioned with it (CM-11) |

**Assembly** (`netlify/lib/prompts.mjs`): system prompt = `persona.md` + `overlay-chart-makeover.md` + the stage prompt, with `{{RULES_STAGE_n}}` replaced by that stage's table from `rule-library.md` (Stage 1 includes the "Shapes of strong leads" and "Actions are not required" paragraphs), `{{RULES_L8_L11}}` by those two rows, `{{FAULT_LIBRARY}}` and `{{FEEDBACK_FORMAT}}` by the shared files. The user message is the JSON input each prompt describes. Cache the system prompt (prompt caching) since it repeats every round.

**Review check** (`shared/reviewCheck.js`, after schema validation): every rule ID exists and is allowed in this stage (`rules.json` `stages`); each severity is in the rule's `allowed` list; `whatWorks` is null when any finding is a hard stop; `offeredLead` only under CM-5; no score (`/\b\d+\s*(\/|out of)\s*10\b/`, "score"); message at most `caps.messageWords` + 25 words; at most `caps.issuesShown` hard-stop and major findings. Fix what can be fixed in code (strip, drop and log); regenerate (max 2) for the rest, as Question Time does.

## Make these changes (`src/redraw/`, CM-8)

- One slide, A4 landscape 10.83 × 7.5 in, built with PptxGenJS from `schemas/redraw-spec.json` and `config/app.json` `redraw`: a slide master with `title-only-bg.jpg` as background, the title placeholder at the Title Only geometry, slide number bottom right, no footer text.
- Native, editable chart; Calibri; 16–18 pt bold; black axes; no gridlines, legend or chart title; colours by role (subject `033D93`, comparison `BFBFBF`, others `C00000`, `008000`, `FFC000`); series labelled at the line end.
- Set the plot area (`layout`) and axis min and max explicitly, so value-to-slide coordinates are known: lead numbers (24 pt bold `033D93`), annotations (white rounded speech bubbles, 0.75 pt black outline, 16–18 pt), CAGR labels and reference-line labels are text boxes placed from those coordinates.
- Kinds: line, column, bar, stacked and 100% column (no value axis, segment labels left of the first column, totals above, CAGR per segment right), waterfall (stacked columns with an invisible base series), scatter with lines (`lineSize` above 0) for a relationship, points in time order and labelled at start, turning point and end, bubble (GE matrix: attractiveness vertical, quadrant lines labelled), table (Medium Style 2 – Accent 6, first column bold).
- "Illustrative data" on the slide and in the file name; source line 12 pt regular at (0.30, 6.95); speaker notes from `notes`; the redraw never adds a second chart, never changes the lead, never applies a declined fix. `redrawable: false` (concept charts) hides the button with Daniel's reason.
- Then Daniel's last message from config. The student can change fix choices and rebuild; each version goes into the record.

## Record PDF (`src/record/`, CM-9)

Common Module header (tool, case, engagement code, student name and ID, team, attempt ID, start and end times, app, prompt and rules versions), the audience line, an image of the original (the page image; for a .pptx without a thumbnail, the reading's summary and key values in its place), every lead draft with Daniel's messages, findings and decisions per stage (accepted, declined with reason, pushed back), open items at caps, data to source, the redraw preview, and the footer disclaimer. A4, printable. File name from config.

## Config (`config/app.json`)

Already written: models (all `claude-opus-5-5`, effort low; token limits are starting points, and Opus's thinking counts against them), `functionBudgetSeconds` 24, caps, upload limits, openers, comparison options, redraw geometry and colours, file names, footer. Tune token limits in the pilot so every call ends inside the budget.

## Build order

Finish each milestone with passing tests before starting the next. Stop where marked and wait for Chris.

0. **Spec.** Read `docs/prd.md`, the prompts, `calibration/README.md`, the style guide, and Question Time's `CLAUDE.md`, `docs/spec.md` and code (and Tree Surgery's, if present). Write `docs/spec.md`, `tests/test-plan.md` and `scripts/rules-from-prd.mjs`. List every assumption and question. **Stop for Chris.**
1. **Scaffold:** copy Question Time's scaffold (Vite + React, `netlify.toml`, functions skeleton with access-code guard, app shell, autosave store, footer disclaimer). Rename everything to Chart Makeover; strip QT-only parts. Move `docs/prd-update-command.md` to `.claude/commands/prd-update.md` (the `/prd-update` command).
2. **Intake and reading:** setup, the set-up chat, upload with the one-chart checks, PDF render and text layer, .pptx shape and chart-XML extraction, HEIC conversion, `/api/read-chart`, unreadable handling. Run the **read test** (below). **Stop for Chris** with the results.
3. **Chat shell and stage engine:** chat view, stage tracker, fix checklist with accept and decline-with-reason, route buttons, comparison picker, planned-page view; the engine with gates, caps, routes and reopen, driven by canned review JSON (no model). Unit tests for every gate and cap. **Stop for Chris** with a click-through on canned data.
4. **Stage 1 live:** `/api/review` for stage 1, prompt assembly, schema and review check, regeneration. A first `scripts/pilot-run.mjs` that runs Stage 1 on the ten cases. **Stop for Chris** with the Stage 1 report against `expected.json`.
5. **Stages 2–5 live:** the four prompts, decline responses, routes, re-upload (CM-12), reopen. Extend the pilot to the chart stages.
6. **Make these changes:** `/api/redraw-plan`, the PptxGenJS builder, rebuild after changed choices. Build the redraw for every calibration case with chart stages, open each in PowerPoint (or LibreOffice) and check it against the style guide's QA list. **Stop for Chris** with the redraws.
7. **Record PDF** (CM-9), including the redraw preview.
8. **Pilot harness and tests:** calibration run 2 over `calibration/` (real model calls only when Chris asks), the report for Chris to mark, everything in `tests/test-plan.md`.
9. **Deploy:** as Question Time (`docs/deploy.md`): Netlify site, `ANTHROPIC_API_KEY` and `CM_ACCESS_CODE`, custom domain so mainland-China students can reach it.

## Read test (milestone 2)

Run `read-chart` on the ten files in `calibration/inputs/`. Compare with `calibration/read-truth.json`: every `mustRead` string verbatim (typos included: "Procurment", "ANUAL", "Phillipines"), `kind` and `chartType`, flags (3D, dual axis, panels, log), and `keyValues` within ±5% (±10% for the photo). Report misses case by case. The photo (C06) is the hard one: if it fails, show Chris the reading before changing the prompt.

## Definition of done (v1)

- Every v1 requirement in `docs/spec.md` passes its test in `tests/test-plan.md`.
- The read test passes on all ten charts.
- **Calibration run 2:** the pilot report shows, for every case, the Stage 1 verdict in `expected.json`, every `mustCatch` point at its stage and severity, no `mustNot`, and nothing in `globalMustNot`. Report misses to Chris before fixing anything: each is a prompt or rule question for him. Chris then marks each message agree or disagree; the Common Module pass mark is at least 80% agreed and no false hard stops.
- The ten redraws pass the style guide's QA list, each labelled "Illustrative data".
- No function call exceeds 24 s in the pilot logs; 95% of EM replies arrive within 20 s.
- The record PDF opens, prints on A4, and contains no prompt text.

## Changing the app: PRD updates

Same process as Question Time: the PRD is the master; every change starts there and reaches the code as a small, targeted update. Run `/prd-update` after Chris commits a new `docs/prd.md` on a branch `prd-vX.Y`. Classify each change (prompt, rules, config, schema, flow, architecture), regenerate `config/rules.json` and the shared prompt tables, show Chris a table of CM ID, change, files and tests, and wait for confirmation. Then update `docs/spec.md` for the affected IDs only, tests first, the smallest change, run everything, bump `appVersion` and any edited prompt or rules version, commit "PRD vX.Y: <summary> (CM-n, …)", push the branch and give Chris the deploy-preview link. Don't deploy prompt changes while students are mid-course without telling Chris.

**Changes agreed in a build session** (Tree Surgery practice, Chris, 3 Nov 2026). The PRD stays the master, so a change Chris agrees while building also goes into the PRD, not only into `docs/spec.md`: any change to what students see or do, a rule, a severity, wording, a limit, the flow or a prompt's behaviour goes into the PRD section it belongs to, with a change-log row. Then `docs/prd.md` is refreshed and committed with the code and spec change it describes, in the same push. Implementation details (endpoints, token limits, file formats, libraries) stay in `docs/spec.md` only. Before ending a session, check that every decision in `docs/spec.md` §14 since the last PRD version is either in the PRD or marked implementation-only.

## Assumptions to confirm with Chris in milestone 0

1. Folder and repo: `Chart Makeover App`, in OneDrive `Documents/Consulting practice apps` beside `Question Time App` and `Tree Surgery App`; a new private GitHub repo and its own Netlify site.
2. Access code `CM_ACCESS_CODE`, separate from the other apps'.
3. A .pptx has no page image unless it carries a thumbnail, so Stages 2–4 judge visual points (emphasis, clutter, alignment) from the extracted XML. Option to offer: an optional PDF or picture of the same slide alongside the .pptx, for a better visual check and an image in the record.
4. Stage 1 sees the chart reading only to check L11 and D10 (PRD rev 58); Daniel's reading is confirmed by the student as a UI step at the start of Stage 2, with no model call.
5. A route back to Stage 1 gives 3 more lead rounds; Stage 5's reopen gives one more round in the reopened stage.
6. A declined fix counts as closed once Daniel has answered it (accepted the reason, or pushed back once and the student chose again), as the PRD's "logs the decision and moves on".
7. The redraw preview in the record is drawn with Chart.js from the redraw spec, not a render of the .pptx (no in-browser PowerPoint renderer).
8. Template background: `assets/template/title-only-bg.jpg` comes from the Man City exercise deck. If Chris supplies `HKUST_class_template.pptx`, extract its Title Only background and compare.
9. Pilot run 2 uses the ten calibration charts, which shaped the rules, so it is in-sample. A held-out test on 10 past student charts (Common Module pilot plan) follows before students use the tool.
