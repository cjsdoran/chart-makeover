# Chart Makeover: v1 functional spec

Derived from "PRD — Chart Makeover" rev 58 (`docs/prd.md`, 14 Nov 2026), the build brief (`BUILD_BRIEF.md`), and the specs of Tree Surgery (TS D1–D27) and Question Time (QT D1–D24), whose code this app reuses. Requirement IDs CM-1 to CM-12 match the PRD; CMS-n IDs are added by this spec. Decisions are in §14, questions for Chris in §15.

**Status:** milestones 1–3 built, 15 Nov 2026 (scaffold, intake and reading, D33–D40; chat shell and stage engine on canned reviews, D41–D48). RT-1 passed 10/10 with read prompt 1.1. Chris's answers to §15 (D27–D32) are not in this file yet; the build follows the proposed defaults in §15 until they are.

**Base code.** Tree Surgery is the newer sibling and already has what this app needs most: PDF page rendering with the text layer, .pptx slide reading (groups flattened, pictures), NDJSON responses with keep-alive pings, stage cores shared by the functions and the pilot, the read test and the pilot harness. Copy from `../Tree Surgery App` first, and from `../Question Time App` only where Tree Surgery doesn't have it (D3).

## 1. What the student experiences

One student, one chart they built, about 20–30 minutes (verify in pilot P-7).

| Step | Screen | What happens | Model call |
| --- | --- | --- | --- |
| 1 | Setup | Access code, name, student ID, team (optional), case or project name (CMS-1) | `/api/check` (no model) |
| 2 | Set-up chat | Daniel's opening message asks for the chart and "Who is this for, and what do they need to decide?" The student uploads one chart, writes the audience line, and ticks "These values are illustrative" if they are (CM-1, CM-3, CMS-16) | `/api/read-chart` |
| 3 | Stage 1 Lead | "Forget the chart for a minute…". The student types a lead; Daniel critiques; up to 5 rounds; one offered version from round 3 (CM-5) | `/api/review` stage 1 |
| 4 | Stage 2 Data fit | Daniel's reading ("I read this as …. Right?") with **Yes** / **Correct it** (CMS-12); then the review, fix checklist, and route buttons when offered | `/api/review` stage 2 |
| 5 | Re-upload | Only if Daniel routes it (CM-12): new chart, new reading, confirm, then Stage 3 | `/api/read-chart` |
| 6 | Stage 3 Chart choice | Comparison picker (CMS-13), then the review | `/api/review` stage 3 |
| 7 | Stage 4 Polish | The review; impression line on pass | `/api/review` stage 4 |
| 8 | Stage 5 Fit check | The planned page (CMS-14); Daniel's check; confirm or reopen one stage | `/api/review` stage 5 |
| 9 | Make these changes | Build and download the .pptx; change choices and rebuild (CM-8) | `/api/redraw-plan` |
| 10 | Record | Download the record PDF (CM-9); the run ends; **Start a new run** (CMS-15) | none |

**Layout (CM-7).** Firm-style header (Halden & Rowe · Chart Makeover · case or project · student name). A stage tracker across the top: Set-up · Lead · Data fit · Chart choice · Polish · Fit check · Changes, each marked *to do*, *current*, *passed* or *moved on* (cap reached), in words and an icon, never colour alone. Below it, the chat thread: Daniel's messages on the left, the student's turns on the right, fix checklists as cards under the message that raised them. The input area changes with the step (upload card, lead box, reading confirmation, comparison picker, decline reason, route buttons). While Daniel works: "Daniel is reading your chart… N s". Praxis tokens, IBM Plex Sans and Mono, from Tree Surgery's `tokens.css` and `app.css`. Footer on every screen and the record:

> MGMT 5760 practice tool. Feedback is AI-generated; you remain responsible for your work.

## 2. Setup (CMS-1)

| Field | Rule |
| --- | --- |
| Access code | Required. Checked by `POST /api/check` and again by every function against `CM_ACCESS_CODE` (header `X-CM-Access-Code`); 401 gives "That access code isn't recognised. Check Canvas." (CM-S02) |
| Name | Required, 60 characters or fewer, English letters as on Canvas (QT D12) |
| Student ID | Required, free text, 20 characters or fewer |
| Team | Optional, 40 characters or fewer |
| Case or project | Required, 40 characters or fewer; used in the header and both file names (`<Case>`) |

Course is fixed to MGMT 5760 (Q2). Generate an attempt ID (8 characters, base32) and a start time, as Tree Surgery's `session.js`.

## 3. Upload and reading (CM-1, CM-2)

### 3.1 Set-up message and upload card

Daniel's opening message (app-written, `config/app.json` `messages.opening`; wording Q1):

> Send me the one chart you want to work on: a PowerPoint slide, a PDF page or a photo. Who is this for, and what do they need to decide?

Upload card copy: "One chart: a .pptx with one slide, a one-page PDF, or a photo or screenshot (.png, .jpg, .heic). Up to 20 MB." Under it: the audience line (required, 300 characters or fewer, placeholder "e.g. The CFO, deciding whether to push price rises in the 2026 contract round") and the illustrative-values tickbox (CMS-16). **Send to Daniel** is enabled when both the file and the line are in.

### 3.2 Checks, in order, in the browser

1. **Type** by extension and magic bytes: .pptx, .pdf, .png, .jpg/.jpeg, .heic/.heif. `.ppt` gives CM-U02 (re-save as .pptx); anything else CM-U01.
2. **Size**: `upload.maxMB` 20 (CM-U03).
3. **Open**: pdf.js legacy build (QT D18), jszip, or an `Image` decode. Password-protected PDF CM-U08; other failures CM-U07 with the error name. HEIC is converted to JPEG with `heic2any` first; a failed conversion is CM-U05 ("Export the photo as JPEG and upload again").
4. **One chart** (CM-1): a PDF with more than 1 page or a .pptx with more than 1 slide is refused with Daniel's in-world line "One chart, please." and the hint "Upload a one-page PDF or a one-slide .pptx." (CM-U04). A slide with more than one native chart is refused the same way.
5. **Something to read**: a .pptx slide needs a native chart, a table, a picture covering most of the slide, or at least 3 text shapes; otherwise CM-U09 ("We couldn't find a chart on that slide. Export it to PDF and upload that.").
6. **Case detector** (CMS-11, Q3): QT's `caseDetector.js` on the PDF text layer or the slide text. A block is final (CM-U06).

