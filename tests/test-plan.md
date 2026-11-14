# Chart Makeover: test plan

Unit and e2e tests run with every model call mocked (no cost). The read test (RT) and the pilot checks (P) make real model calls and run only when Chris asks. Requirement IDs refer to `docs/spec.md` §16. Milestone 0 draft, 15 Nov 2026.

## 1. Fixtures

### Committed

- `calibration/inputs/`: the ten calibration charts (four .pptx, three .pdf, one .png, one .jpg). Fictional or public data, no student work, so they are committed and used by unit tests as well as RT and P.
- `tests/fixtures/upload/` (synthetic, made in milestone 2):
  - `two-pages.pdf`, `two-slides.pptx`, `two-charts.pptx` (CM-U04);
  - `picture-chart.pptx` (one slide holding a PNG of a chart), `text-only.pptx` (CM-U09), `table-slide.pptx`;
  - `dual-axis.pptx` (a combo chart on two value axes), `log-axis.pptx`, `theme-colours.pptx` (series in scheme colours), `with-thumbnail.pptx` (saved by PowerPoint, so it carries `docProps/thumbnail.jpeg`);
  - `photo.heic`, `photo-rotated.jpg` (EXIF orientation 6), `scan.pdf` (no text layer).
- Generated in the tests: a password-protected PDF, a corrupt PDF, a `.ppt`, a 21 MB file.
- `tests/helpers/`: Tree Surgery's `fakeAnthropic.js` (scripted streams, silence for pings, stop reasons) and `storage.js` (throwing and quota-limited `localStorage`); model JSON fixtures for each schema (valid, and one invalid per review-check rule in spec §7.1); canned stage reviews for the engine and e2e (one per case and stage, written from `calibration/expected.json`).
- Question Time's case-detector fixtures and synthetic briefs, copied (if Q3 is yes).

### Private (git-ignored)

- `calibration/private/`: the held-out past student charts (assumption 9), when Chris supplies them. Tests that need them skip until the folder exists.

## 2. Automated tests

