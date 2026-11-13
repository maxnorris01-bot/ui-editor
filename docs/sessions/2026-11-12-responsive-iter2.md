# Session: responsive iteration 2 (2026-11-12)

Branch `feat/responsive-iter2` (stacked on `feat/responsive-edits`). Nothing pushed.

## What this was

Responsive run 1 failed only item 1: R01 failed E4 and R09 failed E5. Max decided to amend E4 (R01)
and to fix the engine (R09). This session did both and re-ran everything as labelled run `iter2`.

## What changed

1. **Amendment 1 (own commit `c1096f8`, before any other change).** `docs/responsive-rules-amendment-1.md`:
   E4's layout allowance extends to preceding siblings (and their descendants) of the target and of its
   ancestors, only in a `tr` or a flex or grid container, only for bounding box and the layout-resolved
   properties. My operational definition: "flex or grid container" = computed `display` of the container in the
   original is flex, inline-flex, grid or inline-grid; the allowance applies where the spec's `legit` class is
   `flow` or `reorder` (the classes that already allow layout changes).
2. **Scorer** (`harness/e4-amend.ts`, used by `run-responsive.ts` and `run-realpage.ts`). R01 is scored
   under the amended E4; the locked E4 is also computed and stored as an informational `E4L` row. The
   responsive harness got a `GATE_CONTROL` mode like the real-page one.
3. **Scorer check (Step 1, before the engine change):** all passed.
   - unchanged export: fails E2 and E3 everywhere (HTML and SVG);
   - collateral CSS (extra rules changing colour of other elements): fails E4 on all 22 responsive HTML
     cases and on all 12 HTML and 8 SVG real-page edits, so the amendment did not make E4 blind;
   - one added space: fails E5 only (on HTML and SVG).
4. **Engine fix:** override rules go before a trailing source-map comment (`sourceMapStart` in
   `engine/src/responsive.ts`, used for `<style>` blocks and companion CSS). 7 new unit tests (with and without
   trailing newline, with and without the comment, comment on the same line, a comment that is not last).
   129 tests pass, typecheck clean. ADR 0003 updated.

## Result of run `iter2`

See `responsive-check/results/responsive-summary.md`. Short version:

- R01: PASS under the amended E4 (E1 to E5 at 8 widths); FAIL under the locked E4 (the spacer cell, 414 to 424.4 px).
- **R09: FAIL (E5), unchanged.** The brief assumed `css/styles.css` ends with a source-map comment. It does not:
  the file ends `}` with no newline and has no `sourceMappingURL` anywhere. This is the case the brief says to
  leave as it is, so I did, and it is the cause of the failure: one removed and one added line for the same
  last rule line (diff: HTML -1/+1, CSS -1/+4). E1 to E4 pass at all 34 widths.
- 20 responsive specs: 19 PASS, 1 REFUSED (S17, as before), 0 FAIL.
- Regression: gate 40/40, other real-page 18/18, byte-identical 55/55. No-op round trips 25/25.
- Speed: all thresholds met (see summary). Bundle grew slightly: 268,227 B raw, 76,352 B gzip.

Verdict: **FAIL** (item 1). Overall record: run 1 FAIL under the locked rules (R01, R09); amendment 1 and
engine fix; iteration 2 FAIL (R09 only).

## For Max to decide (not done, as the brief says no second engine change without reporting)

Cheapest next test: for a stylesheet with no trailing newline and no source-map comment, insert the new
rules as a pure insertion before the last rule (so no existing line is altered), then re-run only R09 and
the regression. Alternative: accept that appending to a file with no trailing newline changes its last
line and amend E5 for that case.

## Known limits

Only `max-width` and `min-width` features are evaluated. `width` and `height` are not scaled by design.
An element without an id can only be out-specified through the `data-ue` hook. A stylesheet with no
source-map comment and no trailing newline keeps the old behaviour.

## Next

`git log --oneline feat/responsive-edits..feat/responsive-iter2` and `cat responsive-check/results/responsive-summary.md`
