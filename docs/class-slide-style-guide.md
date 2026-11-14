# Class slide style guide (HKUST, .pptx)

Copied from the "Consulting skills tools" project instructions, 14 Nov 2026. Chris owns it; never edit it here. Chart Makeover's redraw follows sections 2–4 and 7; the additions at the end come from the PRD.

Applies to every PowerPoint deck built for Chris's classes. These rules override generic slide-design defaults (title sizes, palettes, "a visual on every slide", "never centre text"). Values marked *(standardised)* were inconsistent in the source decks and have been fixed to one value; everything else is measured from them.

## 1. Build method
- Start from **HKUST_class_template.pptx** (project files). If it isn't available as a file, ask Chris to attach it. Never draw, recreate or substitute the HKUST logo or crest: they live in the template's backgrounds.
- Duplicate the matching exemplar slide (pptx skill `add_slide.py`), replace its content, then delete unused exemplars. Exemplars: 1 title · 2 agenda tracker · 3 section divider · 4 bullets + callout · 5 two columns · 6 table · 7 phase/process diagram · 8 chart · 9 class discussion · 10 quote · 11 take-aways.
- Layouts: **Title Slide** (title and section dividers) and **Title Only** (every other slide). No other layouts.
- Slide numbers on every Title Only slide (clone the layout's slide-number placeholder; python-pptx doesn't). No footer text.
- On autoshapes, remove `<p:style>` (it adds a shadow). Tables use style `{93296810-A885-4BE3-A3E7-6D5BEEA58F35}` (Medium Style 2 – Accent 6).
- No animations, no transitions. For a reveal, duplicate the slide and add one element per copy.

## 2. Canvas, type, colour
- A4 landscape, **10.83" × 7.5"**. Font: **Calibri only**, every element.
- Text is **bold by default** (theme default). Regular weight only for table body cells and source lines; italic only for quotes, quoted jargon and attributions.

| Token | Hex | Use |
|---|---|---|
| Title navy | `1F497D` | Slide titles |
| Text | `000000` | All body text, subheadings |
| Blue | `033D93` | Keyword emphasis (one word or phrase, also inside a title), diagram labels, table header, chart series 1 |
| Navy box | `1F497D` | Process boxes / org-chart boxes, white text |
| Light panel | `B8D4FE` | Grouping panels, framework cells |
| Highlight band | `72AAFC` | Current item on agenda tracker; key bullet on a reveal |
| Amber | `FFC000` | Callout boxes (0.75pt black outline) |
| Red | `C00000` | One emphasised word or phrase, negative, chart series 2 *(standardised; also seen FF0000, CC0000)* |
| Green | `008000` | Positive / tick, chart series 3 |
| Silver | `C0C0C0` | All text on navy title slides |

## 3. Slide anatomy (Title Only)
- **Title**: placeholder (0.77", 0.05", 9.52" × 0.95"), 24pt bold `1F497D`, left, middle-anchored, sentence case, max 2 lines.
- **Subheading**: text box at (0.40", 0.98"), h 0.5", 24pt bold black, **ALL CAPS**, no bullet. Present on most content slides.
- **Body zone**: x 0.45"–10.3", y 1.55"–6.9".
- **Body text**: 24pt bold black. Level 1 `•` (Arial, marL 0.19", hanging 0.19"); level 2 `–` (marL 0.69", hanging 0.19"); 20% space before. Max 8 level-1 lines at 24pt.
- **Size floor**: 18pt for dense diagrams and panels; 14–18pt in tables; 12pt only for source lines.
- **Source line**: "Source: …" at (0.30", 6.95"), 12pt regular black *(standardised)*. Use it whenever a slide shows external data or a chart.

