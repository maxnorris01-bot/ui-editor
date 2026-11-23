# Engine hardening rules (LOCKED)

Locked in the commit `docs: lock engine hardening rules, fixtures and specs`. After that commit this file, `fixtures/harden/*` and
`fixtures/harden/edits.json` are never edited. If a definition turns out wrong, it is recorded in the report and in
`docs/working-notes-and-decisions.md`, and Max decides; a flaw found before anything is scored is a re-lock (a new commit, the first lock
kept, corrections logged as numbered amendments). All earlier rules, specs, fixtures and amendments stay in force, and the checks A, B, C, E,
O, M, U, F, V and E1 are those of `docs/insert-comments-rules.md` and its amendment 1. Nothing here calls an LLM or a paid service. Sections
marked **(mine)** are operational definitions written by the implementing agent; the rest is the brief's wording
(`~/Desktop/Projects/ui-editor-hardening-brief.md`).

Question: **before a UI is built on the engine, do reorder, remove, files with Windows line endings and pages with neighbour selectors behave,
without changing any byte or any rendering the edit does not own?**

## 1. The four behaviours

- **H1 Reorder remaps pins.** A pin (an unlinked value, recorded by the element's path) follows its element through a reorder exactly as it
  already does through insert and remove: `listUnlinked` names the right path afterwards and a later linked edit in the other environment keeps
  the pinned value. This covers the moved element, the siblings it jumps over and the descendants of either. Undo is replay: replaying a list
  that contains a reorder gives the same bytes and the same pins. Every existing locked edit that reorders must still export byte-identical to
  its baseline; if one would change, the round stops and is reported. An unlinked (CSS `order`) reorder moves nothing in the file and changes no
  path, so it remaps nothing.
- **H2 Remove takes the element's engine-written rules with it.** For an element the engine inserted: every rule the engine wrote for it (its own
  rule and any override or scoped rule from later `set` edits, linked or unlinked) and its `data-ue` hook go with it, so insert, any mix of `set`
  edits, then remove returns the ORIGINAL bytes. For an ORIGINAL element with engine-written override rules the engine cannot tell them from
  page-authored rules with certainty, so it leaves them (see 2.2). A page-authored rule is never deleted.
- **H3 Line endings.** A file whose line breaks are CRLF stays CRLF: every line break the engine adds (inserted lines, a note's line breaks, the
  header comment, an appended rule, a typed line break in a text edit) uses the file's own ending, taken from the nearest existing line break
  (see 2.1). Bytes outside the change stay identical, mixed files included (never normalised). A typed note with line breaks in a CRLF file is
  written with CRLF and read back by `listNotes` and by the browser as LF. No final newline is invented.
- **H4 Neighbour selectors.** Inserting or removing an element can legitimately restyle its neighbours when the page's CSS uses `:nth-child`,
  `:first-child`, `:last-child`, `+` or `~`. The truth for what else may change is the browser's own answer (section 3, oracle). No engine change
  is expected; a defect found by the specs is fixed.

## 2. Operational definitions (mine)

### 2.1 How the line ending of an added break is decided

For an edit at source offset `o` in a file, the ending is that of the nearest existing line break: the break that ends the line before `o`
(the last `\n` before `o`, CRLF if a `\r` precedes it); if there is none before `o`, the first `\n` after `o`; if the file has no line break at
all, the file's dominant ending (CRLF when it has more CRLF than lone LF), else LF. An appended rule uses the break nearest to where it is
inserted, in the stylesheet it is written to (the companion CSS, or the `<style>` block in the page). Added text that itself contains line
breaks (a note, a typed text) has every break converted to that ending. A rule appended to a file with no final newline is written after one
break and without a trailing one.

### 2.2 How engine-written rules are recognised

An element is **engine-inserted** when it carries a class `new-box-N`, `new-text-N` or `new-button-N` AND the rule `.CLASS` (or, with no
stylesheet, its inline `style`) begins with exactly the engine's default declarations for that prefix (`docs/insert-comments-rules.md`
section 1). A page-authored class of the same name with other declarations (spec H11) is therefore never taken for the engine's. For an
engine-inserted element the engine removes: its `.CLASS` rule; and every rule, at any `@media`/`@supports` nesting, whose selector is only
the element's hook `[data-ue="K"]` (repeated any number of times) where K is the element's own `data-ue` value, when that rule was written
on its own line. For an ORIGINAL element (not engine-inserted) the same rules (`#id` or `[data-ue]` override rules) look like page-authored
ones, so they are **left** and listed as a known limit: this is the "case B" of the brief (spec H10). Known limit of H2: in a stylesheet with
no final newline a later `set` edit appends its line with a trailing newline (the existing, locked behaviour), so insert, `set`, remove there
returns the original plus one final newline.

## 3. The H4 oracle

For each H4 spec the harness loads the ORIGINAL page in Chromium, performs the spec's structural steps with the DOM API at the same positions
(an insert creates the same tag with the kind's default declarations as an inline `style`, restated here independently of the engine: boxes
`box-sizing: border-box; width: 200px; max-width: 100%; height: 120px; background: #d9d9d9; border: 1px solid #999999` (rounded adds
`border-radius: 12px`, ellipse `50%`), text `max-width: 100%; overflow-wrap: break-word` with the text "Text", button `box-sizing: border-box;
max-width: 100%; padding: 8px 16px; font: inherit; cursor: pointer` with the text "Button"; a remove removes the element), and reads every
other element's computed styles (all properties) and bounding box at the test widths. The export, loaded fresh, must match the oracle within
0.5 px (sizes and boxes; other properties exactly after normalisation) for every element except the created or removed ones (paired by
document order with those skipped). This replaces the "no other element changes" collateral check only for the H4 specs (`oracle: true`);
horizontal overflow and the byte-region check still apply.

