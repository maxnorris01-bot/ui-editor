# Insert and Comments engine rules (LOCKED)

Locked in the commit `docs: lock insert and comments engine rules, fixtures and specs`. After that commit this file,
`fixtures/insert/*` and `fixtures/insert/edits.json` are never edited. If a definition turns out wrong, it is recorded in
the report and in `docs/working-notes-and-decisions.md`, and Max decides; a flaw found before anything is scored means a
re-lock as a new commit (first lock kept, corrections logged as numbered amendments). The gate, real-page, responsive and
size rules and their amendments stay in force. Nothing here calls an LLM or a paid service. Sections marked **(mine)** are
operational definitions written by the implementing agent; the rest is the brief's wording
(`~/Desktop/Projects/ui-editor-insert-engine-brief.md`) and Max's decisions of 2026-11-19.

Question: **can the engine, alone, add new elements (insert), change an element's text (text), delete an element (remove)
and attach a comment for an AI to an element or to the page (note), always by patching the visitor's own text, without
changing a byte outside the change and without any text becoming markup?**

## 1. The four edit kinds

All four apply at every screen width: they ignore `environment` and `link`, create no pins and no unlinked-list entries.
Each returns the usual `EditResult` (text patches against the current model, the DOM operations the preview needs, warnings,
a placement string) and never re-prints the file.

- **insert** (HTML only): `kind` is one of `text` (a `<p>` reading "Text"), `rect` (`<div>`), `rounded` (`<div>`, border
  radius), `ellipse` (`<div>`, radius 50%), `button` (a real `<button type="button">` reading "Button"). The new element goes
  into normal document order next to an `anchor` element: `before`, `after`, `first-child` or `last-child`. No
  `position:absolute`, no coordinates. SVG insert is refused (`svg-insert`).
- **text**: replace the text of an element (`target`, `text`).
- **remove**: delete an element (`target`).
- **note**: set, replace or delete the note of an element, or the page note (`target` is an element or `page`; empty text
  deletes).

Also `listNotes(model)`: every note in a loaded file (the element it belongs to, its text, the page note).

### Names (Max's decision; exact prefixes mine)

Class `new-box-N` (rect, rounded, ellipse), `new-text-N` (text), `new-button-N` (button). **(mine)** N is the smallest
positive integer such that neither a class token nor a rule selector in the document (all stylesheets of the model) already
uses `PREFIX-N`; found by scanning, so replay is deterministic.

### Styles of an inserted element

A rule appended to the page's last stylesheet (the last `<style>` block or the companion CSS, the same place the responsive
override rules go); if the page has no stylesheet at all, an inline `style` attribute on the element. Never a new `<style>`
block or file. Defaults are sensible and cannot overflow a 390 px phone: every inserted element carries `max-width: 100%`.
**(mine)** the declarations: box kinds `box-sizing: border-box; width: 200px; max-width: 100%; height: 120px; background:
#d9d9d9; border: 1px solid #999999;` plus `border-radius: 12px` (rounded) or `50%` (ellipse); text `max-width: 100%;
overflow-wrap: break-word;`; button `box-sizing: border-box; max-width: 100%; padding: 8px 16px; font: inherit; cursor:
pointer;`. A stylesheet rule is one line, `.new-box-1 { ... }`, written the way the responsive path writes its lines. In a
companion CSS that has no final newline the rule is appended after one newline and the file still has no final newline, so
that removing the rule can restore the exact original bytes.

### Notes (Max's decision)

An HTML or XML comment placed directly before its element; the text starts `NOTE FOR AI: `. **(mine)** the comment is
written `<!-- NOTE FOR AI: TEXT -->` (one space inside each end), so a browser's comment data is ` NOTE FOR AI: TEXT `. A
note belongs to an element when the comment is the closest preceding sibling node with only whitespace between them.

A header comment explains the convention and exists only while at least one note (element note or page note) exists; with no
notes the export is byte-identical to a no-note export. The header text is locked word for word:

`Exported from UI Editor. Comments starting "NOTE FOR AI:" are the designer's instructions for the element that follows. Implement them.`

written `<!-- HEADER -->`. It sits after the DOCTYPE or XML declaration if there is one, else at the very start of the file.
A page-level note (target `page`) sits right after the header and starts `NOTE FOR AI (whole page): `. One note per element
(setting again replaces it; empty text deletes it) plus one page note (mine).

