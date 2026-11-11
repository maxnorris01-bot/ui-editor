# Session: engine gate, Step 4 (scoring)

## What changed and why
- `docs/speed-thresholds.md` (own commit `fd51815`): Max's thresholds, the proposed ones plus a 10x
  large-page scaling check (preview <= 250 ms, apply <= 50 ms) and a report-only 100x copy.
- `harness/scale.ts`: builds the 10x and 100x copies in memory (body repeated, ids suffixed) and
  adds a `scaling` block to `results/timing.json`. The copies are not committed.
- `harness/run-gate.ts`, `page-gate.js`, `page-measure.js`, `summary.ts`: the scoring harness. It
  does the no-op round trip on all 10 files, then 40 edits: engine in a page (live preview path and
  export), exported files loaded fresh in headless Chromium with scripts off, E1 to E5 by script,
  CSV rows, and a summary with the verdict computed from the CSV and `timing.json`.
- Results: `results/gate-results.csv`, `results/gate-summary.md`, raw dumps in git-ignored
  `results/raw/run-1/`.
- No engine code changed in Step 4.

## Iteration log
- Iteration 0 (pre-gate, before any scoring): the first speed run refused 3 of 10 T1 edits as
  `shorthand-mix` because `font-size` and `font-family` were treated as related properties. Fixed
  (`sameFamily` in `engine/src/edit.ts`) with a regression test. Found on 2026-11-08 during Step 3.
- Run 1: the only scored run. No engine change after it.

## Result
Run 1: 40/40 edits, every type 10/10, every rule 40/40, no-op round trip byte-identical and loading
for all 10 files, all speed thresholds met. Verdict PASS. See `results/gate-summary.md`.

## Scorer sanity check (harness validation, not engine tuning)
A scorer that passes everything proves nothing, so a throwaway copy was run on sabotaged exports:
no change at all (0/40 pass: E2, E3, E5 fail), an extra `!important` rule or `fill` on other
elements (4/40 pass; E1, E4, E5 fail), and one added space on line 2 (0/40 pass; only E5 fails).
The copy was deleted.

## Interpretations the locked rules left open (made in the harness, fixed before the run)
- E1 on a refused edit is measured on the unchanged output; E2 to E5 fail. (No edit was refused.)
- E4 compares computed values as normalised strings, bounding boxes within 1 px.
- `reorder` legit class: layout-resolved properties may differ for the parent's subtree, the
  target's ancestors, and the flow set of the parent (following siblings of the parent and of its
  ancestors, with descendants). Pairing for reorders is by id, idless children in order.
- E5 reorder: changed lines must lie within the line span of the moved element plus its sibling,
  and removed lines must equal added lines as a multiset.
- PASS WITH CHANGE is only reported when T1 to T3 each reach 9/10, every file loads, speed is met
  and T4 alone is below 9/10.
- Speed numbers are from the Step 3 build (engine unchanged since), plus the scaling run above.

## Test/lint status
`make lint`, `make test` (3 Python tests), `make node-test` (tsc strict, 96 vitest tests): clean.

## Open questions for review
- Fixtures are hand-written by the same agent and probably easier than real pasted code.
- No real pointer interaction, no real-world pages, scripts-off preview only, Chromium only.
- The brief's closing `pkill caffeinate` was denied by the permission classifier earlier and not
  run (Max said not to run pkill).

## Next command
`git log --oneline main..` then `cat results/gate-summary.md`.
