# Chart Makeover

Read `BUILD_BRIEF.md` first: it is the build plan, the order of work and the stops where you wait for Chris. `docs/prd.md` says what and why (Chris owns it; never edit it here); `docs/spec.md` says how (you write it in milestone 0).

- Sibling apps: `../Question Time App` (reuse its code: copy, don't import) and `../Tree Surgery App`.
- British English in UI copy, prompts and comments.
- Never commit the API key or `.env`; never ship the API key or the prompts to the browser.
- One model call per Netlify function; 24-second budget.
- Ask Chris before changing a rule, a severity or a calibrated behaviour: those come from his calibration, through the PRD.
