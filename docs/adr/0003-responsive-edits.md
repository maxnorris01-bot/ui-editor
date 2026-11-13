# ADR 0003: Responsive (linked and unlinked) edits as element-scoped override rules

Status: accepted for the responsive iteration (2026-11-11). Rules and tests: `docs/responsive-rules.md`.

## Context

The real-page check showed the engine refused any edit to a property that is also set inside an
`@media` rule (R01 and R09). Max decided an edit is a ratio: a size changed while previewing one
width scales the page's own screen-specific values for the same element and property by the same
ratio; colours, families, weights, order, alignment and moves are not ratios and apply at every
width. An edit can also be **unlinked** (applies only in the environment it was made in, and pins
that value against later linked edits made in the other environment).

## Decision

Text patches only, as before. For a linked ratio edit on a property the page also sets in `@media`
rules, the engine appends **element-scoped override rules** to the page's last stylesheet (its last
`<style>` block, or the companion CSS), one for the base value and one inside each matching media
condition (same at-rule chain, including nested `@supports` and comma lists), carrying the scaled
value (the number multiplied, the unit kept). The page's own rules are never edited, so every other
element is untouched at every width.

- **Selector:** the element's existing `id` (`#a`) if it has a plain one, else a minimal added hook
  attribute `data-ue="N"` (the hook is part of the target's start tag in the diff). The selector is
  repeated (`#a#a`, `[data-ue="1"][data-ue="1"]`) until its specificity is at least that of every
  page rule it must beat; if that is impossible (a page id selector and an element without id) the
  edit is refused with that reason.
- **`!important`:** only when the page's own rule for that condition uses it, or an inline
  declaration has to be beaten (unlinked edits).
- **Base value placement:** an inline `style` beats any non-important media rule, so when the page
  has media rules for the property the base value goes into a scoped rule (ratio edits) or the
  element's inline style (non-ratio edits such as colour, which must win at every width). If the
  element already declares the property inline, that declaration is replaced in place.
- **Not scalable** (`calc`, `clamp`, `min`, `max`, `var`, `env`, keywords): copied verbatim into the
  scoped rule so the page's behaviour at that width is kept, plus a structured note
  `{property, condition, value, reason}`. Never guessed.
- **Ratio:** old computed value at the environment's width (1280 desktop, 390 phone) read from the
  live preview at that width; the new value must be px. Shorthands use per-side ratios (all numbers
  multiplied when the ratios agree; expanded to four values when they differ).
- **Unlinked:** one scoped rule inside `@media (max-width: Bpx)` (phone) or `@media (min-width:
  (B+1)px)` (desktop), B = the page's largest `max-width` px at or below 768, else 767. Because the
  rule only applies inside its environment, the other environment needs no companion rule. The
  value is pinned in the edit-list state (`{pins}`, pure data); a later linked edit in the other
  environment restates the pinned environment's value verbatim after the new base rule instead of
  scaling it. `listUnlinked(state)` returns the review list; the exported code carries no markers
  other than the `data-ue` hook where one is needed.
- **Moves:** linked offsets and reorders are unchanged. An unlinked offset is a translate inside the
  condition composed with the effective declared transform. An unlinked reorder is the CSS `order`
  property inside the condition, only for a flex or grid parent and only to the first or last
  position (changing the target's own `order` only); otherwise it is refused with that reason.
- **Preview:** a new DOM operation appends the same CSS text to the preview's stylesheet element, and
  the preview iframe can be resized, so the live preview behaves like the export at every width.
- **Edit lists:** `applyEditSteps(preview, edits, state)` decides each edit against the preview as it
  is after the earlier ones, so the scaling base is the current effective value. Replaying the same
  list gives the same export.

## Alternatives considered

- Editing the page's own `@media` rules in place: smaller output for single-element rules, but it
  changes bytes outside the target and risks shared rules; rejected by the brief's "only the
  selected element may change at any width".
- Inline `style` plus `!important` overrides: would use `!important` where the page does not.
- A second pair of conditions for every unlinked edit: unnecessary, since a rule scoped to one
  environment leaves the other untouched.

## Consequences and limits

Only width media features are evaluated. width and height are never scaled (applied at every width,
with a note). Conditions that span both environments are scaled but not pin-protected. Linked offsets
and reorders still refuse when a media rule sets `transform`. Appended lines go before the closing
tag of the last `<style>` block; a one-line `<style>` block changes that line.

## Amendment (iteration 2, 2026-11-12)

Where the last stylesheet (the last `<style>` block or the companion CSS) ends with a
`/*# sourceMappingURL=... */` comment, optionally followed only by whitespace, the appended rules go
immediately before that comment, on their own lines if the comment is on its own line. The comment
stays the last thing in the file and no existing line changes. Known limit: a file with no such comment
and no trailing newline still gets the old behaviour (a newline, then the rules), which changes that
file's last line in a line diff. `freelancer-index`'s `css/styles.css` is exactly that case.
