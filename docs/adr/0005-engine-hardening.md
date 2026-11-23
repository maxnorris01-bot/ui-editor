# ADR 0005: Engine hardening (reorder pins, remove's rules, line endings, neighbour selectors)

Status: accepted for the hardening round (2026-11-22). Rules, specs and pass line: `docs/hardening-rules.md` and amendment 1. Builds on ADR 0003
(pins) and ADR 0004 (content edits). Choices marked **(mine)** are the implementing agent's.

## Decisions

- **H1 Reorder remaps pins.** A linked reorder moves a subtree in document order, so element indexes and paths change. `reorderPins`
  (`engine/src/structure.ts`) computes the new index of every element (moved subtree to its new place, the rest in order), re-parses the patched
  text, checks the tag sequence, and re-points each pin with the same `remapPins` insert and remove use. A pin follows the moved element, the
  siblings it jumps over and the descendants of either. If the structure check fails the pins are left as they were (the old behaviour). An unlinked
  (CSS `order`) reorder moves nothing in the file and remaps nothing. `reorder` now returns `state` (the remapped pins). No other change to
  reorder: the 156 baseline exports are byte-identical.
- **H2 Remove takes an inserted element's rules (mine: how they are recognised).** An element is engine-inserted when it has a class
  `new-box-N`, `new-text-N` or `new-button-N` AND the rule `.CLASS` begins with exactly the engine's default declarations for that prefix. For such an
  element remove deletes its own rule and every rule, at any `@media`/`@supports` nesting, whose selector is only its `[data-ue="K"]` hook (an
  engine-written conditional rule is one line; a conditional rule that is not is never deleted). The element's `data-ue` attribute goes with it.
  So insert, any mix of `set` edits (linked or unlinked, both environments), remove returns the original bytes, and with two inserted elements
  removing one leaves exactly the other's bytes. **Page-authored rules are never deleted**: a page rule `.new-box-1 { ... }` with other
  declarations is kept (this fixes the merged remove, which deleted it). **Case B, an original element:** the override rules written for it (`#id`
  or `[data-ue]` rules) cannot be told from page-authored ones with certainty, so they are left (a known limit; spec H10).
- **H3 Line endings.** `eolAt(src, offset)`: the ending of the nearest existing line break (the one before the offset, else the first after, else LF).
  Every break the engine adds uses it: inserted lines, a note's typed line breaks, the header and page-note lines, a typed line break in a text
  edit, and every appended rule (`appendCss` now converts its LF text to the file's ending; `appendCssLF` is the old function). Mixed files are never
  normalised: each added break follows its neighbour. A rule appended to a file with no final newline is written after one break and without a
  trailing one. `listNotes` and the browser read a CRLF note back as LF (the parser normalises it).
- **H4 Neighbour selectors.** No engine change was needed: the browser-oracle specs (insert before/after and remove around `:nth-child`,
  `:first-child`, `:last-child`, `+` and `~`) passed on the merged engine. The scorer is new: the truth for "what else may change" is the
  browser's answer (`docs/hardening-rules.md` section 3).

## Edit shapes and result fields

Unchanged. `EditResult` for `reorder` now carries `state` with remapped pins (the page already passes `state` through `applyEditSteps`).

## Consequences

- One existing unit test (`engine/test/structure.test.ts`, "removes the element subtree and its engine rule") had a hand-written rule
  `.new-box-1 { width: 10px; }` that the old remove deleted. That is exactly the page-authored case H2 forbids and spec H11 locks, so the test's
  fixture rule now has the engine's real default declarations; its assertions are unchanged. This is flagged as a decision for Max.
- Engine size grew a little (see the report); speed thresholds hold.
