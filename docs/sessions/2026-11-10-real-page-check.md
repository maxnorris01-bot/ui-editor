# Session: real-page check

## What this was
A measurement, not a feature: does the engine that scored 40/40 on hand-written fixtures hold up
on five files written by other people (two HTML emails, a Bootstrap one-page site with a 241 KB
linked stylesheet, two SVGs including an Inkscape export)? No engine code changed. The pages live
outside the repo and were never copied into it.

## What changed
- `docs/realpage-rules.md` and `realpage-check/edits.json`: 20 edits (4 per file), locked in
  `ad1c999` before the engine touched any real file. I read the pages, picked targets by a written
  procedure (largest text, largest container, a sibling-rich element, a small button/shape), and
  checked every expected value against a plain Chromium DOM edit first (no engine); all 20 agreed.
- `harness/run-realpage.ts`, `page-measure-real.js`, `summary-real.ts`, Makefile target `realpage`:
  the engine-gate harness extended to take a spec file, an input folder and companion mapping,
  JavaScript off, other hosts aborted, and three outcomes (PASS / REFUSED / FAIL).
- `.gitignore`: `realpage-check/tmp/` and `realpage-check/raw/`.
- Results (numbers and names only): `realpage-check/results/realpage-results.csv`,
  `realpage-summary.md`, `timing.json`.

## Results
- Regression first: `make node-test` 96/96, original 40-edit gate 40/40 again (not part of the verdict).
- No-op round trips: 6 of 6 byte-identical (five files plus the stylesheet), and all load.
- **Run 1 (scored run): 15 PASS, 2 REFUSED, 3 FAIL, so FAIL.** The three FAILs were R10, R11, R12 on
  `freelancer-index.html`. All three were my harness, not the engine: E4 compared computed styles
  by array index and Chromium lists custom properties (`--bs-*`) in a different order on each
  load, which produced hundreds of false differences (R10, R11); E5 flagged a listed output file
  that did not change (the stylesheet), although a spec's `expectedFiles` only says a file may
  differ (R10, R12). The engine's edits for those three were a new inline `style` attribute (R10,
  R12) and an 8-line move (R11), all looking right once measured correctly.
- **Run 2 (same engine, harness fixed): 18 PASS, 2 REFUSED, 0 FAIL.** This is a labelled harness
  iteration. The brief makes run 1 the scored run, so both are kept and reported; Max decides
  which one counts.
- Scorer sanity check on throwaway copies (deleted): an unchanged export fails E2/E3 on every
  non-refused edit; one added space fails E5 on every edit.

## Refusals (both `conditional-rule`, both checked by reading the file)
- R01 leemunroe T1 (font-size on a `p`): `.main p, .main td, .main span { font-size: 16px !important }`
  sits inside `@media only screen and (max-width: 640px)` (lines 232-237). True, though that media
  query is inactive at 1280 px.
- R09 freelancer T1 (font-size on the masthead h1): `h1, .h1 { font-size: 2.5rem }` sits inside
  `@media (min-width: 1200px)` (styles.css lines 126-129). True, and active at 1280 px.

## Decisions I made (all written into the rules before any run, except the harness fixes)
- Tie-breaks for target selection, the candidate tags for "largest container", and the
  SVG-without-text rule (stroke area) are in `docs/realpage-rules.md` section 2.
- Console errors that only say a resource failed to load are not counted (images, icons and fonts
  are not supplied or are aborted); any other new error counts.
- Reorder checks use an `order.key` (text prefix or attribute) because the real pages have no ids.
- E5 at character level for lines over 2,000 characters. It was not needed: no edited line
  exceeded that, and the stylesheet is 11,045 lines, not minified, so no edit was measured by bytes.
- `mailgun-action.html`: T1 and T2 are inline-styled by the procedure, so T3 (inherited
  alignment) and T4 (a cell with no inline style; the only `.content` rule is in an inactive
  dark-mode query) carry the "not inline" requirement.

## Information only: timings on the real files
Apple M5 (`Mac17,4`), Node v24.21.0, Chromium 158.0.8127.18, 20 runs, median preview ready:
leemunroe 1.9 ms, mailgun 1.5 ms, freelancer 13 ms (31 KB page plus 241 KB stylesheet), fibonacci
2.0 ms, normal-distribution 4.8 ms. Edit-and-export median: 8.5 microseconds to 9.5 microseconds
on the files where the T1 edit succeeded; the two refused files show the refusal time (14
microseconds, 2.7 ms for the large stylesheet), which is not an edit.

## Open questions for review
- Which run counts: run 1 as written, or run 2 after the harness fix.
- Whether the `conditional-rule` refusal is acceptable as a v1 limit. It refused font-size on the
  masthead heading and on an email paragraph, which are the commonest typography edits.
- The check is five files with targets I picked; see the report's "could not verify" list.

## Next command
`git log --oneline feat/engine-gate..` then `cat realpage-check/results/realpage-summary.md`.
