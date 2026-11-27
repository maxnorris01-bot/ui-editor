# Views real-page check (2026-11-27)

Branch `test/views-real-pages` from `main` at 02b9466. Question: do Desktop, Tablet and Phone hold up on the five real pages? Nothing under `engine/` or `src/` changed (checked by the verdict script).

## What was done
- Lock commit `878d368`: `docs/views-realpage-rules.md` and `views-check/realpage-edits.json` (16 specs V01 to V16; retired list: none). B and T were read with the engine's own exports and agree with the harness's independent reading.
- Harness: `harness/run-views-real.ts`, `views-real-lib.ts`, `controls-views-real.ts`, `views-real-verdict.ts`; `page-views.js` gained one extra returned field (`customAfter`) for the customEdits query.
- Amendment 1 (made before the first scored run): the locked iframe method for 767.98 and 991.98 does not work in Chromium (viewport snapped to whole pixels). V14 is scored at 767, 768, 991, 992, 993 and by a text check of the written condition.
- Scorer check: first attempts failed for scorer-side reasons, which I fixed before any engine export was scored: the hand-built exports added a `<style>` element (element count +1), an ad hoc control had no target step, and the iframe could not reach fractional widths (the amendment). Those earlier outputs were overwritten in `realpage-scorer-check.txt`; they are described here only. The final check passed: every unfaulted control PASS (13 specs plus V14), each of 6 faults fails the check named.
- One scored run, `v1`, on the final commit, as a full chain with the earlier suites.

## Results
| page | B | T | Tablet band |
|---|---|---|---|
| leemunroe-email.html | 640 | 1024 (default) | 641 to 1024 |
| mailgun-action.html | 599 | 1024 (default) | 600 to 1024 |
| freelancer-index.html | 767.98 | 991.98 | 768 to 991.98 |

16 of 16 specs PASS, collateral clean in all, 5 of 5 round trips byte-identical, SVG Phone- and Tablet-tagged edits equal the saved Desktop bytes. Earlier suites as in the follow-up run. Per-stage seconds: gate 7, real-page 21, responsive 34, size 9, flex 3, insert 28, hardening 15, M 30, N 13, V 76, speed 2, scale 35, regress 1, verdict 1.

## Could not verify
Chromium only; JavaScript off, other hosts aborted, fonts fall back; no real device; the page's UI is not involved; 767.98 and 991.98 as real viewport widths; widths strictly between 767.98 and 768. Spec targets and values were chosen by Claude Code (reusing the earlier selection procedure). The FT text check has no failing-direction control (a seventh switch would exceed the brief's six). The verdict's "stage 1 second" timings for the last stage look too short to include npm test; not re-timed.

## Next
`git log --oneline main..test/views-real-pages`, `cat views-check/results/realpage-summary.md`.