**(mine) formatting.** A comment placed at a line start is a whole line (`indent + comment + EOL`), indented like the element
it precedes; a comment placed in the middle of a line is inserted with no whitespace invented. The header goes on its own line
when it is placed at a line start (after the declaration's line break, or at offset 0), and directly after the declaration
when the declaration is followed by other text on the same line. Deleting a comment removes its whole line when it has one to
itself, else only the comment. Deleting the last note also deletes the header; a file that already contains the header (and
no notes) keeps it until a note edit deletes the last note. The header is recognised by its exact text.

**A note travels with its element**: reorder moves the note with it (the note is part of the element's block); remove
deletes it; insert before or after an element goes outside the element's note.

### Comment text safety (neutralising rule, mine)

The text of a note can never end or break a comment. **One stated rule:** every run of two or more consecutive hyphens gets
a single space between each pair of hyphens (`--` becomes `- -`, `---` becomes `- - -`, `-->` becomes `- ->`, `<!--` becomes
`<!- -`, `--!>` becomes `- -!>`). Because the comment is `<!-- NOTE FOR AI: ` + text + ` -->`, a leading `>` or `->` and a
trailing `-` cannot close or break it. NUL characters are removed and carriage returns are normalised to line feeds; the
readable text is otherwise unchanged (line breaks, `&`, `<script>`, `</style>`, emoji and non-Latin text stay as typed). XML
comments in SVG forbid `--` entirely; the rule removes every `--` from the text.

### Text safety (mine)

Inserted or edited element text is escaped: `&` becomes `&amp;`, `<` becomes `&lt;`, `>` becomes `&gt;`; nothing else is
changed. `<script>`, `</style>`, `"><img onerror>` and `&amp;` therefore appear literally and never become markup.
Carriage returns are normalised to line feeds and NUL is refused (`invalid-character`).

### Refusals (structured, a true reason, no change)

| code | when |
|---|---|
| `svg-insert` | insert into an SVG document |
| `invalid-parent` | the new element would sit directly inside `table`, `thead`, `tbody`, `tfoot`, `tr`, `colgroup`, `select`, `optgroup`, `datalist`, `ul`, `ol`, `menu`, `dl` or `html` (the parser moves or drops it, or the list/table content model forbids it) |
| `parser-moves-element` | re-parsing the patched text shows the new element's parent, position or the other elements' sequence differ from what was asked |
| `void-element`, `raw-text-container` | the container is a void element, or `script`, `style`, `textarea`, `title` |
| `implied-anchor` | the anchor or container is created by the parser and has no source text |
| `mixed-content` | `text` on an element with child elements |
| `has-comment` | `text` on an element whose content holds a comment |
| `raw-text-element` | `text` on `script`, `style`, `textarea`, `title`, `pre`, `listing` |
| `protected-element` | `remove` of `html`, `head`, `body` or the document root of an SVG |
| `implied` | `remove` or `note` on a parser-implied element |
| `referenced` | `remove` of an SVG element whose id is used by `href`/`xlink:href`/`url(#id)` elsewhere |
| `note-misplaced` | re-parsing the patched text does not show the note directly before its element |
| `invalid-character` | NUL in typed text |

### Pins (mine)

An unlinked edit pins by element path (`describe`); insert, remove and reorder shift paths. The engine must remap the pins on
structural edits (and drop a pin whose element was removed) so that `listUnlinked(state)` and later linked edits name the
right element. Locked spec I33 measures this.

## 2. "Outside the change is untouched" (mine)

For every export the harness removes the permitted regions and compares what is left with the original, byte for byte:

- **Permitted regions** of an additive edit (insert, note): the new element (found by its class), the appended rule (found by
  its selector `.CLASS`), every comment whose data starts ` NOTE FOR AI` or equals the header. A region that occupies whole
  lines alone is removed together with its line break (and leading blanks); otherwise only the region itself. When the file
  had no final newline, an appended rule at the very end is removed with the one newline before it.
- `format: lines` additionally requires that the element or comment region did occupy whole lines; `format: inline` requires
  that it shared a line and that removing only its exact text restores the original (no whitespace invented).
- A line diff (jsdiff `diffLines`; `diffChars` for `format: inline`) of original against export has **no removed lines or
  characters** (only additions), so a changed neighbouring line, an extra space or a re-indented line fails.
- For text, remove and reorder the harness states the exact change: `replace` (a literal from the original replaced by a
  literal, the only change), `removed` (literal blocks deleted, the only change), `innerOf` (everything outside the inner text
  of the named elements is equal), `moveBefore` (a block moved before a line, after stripping notes), `equals-original`.
- Mixed ordered lists (set, reorder with insert/remove) are not byte-compared (`bytes: none`): they are checked by the
  created element, the removed element, the notes, the order, the measured values, notes-off, replay and undo (section 3).

## 3. The independent checks

Chromium via Playwright, headless, never Max's Chrome; JavaScript off, other hosts aborted; the verdict never reads the
engine's own model. Each spec's `expect` declares what is checked; a check is run only when declared.

- **A created element:** the export has exactly one match for the new selector, with the stated tag, the stated parent and
  position among its parent's element children, exactly the expected text, and the stated attributes (`type="button"`).
  `gone`: no match. `elementDelta`: the element count changes by that number. `textEquals`: `textContent` equals the typed
  string preceded and followed by the original element's own surrounding whitespace, exactly.
- **B bytes:** section 2.
- **C collateral:** at 1280, 1024, 768, 390 and the page's `(min|max)-width` media breakpoints and breakpoint + 1 (767 and
  768 when the page has none), every element other than the structural site has the same computed styles and bounding box in
  the export as in the original (tolerance 0.5 px for sizes, 1 px for boxes; pairing skips the created or removed elements),
  and the page has no horizontal overflow (the export's `scrollWidth` is at most the larger of the viewport width and the
  original's `scrollWidth`; the table email and the SVG chart already overflow a 390 px viewport). **Legit differences:**
  `legit: none` (notes) allows nothing; `text` and `insert` allow bounding box and layout-resolved properties (`width`,
  `height`, `inline-size`, `block-size`, `perspective-origin`, `transform-origin`) on the ancestors of the site, its parent's
  whole subtree, the following siblings of the parent and of every ancestor (and their descendants), and preceding siblings
  in the same table row or flex or grid container (amendment 1 to E4); `remove` the same around the removed slot. Any other
  difference fails.
- **D hostile strings:** the export has no new element beyond the declared ones, no more `script` nodes than the original,
  exactly one new `Comment` node per note (plus one for a header that appeared), an SVG export parses as well-formed XML
  with no parser error, and a text edit's `textContent` is exactly the typed string.
- **E notes:** read back through the browser's comment nodes: the comment directly before each target equals
  ` NOTE FOR AI: ` + the declared read-back text + ` `; the page note equals ` NOTE FOR AI (whole page): ` + text + ` `
  and sits right after the header; the number of header comments equals `headerCount` and it is the first node after the
  DOCTYPE (`headerAfter: doctype`) or the first node of the document (`start`). The declared read-back texts are written by
  hand in the spec (the neutralising rule applied by me, not by the engine). `listNotesOriginal` and the list for the export
  are compared with the engine's `listNotes`.
- **F undo, replay, round trip:** (`undo`) replaying the first n-1 steps of the list in a fresh preview gives exactly the
  bytes the full run had after step n-1, for every n; replaying the full list twice gives identical bytes; (`notesOff`) the
  same list with every `note` step removed equals the full export with every note comment and the header stripped by the
  rules of section 2; every export parsed and exported with zero edits is byte-identical to itself.
- **Preview equals export (mine):** the preview after the steps and the exported file measure the same (1 px) for the created
  element's box and the document height at 1280 and 390.
- **Measured values** (`measured`): computed values of a selector at every test width (`hi` = widths above the page's
  phone breakpoint, `lo` = at or below it), within 0.5 px. **Order:** the ids of a parent's element children in document order.
  **Unlinked list:** `listUnlinked(state)` after the last step equals the declared list.

E1 (loads) holds for every PASS spec: the export loads in Chromium with no new errors, the engine re-parse reports no more
parse errors than the original, and the element count is the original's plus the net created minus removed.

## 4. Outcomes

Each spec (an ordered list is one unit) is **PASS** (it declared PASS and every declared check holds), **REFUSED-as-declared**
(it declared REFUSED, the engine refused with exactly the declared code on the last step, the earlier steps succeeded and the
export of the earlier steps is unchanged because nothing was written; the reason is verified by reading the fixture), or
**FAIL** (anything else, including an uncaught exception, a refusal with another code, or a refusal where a PASS was
declared).

## 5. Pass line

1. Every I-spec meets its declared outcome, 0 FAIL (a REFUSED spec passes only with the declared reason, verified by reading
   the fixture). There are 36 specs (I01 to I36).
2. Regression: gate 40/40, real-page 20/20, responsive 19 PASS + 1 REFUSED, size specs unchanged (16 PASS; Z17 to Z21 PASS and
   Z22 REFUSED), every existing edit exports byte-identical to the baseline saved in Step 1 (hashes in `results/insert/`).
3. All no-op round trips byte-identical (the existing 34 plus the 11 new fixture files).
4. Speed thresholds (`docs/speed-thresholds.md`) still met.
5. `npm test` (engine unit tests, including the new ones that do not use the locked fixtures): no fewer than the baseline plus
   new, 0 failing; typecheck, lint and build clean.
6. The scorer check (Step 1) passed.
7. Locked files byte-identical to their lock commit (this file, `fixtures/insert/*`).
8. One complete final run on the final commit.

Decided in advance: any miss means the iteration FAILS; no tuning; name the cheapest next test; changes after the scored run
are labelled iterations and both runs stay on record. A failing scorer control stops the round: report to Max before building.

## 6. Fixtures and specs

Fixtures (`fixtures/insert/`): `landing.html` + `landing.css`, `email.html`, `chart.svg` (the three built-in samples,
byte-identical copies from `portfolio-site/src/ui-editor/samples`), and hand-written `style-only.html` (a `<style>`-only
page with a list and a 640 px phone rule), `no-style.html` (no stylesheet), `collision.html` (already uses `new-box-1`),
`inline.html` (same-line neighbours), `header-present.html` (the header text and one note already present, plus a plain
comment), `hostile.html` (14 paragraphs for hostile strings), `pins.html` (four paragraphs with a 640 px phone rule).

The hostile list (14, in order): `-->`, `--`, `--!>`, `<!--`, a leading `>`, a leading `->`, a trailing `-`,
`<script>alert(1)</script>`, `</style>`, `"><img src=x onerror=1>`, `&amp;`, emoji and non-Latin text, a 5,000 character text,
and a text with line breaks.

| spec | case | fixture |
|---|---|---|
| I01 | insert text after `.lead`; rule in the companion CSS | landing |
| I02 | insert rect before the first card (flex row) | landing |
| I03 | insert rounded as first child | landing |
| I04 | insert ellipse as last child of the footer | landing |
| I05 | insert button after the CTA link | landing |
| I06 | rule lands in the page's `<style>` block | style-only |
| I07 | no stylesheet: inline style | no-style |
| I08 | `new-box-1` taken: picks `new-box-2` | collision |
| I09 | same-line neighbour: no whitespace invented | inline |
| I10 | insert inside a table cell: PASS | email |
| I11 | insert directly inside `<tr>`: REFUSED `invalid-parent` | email |
| I12 | SVG insert: REFUSED `svg-insert` | chart |
| I13 | `div` first child of a `p`: REFUSED `parser-moves-element` | landing |
| I14 | insert directly inside `<ul>`: REFUSED `invalid-parent` | style-only |
| I15 | text edit on a paragraph, `& < >` escaped | landing |
| I16 | empty text on a table cell | email |
| I17 | text edit on an SVG `<text>` | chart |
| I18 | text on an element with child elements: REFUSED `mixed-content` | landing |
| I19 | hostile text strings | hostile |
| I20 | remove a line-formatted element | landing |
| I21 | remove an element with a note (header goes too) | landing |
| I22 | insert then remove: original bytes | landing |
| I23 | remove `body`: REFUSED `protected-element` | landing |
| I24 | remove an SVG element | chart |
| I25 | note before an element; header once after the DOCTYPE | landing |
| I26 | second note adds no second header | landing |
| I27 | deleting the last note: original bytes | landing |
| I28 | page note right after the header; replacing a note | landing |
| I29 | note on an SVG element; header at the very start | chart |
| I30 | the note travels with a reorder | landing |
| I31 | hostile notes (HTML) | hostile |
| I32 | hostile notes (SVG) | chart |
| I33 | pins stay right across inserts and a remove | pins |
| I34 | linked font-size edit on an inserted element | style-only |
| I35 | `listNotes` on a file already holding notes; no second header | header-present |
| I36 | mixed list; notes-off; undo by replay | landing |

Insert, remove and reorder paths in I33: the final path of `#t4` is `/html[1]/body[1]/div[1]/p[5]` (two inserted paragraphs
before `#t1`, `#t2` removed). The pinned phone value of `#t2` must be dropped when `#t2` is removed.

## 7. Limits stated in advance (mine)

- Insert is HTML only, flow placement only; SVG insert, absolute placement and coordinates are out of scope.
- Rules the engine appended for other edits to a removed element (`#id` or `data-ue` override rules) are not removed with it;
  only the element's own `.new-*` rule is.
- A page whose CSS uses structural selectors (`:nth-child`, `:first-child`, sibling combinators) may legitimately restyle
  neighbours when an element is inserted or removed; none of the locked fixtures does.
- Only the widths listed are tested; Chromium only; no real pointer interaction (there is no UI in this spike).