## 4. Components
- **Callout** (signature element): rectangle, `FFC000` fill, 0.75pt black outline, 18–24pt bold black, centred text and anchor. Holds a question to the class ("What is your value proposition?") or a one-line takeaway or tip. Max ~15 words. Place it right of the body or bottom-centre; one or two per slide.
- **Agenda tracker**: list of the session's parts (24pt bullets); a rounded `72AAFC` band (no outline) sits behind the current item. Repeat it at each new part, moving the band.
- **Section divider**: Title Slide layout. Session title, blank line, section name.
- **Process / framework**: navy pentagon or rectangle headers (`1F497D`, white 18pt bold) over `B8D4FE` panels (18pt bullets). Arrows and connectors black 0.75pt.
- **Two columns**: column heads 24pt bold black, ALL CAPS, underlined; bullets beneath each.
- **Table**: Medium Style 2 – Accent 6, i.e. `033D93` header with white bold text and blue-grey banded rows. First column bold.
- **Chart**: native, Calibri 16–18pt bold *(standardised)*, black axes, no gridlines, no legend, no chart title. The subheading is the chart title (e.g. "UN POPULATION FORECAST, 2010"). Series in `033D93`, `C00000`, `008000`, `FFC000`, each labelled directly at its line end in its colour. Annotations go in white rounded speech bubbles with a 0.75pt black outline, 16–18pt.
- **Class discussion**: subheading "CLASS DISCUSSION" or "CLASS EXERCISE"; one question centred, 36pt bold, middle of the slide.
- **Quote**: centred italic 32–36pt in curly quotes; attribution right-aligned below, name 24pt plus source in italic *(standardised)*.
- **Images**: photos used as metaphors, and company logos for examples, with no frames. Claude can't source images: leave a dashed grey box labelled "Image: <description>" and list the boxes in the reply.

## 5. Writing
- **Action titles**: a full sentence stating the slide's takeaway, 6–15 words (median 10), no full stop. Address students directly ("Your workplan must…", "You will need…") or use the imperative for how-to ("Use Gen-AI to…", "Start your desk research…"). A question title is fine for a discussion slide.
- **Two-slide cliffhanger**: trailing "……" on the set-up title, leading "……" on the payoff ("If business is like a car race……" → "……then what is strategy?"). Use ellipses only for this.
- **Subheading**: ALL CAPS noun phrase naming the topic or framework ("KEYS TO SUCCESSFUL PROJECT MANAGEMENT"). Use a spaced en dash for a series ("DEEP RESEARCH – CUSTOMER RESEARCH").
- **Bullets**: short fragments or questions, in parallel form, with no full stops. Questions are encouraged: they drive class discussion.
- Concrete named cases (Southwest, Netflix, Hilti) over abstractions; "e.g." examples as level-2 bullets.
- British spelling (organisation, behaviour, prioritise, programme).
- **Speaker notes on every content slide**: facilitation prompts, not a script. Give the question to ask the room, the example or anecdote to tell, and the time for any exercise. Keep to short lines.

## 6. Deck structure
1. Title slide: course code and course name above the gold rule; session title below it; presenter "Chris Doran" ("Professor Chris Doran" for exec ed).
2. Objectives or session overview (agenda tracker or a day/time table).
3. Parts, each opened by a section divider (major part) or the agenda tracker (sub-topic).
4. Within a part, alternate between teaching slides, a class discussion or exercise, and a case application.
5. Close with "Key take-aways" (bullets, one red emphasis word allowed).

## 7. Don'ts (fixes to past inconsistencies)
- No footer text (old templates leak "YYDDMM Syndicate Case_name").
- No fonts other than Calibri (stray Times, Arial, Script MT appear in the old decks).
- No orange `FF9900` or yellow `FFCC00` callouts: amber `FFC000` only.
- No full stops ending titles; no titles over 2 lines.
- Don't use the "World Class in Asia" title background; the template's standard one only.

## 8. QA before delivering
Render every slide and check: titles at an identical position; subheading present; no text below 12pt; nothing overflowing the body zone; slide numbers present; no leftover exemplar text; notes filled.

## Chart Makeover additions (PRD, "Make these changes")
- Comparison sets in grey `BFBFBF` (approved 23 Oct 2026); the subject in blue `033D93`; further series `C00000`, `008000`, `FFC000`.
- Every number in the lead appears on the chart in 24pt bold `033D93`, beside the mark it describes.
- CAGR % for the period beside each series at the right end, or in the subheading.
- "Illustrative data" label on the slide and in the file name.
- The redraw's title is the student's agreed lead, which may be a finding rather than an action title addressed to students; section 5's title wording rules don't apply to it beyond length and no full stop.
