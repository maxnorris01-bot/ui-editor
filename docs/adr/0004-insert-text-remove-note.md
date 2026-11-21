# ADR 0004: Insert, text, remove and note edits (content edits) and a note convention for an AI

Status: accepted for the engine spike (2026-11-21). Rules, specs and the pass line: `docs/insert-comments-rules.md` and
`docs/insert-comments-rules-amendment-1.md`. Max's decisions of 2026-11-19 are the starting point; the choices marked
**(mine)** are the implementing agent's and are listed for Max in the session note.

## Context

Until now the engine changed properties of existing elements (`set`, `offset`, `reorder`). The editor page will get an Insert
menu (text box, rectangle, rounded rectangle, ellipse, button) and Comments: a note on any element that travels inside the
downloaded code as an HTML comment, so the AI chat that receives the code knows what the user meant (for example an inserted box
reading "Home" with the note "this will be the button that brings the user back to the home screen"). The spike proves, in the
engine alone, that four new edit kinds work and never damage the file.

## Decision

Four new `Edit` members, handled in `engine/src/structure.ts`; all are text patches against the current model (the file is never
re-printed), all apply at every screen width (`environment` and `link` are accepted and ignored) and create no pins:

- `{ op: 'insert', kind, anchor, placement }`: `kind` is `text` (a `<p>` reading "Text"), `rect` (`<div>`), `rounded` (`<div>`,
  radius 12px), `ellipse` (`<div>`, radius 50%) or `button` (`<button type="button">` reading "Button"). `placement` is `before`,
  `after`, `first-child` or `last-child` of the `anchor`: flow placement, no `position:absolute`, no coordinates. HTML only; SVG is
  refused (`svg-insert`).
- `{ op: 'text', target, text }`: replaces the element's text, keeping the whitespace around it.
- `{ op: 'remove', target }`
- `{ op: 'note', target | 'page', text }`: sets, replaces or (empty text) deletes the note of an element or the whole-page note.
- `listNotes(model)`: `{ page: { text } | null, notes: [{ index, path, text }] }` for a loaded file.

### Result fields the page needs

