# Session: responsive edits (linked and unlinked)

## What this was
Max's decision: an edit is a ratio. Changing a size while viewing one width scales the page's own
screen-specific values (every matching `@media` rule) for that element and property by the same
ratio; colours, families, order, alignment and moves apply at every width. Edits are **linked** by
default; an **unlinked** edit applies only inside the environment it was made in (desktop = widths
above B, phone = B and below) and pins that value against later linked edits from the other
environment. No UI, no `portfolio-site`, nothing pushed. Run 1 is the scored run.

## What changed
- `docs/responsive-rules.md`, `fixtures/responsive/` (9 pages) and `edits.json` (20 specs), locked in
  `51a861f` before any engine change. The numbers were checked against a hand-written reference
  stylesheet in plain Chromium first (no engine): 19 measurable specs agreed at every width.
- Step 1 before engine changes: baseline exports of the 40 gate edits and 20 real-page edits saved
  to a gitignored `baseline-exports/` (hashes committed in `results/responsive/baseline-hashes.json`);
  scorer control on the fixed real-page harness (`GATE_CONTROL`): see the report.
- Engine (`db05bca`): `engine/src/responsive.ts` (media evaluation, breakpoint, scaling, scoped
  overrides, pins, unlinked set/offset/reorder, `listUnlinked`), `Edit.environment`/`link`,
  `RuleNode.conditions`, a `css` DOM operation, width-aware `Probe.computed`, `Preview.setWidth`,
  `applyEditSteps` for ordered edit lists. ADR `docs/adr/0003-responsive-edits.md`. 122 unit tests
  (26 new, none using the locked fixtures). One old test that expected an `@media` refusal was
  rewritten: a linked colour edit on such a property is now written inline so it wins everywhere.
- Harness: `run-responsive.ts` (specs at every width plus R01 and R09), `regress.ts` (byte-identity
  against the baseline), `responsive-verdict.ts` (verdict from the pass line), and the new
  `page-*.js` helpers. Results (numbers and names only) are under `responsive-check/results/`.

## Result (run 1, the scored run): iteration FAILS pass line item 1
| item | measured | met |
|---|---|---|
| 1. R01 and R09 at all test widths | R01 FAIL (E4), R09 FAIL (E5) | no |
| 2. 20 new specs | 19 PASS, 1 REFUSED (S17, expected), 0 FAIL | yes |
| 3. regression | gate 40/40, other real-page 18/18, byte-identical 55/55 | yes |
| 4. no-op round trips | 25/25 | yes |
| 5. speed | worst preview 2.3 ms, apply 0.07 ms, gzip 76 KB, raw 268 KB, 10x page 7.6 ms / 0.55 ms | yes |

The two misses are not wrong values: E2 (the Truth) and E3 (preview equals export) pass for both at 8
widths (R01) and 34 widths (R09).
- **R01 E4:** at every width the spacer cell `<td>&nbsp;</td>` left of the content cell grows from
  414 px to 424.4 px because the table row got taller. That is a real layout consequence of making
  the text bigger, but the locked `flow` class only allows following siblings, so the preceding
  spacer cell counts as collateral change.
- **R09 E5:** `styles.css` has no trailing newline, so appending three rule lines changes its last
  line (the diff shows "No newline at end of file"). The E5 rule allows removed lines only in the
  target's start tag.
Rules and specs were not tuned. I did not run a second iteration: R01 cannot pass under the locked
`flow` class whatever the engine does, so the verdict would not change.

## REFUSED (checked by reading the file)
S17 (phone-only reorder in `#stack`): refused with `order-needs-flex-or-grid`, reason "the parent is
display: block". `fixtures/responsive/moves.html` line `.stack { display: block; ... }` confirms it.

## Decisions I made (inside the rules before the lock, unless noted)
- Spec (b) is split into S02 (rem) and S03 (em) so there are ten linked cases (a to i is nine letters).
- A single environment-scoped rule is enough for an unlinked edit; no companion rule for the other
  environment (it is untouched by construction), so "the pair" is never needed.
- Unlinked reorder via `order` works only to the first or last position among siblings with equal
  `order`, because changing only the target's `order` cannot place it between siblings.
- E5 allowance: 3 x edits in the spec + 2 x added `@media` lines.
- Harness note: Playwright's `setViewportSize` hung on a JavaScript-off context, so each width uses a
  fresh JavaScript-off context with that viewport.
- The first run attempt crashed before writing results (E4 needed the step target, not the measured
  parent); fixed in the harness and run again. That crashed attempt is not a run.

## Information only
"Not scaled" notes: 1 of the 20 new specs (S06, clamp()) and 0 of R01/R09; the other 18 real-page
edits never reach the responsive path. Diff sizes are in `responsive-summary.md` (typically 1 to 3
added lines, 2 to 5 for chains, plus the start tag where a hook or inline style is needed).

## Open questions for review
- Whether to widen `flow` (preceding sibling in the same table or flex row), a rule change for Max.
- Whether a file without a trailing newline may take one changed last line (R09), or the engine
  should place rules before a trailing source-map comment.
- Linked offsets and reorders still refuse when a media rule sets `transform` (unchanged behaviour).

## Next command
`cat responsive-check/results/responsive-summary.md` and `git log --oneline feat/real-page-check..`
