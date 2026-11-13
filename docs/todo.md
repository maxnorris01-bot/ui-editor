# To-do - UI Editor

A running checklist, not a narrative. Check items off as they're done and add a short note (what
happened, any surprises) rather than deleting the line - that note is often more useful later than
the checkmark itself. Add new items as they come up; don't wait for a session's end. This is
*not* where decisions and reasoning go - that's `docs/working-notes-and-decisions.md`. This is just
"what's next."

## Up next (in priority order)

- [ ] Max: read the Step 4 report and decide what ships (`results/gate-summary.md`).
- [ ] Max: decide which real-page run counts (run 1 FAIL with harness bugs, run 2 PASS with 2 true refusals) and what the README says about known limits.
- [ ] Max: decide the responsive iteration (run 1 FAIL on R01 E4 and R09 E5; see `responsive-check/results/responsive-summary.md`), then whether to ship.
- [ ] After the verdict, Max asks for the real README.

## Later

<!-- Real, but not next. -->

## Lower priority / opportunistic

<!-- Worth doing if the moment presents itself; not worth planning around. -->

## Next (decision needed from Max)

- [ ] Responsive iteration 2 left R09 failing E5 (`styles.css` has no trailing newline and no source-map comment). Options in `docs/sessions/2026-11-12-responsive-iter2.md`.

## Completed (most recent first)

<!-- Move items here when done, newest first, with a one-line note on what happened. -->

- [x] Responsive iteration 2 (2026-11-12): amendment 1 (`c1096f8`), source-map placement fix, run `iter2`: R01 PASS (amended E4), R09 FAIL (E5), items 2 to 6 met. Verdict FAIL.
- [x] Responsive edits (2026-11-11): rules/specs locked (`51a861f`), engine `engine/src/responsive.ts`, harness `run-responsive.ts`; run 1 FAIL (item 1), items 2 to 5 met.
- [x] Real-page check (2026-11-10): rules and specs locked (`ad1c999`), harness `harness/run-realpage.ts`, run 1 and run 2 in `realpage-check/results/`.
- [x] Step 4 (2026-11-10): thresholds committed (`fd51815`), `harness/run-gate.ts` written, no-op round
      trip 10/10, 40/40 edits pass in run 1, speed thresholds met. Verdict PASS.
- [x] Step 3 (2026-11-08): speed measured, `docs/checkpoint.md` written. Worst preview median 2.5 ms,
      worst apply 0.034 ms, bundle 253 KB raw / 71 KB gzip.
- [x] Step 2 (2026-11-08): engine built (`engine/`), 96 unit tests, strict TypeScript.
- [x] Step 1 (2026-11-08): Node project, Makefile targets `node-install`/`node-test`/`gate`, ADR 0002.
- [x] Step 0 (2026-11-08): rules, 10 fixtures and 40 edit specs locked in `090b9ef`.
