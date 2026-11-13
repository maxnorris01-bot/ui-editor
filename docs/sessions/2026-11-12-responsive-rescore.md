# Session: responsive re-score (2026-11-12)

Branch `feat/responsive-rescore` (stacked on `feat/responsive-iter2`). Nothing pushed. The engine did not change
(`git diff feat/responsive-iter2 -- engine/` is empty).

## What and why

Iteration 2 failed on R09 only: `css/styles.css` has no final newline, so appending rules made a line diff show the
old last line as changed. Max decided to amend E5 for that case and re-score.

## What changed

1. `docs/responsive-rules-amendment-2.md` (own commit): when the original lacks a final newline and the export is the
   original plus exactly one newline plus appended content, the original is compared as if it ended with that newline.
   Any other last-line change, a second newline, or any other change still fails E5. My operational definition is in
   that file. R09 under the locked E5 stays FAIL.
2. Scorers: `harness/e5-amend.ts`, used by the gate, real-page and responsive harnesses. The responsive harness also
   stores the locked E5 as an informational `E5L` row, and has `GATE_ONLY` and `lastline` and `twonl` control modes.
3. `docs/known-limits.md`: every limit found so far, for the README.

## Scorer check (before the re-score)

- one added space (reformat): fails E5 on all 22 responsive HTML cases and on all 12 HTML and 8 SVG real-page edits;
- the original's last line altered (`}` to `} `): fails E5 on R09 (`css/styles.css`) and on all 20 real-page edits (HTML and SVG);
- two newlines after the last character: fails E5 on R09;
- collateral CSS: still fails E4 (22 responsive, 12 HTML and 8 SVG real-page);
- unchanged file: fails E2 and E3 everywhere.

## Result (run `rescore`)

All six pass-line items met; see `responsive-check/results/responsive-summary.md`. R09 passes E1 to E5 at 34 widths
under the amended E5 (diff: HTML 1 line removed, CSS 4 lines added); under the locked E5 it fails. R01 passes under
the amended E4 (and fails under the locked E4). 20 responsive specs: 19 PASS, 1 REFUSED (S17), 0 FAIL. Gate 40/40,
other real-page 18/18, byte-identical 55/55, round trips 25/25, speed thresholds met.

Only R09's E5 differs from iteration 2 (false to true); gate, real-page and the other responsive outcomes are identical.

## Record

Run 1 FAIL under locked rules (R01, R09); amendment 1 and the source-map fix; iteration 2 FAIL (R09); amendment 2 and
re-score PASS. The pass needed two post-hoc rule amendments, made by Max after seeing results.

## Open questions

A user's own `git diff` will still show the last line of a newline-less stylesheet as changed. The engine could instead
insert before the last rule; not done (engine unchanged by brief).

## Next

`git log --oneline feat/responsive-iter2..feat/responsive-rescore` and `cat docs/known-limits.md`