Every refusal is added to `blockedUploads` (time, code) and printed on the record.

### 3.3 What is sent to the read call

| Upload | Image | Text |
| --- | --- | --- |
| PDF page | Rendered with pdf.js (fonts on, TS D22) to `upload.imageLongSidePx` 2,000 px, PNG, JPEG 0.9 then 0.8 over 3.5 MB (TS §6.3) | The page's text layer with positions and font sizes (`pageTextLines`, TS D19), when it has one |
| Photo or screenshot | EXIF-rotated, resized to 2,000 px long side, JPEG 0.9 | none |
| .pptx slide | `docProps/thumbnail.jpeg` if present (layout and colour only); the picture itself if the chart is a pasted picture | Shapes text with position, size, font and font size (TS `readSlide`, extended with `sz`); tables; and each native chart parsed from its XML (§3.4) |

A second copy of every image, JPEG 1,600 px at 0.85, is kept in the session for Stages 2–4 and the record (D7). The full-size image is sent once, to the read call.

### 3.4 Native chart XML (new: `src/upload/chartXml.js`)

From `ppt/charts/chartN.xml` via the slide's relationships: chart type element (`lineChart`, `barChart` with `barDir` and `grouping`, `pieChart`, `pie3DChart`, `doughnutChart`, `scatterChart`, `bubbleChart`, `areaChart`; several types in one plot area = combo), `view3D`, every `ser` (name from `tx`, categories from `cat` `strCache`/`numCache`, values from `val` or `xVal`/`yVal`/`bubbleSize`, colour from `spPr` `solidFill` `srgbClr`, or "theme" when it is a scheme colour), data labels (`dLbls` on chart and series: shown or not, number format), axes (`catAx`, `valAx`, `dateAx`: title text, `delete`, `scaling` min, max and `logBase`, `numFmt`, `majorGridlines`, which axis each series uses, so a second value axis = dual axis), legend present, chart title text. Sent as compact text, at most 20,000 characters, for example:

```
CHART 1 lineChart, 5 series, categories 2008/09 … 2024/25 (17)
S1 "Man City" colour 4472C4 axis y1 labels:none values 18, 22, … 340
AXES x: title none, shown · y1: title "£m", min auto, max auto, gridlines yes
LEGEND yes · TITLE "Commercial revenue (£m)" · 3D no
```

The calibration .pptx files (C01, C03, C04, C07, C10) cover line, stacked column, 3D pie, bubble and data labels; tests use them (T-PPTX-1..5).

### 3.5 Read call

`POST /api/read-chart` with `{ upload: { kind: "pdf"|"image"|"pptx", fileName, image?: { mediaType, base64 }, pdfText?, pptx?: { shapes, charts, tables } }, attempt, previousErrors? }`. System prompt: `prompts/read-chart.md` only, no persona (CMS-7, as TS D10). User message: the image block (if any), then a JSON text block with the rest. Output: `schemas/read-chart.json`. The function returns the reading to the browser; the browser stores it with the upload.

- **Readable:** the app goes on to Stage 1 (first upload) or to the reading confirmation (re-upload).
- **Unreadable:** Daniel's in-world message from `config/app.json` `messages.unreadable` plus the model's reason, and the upload card again. It doesn't count against anything; at most `caps.unreadablePerUpload` 3 tries (Q4), then "Export the slide to PDF and try once more later." Every unreadable result is printed on the record.

## 4. Stage 1: lead (CM-4, CM-5)

