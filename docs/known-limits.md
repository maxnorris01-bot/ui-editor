# Known limits (for the future README)

Collected from every gate so far: the engine gate (40 edits, 10 fixtures), the real-page check (5 real
files), and the responsive iterations (run 1, iteration 2, re-score). Sources: `docs/checkpoint.md`,
`docs/gate-rules.md`, `docs/realpage-rules.md`, `docs/responsive-rules*.md`, `docs/adr/0002` and
`0003`, the session notes, the refusal codes in `engine/src/`, and the `results/` folders. Nothing
here was invented; items I am not sure about are marked **(unsure)**.

"Refuses" means the engine returns a structured refusal with a plain reason and changes nothing.
"Notes" means it makes the edit and reports what it left alone. "Applies everywhere" means the edit
takes effect at every screen width.

## Screen sizes and media queries

- **Only width conditions are understood.** The engine reads `max-width` and `min-width` (px, em, rem)
  inside `@media`. Other features (`prefers-color-scheme`, `print`, `orientation` and so on) are treated as
  not matching. A visitor whose page styles dark mode or print differently will find those rules untouched
  and unscaled. Nothing is refused. **(unsure)** how the page behaves for features only partly
  understood; no gate tested them.
- **Two environments only.** Edits are made as "desktop" (previewed at 1280 px) or "phone" (390 px). The
  phone breakpoint is the page's largest `max-width` at or below 768 px, otherwise 767. A page with several
  breakpoints gets one pair of conditions; in-between widths follow the page's own rules.
- **Conditions that span both environments** are scaled but are not protected by pins (a later unlinked
  edit does not freeze them).
- **Offsets and reorders that meet a media rule on `transform`** refuse (`transform` set in a media rule is
  not composed with).
- **Real-page results:** before the responsive work, a font-size edit on two real pages was refused because the
  page set that size inside `@media` (`conditional-rule`). The responsive path now handles size and spacing in
  `@media`. **(unsure)** whether the `conditional-rule` refusal still fires for other properties; the code is
  still present and I did not test those.

## Which properties scale

- **Scaled by ratio** (linked edits): `font-size`, `padding` and `margin` and their sides. Each number in
  the page's own rules is multiplied; units and keywords stay.
- **Not scaled; applies everywhere:** colour, font-family, font-weight, alignment, offsets and reorders.
- **`width` and `height` follow the ratio where the other screen size declares a fixed length**
  (px, rem, em, or an HTML `width`/`height` attribute). The other size is multiplied by the same ratio.
  Percentages, `auto`, `vw`/`vh`, `calc()`/`clamp()`/`min()`/`max()`/`var()`, keywords and "not declared"
  are left alone: the new size applies only to the screen size being edited and the engine notes which one
  was left alone. Every px width also gets `max-width: 100%` (so it cannot overflow a phone), unless the
  element already has its own `max-width`. Height gets no such guard.
- **Size edits: limits.** Only the declaration that wins at 390 px (phone) or 1280 px (desktop) is read, so
  other breakpoints inside the same screen size are not scaled. `min-width`, `max-width`, `min-height`,
  `max-height` and `aspect-ratio` are never changed. A page rule that uses `!important` on the size refuses
  (`important-conflict`). A non-px new value, or a page with no stylesheet at all, falls back to applying at
  every width with a note.
- **Flex items:** a width edit (or a height edit in a column container) on a flex item with a non-auto
  `flex-basis` also writes `flex-basis`, because the basis beats the width on the main axis. Where the other
  screen size has a fixed px, rem or em basis it is scaled by the same ratio; a flexible basis (`%`, `content`, a
  function, `var()`) is left alone with a note. Unlinked size edits on such an item write the basis too.
  **A flex item that can grow (`flex-grow` above 0, for example `flex: 1`) is refused** (`flex-grow`): the
  container, not the size, would decide how large it is, and `flex-grow: 0` would also change how its siblings
  share the space. `flex-shrink` is not touched, so a shrinkable item can still end up smaller than the size
  asked for in a narrow container. Flex items with an `auto` basis, and grid items, are handled like any other
  element. **(unsure)** how an item with `flex-wrap` and a basis larger than its line behaves; not tested.
- **Values it cannot scale** (`calc()`, `clamp()`, `min()`, `max()`, `var()`, `env()`, keywords such as
  `auto`) are copied as the page wrote them and reported in a note (one of the 20 responsive specs, S06).
- **The new value must be in px** so a ratio can be derived. Other units are refused (`ratio-unit`). A zero or
  unknown old value also refuses (`ratio-base`).
- **`!important`:** if the page's own rule uses `!important`, the engine refuses when it could not win
  (`important-conflict`) and otherwise uses `!important` only where the page's media rule does.
- **Shorthand and longhand mixes** (for example `padding` with `padding-left` on the same element) refuse
  (`shorthand-mix`). Only a shorthand against its own longhands counts; `font-size` and `font-family` do
  not conflict.

