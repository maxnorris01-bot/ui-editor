# Size scaling rules, amendment 1 (flex items): LOCKED

**Post-hoc: written after seeing the size1 failure** (2026-11-15, by Max's decision, as labelled iteration 2).
`docs/size-scaling-rules.md`, `fixtures/size/*` and the 16 specs Z01 to Z16 are untouched. Run size1 stays on
record as FAIL (gate 39/40, edit E14). Amendments 1 and 2 of the responsive rules stay in force. Nothing here
calls an LLM or a paid service. Sections marked **(mine)** are operational definitions I wrote.

## Why

E14 sets `width: 300px` on `#sidebar`, a flex item with `flex: 0 0 240px`. A non-auto `flex-basis` beats `width`
on the main axis, so a rule that writes only `width` leaves the item at 240 px: the edit silently does nothing.
The old placement code wrote `flex-basis` too. The size1 spec set had no flex item; that was a gap in the specs.

## Behaviour added

For a width edit (or a height edit when the flex direction is column) on an element whose parent is `display: flex`
or `inline-flex` and whose computed `flex-basis` is not `auto` at the relevant width:

1. **Edited environment E:** `flex-basis` is written with the same value inside the same scoped rule as the size.
2. **Other environment O:** where O's parent is also a flex container and O's computed `flex-basis` is not `auto`,
   the effective size declaration there is the basis. If O's winning basis is a fixed length (px, rem, em) it is
   scaled by r exactly as width is; `width` is also scaled if it is declared as a fixed length. If the basis is
   flexible (`%`, `content`, a function, `var()`), O is left alone and a structured note says so. If O's basis is
   `auto` (or O is not a flex container), the existing size1 width rules apply unchanged.
3. The `max-width: 100%` guard is unchanged. **Unlinked** size edits on such an item also write `flex-basis`
   (inside E's condition). A pin on width covers the `flex-basis` written with it. `listUnlinked` is unchanged.
4. **flex-grow (my choice): REFUSED.** If the item's computed `flex-grow` is above 0 at E or at O, the engine
   returns a structured refusal (`flex-grow`) and writes nothing: the container, not the size, decides how large
   the item is, and writing `flex-grow: 0` would also change how its siblings share the space. It does not
   export something that silently misses the size.
5. Nothing else changes: other properties, moves, SVG, non-flex elements, and flex items whose basis is `auto`
   behave exactly as in run size1.

### Operational definitions (mine)

- **Flex item, main axis:** the parent's computed `display` at that width is `flex` or `inline-flex`; the main-size
  property is `width` when the parent's computed `flex-direction` starts with `row`, `height` when it starts with
  `column`. The check is made on the original page at E's reference width (1280 or 390) for E, and at O's for O.
- **Winning basis at O:** the cascade winner among `flex` and `flex-basis` declarations that match at O's reference
  width (inline style first). In the `flex` shorthand the basis is the length, percentage or `content` token; with only
  unitless numbers it is `0%`; `none`, `auto` and `initial` give `auto`. A basis is **fixed** when it is a single
  px, rem or em length.
- Flex-shrink is not touched; the new specs use `flex-shrink: 0` items.

## Test widths and the Truth

As before: 1280, 1024, 768, 641, 640, 390 (every page has the one breakpoint `max-width: 640px`, B = 640).
Truth at E's widths: the new size. At O's widths: if the winning declaration (basis, else width) is fixed,
original x r (capped by the container content width); otherwise the original computed value, unchanged.
Tolerance 0.5 px. The numbers were validated in plain Chromium without the engine (`harness/validate-size-specs.ts`
with `SIZE_DIR=size-flex`, hand-written `reference` CSS, 6/6 matched before this lock).

## The 6 specs (`fixtures/size-flex/edits.json`, pages `flex-rows.html`, `flex-column.html`, `grid-item.html`)

| spec | page | what |
|---|---|---|
| Z17 | flex-rows | desktop width edit, fixed px basis, phone declares a different fixed px basis: basis scaled in phone |
| Z18 | flex-rows | the E14 shape: `flex: 0 0 240px`, no width, same basis everywhere: 300 at every width |
| Z19 | flex-column | column container, height edit on an item with a fixed basis |
| Z20 | grid-item | grid item width (control: no flex-basis involved) |
| Z21 | flex-rows | unlinked phone-only width on a flex item with a fixed basis (writes `flex-basis`, pinned) |
| Z22 | flex-rows | `flex: 1` item: PASS with a size that holds, or a structured REFUSED with a true reason |

Z22 is written with `expectedOutcome: PASS` (the numbers a working edit would give: 300 at E, the original
540 and 290 at O); a REFUSED is accepted on Z22 only, with a reason verified by reading the page.

## Pass line for iteration 2 (scored by script)

1. Gate **40/40** (E14 passes E1 to E5).
2. Original 16 size specs: still at least 15 PASS and 0 FAIL.
3. Z17 to Z22: **0 FAIL** and at least 5 PASS. A REFUSED only on Z22, with a true reason.
4. Real-page 20/20; responsive 19 PASS / 1 REFUSED / 0 FAIL; every existing edit not listed in section 6 of
   `docs/size-scaling-rules.md` byte-identical to the saved baseline (same baseline hashes as size1); the listed
   width/height edits still pass E1 to E5.
5. No-op round trips byte-identical (31/31 plus the 3 new fixtures).
6. Speed thresholds still met.
7. Scorer check passed on the new specs (run before the engine change).

Decided in advance: any miss means iteration 2 FAILS; report plainly, do not tune, name the cheapest next test.
