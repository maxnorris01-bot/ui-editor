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

## See also

- `docs/sessions/*.md` - what changed and why, per work session.
- `README.md`'s Known Failures section (if present) - the detailed, evidence-quoted record of real
  bugs found and their status.
- `docs/adr/` - specific architectural decisions with fuller reasoning than fits here.
