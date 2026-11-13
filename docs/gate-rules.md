# Engine gate rules (LOCKED)

Locked in the commit `docs: lock engine gate rules, fixtures and edit specs`. After that commit
this file, `fixtures/*` and `fixtures/edits.json` are never edited. If something here turns out
wrong, it is recorded in the report and in `docs/working-notes-and-decisions.md`, and Max decides.

Question the gate answers: **can a small browser-side engine take HTML or SVG a visitor pastes,
apply visual edits (typography, size, move), and write them back into the visitor's own source
text so the exported file renders exactly as edited, changes nothing else, and keeps the original
formatting?**

Sections marked **(mine)** are operational definitions written by the implementing agent to make
the brief's rules measurable. Everything else is the brief's wording.

## 1. Edits

40 edits, 4 per file, over 10 fixtures (`fixtures/`), specified in `fixtures/edits.json`. One edit
of each type per file, so 10 per type:

- **T1 typography:** font-size, font-family, font-weight or colour on one target element.
- **T2 size/spacing:** HTML: width, height, padding or margin. SVG: width/height/r/font-size.
- **T3 move by result:** HTML: reorder before/after a named sibling, or change alignment. SVG:
  reorder in document order (changes paint order).
- **T4 move by offset:** shift the target by (dx, dy) pixels. HTML: `transform: translate(dx, dy)`
  composed with any existing transform. SVG: update `x`/`y` (or `cx`/`cy`) where the element has
  them, otherwise add or compose a `transform` translate. Inside transformed groups the shift is in
  the visible (screen) direction.

Intended scope is the **single selected element only**. Editing a shared class rule that also
changes siblings is a FAIL. (None of the 40 specs uses the shared-rule exception.)

Each spec names the target by a selector verified unique in its file, the edit, and an `expected`
section stated as values a browser can measure (computed style values, bounding-box deltas, DOM
or paint order). Expected values do not depend on the engine.

## 2. An edit PASSES only if ALL hold

- **E1 Loads:** the exported file loads in headless Chromium without parse errors (the engine
  itself also re-parses it without error), and for `linked-css` the companion CSS is exported too.
- **E2 Matches spec:** measured values on the target match `expected` (sizes and offsets within
  1 px, colours exact, order exact).
- **E3 Matches preview:** the exported file, loaded fresh, gives the same measured values on the
  target as the engine's live preview edit applied to the original (within 1 px, colours exact).
- **E4 Nothing else changed:** for every other element, computed style (all properties) and
  bounding box are identical between original and exported, within 1 px, EXCEPT descendants whose
  changes are the legitimate inherited or layout consequence of the edit (definition in section 5).
- **E5 Minimal diff:** a line diff of exported vs original touches only lines belonging to the
  edit (the target's start tag, or the one rule block, or for reorder the moved element's lines).
  At most 3 changed lines for typography, size and offset edits; reorder counts moved lines. Every
  other byte of the file, including comments, indentation, tag case, quoting style, entities and
  the inline `<script>`, is identical.

A refusal by the engine (it detects a case it will not edit and says why) counts as a FAIL for
that edit, but is reported as detected.

## 3. Gate pass line

- At least **36 of 40** edits pass.
- No edit type below **9 of 10**.
- All **10 files** load (E1 on at least their no-op round trip too: parse then export with zero
  edits returns the file byte-identical).

Decided in advance:

- If ONLY T4 (offset) misses its line and everything else passes, the verdict is **PASS WITH
  CHANGE**: v1 ships offset moves as in-page-preview-only labelled "approximate", and the README
  says so. Max decides.
- If overall fidelity misses, report plainly. Do not tune the rules or fixtures. Offer the single
  cheapest test that would settle doubt.

**Verdict:** PASS if the pass line is met and the speed thresholds (once set) are met. PASS WITH
CHANGE as above. Otherwise FAIL, naming each rule and metric that missed, with numbers next to
thresholds. No "close enough".

## 4. Speed

Thresholds are NOT set. They are measured first (Step 3), proposed in `docs/checkpoint.md`, and
set by Max in a separate commit `docs: add speed thresholds`. Items measured:

- median time from "source in" to "preview ready" over 20 runs per file (parse + build the preview
  DOM + tag source positions), headless Chromium;
- median time to apply one edit and produce the exported text;
- bundle size of the engine, raw and gzip;
- the largest fixture's size in bytes.

**(mine)** "Source in" is the moment the harness calls the engine's load entry point with the
source string already in memory (file read time excluded). "Preview ready" is when that call
returns with the preview DOM attached to a sandboxed, scripts-off iframe `srcdoc` document and
every element tagged with its source node. Timing uses `performance.now()` inside the page. The
edit-apply timing uses each file's T1 edit and covers `applyEdit` plus `export`, run 20 times,
median reported. The machine, Node and Chromium versions are named in `docs/checkpoint.md`.

## 5. Operational definitions (mine)

These are written now, before any engine exists, and do not change after the lock.

### 5.1 Measurement environment

