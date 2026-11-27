# Working notes and decisions log - UI Editor

This is a different kind of record from `docs/sessions/*.md`. Session docs narrate what changed in
one sitting and are written for someone with zero context picking up the diff. This file is the
opposite shape: short, durable entries - a decision plus *why*, or an open item worth remembering -
meant to be skimmed months later when the reasoning behind something has otherwise been forgotten.
Append to it whenever a real decision gets made, not just at the end of a session. If something is
already fully documented elsewhere (a technical fix in a session doc, a known failure in the
README, a design tradeoff in an ADR), point to it here rather than duplicating it.

## Decisions

<!--
One entry per decision, newest first. Format:

**YYYY-MM-DD - Short title.** What was decided, and the reasoning - not just the choice but why
this choice over the alternatives. Note what's still open or deferred within it, if anything.
-->

**2026-11-08 - Engine gate rules, fixtures and edit specs locked before any engine code.** Commit
`090b9ef`. Gate pass line, E1 to E5 and my operational definitions are in `docs/gate-rules.md`.
Before locking I checked each selector is unique and ran a crude DOM-manipulation oracle (not the
engine) against the 40 expected values; 39 matched and E15's `flex-end` serialises as `flow-end` in
this Chromium, so the rules carry an alias in the value normalisation rather than changing the spec.
Nothing in the locked files may change; if one turns out wrong it is recorded here and Max decides.

