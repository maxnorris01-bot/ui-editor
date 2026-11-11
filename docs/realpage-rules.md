# Real-page check rules (LOCKED)

Locked in the commit `docs: lock real-page check rules and edit specs`. After that commit this
file and `realpage-check/edits.json` are never edited. If something here turns out wrong, it is
recorded in the report and in `docs/working-notes-and-decisions.md`, and Max decides.

Question: **does the same engine hold up on five real files written by other people?** Same four
edit types and the same five checks as `docs/gate-rules.md` (read it; its definitions of E1 to E5,
the legit classes in section 5.5, the normalisation in 5.1 and the 1 px / exact-colour tolerances
are reused unchanged except for the additions below). Nothing here calls an LLM or a paid service.

Sections marked **(mine)** are operational definitions written by the implementing agent. Everything
else is the brief's wording or reuses `docs/gate-rules.md`.

## 1. Inputs

Read from `../ui-editor-realpages/` (outside the repo; override by argument). They are never
committed, copied into the repo, or edited. The harness works on in-memory copies and on exports
under the gitignored `realpage-check/tmp/`.

| file | kind | companion |
|---|---|---|
| leemunroe-email.html | HTML email, embedded styles | none |
| mailgun-action.html | HTML email, embedded styles, long lines | none |
| freelancer-index.html | Bootstrap one-page site | css/styles.css (11,045 lines, 241 KB), linked as `css/styles.css` |
| fibonacci-spiral.svg | plain SVG | none |
| normal-distribution.svg | Inkscape SVG, sodipodi/rdf metadata, transformed groups | none |

## 2. Edits

20 edits, 4 per file, one per type (`realpage-check/edits.json`), in the harness spec format with
these additions: `why` (how the selection procedure picked the target), `styleSource` (where the
target's current styling comes from), and, for reorders, `expected.order.key` and `values`.

Selection procedure, fixed before the engine touched any of these files **(mine, where it fills a
gap)**:

- **T1** element with the most prominent text: among elements with a rendered box (width > 0) and
  their own non-whitespace text (a non-breaking space counts as whitespace), the largest computed
  font-size at 1280 x 800 with JavaScript off; ties go to the first in document order. For SVG, the
  largest `<text>`/`<tspan>` by computed font-size, ties first in document order. If an SVG has no
  text: the shape with the largest stroke area (path length x stroke-width), and the edit is the
  stroke colour.
- **T2** largest content container, image or table: among `div, section, header, footer, main,
  article, nav, aside, form, table, img, ul, ol` the largest bounding-box area at 1280 x 800; ties
  first in document order. For SVG the largest of `rect, circle, ellipse, path, polygon, polyline,
  line`.
- **T3** an element with at least 2 siblings; reorder (or an alignment property).
- **T4** a button, link, cell or small shape (SVG: an element inside a transformed group, or a
  small shape with its own transform). Shift (dx, dy) = (24, 16) screen pixels.
- At least 2 of the 4 edits per file must target an element whose current styling does not come
  from its own inline `style`; each spec's `styleSource` says which. In `mailgun-action.html`,
  T1 and T2 are fixed by the procedure and are inline-styled, so T3 (inherited alignment) and T4
  (no inline style, class rule only inside an inactive media query) carry the requirement.
  Selectors were verified unique in their file, and the expected values were checked against a
  plain Chromium DOM edit (no engine) before the lock; all 20 agreed.

Expected values are browser-measurable and do not depend on the engine: computed values,
bounding-box deltas, and DOM order.

`expected.order` (extension, mine): `parent` is a selector, `key` says how to name each element
child of the parent, and `values` is the exact expected list in document order after the edit.
`key` is `{attr: "id"}`, `{attr: "text", length: n}` (normalised text content, first n characters),
or `{selector, attr}` / `{attr: [a, b]}` (an attribute of a descendant, or several attributes of the
child joined with a comma).

## 3. Outcomes and pass line

Each edit gets exactly one outcome:

- **PASS**: E1 to E5 all hold.
- **REFUSED**: the engine returned a structured refusal with a human-readable reason and made no
  change. The reason is quoted in the results, and must be true: each REFUSED reason is checked by
  reading the file. A refusal with a wrong reason is a FAIL.
- **FAIL**: anything else: wrong value, collateral change, diff too large, export that does not
  load, an uncaught exception, or a harness error attributable to the engine.

Pass line: **at least 16 of 20 edits PASS, zero FAIL (every non-PASS edit is a true REFUSED), and
all 5 no-op round trips byte-identical (the companion CSS included).** Any FAIL means the check
FAILS. Rules and specs are not tuned. Run 1 is the scored run; a later run after an engine change
is a labelled iteration, both are reported, and the later one is not called the verdict without
saying so.

## 4. Additions to the engine gate rules

### 4.1 Load settings (as in the brief)

Original and exported pages are loaded in headless Chromium (viewport 1280 x 800, scale 1) with
JavaScript **disabled** and every request to another host aborted (fonts, CDNs), so both loads are
identical and offline. Fonts fall back. The same abort rule applies in the engine's preview page.
`file://` loads resolve the companion CSS next to the HTML.

### 4.2 E1 (mine, where it fills a gap)

As `docs/gate-rules.md` 5.2, plus: the no-op round trip of the file and its companion CSS is
byte-identical. Because the real pages reference images, icons and fonts that are not supplied or
are aborted, console errors that only say a resource failed to load (`Failed to load resource`) are
not counted; every other page or console error counts, and an error present in the exported load
that is not present in the original load is a failure.

### 4.3 E4 pairing (mine)

Reorder pairing uses `expected.order.key` (children paired by key value; subtrees paired in
document order) instead of ids. Everything else is as `docs/gate-rules.md` 5.5, including the
interpretation used in the engine gate for the `reorder` class.

### 4.4 E5 for long lines (mine)

If any line of the original that the diff touches is longer than 2,000 characters, E5 for that file
is measured at the character level instead of by lines: the common prefix and suffix of original
and exported text are removed, and the remaining changed region of the original must lie inside the
allowed source span (the target's start tag, or a CSS rule block whose selector matches the
target; for a reorder, the moved element together with the sibling it moved past). The number of
bytes changed (the larger of the removed and added region) is reported, and every byte outside
that region is identical by construction. Otherwise E5 is the line rule of `docs/gate-rules.md`
5.6 (at most 3 changed lines for non-reorder edits; reorders are a permutation of whole lines).
Files other than the ones named in a spec's `expectedFiles` must be byte-identical.

### 4.5 Information only

Median preview-ready time (20 runs) and edit-and-export time on the five real files, measured as in
the engine gate, are reported with machine and versions named. They are not part of the verdict.

## 5. Results

`realpage-check/results/realpage-results.csv` (columns `run,edit_id,file,type,rule,outcome,pass,
detail`), `realpage-check/results/realpage-summary.md`, `realpage-check/results/timing.json`.
Only file names, specs, numbers and diff sizes are committed; raw dumps and exported copies stay in
the gitignored `realpage-check/tmp/` and `realpage-check/raw/`.