## Moves

- **Offsets under a transformed ancestor** refuse (`transformed-ancestor`), because a screen shift cannot be
  written as a plain translate there. A degenerate transform (zero scale) refuses (`singular-matrix`).
- **Offsets on `display: inline` elements** refuse (`not-transformable`): CSS transforms do nothing there.
  Making it `inline-block` first is the suggestion.
- **An element that sets `transform` in its own style attribute** refuses for phone-only offsets
  (`inline-conflict`) and for the plain case (`transform-in-style`).
- **Reorders** only work between siblings of the same parent (`different-parents`) and not against
  itself.
- **Phone-only or desktop-only reorder** uses the CSS `order` property, so it needs a flex or grid parent
  at that width (`order-needs-flex-or-grid`, as in spec S17, where the parent was `display: block`),
  can place the element only first or last (`order-position`), and refuses if the siblings already have
  different `order` values (`order-values-differ`).
- **SVG:** phone-only or desktop-only edits are refused (`svg-unlinked`); SVG has no media-scoped attribute.

## Selectors, ids and shared styles

- **Element-scoped rules:** the engine writes override rules with the element's `id`, or adds a
  `data-ue` attribute hook when there is no id. If a page rule with an id selector already wins for an element
  with no id, an attribute hook cannot beat it and the engine refuses (`specificity`).
- **Elements the parser invents** (for example an implied `tbody`, or a parent with no source text) cannot be
  edited or used as an anchor (`no-source`, `implied-parent`, `no-sibling`).
- **Shared class rules:** the engine edits only the selected element, never a shared rule. When a shared rule
  is where the value lives, it writes an override for that element (inline or as a scoped rule). **(unsure)**
  exactly which form is used in each case; both kinds passed the gates.
- **SVG elements shared through `<use>` or `<defs>`** refuse (`shared-instance`), because editing one would
  change every instance.
- **SVG styled by a `<style>` rule** (not an attribute or style attribute) refuses (`svg-stylesheet`).
- **An unquoted or valueless `style` attribute** refuses (`style-unquoted`, `style-valueless`) rather than guess.

## Stylesheets and files

- **Rules are appended** to the last `<style>` block, or to the companion stylesheet if there is no
  `<style>`. A page with no stylesheet, or whose last `<style>` is not closed, refuses (`no-stylesheet`).
- **Source-map comment:** if the stylesheet ends with `/*# sourceMappingURL=... */`, new rules go before it.
- **A stylesheet with no final newline** gets a newline and then the new rules. In a plain line diff the old
  last line shows as changed even though its text is the same. The scoring accepted this by amendment 2 (the
  check treats that one end-of-file newline as unchanged). A user's `git diff` will still show it.
- **One-line `<style>` blocks:** appended rules change that line.
- **Companion CSS has to be supplied.** The engine edits CSS the visitor pasted or uploaded. A stylesheet that
  lives only on the web (for example a CDN Bootstrap link) is not fetched and is not edited.
- **Everything is text patches.** Whitespace, comments, case and quoting outside the edit stay identical;
  the engine never re-writes the whole file. Pages that the parser reads differently from a browser
  (broken markup) are the parser's reading. **(unsure)** how SVG that is valid only as XML is split, since
  SVG goes through the HTML parser.

## Preview, JavaScript and fonts

- **Scripts never run.** The preview is a sandboxed frame with JavaScript off. Anything a script builds,
  moves or styles after load is not in the preview and cannot be edited. A script that changes the page at
  run time may make the exported page look different from the preview. **(unsure)** no gate tested
  script-driven pages beyond an inert inline script in one fixture.
- **External fonts, images and CDNs** were blocked in every measurement, so text uses fallback fonts; sizes
  of text in real web fonts were not measured.
- **React, Vue, bundled or minified app code is not supported.** The tool edits static HTML and SVG source,
  not framework components or build output. **(unsure)** this is a design boundary from the project brief, not
  something a gate tested.

## What was and was not tested

- Chromium only (headless Playwright, JavaScript off, 1280 by 800 and the responsive widths).
- Ten fixtures written by the same agent as the engine; five real files from other authors (two email
  templates, a Bootstrap one-page site, two SVGs); 20 responsive specs on nine fixtures.
- Targets were chosen by Claude Code, not by a visitor. No real pointer interaction and no UI exist yet.
- The licences of the two Wikimedia SVGs were not verified; that matters only if they were redistributed.
- Speed was measured on one machine; thresholds are in `docs/speed-thresholds.md`.
- Gate history: engine gate 40 of 40; real-page run 1 FAIL (harness bugs), run 2 18 PASS and 2 true refusals; responsive run 1 FAIL
  (R01 and R09); iteration 2 FAIL (R09); the re-score applies two post-hoc amendments (E4 and E5).
