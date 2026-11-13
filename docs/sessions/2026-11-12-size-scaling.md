# Session: size scaling (2026-11-12)

Branch `feat/size-scaling`, from `main` (already contains PR #1). Nothing pushed.

## What this was

Max decided that resizing (width and height) follows the same ratio rules as font size, while moves stay unlinked in
v1. This session wrote the rules, fixtures and specs first, took a baseline and checked the scorer, then changed the
engine and ran everything as run `size1`.

## What changed

1. **Locked first (`909459a`):** `docs/size-scaling-rules.md`, six pages in `fixtures/size/`, 16 specs in
   `fixtures/size/edits.json`. The hand-written numbers were checked in plain Chromium with no engine
   (`harness/validate-size-specs.ts`, 16/16 matched). My operational definitions (winning declaration, fixed length,
   reference widths) are marked in the rules.
2. **Baseline and scorer check (`f2157bd`):** exports of all existing suites saved before the engine change (hashes in
   `results/size/baseline-hashes.json`, files gitignored). The scorer failed every deliberately wrong export where it
   should, including the two new ones (phone width equal to the desktop value; width overflowing the phone):
   `size-check/results/scorer-check.txt`.
3. **Engine:** `linkedSize` in `engine/src/responsive.ts` (see ADR 0003, amendment) plus 11 unit tests that do not use
   the locked fixtures. 140 tests pass, typecheck clean. One old test that expected "width is not scaled" was
   rewritten for the new behaviour (intentional).

## Result (run `size1`, the scored run)

`size-check/results/size-summary.md`. Verdict **FAIL**, on pass-line item 2 only.

- Item 1: 16 PASS, 0 REFUSED, 0 FAIL of 16. Met.
- Item 2: gate **39/40**, real-page 20/20, responsive 19 PASS / 1 REFUSED / 0 FAIL, byte-identical 72/72 for every
  edit not listed as width/height. Missed because of **E14**.
- Item 3: no-op round trips 31/31. Met. Item 4: speed thresholds met (worst preview 2.5 ms, apply 0.07 ms, 10x page
  7.5 ms / 0.545 ms, bundle 270,450 B raw / 76,996 B gzip). Item 5: scorer check passed.

**Why E14 fails:** E14 sets `width: 300px` on `#sidebar`, a flex item with `flex: 0 0 240px`. The old placement code
also wrote `flex-basis` for such items so the width takes effect. The new size path writes only `width`, so the
sidebar stays 240 px (the engine wrote `@media (min-width: 768px) { #sidebar { width: 300px; max-width: 100%; } }`).
This is a real engine defect the size specs did not cover (none of the 16 puts a size on a flex item), which the
regression found. Width/height edits that changed bytes and still pass E1 to E5: E10, E18, R02, R06 (E02, R14, R18
and S18 exported identically).

## Not done, by the brief

No second engine change without reporting. Cheapest next test: reuse the old flex-basis handling in `linkedSize`
(write `flex-basis` with the width when the item has a non-auto `flex-basis`) and re-run only the gate and size
suites, as a labelled iteration 2.

## Open questions

- Whether other things the old placement code did (it also handled other cases) are lost in the new path. Only the
  gate and real-page edits exercised it; E14 is the only one that broke.
- Scaling reads only the winner at 390 or 1280 px; other breakpoints in the same screen size are not scaled.

## Next

`cat size-check/results/size-summary.md` and `git log --oneline main..feat/size-scaling`
