# Engine hardening rules, amendment 1 (harness clarifications found while writing the scorer)

Written after the lock commit `0398e65` and **before anything was scored and before any engine change**. The locked files are not edited;
this is the numbered correction the brief asks for (a flaw found before anything is scored). Every item is **(mine)**.

1. **Collateral class when a list removes an element it inserted.** The insert scorer chose the "remove" allowance whenever a list contained a
   `remove` step. A remove of an element the list itself inserted (selector `.new-...`) is not a removal of an original element, so the class is
   now: `hbytes: equals-original` (or `bytes`): nothing may differ; a remove of an ORIGINAL element: the remove allowance; else an insert: the
   insert allowance; else text; else (a remove of an inserted element only) the remove allowance. This changes no earlier outcome (the 36 insert
   specs were re-run on the unchanged engine: run `hpre`).
2. **Several inserted elements (H15).** The collateral compare skips every inserted element named in `created`, not only the first, and takes
   the allowance around each one's parent.
3. **`noCollateral`.** A spec that declares `noCollateral: true` (H13 and the oracle specs H17 to H20) skips the collateral compare; the
   horizontal-overflow part still runs. H13 changes a paragraph's height by design; H17 to H20 use the oracle (section 3 of the rules).
4. **`hbytes`, `regionEol`, `undoPins`, `oracle`** are checked by `harness/harden-lib.ts` as defined in section 4 of the rules; the insert
   checks A, B, C, E, O, M, U, F, V and E1 run unchanged on every spec (their `bytes` field is not used by H-specs, `hbytes` is).
5. **Pin expectations are values at widths, not the order of rules.** `measured` is the browser's computed value; the engine restating a
   pinned value after a base rule (existing behaviour) is therefore correct, and a reference export must contain it.
