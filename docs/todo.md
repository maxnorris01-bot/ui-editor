# To-do - UI Editor

A running checklist, not a narrative. Check items off as they're done and add a short note (what
happened, any surprises) rather than deleting the line - that note is often more useful later than
the checkmark itself. Add new items as they come up; don't wait for a session's end. This is
*not* where decisions and reasoning go - that's `docs/working-notes-and-decisions.md`. This is just
"what's next."

## Up next (in priority order)

- [ ] Max: approve or change the speed thresholds proposed in `docs/checkpoint.md`.
- [ ] Commit `docs: add speed thresholds` (separate commit, after approval).
- [ ] Step 4: write `harness/run-gate.ts` (E1 to E5 by script), run the no-op round trip on all 10
      files first, then the 40 edits, write `results/gate-results.csv` and `results/gate-summary.md`.
- [ ] Report the verdict computed from `docs/gate-rules.md` only; session note for Step 4.
- [ ] After the verdict, Max asks for the real README.

## Later

<!-- Real, but not next. -->

## Lower priority / opportunistic

<!-- Worth doing if the moment presents itself; not worth planning around. -->

## Completed (most recent first)

<!-- Move items here when done, newest first, with a one-line note on what happened. -->

- [x] Step 3 (2026-11-08): speed measured, `docs/checkpoint.md` written. Worst preview median 2.5 ms,
      worst apply 0.034 ms, bundle 253 KB raw / 71 KB gzip.
- [x] Step 2 (2026-11-08): engine built (`engine/`), 96 unit tests, strict TypeScript.
- [x] Step 1 (2026-11-08): Node project, Makefile targets `node-install`/`node-test`/`gate`, ADR 0002.
- [x] Step 0 (2026-11-08): rules, 10 fixtures and 40 edit specs locked in `090b9ef`.
