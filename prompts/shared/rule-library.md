<!-- version: 1.0 · PRD rev 58, calibrated 14 Nov 2026. From the PRD; edit there first. The function inserts only the current stage's table into each stage prompt (plus L8 and L11 for Stage 5). -->

# Rule library

### Stage 1 — Lead (judged on the words; the chart reading is used only to check L11 and D10)

| ID | Rule | Test | Severity |
| --- | --- | --- | --- |
| L1 | One message | One conclusion, not two joined by "and" | Major |
| L2 | A finding, not a description | States what the chart proves, not a list of facts, a label for what is plotted, or padding ("profitability varies widely") | Hard stop |
| L3 | Full sentence | Has a subject and a verb | Minor |
| L4 | Real number | Carries the key number where a real number sharpens the conclusion (a change, a gap, a CAGR); never an artificial one such as a 1–5 score. A qualitative conclusion without a number is fine | Minor |
| L5 | Stands alone | Makes sense without the chart or the speaker | Major |
| L6 | Answers the client's question | Speaks to the stated audience's decision; a different client would need a different lead | Hard stop |
| L7 | Insightful | Not obvious or "motherhood": the audience would not say "we knew that" | Hard stop |
| L8 | No overreach | Goes no further than the chart shows: no motive, no "most", no action that needs more evidence than this chart | Major |
| L9 | Short | Two lines at most; aim for 15 words or fewer | Major |
| L10 | Punch first | Most important point first, then detail and qualifications; plain words, active verb, no hedging or wordy opener ("Looking at the data…") | Major |
| L11 | Follows from the data | The chart can support it at all: no non-sequitur, no cause read from a correlation, no restating the client's belief without evidence | Hard stop |
| L12 | No typos | No spelling or grammar error in the lead | Hard stop |

Shapes of strong leads (Chris's calibration notes, with the specifics removed): "[Entity] is the fastest growing [market] in [comparison set], at [x]% CAGR"; "[Driver] has a weak correlation with [outcome]"; "Push [action] in [year] to recover [measure]".

**Actions are not required.** One chart supports a finding; an action usually rests on several findings across the storyline. An action in the lead passes only when this chart alone supports it. Otherwise it overreaches (L8): ask for the finding the chart supports now and name the further analysis the action needs (e.g. a market-entry call also needs profitability and competitive position, as in a GE matrix).

### Stage 2 — Data fit

| ID | Rule | Test | Severity |
| --- | --- | --- | --- |
| D1 | Proves the lead | Read as drawn, the data shows what the lead claims (a lead about revenue against football record needs the record on the chart) | Major |
| D2 | Right measure | Plots the quantity the lead is about, not a proxy (salary uplift, not salary at graduation) | Major |
| D3 | Like-for-like | Same base and start point; market growth, inflation or size removed where it distorts (index to the average) | Major |
| D4 | Enough comparators | The comparison set can define "normal" | Minor |
| D5 | Right span and window | Covers the period the lead names, on both sides of any turning point; averaging windows chosen for a stated reason | Major |
| D6 | Lead's numbers on the chart | Every number in the lead can be read off the chart, or is annotated on it | Major |
| D7 | Obtainable | For a dummy chart, the data could realistically be obtained | Major |
| D8 | Robust | A different reasonable choice (window, base, peer set) would not change the answer, or the page says so | Minor |
| D9 | Honest gaps | Missing data not filled or interpolated; coverage bias noted | Minor |
| D10 | Lead's numbers right | Every number in the lead matches the chart: same value, same measure, and any sum adds up (60 + 35 is not 90) | Hard stop |

### Stage 3 — Chart choice

| ID | Rule | Test | Severity |
| --- | --- | --- | --- |
| C1 | Right broad type | Numbers as a chart, never a pasted data table (that belongs in the appendix, for Q&A); ideas as a concept chart; text only for an argument | Hard stop |
| C2 | Form fits the comparison | Items: bar. Time: column or line. Distribution: histogram. Composition: stacked or 100% column, waterfall for change. Look for a better chart than a pie; never 3D | Major |
| C3 | Transformation exposes the lead | Index, ratio, % change, a gap line, a CAGR: whichever makes the lead's comparison direct, so the reader never calculates | Major |
| C4 | One axis per measure | No dual axes: they are rarely the best choice | Major |
| C5 | Emphasis | What the lead names in colour, the rest grey | Minor |
| C6 | Proof annotated | Turning point, gap or gradient marked on the chart | Minor |
| C7 | Relationship as an X-Y plot | A relationship between two variables is one X-Y plot, points joined in time order and labelled at start, turning point and end; never two panels or a dual axis, because nobody can eyeball a relationship | Major |
| C8 | Log scale justified | Only for wide ranges or growth rates, and labelled as log | Minor |
| C9 | Panels | One chart; two panels at most | Minor |
| C10 | Lead numbers jump out | Every number in the lead is highlighted on the chart in colour or size | Major |
| C11 | Growth as CAGR | A time series shows the CAGR % for the period, per series at the right end or in the chart title, because nobody can eyeball a growth rate | Major if the lead is about growth, else Minor |
| C12 | Framework conventions | A standard framework keeps its standard layout (GE matrix: market attractiveness vertical, competitive position horizontal) | Major |

### Stage 4 — Polish

| ID | Rule | Test | Severity |
| --- | --- | --- | --- |
| P1 | No typos on the chart | No spelling or grammar error on the page outside the lead (typos in the lead are L12). Overrides the Common Module's "typo anywhere = hard stop" for this tool | Major |
| P2 | Source line | Present, specific and accurate; Gen AI is never a source | Hard stop; Major for a dummy chart (say where the data will come from) or a source that is present but wrong |
| P3 | Standard template | Lead as the title; chart title states what the data is, its unit, period and CAGR where relevant; data; source. Keys such as bubble size go in a legend, not the title | Major |
| P4 | No noise | No data that does not serve the lead; no gridlines, borders, shadows or decoration; 3D looks unprofessional | Minor |
| P5 | No duplication | Data labels or a value axis, not both (drop the axis); series labelled beside their line or segment, not in a legend | Minor |
| P6 | Digestible numbers | Rounded (to HK$m, or to the nearest 10); consistent decimals; short axis labels (08/09) | Minor |
| P7 | Labels and units | Every axis, unit and series identifiable; no bare numbers ("3100; 37%") | Major |
| P8 | Aligned and consistent | Elements aligned; one font; consistent sizes; six colours at most | Minor |
| P9 | Plain wording | Short labels, no jargon or abbreviations | Minor |
| P10 | Readable | No text below 12pt | Minor |
| P11 | Dummy-chart label | Dummy data marked "Illustrative data" | Minor |
| P12 | Engaging | Optional: one device that helps the reader engage without adding noise | Suggestion |
| P13 | Reference lines labelled | Dotted and average lines say what they mark | Minor |

### Stage 5 — Fit check

| ID | Rule | Test | Severity |
| --- | --- | --- | --- |
| F1 | 10-second test | A senior reader gets the lead from the planned chart in 10 seconds | Major |
| F2 | Lead matches the chart's shape | A time-series chart carries a lead about change; a ranking chart, a lead about rank | Major |
| F3 | Same measure | After a transformation, the lead's number uses the chart's measure (an index, not £m) | Major |
| F4 | Emphasis on the lead | Colour and annotations fall on what the lead names (numbers: C10) | Major |
| F5 | Still no overreach | L8 and L11 rechecked against the planned chart | Major |
| F6 | Storyline or appendix | A weak lead or a data table marks an appendix page, kept for Q&A; the EM says so | Minor |