- Opener (app-written, `openers.stage1`). The lead box: required, 300 characters or fewer, "Round 1 of 5".
- `POST /api/review` with `{ stage: 1, round, input }`; `input` as `prompts/stage1-lead.md` describes: `audience`, `lead`, `round`, `cap`, `history` (earlier leads, findings and messages in this stage), `reading` (the active upload's), `offerMade`.
- The review returns findings and a message (§7). Stage 1 has no checklist: its findings close when the student rewrites the lead. The findings show as a compact list under the message (rule chip, severity word, the quoted words), so the student sees what to fix.
- **Gate:** the engine passes the stage when no hard-stop or major finding remains (§5.2). On pass, the lead is frozen as `agreedLead`, the tracker moves on, and Daniel's message says so.
- **Offer (CM-5):** `offeredLead` is kept only if this is lead round 3 or later counted across the run, no offer has been made, and the verdict isn't pass (§5.4). It shows in a quoted box with **Use this as a starting point** (copies it into the lead box for editing; the student must still send it). Otherwise the engine strips it.
- **Same lead again:** a lead identical to the previous one (ignoring case and spaces) is not sent; the app says "That's the same lead as last time. Change it, then send it." (no round used; Q6).
- **Cap:** after round 5 (or the reopened allowance) the stage moves on with the latest lead as `agreedLead`; the record flags what was still open.

## 5. Stage engine (CM-4, `src/engine/`)

Plain JavaScript, no React, imported by the UI, the tests and the pilot harness. It owns the run; the model only reviews.

### 5.1 State (part of the session, §11)

```
run = {
  step, stage,                    // 'setup'|'lead'|'data'|'chart'|'polish'|'fit'|'changes'|'record'
  audience, isDummy,
  uploads: [{ id, fileName, kind, at, reading, readingCorrection, readingConfirmed, image1600? }],
  activeUpload,                   // id; Stages 3–5 use the re-upload when there is one
  leads: [{ text, round, at }], agreedLead, offerMade, leadRoundsUsed,
  comparison,                     // Stage 3 answer
  stages: { 1..5: { status: 'locked'|'open'|'passed'|'cappedOpen', roundsAllowed, rounds: [review] } },
  findings: { [fid]: { stage, upload, rules, severity, location, issue, fix,
                       status: 'open'|'accepted'|'declined'|'closed'|'superseded',
                       reason?, pushBack?, finalChoice? } },
  dataToSource: [string], route?, reopensLeft, reuploadsLeft,
  redraws: [{ at, spec, acceptedIds, fileName }]
}
```

Finding IDs from the model (`S2-1`) are namespaced by upload and round in the engine (`u1-s2-r1-1`), so a finding from an earlier round never collides with a later one.

### 5.2 Gate and verdict (D10)

- A finding is **blocking** if its severity is `hardStop` or `major`.
- **Stage 1:** passes when the latest review has no blocking finding. Earlier rounds' findings are closed by the rewrite (status `closed`).
- **Stages 2–5:** a blocking finding closes when it is `accepted`, or `declined` and Daniel has answered (accepted the reason, or pushed back once and the student made a final choice). The stage passes when no blocking finding is open.
- The engine computes the verdict itself: `hardStop` if any finding is a hard stop, `revise` if any is major, else `pass`. If the model's `verdict` disagrees, the engine's wins and the mismatch goes to the call log (pilot P-2 reports them).
- Minor findings and suggestions never gate. They appear in a collapsed "Minor fixes" group with **Accept all** (Q12); accepted ones go into the redraw.

### 5.3 Rounds and caps (`config/app.json` `caps`)

| Stage | First round | Further rounds | Cap |
| --- | --- | --- | --- |
| 1 Lead | each lead sent | each rewrite | 5 (`leadRounds`); a reopen adds `reopenedLeadRounds` 3 |
| 2 Data fit | after the reading is confirmed | the student sends declines, or the rewritten lead comes back (`leadChanged`) | 3 |
| 3 Chart choice | after the comparison answer | the student sends declines | 3 |
| 4 Polish | on entry | the student sends declines | 3 |
| 5 Fit check | on entry | after a reopen, once | 1 reopen |

A round is one review call. If every blocking finding is accepted, the stage passes with no further call. With declines, **Send to Daniel** sends them with their reasons; the next review's `declineResponses` answer each one. At a cap with blocking findings open, the stage is `cappedOpen`: the student moves on and the record lists what was open.

### 5.4 Lead offer (CM-5)

`leadRoundsUsed` counts lead rounds across the run, including a reopened Stage 1. The offer is allowed when `leadRoundsUsed >= offerAtRound` (3), `offerMade` is false and the review isn't a pass. Then `offerMade` becomes true for the rest of the run.

### 5.5 Declines and push-back (D14)

Decline needs a reason of at least 10 characters. Daniel's next review answers each: `accept` closes it; `pushBack` shows Daniel's sentence with two buttons, **Accept the fix** and **Keep my choice**; either closes it with `finalChoice`, with no further call. A finding is never pushed back twice (`caps.pushBacksPerFinding` 1; the review check drops a second push-back).

### 5.6 Routes (CM-12)

- **Stage 2 or 5 `route.options`** shows **Rewrite the lead** and **Keep it and name the data**.
  - Rewrite: Stage 1 reopens with `reopenedLeadRounds` more rounds. When it passes, Stage 2 runs one more round with `leadChanged: true` (outside its cap).
  - Name the data: a text box (required, 200 characters or fewer) adds to `dataToSource` and closes the finding.
- **`route: "reupload"`** (only when `reuploadsLeft` is 1): Daniel's message asks for the redrawn chart. The upload card opens; the new upload is read (§3.5), its reading confirmed (CMS-12), and Stage 3 opens on it. Stage 2 findings tied to the old chart that are still open become `superseded`. `reuploadsLeft` becomes 0. Both uploads stay in the session and the record.

### 5.7 Stage 5 reopen

Daniel's `reopenStage` (or the student's own choice of Stage 1–4 from a picker) reopens that stage with one more round (a reopened Stage 1 gets 3), then returns straight to Stage 5, which runs once more and can't reopen again (`caps.fitReopens` 1).

### 5.8 Planned page (CMS-14)

Stage 5 opens with the planned page, built by the engine, not the model: the agreed lead; the accepted fixes in stage order; the declined fixes with reasons; the data to source. The same object is the Stage 5 input (`plannedPage`) and the redraw input.

## 6. Stages 2–5 inputs

| Stage | Opener | Input to `/api/review` (beyond `stage`, `round`) |
| --- | --- | --- |
| 2 | `openers.stage2` with the reading's `summary`, **Yes** / **Correct it** (a 300-character correction box), then `openers.stage2Then` | `audience`, `lead`, `reading`, `readingCorrection`, `image` (1,600 px copy, if any), `cap`, `history`, `leadChanged`, `reuploadsLeft`, `dataToSource` |
| 3 | `openers.stage3`, with the picker (CMS-13): Items, Time, Distribution, Composition, Relationship, Framework, or "Something else" with a text box | as Stage 2, plus `comparison`, `acceptedFixes` (Stage 2) |
| 4 | none (Daniel goes straight to issues) | as Stage 3, plus `isDummy`; `acceptedFixes` from Stages 2–3 |
| 5 | `openers.stage5` with the planned page | `audience`, `lead`, `reading`, `readingCorrection`, `plannedPage`, `reopensLeft`, `history` |

`history` carries this stage's earlier findings with their status, reasons and any push-back, so Daniel can answer declines and keep finding IDs stable.

## 7. Model output handling (CMS-5)

One pattern for the three model functions, from Tree Surgery's `netlify/lib/stages.mjs` and `anthropic.mjs`:

1. Guard: method, access code, declared and actual size, JSON shape, text limits (§12), case detector on any text field.
2. One model call, streamed into a server-side buffer. Response to the browser: NDJSON `meta`, `ping` every `keepAliveSeconds` (5), then one final event (TS §9).
3. On `message_stop`: parse (`modelJson.js`), fill omitted empty fields (QT D23), validate against the schema (ajv), then the **review check** (§7.1).
4. Final event `{ type: "result", data, promptVersion, rulesVersion, servedBy, durationMs }`, or `{ type: "invalid", errors }`, or `{ type: "error", error, message }`. Unlike Tree Surgery, findings **do** go to the browser: the student acts on them (D4).
5. The browser retries `invalid` with `attempt + 1` and `previousErrors`, up to 3 attempts in all; then CM-S04 with **Ask Daniel again**.

The pilot harness calls the same cores in-process (`netlify/lib/stages.mjs`).

### 7.1 Review check (`shared/reviewCheck.js`)

| Check | On failure |
| --- | --- |
| Every rule ID exists in `config/rules.json` and is allowed in this stage (`stages`) | Drop the finding and log it (logic first: C or P rules in Stages 1–2, P rules in Stage 3) |
| Each severity is in the rule's `allowed` list; a multi-rule finding takes the most severe of its rules' allowed values | Set it to the rule's default severity and log it |
| `whatWorks` is null when any finding is a hard stop | Set to null |
| `offeredLead` only under §5.4 | Strip it |
| `route`, `reopenStage`, `impression` only in their stages (`impression` on a Stage 4 pass only) | Strip |
| At most `caps.issuesShown` 3 blocking findings | Regenerate: "Raise at most three hard-stop or major findings; group by root cause." |
| `message` at most 150 words (target about 120, `caps.messageWords`) | Regenerate with the count |
| No score: `/\b\d+(\.\d+)?\s*(\/|out of)\s*(5|10|100)\b/i` or the words "score", "grade", "rating" about the work | Regenerate |
| `declineResponses` cover every declined finding sent, and push back only once per finding | Regenerate (missing) or convert a second push-back to accept |
| Stage 1: `message` doesn't contain a quoted rewrite of the lead before round 3 (a quoted sentence of 6+ words that isn't the student's own words) | Regenerate: "Don't write the lead for the student before round 3." |

Strip-and-log fixes don't cost a call; regeneration does. The pilot reports both.

### 7.2 Time budget (CM-10, D12)