**2026-11-08 - parse5 + postcss with text patches, not a tree re-serialiser.** parse5 for HTML and
SVG (spec-compliant tree matches Chromium's, offsets for everything), postcss for CSS, edits are
patches against the original text. Full reasoning and the options rejected: ADR 0002.

**2026-11-08 - Where edits are written.** Inline style if the element has one, else the single rule
that targets only this element if it would still win the cascade, else a new `style` attribute;
SVG follows what the element already uses. Offsets prepend a translate to the effective declared
transform. Refuse rather than guess for `!important`, `@media`, shorthand/longhand mixes,
transformed HTML ancestors, shared SVG instances. Docstring in `engine/src/edit.ts`.

**2026-11-08 - Pre-gate bug fix after the speed run.** The speed run's refusal status showed 3 T1
edits refused as `shorthand-mix` because `font-size` vs `font-family` were treated as related.
Fixed with a regression test before any scoring existed; disclosed in `docs/checkpoint.md` so Max
can decide whether Step 4 should treat it as an iteration.

**2026-11-08 - Speed thresholds not set.** Measured (worst preview median 2.5 ms, worst apply
0.034 ms, bundle 253 KB raw / 71 KB gzip, largest fixture 14.7 KB); proposals in
`docs/checkpoint.md`; waiting for Max. Step 4 does not run until he approves.

**2026-11-10 - Speed thresholds set by Max, plus a scaling check.** Proposed thresholds accepted
(preview <= 100 ms, apply <= 10 ms, gzip <= 100 KB, raw <= 350 KB), with a 10x large-page copy
(preview <= 250 ms, apply <= 50 ms) and a report-only 100x copy. Committed in `fd51815` before any
scoring. The shorthand-mix fix is reported as "iteration 0" (pre-gate). See
`docs/speed-thresholds.md`.

**2026-11-10 - Gate run 1: 40/40, verdict PASS.** Details in `results/gate-summary.md` and
`docs/sessions/2026-11-10-engine-gate-step4.md`. Scorer sanity-checked with three sabotaged
exports (no-op, collateral change, reformat): all failed as they should. Interpretation choices
the locked rules left open are listed in the session note.

**2026-11-10 - Real-page check (`feat/real-page-check`).** Rules and 20 edit specs locked in
`ad1c999` before the engine touched any real file; specs were checked against plain Chromium DOM
edits (no engine) first. Run 1 (scored, as the brief says): 15 PASS, 2 REFUSED, 3 FAIL, so the
check FAILED as computed. Two of those FAILs (R10, R12) and one more (R11) came from two harness
bugs, not the engine: E4 compared computed styles by array index (Chromium lists custom
properties in a different order per load), and E5 treated an `expectedFiles` entry that did not
change as a problem although the entry only says the file may differ. Harness-only fix
(`engine/` untouched), re-run as run 2: 18 PASS, 2 REFUSED, 0 FAIL, round trips 6/6. Both runs are
in `realpage-check/results/`. Both refusals are `conditional-rule` and both reasons are true
(checked by reading the files). Max decides which run counts. Details:
`docs/sessions/2026-11-10-real-page-check.md`.

**2026-11-11 - Responsive edits (`feat/responsive-edits`).** Max's decision: an edit is a ratio, so a
size changed at one width scales the page's own screen-specific values by the same ratio; linked by
default, unlinked edits apply only inside their environment and pin it. Rules, 9 fixtures and 20
specs locked in `51a861f` before any engine change; baseline exports saved with the old engine
first; scorer control passed on HTML and SVG. Mechanism and limits: `docs/adr/0003-responsive-edits.md`.
Run 1 (scored): the 20 new specs 19 PASS + 1 expected REFUSED (S17), regression 40/40 and 18/18,
byte-identical 55/55, round trips 25/25, speed met. The iteration FAILS pass line item 1: R01 fails E4
and R09 fails E5. Neither is a wrong value (E2 and E3 pass at 8 and 34 widths). R01: the spacer cell
beside the edited cell stretches with the taller row, which the locked `flow` class (gate-rules 5.5)
does not allow (it covers following siblings, not a preceding sibling in the same table row).
R09: the stylesheet has no trailing newline, so appending a rule line changes its last line. Rules and
specs were not tuned; Max decides. The old unit test that expected an `@media` refusal now expects the
new behaviour (inline style for a linked colour edit).

## Open items / parking lot

<!-- Things to revisit later - not urgent, not forgotten. -->

- Fixtures are hand-written by the same agent as the engine and are probably easier than real
  pasted code; the 10x/100x copies only repeat one page. Real pasted pages are the open test.
- Bundle is dominated by parse5 (140 KB, 33 KB of it the entity table) and postcss (57 KB);
  revisit only if the size threshold is missed.
- Responsive iteration (see above): decide whether to widen the `flow` class to cover a preceding
  sibling in the same table or flex row (R01), and whether a file with no trailing newline may take
  one changed last line when a rule is appended (R09). The old `@media` refusal is gone.
- SVG goes through parse5's HTML parser; SVG that is only valid as XML may be split differently.

## Responsive iteration 2 (2026-11-12)

- **Decision (Max, 2026-11-12): amendment 1 to responsive E4.** The layout-resolved allowance now also
  covers preceding siblings (and their descendants) of the target and its ancestors when they share a
  `tr` or a flex or grid container. Why: cells and items in one line share cross-axis size, no engine can
  avoid it. Made after seeing R01 fail; R01 under the locked rule stays FAIL in run 1. Text:
  `docs/responsive-rules-amendment-1.md`.
- **Decision (Max): engine places override rules before a trailing `/*# sourceMappingURL */` comment.**
  Done and tested. It does NOT help R09: `css/styles.css` has no such comment and no trailing newline, so
  the old behaviour (append after the last byte) still applies and E5 still fails by one changed line.
  Iteration 2 therefore FAILS item 1. Open decision for Max: see the session note.

## Responsive re-score (2026-11-12)

- **Decision (Max): amendment 2 to E5.** A missing final newline in the original, with the export appending
  content that starts with exactly one newline, no longer counts as a changed last line. Why: a line diff
  reports the unchanged text of the last line as changed only because of the end-of-file newline. Text:
  `docs/responsive-rules-amendment-2.md`. R09 under the locked E5 stays FAIL (iteration 2).
- Re-score with an unchanged engine: PASS. Only R09's E5 changed. Two post-hoc amendments (E4, E5) were
  needed to get there; the README should say so.
- `docs/known-limits.md` collects every limit found so far for the README.

## Size scaling (2026-11-12)

- **Decision (Max, 2026-11-12):** resizing keeps the same ratio rules as font size; moves stay unlinked in v1.
  Rules, fixtures and 16 specs locked in `909459a` (`docs/size-scaling-rules.md`).
- **Run 1 (size1): FAIL.** The 16 new specs all pass, but the regression missed: gate 39/40. E14 (width on a flex
  item with `flex: 0 0 240px`) stays at 240 px because the new path does not write `flex-basis` as the old path did.
  Everything else met the pass line. Per the brief there is no second engine change without Max's decision; the
  cheapest next test is to reuse the old flex-basis handling in the new path and re-run only the gate and size suites.

## Size scaling iteration 2 (2026-11-15)

- **Decision (Max, 2026-11-15):** labelled iteration 2 to fix the flex-item gap found by size1. Amendment, 6 new specs
  Z17 to Z22 and fixtures locked in `5d8898c` (post-hoc: written after seeing the size1 failure). Size1 stays FAIL on record.
- **My choice, flex-grow above 0: REFUSE** (not `flex-grow: 0`), because `flex-grow: 0` changes how siblings share space.
- **Result (run sflex1): PASS**, all seven items met. Z17 to Z21 pass; Z22 (`flex: 1`) is REFUSED with a true reason.

## Insert and Comments engine spike (2026-11-21)

- **Decisions (Max, 2026-11-19):** insert places in document order (before, after, first or last child), no coordinates; five HTML kinds
  (text, rect, rounded, ellipse, button); SVG insert refused; readable unique class names; styles in the page's last stylesheet else
  inline; notes are comments directly before their element with a locked header; a note travels with its element.
- **Rules, 36 specs and fixtures locked first** (`f777429`); amendment 1 (`66bf0e6`) fixed three ambiguities before anything was scored.
- **My choices, for Max to confirm or change:** the neutralising rule (a run of 2+ hyphens gets a space between each pair; nothing else
  changes, not even the ends); class prefixes `new-box-`, `new-text-`, `new-button-` with the smallest unused number; default styles
  (boxes 200 x 120 px grey with `max-width: 100%`, text and button defaults); one note per element plus one page note; blank text
  deletes a note; a note belongs to an element by source adjacency; `ul`/`ol`/`dl`/`menu` refuse direct children (stricter than the parser).
- **Result (run i2): PASS**, all eight pass-line items met (30 PASS and 6 REFUSED as declared, 0 FAIL; regression 111/111 byte-identical).
  Run i1 on the earlier commit was FAIL on item 5 only, because the new verdict script had a typecheck error and read the test count
  wrongly; no engine change between i1 and i2. See `docs/sessions/2026-11-21-insert-comments-engine.md`.
- **Pins:** measured. Insert and remove make a pin name the wrong element (a later linked edit scaled 20 px to 50 px); fixed by remapping
  pins on insert and remove, covered by locked spec I33. **Reorder has the same flaw and is not fixed** (outside the brief); Max decides.
- **Finding:** the old dispatch sent any unknown edit kind on an SVG file to the offset code (wrote `x="NaN"`); unknown kinds are now
  refused (`unknown-edit`).

## Engine hardening (2026-11-22)

- **Done:** reorder remaps pins (H1); remove takes an inserted element's engine-written rules and never a page-authored one (H2); every line break the engine adds
  follows the file's own ending (H3); neighbour-selector pages checked against the browser's own answer, no engine change needed (H4). Rules and 20 specs locked in
  `0398e65`; amendment 1 before scoring. Run `h2`: PASS (run `h1` FAIL on a verdict-script defect only). `docs/adr/0005-engine-hardening.md`.
- **Choices (mine):** engine-inserted = class `new-*-N` plus a rule starting with the engine's default declarations; an ORIGINAL element's override rules are left; line
  ending = nearest existing break; no line break in the file = LF.
- **Open:** one existing unit test's fixture rule was changed (see the session note); Max confirms.

## Small views (2026-11-25)

- **Decision (Max, 2026-11-25):** three views; Desktop edits reach Phone and Tablet in proportion; Phone and Tablet edits are custom to their view (Link ignored) and survive later Desktop edits; a view can be
  reset. Engine side proven in `feat/small-views-engine`: rules and 32 specs locked in `647ff3b`, run `m1` PASS (`docs/adr/0006-small-views.md`, `docs/sessions/2026-11-25-small-views-engine.md`).
- **Choices (mine):** Tablet = `floor(B)+1` to T (T = largest `max-width` in 769 to 1100, else 1024); a Tablet edit on a page whose own phone breakpoint is 768 is refused (`tablet-covered-by-phone`); the Desktop
  cascade over a pinned view is done by writing the view's own rule again after the Desktop rules; Reset of Desktop is not offered.
- **Retired:** S09, Z09 and one unit test (a Phone edit with link on no longer scales Desktop).

## Small views follow-up (2026-11-25)

- **Done:** a Desktop edit of a colour, font or other non-ratio property after a view is customised works (the view's rule is written again after it with `!important`; no `pinned-conflict` any more); a
  Desktop width or height edit scales a length declared only for the tablet range; a Bootstrap-style page (B 575.98, T 991.98) works as it was. 13 specs N01 to N13 locked in `537f306`; ADR 0006 addendum.
- **Choice (mine):** `!important` on the re-emitted view rule, because the Desktop value is written as an inline style; nothing is still refused.

## See also

- `docs/sessions/*.md` - what changed and why, per work session.
- `README.md`'s Known Failures section (if present) - the detailed, evidence-quoted record of real
  bugs found and their status.
- `docs/adr/` - specific architectural decisions with fuller reasoning than fits here.

## 2026-11-27: views real-page check (run v1)
- Round changed nothing under `engine/` or `src/`. 16 V-specs (prefix V, no earlier file used it) on the three real HTML pages and the two SVGs all PASS; every earlier suite kept its results and bytes.
- All three HTML pages have a Tablet band by the locked definitions (emails from 641 and 600 up to the default T 1024), so `tablet-covered-by-phone` was expected nowhere and occurred nowhere.
- Decision (amendment 1, before the first scored run): Chromium cannot set a fractional viewport, so V14 uses whole widths plus a text check of the written condition; the fractional width itself is unverified in a browser.
- Detail: `docs/sessions/2026-11-27-views-real-pages.md`.

## 2026-11-27: README
- Replaced the template README with the real one (docs only). CI is the template's Python workflow and runs nothing of the engine; the README says so beside the badge. Template leftovers (`src/app/`, `tests/`, `evals/`, Python targets) stay for now: Max decides when to remove them.
- The follow-up session note's "8 of 13 pass, 5 fail" before the work differs from the CSV (7 and 6); the README uses the CSV.
- Detail and the claim-to-file table: `docs/sessions/2026-11-27-readme.md`.

## 2026-11-27: pre-public audit and fixes
- Audited all history (`docs/sessions/2026-11-27-prepublic-audit.md`): no secrets, no third-party files, no AI trailers; the Gmail address is the author of every commit. Decision (Max): keep history exactly as it is, no rewrite.
- Changed: README wording and badge caveat, the CI workflow (one job `engine`: typecheck, tests, bundle, the 40-edit gate), `CLAUDE.md` (private-project lines removed), `package.json` (license, author, repository, description). The old check names `ci/checks` and `ci/eval-*` are gone.
- Max still decides: template leftovers (and the two now-stale sentences in the README's Leftovers paragraph), whether `docs/lessons-learned.md` and `docs/collaboration-conventions.md` (which name other projects and the Cowork Project) stay, and the branch-protection answer before merging.
