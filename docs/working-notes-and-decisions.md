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

## Open items / parking lot

<!-- Things to revisit later - not urgent, not forgotten. -->

- Speed thresholds: Max to set (proposals in `docs/checkpoint.md`).
- Fixtures are small (largest 14.7 KB) and written by the same agent as the engine; a 10x and 100x
  replicated large page would show whether the speed claims hold for real pasted pages.
- Bundle is dominated by parse5 (140 KB, 33 KB of it the entity table) and postcss (57 KB);
  revisit only if the size threshold is missed.
- SVG goes through parse5's HTML parser; SVG that is only valid as XML may be split differently.

## See also

- `docs/sessions/*.md` - what changed and why, per work session.
- `README.md`'s Known Failures section (if present) - the detailed, evidence-quoted record of real
  bugs found and their status.
- `docs/adr/` - specific architectural decisions with fuller reasoning than fits here.