Opus 5.5 thinks before it answers and the thinking counts against `max_tokens`; the same call's time varies widely (QT D24). Starting limits in `config/app.json`: read 2,500; stages 1–5 1,600 each; redraw plan 3,000 (D12; the brief's 1,200–1,500 were raised after Tree Surgery's D26 cut-offs). `functionBudgetSeconds` 24. Milestone 4 measures Stage 1 on the ten cases, milestone 5 the other stages. If any stage's p95 is over 20 s, that stage splits into two browser-driven calls, findings then message, as TS D24 (no seal needed: findings aren't secret here). The redraw plan's 60 s target (CM-10) allows one regeneration.

## 8. Prompts

- Files in `prompts/`, server-side only, loaded by `netlify/lib/prompts.mjs` (TS). Each starts with `<!-- version: x.y · … -->`, which the loader strips and reads as the version (done in milestone 0, D5).
- **Stage prompts:** system = `persona.md` (QT, copied unchanged) + `overlay-chart-makeover.md` + `stageN-….md`, with `{{RULES_STAGE_N}}` replaced by that stage's section of `shared/rule-library.md` (Stage 1's includes the lead-shape and actions paragraphs), `{{RULES_L8_L11}}` by those two rows with the table header, `{{FAULT_LIBRARY}}` and `{{FEEDBACK_FORMAT}}` by the shared files. The assembled prompt is cached (`cache_control`).
- **Read and redraw:** task prompts only (no persona).
- **User message:** the stage's input as one JSON text block (D6), preceded by the image block where the stage sends one.
- **Versions:** every response carries `promptVersion` (each part's version) and `rulesVersion` (from `config/app.json`); the record prints both (CM-11).
- Until Chris has marked calibration run 2, prompt wording may change freely; record each change in §14. After that, only with Chris's agreement.

## 9. Make these changes (CM-8, `src/redraw/`)

### 9.1 Plan call

`POST /api/redraw-plan` with `{ lead, audience, comparison, reading, readingCorrection, plannedPage, isDummy, attempt, previousErrors? }`. Output: `schemas/redraw-spec.json`, then the **redraw check**: `title` equals the agreed lead exactly; at most one chart; `series[].role` has one `subject`; every number in the lead (regex on digits, %, £, $, HK$) appears in `leadNumbers`; `annotations` ≤ 3; `source` starts "Source: "; `notes.declinedFixes` equals the declined list. Failures regenerate (max 2).

`redrawable: false` (concept charts) shows Daniel's reason and no download (PRD "Out of scope").

### 9.2 Builder

PptxGenJS (pinned), in the browser, from the spec and `config/app.json` `redraw`:

- Layout A4 landscape 10.83 × 7.5 in (`defineLayout`). One master `CM_TITLE_ONLY`: background `assets/template/title-only-bg.jpg` (served from `public/`), title placeholder at (0.77, 0.05, 9.52 × 0.95), Calibri 24 pt bold `1F497D`, left, middle; slide number at (10.33, 7.2); no footer text.
- Subheading text box (0.40, 0.98), 24 pt bold black, upper case. Source line (0.30, 6.95), 12 pt regular. "Illustrative data" at the top right of the body zone, 14 pt bold `C00000`.
- Chart in the body zone, with the plot area (`layout`) and value-axis min and max set explicitly, so `valueToSlide(x, y)` maps any data point to slide inches. Calibri 16 pt bold, black axes, no gridlines, no legend, no chart title. Colours by role: subject `033D93`, comparison `BFBFBF`, others in order `C00000`, `008000`, `FFC000`.
- Overlays placed with `valueToSlide`: series labels at the line end (in the series colour); lead numbers 24 pt bold `033D93` beside their mark; CAGR labels at the right end; annotations as rounded rectangles, white fill, 0.75 pt black outline, 16 pt; reference lines as thin dashed lines with their label.
- Kinds: `line`; `column` and `bar` (sorted as the spec says); `stackedColumn` and `stacked100` (value axis hidden, segment labels left of the first column, totals above, CAGR per segment on the right); `waterfall` (stacked columns, the base series transparent, start and end bars in the subject colour, changes grey or red for negative); `scatter` with `lineSize` above 0 for a relationship joined in time order, start, turning point and end labelled; `bubble` (GE matrix kept with attractiveness vertical; quadrant split lines drawn as shapes and labelled); `table` (native table, Medium Style 2 – Accent 6 via `tableStyleId`, first column bold).
- Speaker notes: the agreed lead; accepted fixes; declined fixes and reasons; "Data you must source" with one line per illustrative series and each `dataToSource` item.
- File name `MGMT5760_<Case>_ChartMakeover_<StudentID>_<AttemptID>_illustrative.pptx` (characters outside A–Z, a–z, 0–9, `_`, `-` stripped).
- Then Daniel's last message (`openers.lastMessage`). **Change my choices** reopens the checklists (accept or decline only; no new review), and **Build again** makes a new version; each version is kept in `redraws` for the record.

### 9.3 Preview

Chart.js (pinned) draws the same spec on an off-screen canvas, with the title, subheading and overlays, as a PNG for the screen and the record (D19). It's a preview of the content, not a render of the .pptx; the record says so.

## 10. Schemas (`schemas/`)

JSON Schema 2020-12, validated with ajv in the functions and tests: `read-chart.json`, `stage-review.json`, `redraw-spec.json` (written in the brief; adjust in milestones 2, 4 and 6 and record changes in §14). The model is not given the schema as structured output; the prompts describe the contract and the function validates, as Tree Surgery.

## 11. Session, end of run and new runs (CMS-2, CMS-15)

- `localStorage` key `cm.v1.session`, `SESSION_VERSION` 1, saved after every step and on edits (debounced 1 s), with Tree Surgery's resume prompt, storage warning and try/catch. Images are the 1,600 px JPEG copies (about 200–400 KB each, two uploads at most), so a run stays well under the usual 5 MB (D7).
- The run **ends** when the student downloads the record: `endedAt` is set and the chat becomes read-only. Chart Makeover is encouraged and unlimited, so there is no lock beyond that; **Start a new run (another chart)** keeps the setup fields and starts again (D21).

## 12. Functions: common rules

| Function | Model call | Body limit | Notes |
| --- | --- | --- | --- |
| `POST /api/check` | none | — | 204 or 401 |
| `POST /api/read-chart` | `models.readChart` | 5 MB | Netlify's synchronous limit is 6 MB |
| `POST /api/review` | `models.stageN` | 2 MB | Stages 2–4 carry the 1,600 px image |
| `POST /api/redraw-plan` | `models.redrawPlan` | 1 MB | |

- Guard order as Tree Surgery: method, access code (timing-safe), size, JSON shape, text limits (audience 300; lead 300; correction 300; comparison 200; decline reasons 300 each; data to source 200 each; pdfText 20,000; pptx text 40,000; history 30,000), case detector on every text field.
- One model call per invocation; `functionBudgetSeconds` 24; keep-alive pings; system prompt cached; `effort` and `fallbacks: "default"` (QT D10).
- Log only endpoint, stage, round, duration, tokens, attempt, outcome, error code, and review-check fixes by type. Never student content.

### 12.1 Error codes (CMS-4)

| Code | When |
| --- | --- |
| CM-U01 | File type not accepted |
| CM-U02 | Older .ppt |
| CM-U03 | Over 20 MB |
| CM-U04 | More than one page, slide or chart: "One chart, please." |
| CM-U05 | HEIC photo couldn't be converted |
| CM-U06 | Case detector block |
| CM-U07 | File couldn't be opened (plus the error name) |
| CM-U08 | Password-protected PDF |
| CM-U09 | No chart found on the slide |
| CM-S01 | Server not configured (`CM_ACCESS_CODE` or `ANTHROPIC_API_KEY` missing) |
| CM-S02 | Access code not recognised |
| CM-S03 | Daniel timed out |
| CM-S04 | Daniel's reply failed the checks after its retries |
| CM-S05 | Any other failure reaching Daniel |

An unreadable chart (§3.5) is an in-world message, not an error code. CM-Uxx and CM-Sxx codes are distinct from the CM-n requirement IDs by their letter.

## 13. Record PDF (CM-9)

Built in the browser with pdf-lib, A4, Helvetica (QT D12), Tree Surgery's `layout.js` and image method, footer on every page.

1. **Header:** tool, case or project, student name, ID and team, attempt ID, started and finished, outcome per stage (passed in round N, or moved on at the cap), app version, prompt versions, rules version, model(s), blocked uploads, unreadable tries.
2. **Set-up:** the audience line; the illustrative-values answer; each upload's file name, its image (1,600 px copy; for a .pptx without one, "PowerPoint slide: see Daniel's reading" and the reading's summary and key values), and Daniel's reading with any correction.
3. **Stage 1:** every lead draft with Daniel's message and findings; the offer, if made; the agreed lead.
4. **Stages 2–5:** for each round, Daniel's message, then each finding (rule IDs, severity, location, issue, fix) with the student's decision (accepted; declined with reason; Daniel's answer; final choice). Routes taken, data to source, reopens, open items at caps.
5. **Make these changes:** for each version built, its preview image (§9.3), the accepted fixes it applied, and the file name.
6. Daniel's closing line.

Never prompt text. File name `MGMT5760_<Case>_ChartMakeover_<StudentID>_<AttemptID>.pdf` (PRD and Common Module; Tree Surgery used the name, TS D14).

## 14. Decisions (build defaults; Chris to confirm in §15)

| ID | Decision |
| --- | --- |
| D1 | Folder `Chart Makeover App` in OneDrive `Documents/Consulting practice apps`, beside `Question Time App` and `Tree Surgery App`. New private GitHub repo `chart-makeover`, its own Netlify site. |
| D2 | `CM_ACCESS_CODE`, header `X-CM-Access-Code`. |
| D3 | Copy from Tree Surgery first (page render and text layer, slide reading, NDJSON with pings, stage cores, pilot, read test, record layout), then Question Time where Tree Surgery has nothing. Don't import across folders. |
| D4 | Findings go to the browser: the student accepts or declines them (CM-7). No seal (TS D24's AES token is not needed). Prompts still never leave the server. |
| D5 | Milestone 0: prompt versions moved into `<!-- version: … -->` headers so Tree Surgery's loader reads them; wording unchanged. |
| D6 | User messages are one JSON text block (the prompts describe JSON inputs), not Tree Surgery's tagged blocks. |
| D7 | The read call gets a 2,000 px image once; a 1,600 px JPEG (0.85) is kept in `localStorage` and sent to Stages 2–4 and printed in the record. No IndexedDB (the brief suggested it; Tree Surgery's sizes show it isn't needed). |
| D8 | .pptx: no rendered image (no in-browser renderer); shapes, tables and native chart XML as text; the thumbnail or pasted picture when present (§3.3–3.4). |
| D9 | A PDF page goes as the image plus its positioned text layer (TS D19), so typos are read from the file. |
| D10 | The engine computes each verdict from `config/rules.json` severities; the model's verdict is checked, not trusted. |
| D11 | Review check as §7.1: cheap fixes in code, regeneration only for what code can't fix. |
| D12 | Starting `maxTokens`: read 2,500, stages 1,600, redraw 3,000 (thinking counts). Measure first; split a stage into findings and message calls only if its p95 exceeds 20 s. |
| D13 | Stage 1 findings close by rewriting; no checklist in Stage 1. |
| D14 | Declines need a 10-character reason; Daniel answers once; a push-back leaves the final choice to the student with no further call. |
| D15 | A round is a review call; a stage with every blocking fix accepted passes without another call. |
| D16 | Lead rounds count across the run for the offer (from round 3, once); a reopened Stage 1 gets 3 more rounds. |
| D17 | After a re-upload, Stage 2 findings on the old chart that are still open are marked superseded; Stages 3–5 review the new upload. |
| D18 | A Stage 5 reopen returns straight to Stage 5 after one round in the reopened stage (3 for Stage 1). |
| D19 | The redraw preview in the record is drawn with Chart.js from the redraw spec, not rendered from the .pptx. |
| D20 | Record file name uses the student ID (PRD), not the name (TS D14). |
| D21 | The run ends when the record is downloaded; no lock beyond the read-only chat; new runs unlimited. |
| D22 | pdf.js standard fonts, CMaps and wasm served from `/pdfjs/` (TS D22). |
| D23 | Pilot and read test render PDF pages and resize photos in Node with `@napi-rs/canvas` (TS D13). The pilot's simulated student accepts every fix. |
| D24 | Omitted empty fields (`declineResponses`, `findings`, nulls) are filled before the schema check (QT D23). |
| D25 | `config/rules.json` is generated from `docs/prd.md` by `scripts/rules-from-prd.mjs`; `--check` fails on drift between the PRD, `rules.json` and `prompts/shared/rule-library.md` (T-RULES-1). Verified in milestone 0: the generated file matches the brief's on all 53 rules. |
| D26 | Changes agreed in a build session go into the PRD too, with a change-log row, and `docs/prd.md` is refreshed in the same push (Tree Surgery practice, Chris, 3 Nov 2026). Implementation details stay here. |
| D27–D32 | Reserved for Chris's answers to §15 (opening prompt, milestones 1–2). **Not in this copy of the file**, and `docs/prd.md` has no "Build M0" change-log row: the answers weren't saved or exported. Milestones 1–2 followed the §15 proposed defaults; Chris's message confirmed the same-slide PDF or picture (assumption 3) and the case detector (Q3). |
| D33 | *Implementation.* Photos: the browser's `createImageBitmap` (`imageOrientation: 'from-image'`) and the read test's `@napi-rs/canvas` both apply EXIF orientation when they decode, so `src/upload/image.js` turns the image itself only for a decoder that doesn't (T-UP-9). A photo or screenshot is reduced to 2,000 px on its long side, never enlarged. |
| D34 | *Implementation.* Upload type: the extension picks the type and the first bytes must agree; a mismatch is CM-U01 (spec §3.2 step 1). |
| D35 | *Implementation.* .pptx text (spec §3.3): a placeholder that inherits its position or font size takes them from the slide layout, then the master (C04's title is 44 pt from the master). The chart text (§3.4) lists every category and value in full, with per-point colours, typed-over point labels (C10's bubble names), label sizes and number formats; Office 2016+ chartex parts (waterfall etc.) are parsed for categories and values. |
| D36 | *Implementation.* PDF text layer: strings that are only zero-width or private-use characters (the class template's U+F0B2 symbol glyphs) are dropped; each line carries `size=` (the text height in points). |
| D37 | Same-slide PDF or picture (assumption 3): shown only when the chart is a .pptx; a one-page PDF, .png, .jpg or .heic, with the same checks as a chart upload. It replaces the thumbnail (or a pasted picture) as the image the read call gets, tagged so the read prompt knows the .pptx data is the truth for words and values; it is also the stored 1,600 px image for Stages 2–4 and the record. Its own text layer isn't sent. **Student-visible: for the PRD if Chris's answer didn't already cover it.** |
| D38 | Student-visible wording added in milestone 2, **for Chris to confirm into the PRD**: setup intro and **Continue to Daniel**; upload card labels ("One chart", "A PDF or picture of the same slide (optional)" with its hint, the tickbox "These values are illustrative: it's a dummy chart, not real data yet."); the case-detector message for charts ("This looks like a page from a published teaching case, which can't go into an AI tool. Upload a chart you made yourself."); the CM-U04 hints (pages, slides, charts) under Daniel's "One chart, please."; CM-U01–U03, U05, U07–U09 messages. |
| D39 | After `caps.unreadablePerUpload` (3) unreadable tries, Daniel sends `messages.unreadableTryLater` and the upload card stays open (the message tells the student to export to PDF and try again). Q4's "at most 3 tries" is read as the point the message changes, not a lock. **For Chris to confirm.** |
| D40 | *Implementation.* `config/app.json` gained `firm`, `em`, a `limits` block (setup fields, text limits from §12, request sizes) and `fallbacks: "default"` on each model (QT D10). The read call's JSON block names what the attached image is (`imageRole`: page, photo, picture, thumbnail, sameSlide); `prompts/read-chart.md` is unchanged. |
| D41 | Student-visible wording added in milestone 3, **for Chris to confirm into the PRD**: the cap line "We've used the rounds for this stage, so we'll move on. Your record lists what's still open."; the confirm line "Good. The page is agreed: you can make the changes."; checklist labels (**Accept**, **Decline**, "Why are you keeping it as it is?", **Decline this fix**, **Accept all minor fixes**, **Send to Daniel**, **Move on**); the offer caption "One stronger version, from your own words. You still write the final lead."; **Correct it** → "What did Daniel get wrong?"; the route prompt "The data doesn't prove the lead yet. Choose one:" and "What data would prove your lead?"; Stage 5's **The page works: confirm it** and "Or reopen one stage (once)"; the student turns the app writes ("I'll rewrite the lead.", "I'm declining the D6 fix (location): reason", "Let's reopen Chart choice.", "The page works."). |
| D42 | Stage 5's **Rewrite the lead** route uses Stage 5's one reopen: Stage 1 gets 3 more rounds, then the run returns straight to Stage 5 (as D18). Stage 2's route doesn't touch `reopensLeft`. |
| D43 | **Keep it and name the data** closes the route review's *undecided* blocking findings of the stage's own family (D rules in Stage 2, F rules in Stage 5), or all its undecided blocking findings if none is of that family. A fix the student has already accepted or declined keeps that decision. |
| D44 | At a cap, or in the single round of a stage reopened from Stage 5, declines can't be sent (no call is left): **Move on** closes the stage as `cappedOpen` and the declined fixes stay open in the record. In Stage 5 the student accepts or declines, then confirms; a confirm with a blocking finding open is `cappedOpen`. Stage 5 never passes without the student's confirm (PRD: "Confirms, or reopens one stage"). |
| D45 | A new review round in Stages 2–5 supersedes the stage's *undecided* blocking findings from earlier rounds (after a rewritten lead, say); minor fixes stay open so they can still be accepted. A new finding that repeats a decline Daniel answered in the same review is dropped (the answer governs); a declined finding the review doesn't answer is closed. Both are logged; from milestone 4 the review check regenerates first (§7.1). |
| D46 | *Implementation.* After a `reupload` route, reading the redrawn chart marks Stage 2 passed (its open findings superseded, D17) and shows the new reading to confirm; the confirm opens Stage 3. The re-upload card has no audience line or tickbox (the run keeps the first). |
| D47 | *Implementation.* The engine (`src/engine/engine.js`) runs in the browser and never imports `config/rules.json`: the rules' wording is shared with the prompts and must not ship (T-SEC-1). Rule IDs and severities are enforced on the server by the review check (§7.1, milestone 4); the engine trusts the severities it receives and computes the verdict from them. Until milestone 4, `src/engine/canned.js` supplies fixed reviews, with an on-screen notice. |
| D48 | **Question for Chris (Q13).** A Stage 4 that passes because the student accepted every blocking fix makes no further call (D15), so there's no review with a pass verdict to carry the impression line (PRD: "Closing Stage 4: one line on the impression"). Proposal: Stage 5's call gives the impression in its opening sentence when Stage 4 had none. Until answered, such a run simply has no impression line. |

## 15. Questions for Chris

**The nine assumptions in the brief.** My proposed answer in brackets.

1. Folder and repo (D1). [Yes: `Chart Makeover App`, repo `chart-makeover`, own Netlify site.]
2. `CM_ACCESS_CODE`, separate from the other apps (D2). [Yes.]
3. A .pptx has no page image, so visual points (clutter, emphasis, alignment) are judged from the slide's XML (D8). [Yes, and add an optional "Add a PDF or picture of the same slide" on the upload card: it gives Daniel the visual and the record an image. Recommended.]
4. Stage 1 sees the reading only for L11 and D10; the reading is confirmed by the student at the start of Stage 2, with no model call (CMS-12). [Yes.]
5. A route back to Stage 1 gives 3 more lead rounds (D16). [Yes; the round-3 offer counts rounds across the run.]
6. A declined fix closes once Daniel has answered (D14). [Yes.]
7. Redraw preview drawn with Chart.js (D19). [Yes.]
8. Template background from the Man City deck. [Yes, until `HKUST_class_template.pptx` is in the folder: it's in the project but I couldn't fetch it as a file. Drop it into `assets/template/` and I'll compare the backgrounds.]
9. Run 2 is in-sample; a held-out set of 10 past student charts follows. [Yes. Which charts, and when can you supply them? They stay in `calibration/private/`, git-ignored.]

**New questions**

- **Q1 Opening message** (§3.1): "Send me the one chart you want to work on: a PowerPoint slide, a PDF page or a photo. Who is this for, and what do they need to decide?" OK?
- **Q2 Course.** The PRD and file names say MGMT 5760; Tree Surgery also serves GBUS 4910. MGMT 5760 only? [Yes, fixed.]
- **Q3 Case detector.** The brief dropped it because students upload only their own chart. But a page copied from a case's exhibits would pass a licensed case to the model. Reuse Question Time's detector on the chart's text? [Yes: cheap, and a block is final.]
- **Q4 Unreadable uploads:** at most 3 tries per upload, then a "try later" message? [Yes, 3.]
- **Q5 Message length:** hard ceiling 150 words for the regeneration check, target about 120? [Yes.]
- **Q6 Same lead twice:** not sent, no round used (§4)? [Yes.]
- **Q7 Illustrative values.** The prompts use "is this a dummy chart" (D7 obtainable, P2 source, P11 label). Ask it as a tickbox at upload (CMS-16), rather than have Daniel guess? [Yes.]
- **Q8 Timing.** Stage reviews with an image may run near 20 s. Measure in milestones 4–5 and split a stage into two calls only if needed (D12)? [Yes.]
- **Q9 Minor fixes.** The PRD lists minors "in one line, not explained", but the redraw applies only accepted fixes, and most minors (gridlines, legend, rounding) are redraw changes. Show minors as a collapsed checklist with **Accept all**, non-gating (§5.2)? [Yes.]
- **Q10 Comparison picker:** Items, Time, Distribution, Composition, Relationship, Framework, Something else? [Yes.]
- **Q11 Stage 1 findings on screen:** shown as a compact list under Daniel's message (rule, severity, quoted words), with no accept or decline? [Yes.]
- **Q12 Course use and the record.** Use is encouraged, not mandated: does the record go to Canvas at all, or is it for the student's own file? It changes only the record's header wording. [For the student's file; Canvas optional.]
- **Q13 Stage 4 impression** (D48): when Stage 4 passes by accepting every fix there's no further call, so no impression line. Let Stage 5's call open with it? [Yes.]

## 16. Requirements

| ID | Requirement | v1? | Tests |
| --- | --- | --- | --- |
| CM-1 | One chart: .pptx (one slide), .pdf (one page), .png/.jpg/.heic (HEIC converted); anything more refused with "One chart, please." | v1 | T-UP-1..8 |
| CM-2 | The page as an image the model can read; .pptx native chart data and text read from the file (no .pptx image: D8) | v1 | T-UP-9, T-PPTX-1..6, T-PDF-1..3, RT-1 |
| CM-3 | Set-up asks for one required line on audience and decision | v1 | T-SU-1 |
| CM-4 | Stage engine: five stages in order, gates, caps, routes back | v1 | T-ENG-1..14, T-E2E-1..2 |
| CM-5 | Lead help: no wording before round 3; one offer from round 3 if a hard stop or major still fails; move on after round 5 | v1 | T-ENG-4..6, T-REV-6 |
| CM-6 | Structured findings per stage from the rule and fault libraries, grouped by root cause | v1 | T-REV-1..9, P-2 |
| CM-7 | Chat view, stage tracker, fix checklist with accept or decline (reason required) | v1 | T-CHAT-1..8 |
| CM-8 | "Make these changes" builds the .pptx in the browser with PptxGenJS from accepted fixes; rebuild after changed choices | v1 | T-RD-1..10, P-3 |
| CM-9 | Record PDF: lead drafts, findings and decisions per stage, image of the original, redraw preview | v1 | T-REC-1..5 |
| CM-10 | EM reply within 20 s and redraw within 60 s for 95% of turns | v1 | T-TIME-1, T-FN-2, P-4 |
| CM-11 | Prompts, rule library and fault library versioned; versions on the record | v1 | T-RULES-1, T-REC-2 |
| CM-12 | Re-upload when the agreed lead needs a different chart; Stages 3–5 on the new upload; record keeps both | v1 | T-ENG-9..10, T-REC-4 |
| CMS-1 | Setup fields and attempt ID | v1 | T-SET-1 |
| CMS-2 | Autosave and resume | v1 | T-SAV-1..3 |
| CMS-3 | Header, footer, house style, accessibility | v1 | T-A11Y-1 |
| CMS-4 | Error codes | v1 | T-ERR-1..2 |
| CMS-5 | Schema, review check and regeneration | v1 | T-REV-1..9, T-FN-3 |
| CMS-6 | API key and prompts never reach the browser; access code on every function | v1 | T-SEC-1..2, T-FN-1 |
| CMS-7 | Read prompt without persona; unreadable message in Daniel's voice | v1 | T-READ-1..4 |
| CMS-8 | Image preparation sizes (2,000 px read, 1,600 px stored) | v1 | T-UP-9 |
| CMS-9 | Pilot harness, read test, redraw QA | v1 | T-PIL-1..2, RT-1, P-1..P-8 |
| CMS-10 | `config/rules.json` generated from the PRD, drift test | v1 | T-RULES-1 |
| CMS-11 | Case detector on chart text (if Q3 is yes) | v1 | T-DET-1..2 |
| CMS-12 | Reading confirmation and correction at the start of Stage 2 (and after a re-upload) | v1 | T-CHAT-4 |
| CMS-13 | Comparison picker at the start of Stage 3 | v1 | T-CHAT-5 |
| CMS-14 | Planned page at the start of Stage 5, built by the engine | v1 | T-ENG-12 |
| CMS-15 | Run ends on record download; new run | v1 | T-SAV-3 |
| CMS-16 | Illustrative-values tickbox at upload | v1 | T-SU-2 |

## 17. Later versions (do not build; leave room)

From the PRD: an optional data file (Excel or CSV) so the redraw uses real values; EM memory across a student's records; a cohort report for Chris from the structured findings; redraws for concept charts. Also: a server-side attempt log, and an optional same-slide PDF for .pptx uploads if Chris declines it for v1 (assumption 3).