`EditResult` gains `selected?: number` (the new element's index in the model of the patched text, so the editor can select it) and
`className?: string` for `insert`. Three new DOM operations let the preview follow without re-parsing a parent: `insert`
(`insertAdjacentHTML` next to an element), `remove` (remove an element) and `css-remove` (take an appended rule out of the
preview's stylesheet). `text` reuses the `html` operation on the target.

### Safety, in the order the engine applies it

1. **Re-parse check.** Before an edit returns, the patched text is parsed again. For `insert` the new element must be exactly
   where it was asked to be (parent, position, class), the other elements must keep their tag and parent, and the element count must
   grow by one; for `remove` the structure must be the original minus the subtree; for `text` the structure must be unchanged; for
   `note` the structure must be unchanged and the comment must sit directly before its element with exactly the expected text.
   Otherwise the edit is refused with the true reason (`parser-moves-element`, `parser-reinterprets`, `note-misplaced`) and
   nothing changes.
2. **Escaping.** Typed element text has `&`, `<` and `>` turned into entities and nothing else; carriage returns become line
   feeds; NUL is refused (`invalid-character`). `<script>`, `</style>`, `"><img onerror>` and `&amp;` therefore appear
   literally.
3. **One neutralising rule for notes (mine):** every run of two or more hyphens gets a space between each pair (`--` becomes
   `- -`, `-->` becomes `- ->`, `<!--` becomes `<!- -`, `--!>` becomes `- -!>`); NUL removed, carriage returns normalised,
   nothing else touched (a note's spaces at its ends are kept). Written `<!-- NOTE FOR AI: TEXT -->` a leading `>` or `->` and a trailing `-` cannot break the comment, and XML
   comments (SVG) stay well-formed. The rest of the text is as typed.
4. **Refusals** (all with a structured code and message): `invalid-parent` (directly inside `table`, `thead`, `tbody`, `tfoot`,
   `tr`, `colgroup`, `select`, `optgroup`, `datalist`, `ul`, `ol`, `menu`, `dl`, `html`, or inside SVG/MathML), `void-element`,
   `raw-text-container`, `implied-anchor`, `unknown-kind`, `unknown-placement`, `parser-moves-element`; `text`: `mixed-content`,
   `has-comment`, `raw-text-element`, `void-element`, `self-closing`, `invalid-character`, `implied`; `remove`:
   `protected-element` (`html`, `head`, `body`, the SVG root), `implied`, `referenced` (an SVG element whose id is used by an
   `href`, `xlink:href` or `url(#id)` elsewhere); `note`: `implied`, `note-misplaced`. An unknown edit kind is refused
   (`unknown-edit`): before this change the SVG path sent any kind that was not `set` to the offset code and wrote `x="NaN"`.

### Insert details

- **Names (Max's decision; prefixes mine):** `new-box-N` (rect, rounded, ellipse), `new-text-N` (text), `new-button-N`
  (button). N is the smallest positive integer that no class attribute and no rule selector in the document already uses, so
  replay is deterministic and a page that already uses `new-box-1` gets `new-box-2`.
- **Styles:** one rule line appended to the page's last stylesheet by the same code the responsive override rules use
  (`appendCss`: the last `<style>` block, or the companion CSS; before a trailing source-map comment); if the page has no
  stylesheet, an inline `style` attribute. Never a new `<style>` block or file. Every inserted element carries
  `max-width: 100%`. When the stylesheet has no final newline, or the rule goes right before `</style>` on the same line, the
  rule is written without a newline of its own so that removing it restores the exact bytes.
- **Placement text:** whole lines (indented like the neighbour) next to a line-formatted neighbour; no whitespace invented
  next to a same-line neighbour. An anchor's note belongs to the anchor, so `before` goes above the note and `after` below the
  element.
- **Remove:** deletes the element's block (whole lines when it owns them) together with its note and with the engine's own
  `.new-*-N` rule when no other element uses that class, and deletes the header when it was the last note. Rules the responsive
  edits appended for an element (`#id` or `data-ue` override rules) are not removed with it.

### Notes

- A note is the comment `<!-- NOTE FOR AI: TEXT -->` directly before its element (decided on the source text: only
  whitespace between the comment and the start tag, because the parser puts a comment before the first element of a fragment
  at document level). One note per element plus one whole-page note `<!-- NOTE FOR AI (whole page): TEXT -->` (mine).
- The header (locked word for word) exists only while at least one note exists, after the DOCTYPE or XML declaration, else at the
  very start; the page note sits right after it. With no notes the export is byte-identical to a no-note export; deleting the last
  note deletes the header. A file that already contains the header keeps exactly one.
- **A note travels with its element**: `reorder` moves the note with the element (and lands before the neighbour's note), `remove`
  deletes it, and inserting before or after an element goes outside its note. This is the one change to existing code paths:
  `reorder` and `blockOf` now take the note into account; with no note present they behave and write exactly as before.

### Pins (measured, then fixed)

An unlinked edit pins by element path (`describe`). Insert and remove shift paths, so a pin could name the wrong element and a
later linked edit would scale a value it should have left alone (locked spec I33 measures this). `insert` and `remove` now
remap the pins in the edit-list state (a pin whose element was removed is dropped). **Reorder** also shifts paths and is **not**
remapped (outside the brief); see `docs/known-limits.md`.

## Consequences

- No change to existing behaviour or bytes: all 111 baseline exports are byte-identical (`harness/regress-insert.ts`).
- Engine size grew by the content-edit code (see the report for bytes); speed thresholds still hold.
- Unit tests for the new code use their own small pages (`engine/test/structure.test.ts`), not the locked fixtures.

## Alternatives considered

- Re-printing the document from a tree: rejected (the whole project is text patches).
- `position:absolute` with coordinates for inserts: rejected by Max (flow placement).
- Escaping `--` by removing hyphens or using entities in comments: rejected; comments have no entities, and a space keeps the
  readable text.
- Deciding which element a note belongs to from the parser's tree: rejected for the first element of a fragment (the parser
  hoists the comment); the source text is the truth the AI reads.
