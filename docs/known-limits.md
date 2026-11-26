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

## Three views: Desktop, Tablet, Phone (2026-11-25)

- **Desktop edits reach the small views in proportion.** Changing a size on Desktop scales the page's own Phone (and Tablet-range) values by the same ratio; colours, fonts, order and text apply as they are.
- **Edits made in Phone or Tablet are custom to that view.** They apply only inside that view's own width range (Phone: up to the page's phone breakpoint B; Tablet: from B+1 up to T, the page's own largest
  `max-width` between 769 and 1100 px, else 1024) and are never carried to Desktop or the other small view. The old behaviour "an edit made in Phone with Link on also scales Desktop" is gone for Phone and
  Tablet; the Link flag is ignored there. A later Desktop edit does not change a view's custom value, and still reaches everything else.
- **Reset a view** (`resetView`) drops every custom edit of that view and nothing else; the file then equals one that never had them. Desktop cannot be reset. Insert, text, remove and note edits are never dropped.
- **A page whose own phone breakpoint is 768 has no Tablet range** (the Tablet frame's 768 px is already a phone width): a Tablet edit is refused (`tablet-covered-by-phone`), a Phone edit covers 768. Of the engine's
  14 fixture pages one is like this; none of the five real pages is.
- **Width and height** scale the declared Phone value, the Desktop value and a length declared only for the tablet range (inside its own media condition) by the same ratio. A tablet-range length declared as
  anything but a fixed px, rem or em length is left alone with a note.
- **A Desktop edit of a non-ratio property** (colour, font-family, font-weight, text-align, ...) that is also custom in a view works: the Desktop value is written as before and the view's own rule is
  written again after it, inside its own media condition and with `!important` (the Desktop value is an inline style, which beats ordinary rules), so the view keeps its value and every other view follows.
  The `pinned-conflict` refusal no longer exists. After a Reset of that view the later Desktop edit stays and the file equals one built without the dropped edits.
- **Fractional breakpoints** (a Bootstrap-style page with 575.98, 767.98 and 991.98) work: B and T are read as written, the Tablet range starts at the first whole width above B (576) and ends at T (991.98).
  A `max-width: 767.98px` condition would make B = 767.98 (as for the freelancer page); the follow-up fixture uses 767.98 only as a `min-width`.
- **Tablet and Phone offsets and reorders** keep the unlinked rules and limits (a reorder in a small view only places an element first or last among siblings whose `order` values are all equal, in a flex or grid parent).

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

## Insert, text, remove and notes (content edits, 2026-11-21)

These four edits (`docs/adr/0004-insert-text-remove-note.md`) add an element, change an element's text, delete an element and attach
a note for an AI. They apply at every screen width and ignore the Link switch.

- **Insert is HTML only, and only in document order.** A new element goes before, after, first inside or last inside an anchor
  element; there are no coordinates and no `position: absolute`. Inserting into an SVG file refuses (`svg-insert`).
- **Five kinds, fixed defaults:** text (a paragraph reading "Text"), rectangle, rounded rectangle, ellipse (boxes of 200 by 120 px,
  grey) and a real button (`type="button"`, reading "Button"). Every one carries `max-width: 100%` so it cannot push a phone
  sideways. Changing the default look is a later job.
- **Where an insert refuses** (it says why and changes nothing): directly inside a table, table row, list, `select` or `<html>`
  (`invalid-parent`); inside a void element such as `<br>` or a raw-text element such as `<script>` (`void-element`,
  `raw-text-container`); next to or inside an element the parser invented (`implied-anchor`); anywhere the HTML parser would move
  the new element, for example a `<div>` inside a `<p>` (`parser-moves-element`).
- **Names and styles.** The new element gets a class `new-box-N`, `new-text-N` or `new-button-N` (the smallest number nothing in
  the page already uses). Its styles are one rule appended to the page's last stylesheet (the last `<style>` block or the linked
  CSS); with no stylesheet they go in an inline `style` attribute. If the last `<style>` block is not closed the styles go inline.