| ID | Req | Test | Pass |
| --- | --- | --- | --- |
| T-SET-1 | CMS-1 | Setup rejects each missing required field, over-long fields, and a bad access code (`/api/check` 401); team is optional; attempt ID is 8 base32 characters | Each rejected with its message |
| T-SU-1 | CM-3 | **Send to Daniel** stays disabled until a file and the audience line (1–300 characters) are in | As stated |
| T-SU-2 | CMS-16 | The illustrative-values tickbox is stored and reaches Stage 2, Stage 4 and the redraw call as `isDummy` | As stated |
| T-UP-1 | CM-1 | Each accepted type opens (.pptx, .pdf, .png, .jpg, .heic) | Opened |
| T-UP-2 | CM-1 | `.ppt` → CM-U02; `.docx`, `.xlsx`, `.gif` → CM-U01 | Codes and messages |
| T-UP-3 | CM-1 | 21 MB → CM-U03 | As stated |
| T-UP-4 | CM-1 | `two-pages.pdf`, `two-slides.pptx`, `two-charts.pptx` → CM-U04 with "One chart, please." | As stated |
| T-UP-5 | CM-1 | Password PDF → CM-U08; corrupt PDF → CM-U07 with the error name | As stated |
| T-UP-6 | CM-1 | `photo.heic` converts to JPEG; a failing conversion (mocked) → CM-U05 | As stated |
| T-UP-7 | CM-1 | `text-only.pptx` → CM-U09; `table-slide.pptx` and `picture-chart.pptx` pass | As stated |
| T-UP-8 | CM-1 | Every refusal is added to `blockedUploads` with time and code | As stated |
| T-UP-9 | CM-2, CMS-8 | PDF page rendered at 2,000 px long side (PNG, JPEG fallback over 3.5 MB); photo EXIF-rotated and resized; a 1,600 px JPEG copy stored for each | Sizes and orientation as stated |
| T-PDF-1 | CM-2 | C02, C05, C09: the text layer carries every string in `read-truth.json` `mustRead`, typos included ("ANUAL", "Phillipines") | All present |
| T-PDF-2 | CM-2 | `scan.pdf` sends the image only | No `pdfText` |
| T-PDF-3 | CM-2 | pdf.js assets load from `/pdfjs/` (fonts, CMaps) | Page renders with text |
| T-PPTX-1 | CM-2 | C01: `lineChart`, 5 series, 17 categories, legend and gridlines yes, values equal the XML | As stated |
| T-PPTX-2 | CM-2 | C03: `barChart` column stacked; C04: `pie3DChart` with `view3D` → 3D yes | As stated |
| T-PPTX-3 | CM-2 | C10: `bubbleChart` with x, y and size; axis titles verbatim with "→" | As stated |
| T-PPTX-4 | CM-2 | `dual-axis.pptx` → dual axis yes, each series' axis; `log-axis.pptx` → log yes | As stated |
| T-PPTX-5 | CM-2 | `theme-colours.pptx` → colour "theme" (not a guessed hex); `with-thumbnail.pptx` sends the thumbnail | As stated |
| T-PPTX-6 | CM-2 | Shapes text keeps font sizes; slide title verbatim (C04 "Revenue mix 2025"); text capped at 40,000 characters | As stated |
| T-DET-1..2 | CMS-11 | QT's case-detector tests, ported: a case exhibit page (synthetic, with publisher markers) is blocked in the browser (CM-U06) and by each function (422, no model call) | Blocked |
| T-READ-1 | CMS-7 | The read function's system prompt is `read-chart.md` only (no persona); the user message has the image block (when any) then one JSON block | As stated |
| T-READ-2 | CMS-7 | A mocked reading that fails the schema regenerates with `previousErrors`, up to 3 attempts, then CM-S04 | As stated |
| T-READ-3 | CMS-7 | Mocked `readable: false` → Daniel's unreadable message with the reason; upload card again; tries counted; after 3, the "try later" message | As stated |
| T-READ-4 | CMS-7 | A readable result is stored on the upload with its summary; Stage 1 opens (first upload) or the reading confirmation (re-upload) | As stated |
| T-ENG-1 | CM-4 | Stages open strictly in order; no stage reachable early by the tracker, resume or URL | Blocked |
| T-ENG-2 | CM-4 | Verdict computed from severities: any hard stop → hardStop; any major → revise; else pass. A model verdict that disagrees is overridden and logged | As stated |
| T-ENG-3 | CM-4 | Stage 1 passes only when the latest review has no blocking finding; earlier findings close on rewrite | As stated |
| T-ENG-4 | CM-5 | An `offeredLead` in rounds 1–2 is stripped; in round 3 with a blocking finding it is kept; a second offer later is stripped | As stated |
| T-ENG-5 | CM-5 | After round 5 Stage 1 moves on with the latest lead; the record flags it | As stated |
| T-ENG-6 | CM-5 | Lead rounds count across a reopen: 2 rounds, route back, then the next round is round 3 and may carry the offer | As stated |
| T-ENG-7 | CM-4 | Stages 2–4: accepting every blocking fix passes with no further call; a decline with a reason under 10 characters is refused | As stated |
| T-ENG-8 | CM-4 | Decline → next call carries it; `accept` closes; `pushBack` shows two buttons; either closes with `finalChoice`; a second push-back is converted to accept | As stated |
| T-ENG-9 | CM-12 | Stage 2 route options: **Rewrite the lead** reopens Stage 1 (3 rounds); on its pass Stage 2 runs with `leadChanged: true` outside the cap; **Keep it and name the data** adds to `dataToSource` and closes the finding | As stated |
| T-ENG-10 | CM-12 | `route: "reupload"` opens the upload card; the new upload is read and confirmed; Stage 3 opens on it; old open Stage 2 findings become superseded; a second reupload route is refused when `reuploadsLeft` is 0 | As stated |
| T-ENG-11 | CM-4 | Caps: a stage at its cap with blocking findings open becomes `cappedOpen` and moves on | As stated |
| T-ENG-12 | CMS-14 | The planned page lists the agreed lead, accepted fixes in stage order, declined fixes with reasons and data to source; it equals the Stage 5 input and the redraw input | As stated |
| T-ENG-13 | CM-4 | Stage 5 reopen: one round in the reopened stage (3 for Stage 1), then straight back to Stage 5, which can't reopen again | As stated |
| T-ENG-14 | CM-4 | Same lead twice is not sent and uses no round | As stated |
| T-REV-1 | CMS-5 | Unknown rule ID → finding dropped and logged | As stated |
| T-REV-2 | CM-6 | Logic first: a C or P rule in Stage 1 or 2, or a P rule in Stage 3, is dropped; D10 is allowed in Stage 1; L8 and L11 in Stage 5 | As stated |
| T-REV-3 | CMS-5 | A severity outside the rule's `allowed` list is reset to its default; C11 accepts major or minor; P2 hard stop or major | As stated |
| T-REV-4 | CMS-5 | `whatWorks` with a hard stop is set to null | As stated |
| T-REV-5 | CMS-5 | More than 3 blocking findings, a message over 150 words, or a score → regenerate with the reason in `previousErrors` | As stated |
| T-REV-6 | CM-5 | A Stage 1 message quoting a rewritten lead before round 3 → regenerate | As stated |
| T-REV-7 | CMS-5 | `route`, `reopenStage`, `impression` outside their stages are stripped; `impression` only on a Stage 4 pass | As stated |
| T-REV-8 | CMS-5 | Missing `declineResponses` for a declined finding → regenerate | As stated |
| T-REV-9 | CM-6 | Assembled system prompt for each stage: persona + overlay + stage prompt, with only that stage's rule table (Stage 5: F rules plus L8 and L11), the fault library and the feedback format; no `{{` left | As stated |
| T-RULES-1 | CMS-10, CM-11 | `node scripts/rules-from-prd.mjs --check` passes; a changed severity in the PRD or the prompt rule library fails it | As stated |
| T-FN-1 | CMS-6 | Every function: wrong method 405; no or wrong access code 401 with no model call; oversize 413; bad JSON 400; text limits enforced | As stated |
| T-FN-2 | CM-10 | NDJSON: `meta`, `ping` during silence, one final event; a model that overruns the budget gives a final `error` (CM-S03) | As stated |
| T-FN-3 | CMS-5 | Omitted empty fields are filled before the schema check | As stated |
| T-CHAT-1 | CM-7 | Daniel's messages, the student's turns and checklist cards render in order; nothing depends on colour alone (severity in words) | As stated |
| T-CHAT-2 | CM-7 | The tracker shows to do, current, passed, moved on, in words and icons | As stated |
| T-CHAT-3 | CM-7 | Checklist: Accept and Decline per blocking fix; Decline needs a reason; minors collapsed with **Accept all** | As stated |
| T-CHAT-4 | CMS-12 | Reading confirmation: **Yes** goes on; **Correct it** takes up to 300 characters, stored and sent as `readingCorrection` | As stated |
| T-CHAT-5 | CMS-13 | Comparison picker with six options and "Something else" with text; required | As stated |
| T-CHAT-6 | CM-5 | The offer shows in a quoted box; **Use this as a starting point** copies it into the lead box but doesn't send it | As stated |
| T-CHAT-7 | CM-7 | Waiting line "Daniel is … N s"; **Ask Daniel again** after a failure reruns only that call | As stated |
| T-CHAT-8 | CM-7 | Stage 1 findings show as a compact list without accept or decline | As stated |
| T-RD-1 | CM-8 | The redraw check: title equals the agreed lead; one subject series; every lead number in `leadNumbers`; ≤ 3 annotations; source starts "Source: "; declined fixes listed. Failures regenerate | As stated |
| T-RD-2 | CM-8 | Built .pptx (unzipped in the test): A4 10.83 × 7.5 in; master background is the template image; title text, size 24, bold, colour 1F497D at the Title Only position; slide number present; no footer text | As stated |
| T-RD-3 | CM-8 | Chart XML: no gridlines, no legend, no chart title; Calibri; series colours by role (033D93, BFBFBF, then C00000, 008000, FFC000) | As stated |
| T-RD-4 | CM-8 | Kinds: line, column, bar, stacked, 100%, waterfall (transparent base series), scatter with lines, bubble, table (style `{93296810-A885-4BE3-A3E7-6D5BEEA58F35}`) each build and reopen in jszip | As stated |
| T-RD-5 | CM-8 | `valueToSlide`: a lead number is placed within 0.2 in of its point for a known spec | As stated |
| T-RD-6 | CM-8 | "Illustrative data" on the slide; file name `MGMT5760_<Case>_ChartMakeover_<StudentID>_<AttemptID>_illustrative.pptx` with characters stripped | As stated |
| T-RD-7 | CM-8 | Speaker notes hold the lead, accepted fixes, declined fixes with reasons, and "Data you must source" | As stated |
| T-RD-8 | CM-8 | A declined fix never appears in the spec sent to the builder; changing choices and **Build again** adds a version | As stated |
| T-RD-9 | CM-8 | `redrawable: false` shows Daniel's reason and no download | As stated |
| T-RD-10 | CM-9 | The Chart.js preview renders each kind to a PNG | As stated |
| T-REC-1 | CM-9 | The record opens, A4, footer on every page | As stated |
| T-REC-2 | CM-9, CM-11 | Header: identity, outcome per stage, app, prompt and rules versions, models | As stated |
| T-REC-3 | CM-9 | Every lead draft, every Daniel message, every finding with its decision, reason, push-back and final choice | As stated |
| T-REC-4 | CM-9, CM-12 | Both uploads after a re-upload, each with its image or reading | As stated |
| T-REC-5 | CM-9 | Each redraw version's preview; no prompt text anywhere; file name as spec §13 | As stated |
| T-SAV-1 | CMS-2 | Autosave after each step; reload resumes at the same step with the chat intact | As stated |
| T-SAV-2 | CMS-2 | Quota-limited storage shows the storage warning; nothing crashes | As stated |
| T-SAV-3 | CMS-15 | Downloading the record ends the run (read-only chat); **Start a new run** keeps setup and clears the rest | As stated |
| T-SEC-1 | CMS-6 | The built bundle contains no prompt text, no `ANTHROPIC_API_KEY` and no `.env` values | As stated |
| T-SEC-2 | CMS-6 | Function logs contain no student text (audience, lead, reasons, reading) | As stated |
| T-ERR-1..2 | CMS-4 | Every CM-U and CM-S code has its message; each server failure maps to a code | As stated |
| T-A11Y-1 | CMS-3 | axe on setup, chat (each stage), redraw and record screens: no serious or critical issues; works at 375 px wide | As stated |
| T-TIME-1 | CM-10 | Fake model at 23 s finishes; at 25 s the function ends with CM-S03 inside the budget | As stated |
| T-PIL-1 | CMS-9 | `scripts/pilot-run.mjs --dry-run` reads every calibration input and builds every call body without model calls | As stated |
| T-PIL-2 | CMS-9 | The pilot's comparison logic scores a canned run against `expected.json` correctly (mustCatch by rule and stage, mustNot, globalMustNot) | As stated |
| T-E2E-1 | all | Playwright, model mocked: setup → upload C07 → Stage 1 (two rounds) → reading confirmed → Stage 2 (one decline, push-back) → Stage 3 → Stage 4 → Stage 5 → build the .pptx → record PDF | Completes; files download |
| T-E2E-2 | CM-12 | Playwright, model mocked: C08 path with a route back to Stage 1, `reupload`, a new upload, Stages 3–5 on it | Completes |

