# Insert and Comments rules, amendment 1 (clarifications found while writing the scorer)

Written after the lock commit `f777429` and **before anything was scored and before any engine change**: the scorer
(`harness/insert-lib.ts`) and its controls were being written when these definitions turned out to be missing or ambiguous.
The locked files are not edited. Per the brief, a flaw found before anything is scored is a re-lock: this file is the
numbered correction, committed on its own (`docs: amend insert and comments rules before scoring (amendment 1)`), and it
applies from the first scored run. Every item is **(mine)**.

1. **`legit` in the specs.** The scorer does not read each spec's `legit` field. It derives the collateral class (check C)
   from the steps: only `note` steps, or `bytes: equals-original`: nothing may differ at all; only `text` steps: the text
   allowance; steps containing `insert` (and `set` edits whose target is an inserted element): the insert allowance; steps
   containing `remove`: the remove allowance. The `legit: none` written on I33 and I36 means "no collateral class applies":
   **check C is skipped (the horizontal-overflow part still runs) for any spec that edits an existing element with `set`,
   `reorder` or `offset`: I30, I33 and I36.** For those, the checks that stand are A, E, O (order), M (measured values), U
   (review list), F, V and E1.
2. **Several text edits in one spec (I19).** Every text target is excluded from the collateral compare and each one's layout
   allowance is applied (the union of the allowances), because several paragraphs change at once.
3. **Breakpoints for test widths** are read only from `(min-width: Npx` and `(max-width: Npx` conditions, so a `max-width:
   1100px` property in a rule does not add a width. B is the largest `max-width` condition at or below 768, else 767.
4. **Check D is not a stray-text detector.** Counting comment nodes does not see a comment that was closed early and left text
   behind (the scorer check showed this); that case is caught by E (read-back), B (bytes) and C (the extra text changes a
   box). D keeps its stated meaning; the scorer-check control for `-->` is therefore stated as "fails E and B".
5. **`noteCount`** in a spec is informational; the number of NOTE comments is checked from `notes` and `pageNote`.
6. **Preview equals export (V)** is run for every PASS spec: document height and the created element's box at 1280 and 390
   within 1 px.
7. **Refusals:** a REFUSED spec passes only when the refusal is returned at the last step with the declared code. The facts
   each reason depends on are checked against the fixtures, without the engine, by `harness/validate-insert-specs.ts`
   (all 36 specs were consistent before the lock).
8. **listNotes shape (mine):** `listNotes(model)` returns `{ page: { text } | null, notes: [{ index, path, text }] }` where
   `index` is the element's index in the model and `text` is the note text with the leading `NOTE FOR AI: ` and the one
   trailing space removed.
