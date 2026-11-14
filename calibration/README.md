# Calibration set

Ten student-style charts with seeded faults, built by Claude on 14 Nov 2026 and marked by Chris in calibration run 1. All cases are fictional or built from public data; there is no student work here, so nothing in this folder is private.

| File | What it is |
| --- | --- |
| `inputs/` | The ten uploads: four .pptx, three .pdf, one .png screenshot, one .jpg photo of a hand sketch |
| `cases.json` | Each case: file, audience line (`setup`), the student's lead, seeded faults (pre-calibration severities) |
| `ANSWER_KEY.md` | The seeded faults in prose, pre-calibration |
| `chris-feedback.json` | Chris's run 1 notes, verbatim |
| `expected.json` | What Daniel must and must not say, per stage, after calibration. **The pilot is judged against this** |
| `read-truth.json` | Verbatim strings and key values for the read test (milestone 2) |

## How the pilot uses it

`scripts/pilot-run.mjs` (milestone 8; a first version in milestone 4):

1. `read-chart` on each input, compared with `read-truth.json`.
2. Stage 1, one round, with the student's lead and the audience line.
3. Chart stages, where `chartStages` isn't null: start Stage 2 with `agreedLead` (Chris's) or `pilotLead` (Claude's stand-in, flagged), accept every fix, carry accepted fixes forward through Stages 3, 4 and 5. For C08, run Stage 2 with `leadChanged: true` and `reuploadsLeft: 1` (expect `route: "reupload"`), then Stage 3 on the original with `reuploadsLeft: 0`.
4. Redraw plan and .pptx build for every case with a chart stage.
5. Write `pilot/run-<date>/report.md`: per case and stage, the findings (rule IDs, severity), the message, a ✓ or ✗ against each `mustCatch` and `mustNot`, and timings. Chris marks agree or disagree on each message; misses are prompt or rule questions for him, not things to fix silently.

These charts informed the rules, so a pass here is in-sample. The real test is the Common Module's: 10 past student charts that Chris marks blind.