## 3. Real-model checks (only when Chris asks)

| ID | Check | Pass |
| --- | --- | --- |
| RT-1 | **Read test** (milestone 2): `read-chart` on the ten inputs against `calibration/read-truth.json`: every `mustRead` string verbatim, `kind`, `chartType` (C06 waterfall or column; C09 bar or column), flags, `keyValues` within ±5% (±10% for the photo) | All ten; misses shown to Chris case by case |
| P-1 | **Stage 1** (milestone 4): one round on each student lead; verdict and every Stage 1 `mustCatch` and `mustNot` in `expected.json` | 10 of 10, or each miss taken to Chris |
| P-2 | **Chart stages** (milestones 5 and 8): Stages 2–5 with `agreedLead` or `pilotLead`, the simulated student accepting every fix; C08's route and re-upload path as `calibration/README.md` says | Every `mustCatch` at its stage and severity; no `mustNot`; no `globalMustNot` |
| P-3 | **Redraw QA** (milestone 6): the .pptx for every case with chart stages, opened in PowerPoint and checked against the style guide's QA list (title position, subheading, nothing below 12 pt, nothing outside the body zone, slide number, notes, "Illustrative data") | All pass (Common Module "Redraw quality") |
| P-4 | **Timing**: every call's duration from P-1 to P-3 | No call over 24 s; 95% of replies ≤ 20 s; redraws ≤ 60 s |
| P-5 | **Cost**: input and output tokens per run | Reported to Chris; budget to set |
| P-6 | **Chris's marks**: `pilot/run-<date>/points.csv`, one row per finding and message, for Chris to mark agree or disagree | ≥ 80% agreed; no false hard stops (Common Module) |
| P-7 | **Time per run**: a TA completes two charts end to end | Within 20–30 minutes each |
| P-8 | **Held-out set**: 10 past student charts (assumption 9), Stage 1 to 5, marked by Chris blind | As P-6 |

The pilot writes `pilot/run-<date>/report.md` (per case and stage: findings with rule IDs and severities, the message, ✓ or ✗ against each check, timings, review-check fixes) and `points.csv`. Misses are prompt or rule questions for Chris, reported before anything is changed.
