> **Pre-calibration answer key (14 Nov 2026, run 1).** Severities here are the seeded ones, before Chris's feedback. For the pilot, `expected.json` and `config/rules.json` are authoritative.

# Chart Makeover: calibration test set, run 1

Ten student-style charts with known faults, for calibrating Daniel's feedback before the build. Chris reviews them on the calibration page (https://claude.ai/artifact/XcqAp9uYpQS7wtZqDQZWkN); his notes are saved there for Claude to read. The input files (pptx, pdf, png, jpg) double as test fixtures for the build. All clients are fictional except Man City, which uses the exercise workbook's public data. 14 Nov 2026.

## The set

| ID | Chart | Input | Tests |
|---|---|---|---|
| C01 | Man City: the Big Five in £m | `C01_man_city_big_five.pptx` (.pptx, PowerPoint default template, native line chart) | The classic first attempt: right numbers, wrong yardstick, no conclusion |
| C02 | Man City: two aligned panels, overclaiming lead | `C02_man_city_two_panels.pdf` (.pdf, made in Python (matplotlib)) | A strong chart under a lead that claims more than it shows, with no number |
| C03 | Kettle & Crumb: stacked columns for the station landlord | `C03_kettle_crumb_formats.pptx` (.pptx, class template, default chart colours) | A true "what" that is the wrong conclusion for this client |
| C04 | Kestrel Pacific: 3D pie that echoes the CEO | `C04_kestrel_revenue_pie.pptx` (.pptx, PowerPoint default template, 3D pie) | A non-sequitur lead that repeats the client's belief, plus a hard stop |
| C05 | Northfield Footwear: the store P&L table | `C05_northfield_store_pl.pdf` (.pdf, Excel export) | A data dump with a vague, two-part lead |
| C06 | Lumen Optical: hand-drawn dummy waterfall | `C06_lumen_sketch_photo.jpg` (.jpg, phone photo of a pencil sketch) | A good dummy chart with typos, a missing source and a wrong sum in the lead |
| C07 | Pearl River Packaging: the gap is buried | `C07_pearl_river_margin.pptx` (.pptx, class template, native line chart) | Single-issue test of the new rule: numbers in the lead must jump out |
| C08 | Aster & Moss: dual-axis screenshot | `C08_aster_moss_dual_axis.png` (.png, Google Sheets screenshot) | A causal claim built on a dual-axis crossing |
| C09 | Kaze Climate: strong chart, typos and an AI source | `C09_kaze_asean_growth.pdf` (.pdf, class template, exported from PowerPoint) | Hard stops on an otherwise strong page |
| C10 | Kestrel Pacific: portfolio map (control) | `C10_kestrel_portfolio_map.pptx` (.pptx, class template, native bubble chart) | Control: no seeded faults. Does Daniel invent problems? |

65 seeded faults across 34 of the 48 rules. Controls: C10 has none; C07 and C09 isolate one issue each. Rules not seeded as faults: L5, D5, D7, D8, D9, C1, C7, C8, C9, P12, F1, F2, F3, F6 (C02 passes D5, D8, D9, C8 and C9 deliberately).

## Decisions from building the set (Chris, 14 Nov 2026)

- Readability test is 10 seconds (rule F1 and the learning goals updated).
- New rule D10: every number in the lead must match the chart (value, measure, sums) and be highlighted on it in colour or size (C10). Major for now; C06 asks whether a wrong number should be a hard stop.
- A lead with no number is a Minor fault (L4).
- No action or recommendation is required in a chart's lead: one chart supports a conclusion; an action usually needs several. The So-what "action: what" form is a class device, not a rule.

## Cases and answer key

### C01 Man City: the Big Five in £m

- **Set-up:** Board of a rival Premier League club. Decision: whether to raise a complaint that Man City's commercial revenue was out of line with its football record.
- **Student's lead:** "Looking at the data from 2008/09 to 2024/25, Manchester City's commercial revenue increased from £18m to £340m, which is faster than Arsenal, Chelsea, Liverpool and Manchester United, all of whom grew more slowly over the period"
- **Deliberately right:** Source line present; the lead's numbers can be read off the chart
- **Calibration question:** With 12 faults on one page, which three should Daniel raise first, and should he stop there?

| Rule | Stage | Severity | Seeded fault |
|---|---|---|---|
| L2 | Lead | Major | Describes growth; draws no conclusion for the board |
| L6 | Lead | Major | Does not answer the board's question (revenue out of line with football record) |
| L9 | Lead | Minor | Three lines long |
| L10 | Lead | Minor | Wordy opener ("Looking at the data…") |
| D1 | Data fit | Major | No football record on the chart, so it cannot show "out of line" |
| D3 | Data fit | Major | Absolute £m: league commercial revenue grew 5.6x and lifts every line |
| D4 | Data fit | Major | Four peers cannot define normal |
| C3 | Chart choice | Major | No index to the league average |
| C5 | Chart choice | Major | Five rainbow lines; City not emphasised |
| P3 | Polish | Major | Slide title is a topic, not the lead |
| P4 | Polish | Minor | Gridlines |
| P5 | Polish | Minor | Legend instead of direct labels |