## 4. Independent checks added to the insert rules' checks

- **Pins:** the computed values at the test widths (1280, 1024, 768, 390 and the page's breakpoint and breakpoint + 1) equal the spec's
  `measured` values (hand-computed), and `listUnlinked` equals the spec's `unlinked` list (paths checked against a DOM simulation of the
  structural steps by `harness/validate-harden-specs.ts`).
- **Bytes (`hbytes`):** `equals-original`; `additive` (the permitted regions removed, with whole lines, gives the original; no removed
  line; each region as in the insert rules, with a region at the end of a file that has no final newline removed together with the break before
  it, CR included); `{replace, removed}` (the original with the literals replaced and the blocks removed, nothing else); `{removed,
  othersAdditive}` (the primary file is the original minus the blocks; every other file only gains lines); `{equalsRunWithout: [n...]}` (the
  export equals the export of the same list without steps n..., run fresh); none.
- **Line endings (`regionEol`):** every permitted region found by the byte check (element, rule, note, header, including the break that ends
  its line and the breaks inside it) is checked in file order: every line break in a `crlf` region is `\r\n`, in an `lf` region `\n`; no lone CR
  anywhere. Together with the byte check this proves untouched bytes are identical and nothing was normalised.
- **Undo with pins (`undo`, `undoPins`):** replaying the first n steps from the original gives exactly the bytes after step n of the full run
  (and the same `listUnlinked`).

## 5. Outcomes and pass line

Each spec is **PASS** (every declared check holds) or **FAIL**. All 20 specs declare PASS (no refusal is expected).

1. Every H-spec meets its declared outcome, 0 FAIL.
2. Regression: the 36 insert specs unchanged (30 PASS, 6 REFUSED, 0 FAIL), gate 40/40, real-page 20/20, responsive 19 PASS + 1 REFUSED,
   size 16/16 and flex 5 PASS + Z22 REFUSED, every existing edit byte-identical to its baseline (hashes in `results/harden/`), all no-op round
   trips byte-identical.
3. Speed thresholds still met (the bundle size is reported).
4. `npm test`: no fewer than the current passes (190) plus the new ones, 0 failing; typecheck, lint and build clean.
5. The scorer check (Step 1) passed.
6. Locked files byte-identical to their lock commits.
7. One complete final run on the final commit.

Decided in advance: any miss fails the round; no tuning; name the cheapest next test; changes after the scored run are labelled iterations and
both runs stay on record. A failing scorer control stops the round: report to Max before building.

## 6. Fixtures and specs

`fixtures/harden/`: `pins.html` (byte-identical to `fixtures/insert/pins.html`), `reorder.html` (three sections, each with a heading and a
paragraph, 640 px phone rule), `landing.html` + `landing.css`, `style-only.html` and `collision.html` (copies of the insert fixtures),
`crlf/landing.html`, `crlf/landing.css` and `crlf/chart.svg` (the same files with every line break converted to CRLF, nothing else changed),
`nonl/landing.html` and `nonl/landing.css` (CRLF with no final newline), `mixed.html` (LF in the top half, CRLF in the bottom half) and
`neighbours.html` (`.box:nth-child(odd)`, `:first-child`, `:last-child`, `h2 + p`, `h2 ~ p`, with phone variants).

| spec | case | fixture |
|---|---|---|
| H01 | pin on the moved element, reorder to first, linked edit | pins |
| H02 | pins on the moved element and a jumped-over sibling, reorder up | pins |
| H03 | pins on descendants of the moved and of a jumped-over section, reorder down | reorder |
| H04 | descendant pins, section moved to last | reorder |
| H05 | insert, reorder, remove in one list, then a linked edit; undo by replay | pins |
| H06 | reorder of an element with a note and a pin | pins |
| H07 | insert, linked and unlinked width/padding/margin/font-size/colour edits, remove: original bytes | landing |
| H08 | the same on a `<style>`-only page | style-only |
| H09 | two inserted elements, one removed: bytes of the list without it | landing |
| H10 | H2 case B: original element with override rules (they stay) | landing |
| H11 | page-authored `.new-box-1` rule is never deleted | collision |
| H12 | CRLF: insert, note with a line break, page note, appended rule | crlf/landing |
| H13 | CRLF: text with a typed line break, remove | crlf/landing |
| H14 | CRLF SVG: notes, header at the start | crlf/chart.svg |
| H15 | mixed endings: each added break follows the nearest one | mixed |
| H16 | CRLF with no final newline: insert, note | nonl/landing |
| H17 | insert before the first and after the last child (nth-child, first/last-child) | neighbours |
| H18 | insert between a heading and its paragraphs (`+`, `~`) | neighbours |
| H19 | remove the first and the last child | neighbours |
| H20 | remove the heading `h2 + p` and `h2 ~ p` depend on | neighbours |

Every spec's facts (selectors, the final paths of pinned elements, created positions, element counts, literals, the line-ending shape of each
fixture) were dry-run in plain Chromium without the engine (`harness/validate-harden-specs.ts`) before locking, and every spec's steps were
accepted by the current engine (the edits exist already; only the H2, H3 and H1 outcomes are new).
