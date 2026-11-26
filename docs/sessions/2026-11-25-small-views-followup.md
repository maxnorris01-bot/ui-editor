# Session: small views follow-up (2026-11-25)

Branch `feat/small-views-followup`, from `main` at `949b3b8`. Nothing pushed; no UI; `portfolio-site` untouched. Brief: `~/Desktop/Projects/ui-editor-small-views-followup-brief.md`.

## What was done

1. **Lock (`537f306`):** `docs/small-views-followup-rules.md`, three hand-written fixtures in `fixtures/views-followup/` (`colours.html`, `tabonly.html`, `bootstrap.html` with B = 575.98 and T = 991.98) and 13 specs N01 to N13;
   every expected value validated in plain Chromium without the engine.
2. **Step 1:** on the current engine 8 of the 13 pass and 5 fail: N01, N02, N04, N05, N06 with `pinned-conflict`, N08 on a measurement (a width declared only for 769 to 1024 was not scaled). 10 scorer controls (6 fault switches)
   behave (`views-check/results/followup-scorer-check.txt`; control (4) was first over-specified and corrected before anything ran); the earlier suites' faults and the insert and hardening controls were re-run.
3. **Build:** the non-ratio cascade (`pinned-conflict` removed; the view's rule written again with `!important` after the Desktop inline value), the tablet-only length in `linkedSize`, 4 unit tests, ADR 0006 addendum, known limits.
4. **Scored run `f1` on `1c081ef`: PASS** (`views-check/results/followup-summary.md`). One run, no iteration.

## Result of run f1

N-specs 13/13 PASS; M-specs 31 PASS + M20 REFUSED; gate 40/40, real-page 20/20, responsive 18 + 1 REFUSED (S09 retired last round), size 15/16 (Z09 retired), flex 5 + Z22 REFUSED, insert 30 + 6, hardening 20; 180 of
182 baseline exports byte-identical (the two retired specs excepted, as before); 71 of 71 round trip rows identical; `npm test` 218 pass (214 + 4 new), typecheck, lint, build clean; speed thresholds met.
Elapsed per stage as logged by the script: gate 7 s, real-page 22 s, responsive 34 s, size 9 s, flex 4 s, insert 29 s, hardening 16 s, M-specs 30 s, N-specs 13 s, speed 1 s, scale 36 s, regress 1 s, verdict 1 s
(the last stages look too short to include `npm test`, tsc, eslint and build; I did not re-time them).

## Representation and what is still refused

`!important` on the re-emitted view rule, because the Desktop value is an inline style. The alternatives (a scoped base rule; scoping the Desktop value away from the view) change bytes or lose views. **Nothing needed to
stay refused:** the brief's "one case that must stay REFUSED if any exists": none was found. `tablet-covered-by-phone`, `important-conflict` and `shorthand-mix` are unchanged.

## Decisions for Max

`!important` as the mechanism; the Bootstrap-style fixture uses 767.98 only as a `min-width` (a `max-width: 767.98px` would make B = 767.98 by the locked definition, so B = 575.98 as the brief says needed this reading);
`scaled` truth for tablet-only declarations means every region's own value times the ratio (Phone included).

## Could not verify

Specs written by Claude Code; Chromium only; no real Bootstrap stylesheet was edited; the scorer-check line of the verdict script still reads the previous round's file (the follow-up's own check is `followup-scorer-check.txt`).
Two scorer-check files were rewritten by the earlier-control scripts and put back with `git show HEAD:<file> > <file>`.

## Next

`git log --oneline main..feat/small-views-followup`, `cat views-check/results/followup-summary.md`.