### C02 Man City: two aligned panels, overclaiming lead

- **Set-up:** Board of a rival Premier League club. Decision: whether to raise a complaint that Man City's commercial revenue was out of line with its football record.
- **Student's lead:** "Man City's sponsorship deals were inflated: its commercial revenue ran far ahead of its football record from 2009/10 to 2017/18"
- **Deliberately right:** Indexed to the league average; all 13 clubs with data; 10-season average with a 5-season check; gaps not filled; City blue, others grey; two panels; log scale labelled; source and caveat
- **Calibration question:** Should Daniel push for the connected scatter, since Man Utd's index tops City's in some seasons on this chart?

| Rule | Stage | Severity | Seeded fault |
|---|---|---|---|
| L8 | Lead | Major | "Deals were inflated" claims wrongdoing; the chart shows revenue out of line with results, not why |
| F5 | Fit check | Major | The student's own footnote says "not why": the lead contradicts the chart |
| L4 | Lead | Minor | No number in the lead |

### C03 Kettle & Crumb: stacked columns for the station landlord

- **Set-up:** Head of leasing at the rail-station landlord: 14 of Kettle & Crumb's 22 transit kiosks, all renewing in 2027. Decision: how hard to push Kettle & Crumb on renewal terms.
- **Student's lead:** "Revenue growth 2023–26 by format: delivery kitchens fastest at 31% a year"
- **Deliberately right:** Source line; units in the title
- **Calibration question:** If the student is still stuck at round 3, should Daniel's offered lead name the transit kiosks?

| Rule | Stage | Severity | Seeded fault |
|---|---|---|---|
| L3 | Lead | Major | Fragment: no verb |
| L2 | Lead | Major | A what, not a so what |
| L6 | Lead | Major | Wrong conclusion for the landlord: transit kiosks are the fastest-growing store format (HK$102m to HK$132m, +9% a year), so Kettle & Crumb needs these sites |
| C2 | Chart choice | Major | Stacked columns bury the transit-kiosk trend in the middle of each bar |
| C5 | Chart choice | Major | No emphasis on the series that matters |
| P3 | Polish | Major | Topic title |
| P5 | Polish | Minor | Labels on every segment plus a value axis plus a legend |
| P4 | Polish | Minor | Gridlines |
| P6 | Polish | Minor | One decimal on every label |

### C04 Kestrel Pacific: 3D pie that echoes the CEO

- **Set-up:** Group CEO, Kestrel Pacific Holdings (board, March 2026). Decision: how to split HK$2bn of capital across five businesses, 2026–30.
- **Student's lead:** "Health & beauty retail is our biggest business at 37% of revenue, so it should get the most of the HK$2bn"
- **Deliberately right:** The lead's 37% is on the chart
- **Calibration question:** A hard stop (no source) on a chart whose real problem is the logic: which does Daniel open with?

| Rule | Stage | Severity | Seeded fault |
|---|---|---|---|
| P2 | Polish | Hard stop | No source line |
| L7 | Lead | Major | Repeats what the CEO already believes |
| L8 | Lead | Major | Size does not justify capital: "so it should get the most" does not follow |
| D2 | Data fit | Major | Wrong measure for a capital decision: revenue share, not market attractiveness or position |
| C2 | Chart choice | Major | 3D pie distorts slice sizes |
| P3 | Polish | Major | Topic title ("Revenue mix 2025") |
| P5 | Polish | Minor | Legend plus value and % labels |
| P6 | Polish | Minor | Labels read "3100; 37%": no units, no separator |

### C05 Northfield Footwear: the store P&L table

- **Set-up:** VP Retail Operations, Northfield Footwear (12 US stores). Decision: which stores to close or remodel in 2027.
- **Student's lead:** "Store profitability varies widely across the network and rents are rising too fast"
- **Deliberately right:** Source line; totals reconcile
- **What the data shows:** Springfield, Worcester and Albany lose US$156k a year combined; closing them lifts store contribution from US$808k to US$964k (+19%)
- **Calibration question:** Should Daniel ever point at what the table actually shows (the three loss-makers), or only ask?

| Rule | Stage | Severity | Seeded fault |
|---|---|---|---|
| L1 | Lead | Major | Two messages |
| L2 | Lead | Major | Vague description, no conclusion |
| L4 | Lead | Minor | No number |
| L7 | Lead | Major | Obvious: every network varies |
| D1 | Data fit | Major | No rent trend in the data: "rising too fast" is unsupported |
| C2 | Chart choice | Major | A 12 × 9 table where a ranked bar of contribution % would show the answer |
| C5 | Chart choice | Major | Nothing marks the three loss-making stores |
| P3 | Polish | Major | Topic title ("FY25 Store P&L") |
| P6 | Polish | Minor | Unrounded dollars (2,846,310); 1 and 2 decimals mixed |
| P8 | Polish | Minor | GM $ column left-aligned |
| P9 | Polish | Minor | Abbreviations ("Contrib. $ (adj.)", "GM $") |
| P10 | Polish | Minor | 9pt text |