- Headless Chromium via Playwright (never the user's Chrome), viewport 1280 x 800, device scale
  factor 1, JavaScript **disabled** in the page context for both original and exported documents
  (this matches the scripts-off preview, and keeps `messy.html`'s inline script inert).
- Files are loaded from `file://` URLs so `linked-css.html` resolves its stylesheet next to it.
  The exported HTML and exported CSS are written to a temp directory with the original file names.
- Bounding boxes are `getBoundingClientRect()` on the element, in CSS px, page scrolled to 0,0.
- Colours are compared exact as `getComputedStyle` strings (`rgb(r, g, b)`).
- Computed style values are compared after this normalisation: lower-case, quotes removed,
  whitespace collapsed, a single space after each comma, and the alias pair `flow-start` =
  `flex-start`, `flow-end` = `flex-end` (the Chromium used here serialises the flex keywords with
  the `flow-` spelling; the spec values use the standard `flex-` spelling).

### 5.2 E1 Loads

Pass when all of: Playwright navigation to the exported file succeeds; no `pageerror` and no
console message of type `error` during load (a missing `html5shiv.js` inside the `messy.html`
conditional comment is not fetched, so it cannot raise one); for SVG the document root is `svg`
and there is no `parsererror` element; the engine's own re-parse of the exported text does not
throw and reports no more parse errors than it reported for the original (the messy fixture has
deliberate sloppiness, so the test is "no new errors", not "zero errors"); the exported element
count equals the original element count; and for `linked-css` the CSS file is among the exported
outputs and non-empty.

### 5.3 E2 Matches spec

For each entry in `expected`:

- `computed`: `getComputedStyle(selector).getPropertyValue(property)` equals `value`.
- `bboxDelta`: `exported bbox - original bbox` for the selector equals each listed `dx`, `dy`,
  `dw`, `dh` within 1 px. Keys not listed are not checked.
- `order`: the `id` attributes of the parent's element children that have an id, in document
  order, equal `ids` exactly.

### 5.4 E3 Matches preview

The harness loads the original into the engine's preview (scripts-off sandboxed iframe), applies
the same edit object through the engine's live DOM path, and measures the target with the same
`computed` and `bboxDelta` and `order` entries of the spec. It then loads the exported file fresh
and measures again. The two measurements must agree within 1 px, colours and order exact. Only the
properties named in `expected` are compared for E3; E4 covers everything else on the exported file.

### 5.5 E4 Nothing else changed

Elements of the original and exported document are paired by document-order index. For `reorder`
edits the exported document's indices are first permuted by the spec's own `expected.order` so the
moved element and its siblings pair up with their originals. The target itself is excluded from E4
(E2 covers it). For every other element, all computed properties (every name returned by
`getComputedStyle`) and the bounding box must be identical within 1 px, except where the spec's
`legit` class allows a difference:

- `descendants`: descendants of the target may differ in any computed property and bounding box
  (inheritance, text reflow, and alignment of children all land here). Nothing else may differ.
- `flow`: everything in `descendants`, plus, for elements that are ancestors of the target,
  following siblings of the target, and following siblings of any ancestor (and all their
  descendants): bounding box, and the layout-resolved computed properties `width`, `height`,
  `inline-size`, `block-size`, `perspective-origin`, `transform-origin`. A sibling's colour, font,
  margin or any other specified property is never allowed to differ. Used when the edit changes the
  target's layout box size or position in flow.
- `reorder`: everything in `descendants`, plus the same layout-resolved allowance as `flow` for
  every child of the target's parent and all of their descendants, and for the parent's following
  siblings and ancestors. Used for DOM reorders, which change positions of the elements jumped
  over.
- `svg-ancestors`: everything in `descendants`, plus the bounding box (only) of ancestors of the
  target, because an SVG group's box is the union of its children.

Anything else that differs is a FAIL for E4. The classes are deliberately narrow: they allow
geometry and resolved sizes to follow the edit, never specified style on an unrelated element.

### 5.6 E5 Minimal diff

Line diff via jsdiff `diffLines` on the original and exported text of each file, splitting on
`\n`. "Changed lines" for a file is `max(removed lines, added lines)`.

- Only the files listed in the spec's `expectedFiles` may differ. Every other output file must be
  byte-identical to the original. (For `linked-css` edits E25, E26 and E28 that means the CSS file
  changes and the HTML is byte-identical; for E27 the HTML changes and the CSS is byte-identical.)
- Non-reorder edits: changed lines are at most 3, and every removed line must overlap one of the
  allowed source spans of the original file: the line span of the target's start tag, or the line
  span of any CSS rule block (in a `<style>` element or the CSS file) whose selector list matches
  the target element in the original document, or, for SVG, the target's start tag. Added lines
  are unconstrained apart from the count (they are the replacement for the removed ones, or the
  insertion).
- Reorder edits: no numeric cap. Every changed line (added or removed) must be a line of the moved
  element's original source or of an element it moved past (both are valid descriptions of the same
  move), and the multiset of removed lines must equal the multiset of added lines, meaning the
  edit is a pure permutation of whole lines: no line was re-indented, re-quoted or otherwise
  altered. This includes elements with no end tag, where a naive split of start and end offsets
  would damage indentation.

### 5.7 Round trip

For each of the 10 files (and the companion CSS), parse with the engine and export with zero
patches. The result must be byte-identical to the input.

### 5.8 Refusals and unsupported cases

If the engine detects a case it must not guess about (a target that is a `<use>` instance or whose
value is inherited from an ancestor that would be the wrong element to edit, a conflicting
`!important`, an `@media` rule that would need patching, a script that mutates the page, CSS the
visitor did not supply) it returns an explicit refusal naming the reason. The harness records the
refusal text. A refusal fails that edit's E2 to E5 (it did not do the edit) and is listed
separately in the report as detected.

### 5.9 Results format

`results/gate-results.csv`: one row per edit per rule, columns `run,edit_id,file,type,rule,pass,
detail`. `results/timing.json`: speed numbers. `results/gate-summary.md`: the per-type, per-file
and total table and the verdict computed mechanically from this file. Raw per-element dumps go in
the git-ignored `results/raw/`. No hand-judging: every `pass` value is produced by script.

### 5.10 Iterations

No retries to improve the number. If the engine is changed after a failure, that is a labelled
iteration: both runs stay in the results (`run` column), the report says what changed and why, and
both are reported. The verdict is computed from the locked rules only.