- **Text edit** works on an element that holds only text: the text is replaced and the spaces around it stay. It refuses an element
  with child elements (`mixed-content`), one that contains a comment (`has-comment`), script, style, `textarea`, `title`, `pre`
  and similar raw-text elements (`raw-text-element`), and a self-closing SVG element (`self-closing`). `&`, `<` and `>` are
  written as entities; carriage returns become line feeds; a NUL character is refused.
- **Remove** takes the element, its note and, for an element the engine inserted, every rule the engine wrote for it: its own rule and any
  override rule from later size, spacing, font or colour edits, linked or unlinked (so insert, edits, remove gives back the original file).
  The engine recognises its own element by its class (`new-box-N`, `new-text-N`, `new-button-N`) AND its rule starting with the engine's default
  declarations, so a page-authored rule that merely has such a class name is never deleted. **For an ORIGINAL element** the override rules earlier
  edits wrote for it (`#id` or `[data-ue]` rules) cannot be told from page-authored ones with certainty, so they stay in the file as harmless dead rules.
  In a stylesheet with no final newline a later edit's rule line gets a trailing newline (existing behaviour), so insert, edit, remove there leaves
  one extra final newline. Remove does not check that something in an HTML page still links to the removed element's id (`#section`); an SVG
  element that another element references (`<use>`, `url(#id)`) refuses (`referenced`). It refuses `html`, `head`, `body` and the SVG root
  (`protected-element`).
- **Notes.** A note is the comment `<!-- NOTE FOR AI: ... -->` directly before its element, with one header comment after the DOCTYPE
  (or XML declaration, or at the start) while at least one note exists. One note per element plus one whole-page note. Empty (or
  blank) text deletes the note. A hand-written comment is only recognised as a note if it is spelled exactly like that; a note
  followed by text instead of the element is not attached to anything.
- **Notes are made safe, not copied.** A run of two or more hyphens in a note gets a space between each pair (`--` becomes
  `- -`), so the comment can never end early; the AI reading the file sees `- -` where the user typed `--`. Everything else
  (line breaks, `<script>`, emoji) stays as typed and is inert inside a comment.
- **A note travels with its element** when it is reordered or removed; an unlinked (phone-only or desktop-only) reorder only
  changes the CSS `order` and moves nothing in the file.
- **Pins after structural edits.** Inserting, removing or reordering an element shifts the paths unlinked edits are recorded under; the engine
  remaps them so a pin follows its element (a pin of a removed element is dropped). An unlinked (phone-only or desktop-only) reorder only changes the
  CSS `order` and moves nothing in the file.
- **Line endings.** A file with CRLF line breaks stays CRLF: every break the engine adds (inserted lines, a note's line breaks, the header, an appended
  rule, a typed line break in a text edit) uses the ending of the nearest existing break, so a mixed file is never normalised and a file with no final
  newline gets none. A note typed with line breaks in a CRLF file is written with CRLF and read back as LF by `listNotes` (and by a browser). A file with
  no line break at all gets LF. **(unsure)** old Mac line endings (a lone CR) were not tested.
- **Neighbour selectors.** Pages whose CSS uses `:nth-child`, `:first-child`, `:last-child`, `+` or `~` restyle neighbours when an element is inserted
  or removed. That is the browser's own behaviour and the engine writes only the edit; the hardening specs compare the export with the browser's answer
  for an inserted or removed element (a fixture with all five kinds of rule agrees).
- **Not checked:** inserting into `<pre>`, `<textarea>`-like or custom-element content; very large
  documents beyond the speed fixtures.

## What was and was not tested

- Chromium only (headless Playwright, JavaScript off, 1280 by 800 and the responsive widths).
- Ten fixtures written by the same agent as the engine; five real files from other authors (two email
  templates, a Bootstrap one-page site, two SVGs); 20 responsive specs on nine fixtures.
- Targets were chosen by Claude Code, not by a visitor. No real pointer interaction and no UI exist yet.
- The licences of the two Wikimedia SVGs were not verified; that matters only if they were redistributed.
- Speed was measured on one machine; thresholds are in `docs/speed-thresholds.md`.
- Gate history: engine gate 40 of 40; real-page run 1 FAIL (harness bugs), run 2 18 PASS and 2 true refusals; responsive run 1 FAIL
  (R01 and R09); iteration 2 FAIL (R09); the re-score applies two post-hoc amendments (E4 and E5).