### C06 Lumen Optical: hand-drawn dummy waterfall

- **Set-up:** CEO, Lumen Optical (45 eyewear stores in Hong Kong). Decision: which of three profit programmes to fund first in 2026.
- **Student's lead:** "Three programmes lift EBIT by HK$35m to HK$90m by 2027, with pricing the biggest at HK$15m"
- **Deliberately right:** Waterfall is the right form; the lead's 15 and 90 are on the chart
- **Calibration question:** D10 makes a wrong number in the lead Major: should it be a hard stop, like a typo? Is a photographed sketch an acceptable input?

| Rule | Stage | Severity | Seeded fault |
|---|---|---|---|
| P1 | Polish | Hard stop | "Procurment" |
| P2 | Polish | Hard stop | No source: where will each bar's data come from? |
| D10 | Data fit | Major | 60 + 35 ≠ 90: the net gain after −5 inflation is 30 |
| P3 | Polish | Major | Topic title ("EBIT bridge 2025 - 2027") |
| P7 | Polish | Minor | No units (HK$m) |
| P11 | Polish | Minor | Dummy chart not marked "Illustrative" |

### C07 Pearl River Packaging: the gap is buried

- **Set-up:** CFO, Pearl River Packaging (Hong Kong-listed packaging maker). Decision: whether to push price increases in the 2026 customer contract round.
- **Student's lead:** "Our margin per tonne has halved since 2021, from HK$1,200 to HK$600: push price rises in the 2026 contract round"
- **Deliberately right:** Lead passes every L rule; class template, lead as title, subheading, source, no gridlines, direct labels
- **Calibration question:** Is this one fault (plot the gap) or four? How should Daniel phrase it?

| Rule | Stage | Severity | Seeded fault |
|---|---|---|---|
| C10 | Chart choice | Major | HK$1,200 and HK$600 appear nowhere on the chart |
| D6 | Data fit | Major | The reader must subtract two lines to find the lead's numbers |
| C3 | Chart choice | Major | Two levels on a 0–8,000 axis when the lead is about the gap: plot margin per tonne |
| F4 | Fit check | Major | Emphasis falls on price and cost, not the gap |
| C6 | Chart choice | Minor | 2021 turning point not marked |

### C08 Aster & Moss: dual-axis screenshot

- **Set-up:** CMO, Aster & Moss (Hong Kong skincare brand, online sales). Decision: whether to double the 2026 digital marketing budget.
- **Student's lead:** "Sales took off once marketing spend passed HK$2m a month, so doubling the budget will double sales"
- **Deliberately right:** Source given; units on both axes
- **Calibration question:** How hard should Daniel push on the causal claim versus the chart mechanics?

| Rule | Stage | Severity | Seeded fault |
|---|---|---|---|
| C4 | Chart choice | Major | Dual axis: the "take-off" is where two arbitrary scales cross |
| L8 | Lead | Major | Causal claim and a straight-line extrapolation from a correlation |
| D1 | Data fit | Major | Seasonality: sales also spiked in Nov–Dec 2024 at HK$1.4m spend; the 2025 jump is year-end |
| D3 | Data fit | Major | Not like-for-like: compare the same months year on year |
| P3 | Polish | Major | Topic title ("Marketing Spend vs Online Sales") |
| P4 | Polish | Minor | Gridlines |
| P5 | Polish | Minor | Legend instead of direct labels |

### C09 Kaze Climate: strong chart, typos and an AI source

- **Set-up:** Head of International, Kaze Climate (Japanese air-conditioner maker). Decision: which ASEAN market to enter first in 2027.
- **Student's lead:** "Enter Vietnam first: its room air-conditioner market grows 9.8% a year to 2030, the fastest in ASEAN"
- **Deliberately right:** Lead passes; sorted bars; Vietnam highlighted; 9.8% jumps out
- **Possible comment, not seeded:** Growth alone may not justify entry without market size (D2): not seeded
- **Calibration question:** After three hard stops, how much else should Daniel say? Does growth without market size deserve a comment?

| Rule | Stage | Severity | Seeded fault |
|---|---|---|---|
| P1 | Polish | Hard stop | "ANUAL" in the subheading |
| P1 | Polish | Hard stop | "Phillipines" on the axis |
| P2 | Polish | Hard stop | "Source: ChatGPT analysis" |

### C10 Kestrel Pacific: portfolio map (control)

- **Set-up:** Group CEO, Kestrel Pacific Holdings (board, March 2026). Decision: how to split HK$2bn of capital across five businesses, 2026–30.
- **Student's lead:** "Put most of the HK$2bn into elderly care: our only business in an attractive market (4.6) where we are strong (4.7)"
- **Deliberately right:** Every stage should pass
- **Possible comment, not seeded:** Cold-chain (attractive, weak) is left out of the lead; "4.6 / 4.7" relies on axis order
- **Calibration question:** What is the one line on what works? Is anything here worth a comment at all?

No seeded faults (control).
