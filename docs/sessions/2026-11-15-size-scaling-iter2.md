# Session: size scaling iteration 2, flex items (2026-11-15)

Branch `feat/size-scaling` (not rebased). Nothing pushed. Run size1 stays on record as FAIL.

## What and why

Size1 failed on gate edit E14: a width edit on a flex item with `flex: 0 0 240px` silently did nothing because a
non-auto `flex-basis` beats `width`. The old code wrote `flex-basis` too; the new size path did not. This iteration adds it.

## What changed

1. **Locked first (`5d8898c`):** `docs/size-scaling-rules-amendment-1.md` (marked post-hoc), three pages in
   `fixtures/size-flex/` and six specs Z17 to Z22. Numbers checked in plain Chromium without the engine (6/6).
2. **Step 1 (before the engine change):** with the size1 engine, Z17, Z18, Z19, Z21 and Z22 failed and Z20 (grid control)
   passed, so the specs do detect the defect (Z22 also failed, as a silent miss: 1180 px instead of 300 px). Raw results kept as
   run `sflex0`. Scorer controls all behaved; the "phone equals desktop" control had to force `flex-basis` too, otherwise it
   cannot fail on a flex item (the basis wins): `size-check/results/scorer-check-iter2.txt`.
3. **Engine:** `flexMain`, `checkGrow`, `basisOfFlex`, `declaredBasis` and the flex-aware `linkedSize` / unlinked path in
   `engine/src/responsive.ts`; 11 new unit tests that do not use the locked fixtures. 151 tests pass.
4. **My choice for flex-grow above 0:** a structured REFUSED (`flex-grow`), not `flex-grow: 0`, because that would also change
   how siblings share the space.

## Result (run `sflex1`)

`size-check/results/size-iter2-summary.md`: all seven items met, verdict **PASS**. Gate 40/40; the 16 size specs 16 PASS; Z17 to Z21
PASS and Z22 REFUSED; real-page 20/20; responsive 19 / 1 / 0; byte-identical 72/72; round trips 34/34; speed met.
Z22's reason checked by reading `fixtures/size-flex/flex-rows.html`: `#fl { flex: 1; min-width: 0 }` has flex-grow 1, so the size
cannot be set exactly.

## Does the old path do anything else the new one loses?

I read `htmlSet` and `placeHtml`/`checkConflicts`: besides the flex-basis block, the old path refused `@media` conflicts (now handled
by the ratio path), `!important` (the new path refuses too) and shorthand mixes (not applicable to width and height), and it placed the
value in the element's own rule or inline style instead of appending a scoped rule (an intentional change of placement, not a loss).
It also wrote `flex-basis` for items that can grow, where the size silently missed; that is now a refusal. The gate (40) and real-page
(20) edits passing is the check; no other difference was found. **(unsure)** the old path is not exercised for every possible page.

## Next

`cat size-check/results/size-iter2-summary.md` and `git log --oneline main..feat/size-scaling`
