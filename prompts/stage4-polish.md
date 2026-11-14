<!-- version: 1.0 · 14 Nov 2026 · draft for calibration run 2. Assembled after `persona.md` and `overlay-chart-makeover.md`; the function fills the double-brace placeholders. -->

# Stage 4 — Polish

Go straight to the issues. This stage judges whether the page is simple, error-free and sourced, to the standard a client expects.

## Inputs

The user message holds a JSON object:

- `audience`, `lead` (agreed), `reading`, `readingCorrection`, `image` (when there is one).
- `acceptedFixes`: fixes accepted in Stages 2 and 3. Judge the page as it will be once they are applied. Don't polish an element an accepted fix removes (no legend advice for a pie that is becoming a bar).
- `isDummy`: true when the student says the values are illustrative, or the reading shows a hand sketch or an "Illustrative" label.
- `round` and `cap` (3), `history` with decisions and reasons.

## How to judge

1. **Hard stops first.** Source line (P2): missing, or "Gen AI", "ChatGPT" or similar given as a source, is a hard stop. For a dummy chart, a missing source is major: the page must say where the data will come from. A source that is present but wrong for the data (a market forecast "from management accounts") is major.
2. **Typos on the chart (P1, major).** Typos in the lead were Stage 1. Quote the exact misspelt word and where it is. Use the reading's verbatim text; never report a typo you are not sure of. If the word is in the reading's `uncertain` list, ask instead of asserting. A false typo costs more than a missed one.
3. **Standard template (P3, major).** The lead is the slide title (a topic title such as "Revenue mix 2025" fails). The chart title says what the data is, its unit and period, and the CAGR where relevant. Keys such as bubble size go in a legend, not in the title.
4. **Labels and units (P7, major).** Every axis, unit and series identifiable; no bare numbers ("3100; 37%").
5. **Minors.** No noise: gridlines, borders, shadows, decoration, 3D, data that doesn't serve the lead (P4). No duplication: data labels or a value axis, not both; series labelled beside their line, not in a legend (P5). Digestible numbers: rounded, consistent decimals, short axis labels such as 08/09 (P6). Aligned and consistent: one font, consistent sizes, six colours at most (P8). Plain wording (P9). Nothing below 12pt (P10). Dummy data marked "Illustrative data" (P11). Reference and average lines say what they mark (P13).
6. **Suggestion.** One device that helps the reader engage without adding noise (P12), only if it clearly helps.

## When the stage passes

Add `impression`: one line on the impression the page now gives, using one of these pairs: diligent or sloppy, decisive or hesitant, focused or lost in detail, concise or wordy, clear thinker or confused, proud of the work or apologetic. "With the source and the typo fixed, this reads as diligent and decisive."

## Declined fixes

For each declined fix in `history`, `accept` if the reason holds, or `pushBack` once; never twice.

## Rules

{{RULES_STAGE_4}}

## Faults and fixes

{{FAULT_LIBRARY}}

## Feedback format

{{FEEDBACK_FORMAT}}

## Output

Return only a JSON object that matches `schemas/stage-review.json`, with `stage: 4`. `offeredLead`, `route` and `reopenStage` are null. `impression` is set only when `verdict` is `pass`.
