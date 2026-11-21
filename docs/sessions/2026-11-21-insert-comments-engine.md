# Session: insert, text, remove and note edits, engine spike (2026-11-21)

Branch `feat/insert-comments-engine`, created from `main` at `27065d8`. Nothing pushed. No UI, nothing in `portfolio-site`, no LLM or paid
service. Brief: `~/Desktop/Projects/ui-editor-insert-engine-brief.md`.

## What and why

The editor page will get an Insert menu (text box, rectangle, rounded rectangle, ellipse, button) and Comments: a note on any element that
travels in the downloaded code as an HTML comment, so the AI chat that receives the code knows what the user meant. Until now the engine
only changed properties of existing elements. This spike proves, in the engine alone, that four new edit kinds work and never damage the
file: `insert`, `text`, `remove`, `note`, plus `listNotes(model)`.

## What was done, in order

1. **Step 0, lock (`f777429`):** `docs/insert-comments-rules.md`, 11 fixture files in `fixtures/insert/` (the three built-in samples, four files with
   `landing.css`, copied byte-identical, plus seven small pages I wrote) and `fixtures/insert/edits.json` with 36 specs I01 to I36. Every spec's facts (selectors,
   parents, positions, literals, the true reason for each expected refusal, original overflow) were dry-run in plain Chromium without the
   engine (`harness/validate-insert-specs.ts`) before locking.
2. **Amendment 1 (`66bf0e6`),** before anything was scored: how the collateral check picks its allowance, that check C is skipped (overflow
   still checked) for the three specs that edit existing elements (I30, I33, I36), and a few smaller definitions. The lock files are untouched.
3. **Step 1, baseline and scorer check (before any engine change):** baseline exports of all five existing suites with the current engine
   (111 files, hashes in `results/insert/baseline-hashes.json`; same as the size-scaling baseline except the five width/height edits that
   size scaling changed on purpose). The old engine fails all 36 specs. 25 scorer controls behaved
   (`insert-check/results/scorer-check.txt`): every good hand-built export passes, and each injected fault fails where it should: insert at the
   wrong position, rule inline although a companion CSS exists, an extra space or re-indented line, a remove that leaves its rule behind, a
   note not moved by a reorder, `-->` left un-neutralised, an unescaped `<script>`, a duplicated header, a missing header, an undo one byte
   off, a button without `type="button"`, an insert that overflows the 390 px phone. The earlier suites' faults were re-run too. One control
   was first written to also require check D to fail for `-->`; D cannot see that case (E, B and C do), so the control states E and B
   (recorded in amendment 1, item 4).
4. **Step 2, build, in commits:** `text` with shared types and comment scanning (`0e942c6`), `remove` (`bc1f372`), `note`, `listNotes` and a
   reorder that carries the note (`92e4998`), `insert` (`abc8b3d`), a fix (`85c73e7`), then ADR and known limits (`6964c29`). The five existing
   suites were re-run after each feature commit and again in both scored runs: all 111 baseline exports stayed byte-identical.
5. **Step 3, scored runs.** Run `i1` on `6964c29` met items 1 to 4 and 6 to 8 but missed item 5: the verdict script I wrote had a TypeScript
   error (so "typecheck clean" failed) and read vitest's JSON from the wrong place. That is a harness defect, not an engine result. I fixed the
   script only (`6ea5d57`) and ran the whole sequence again as **run `i2`**; both runs are in the CSVs. **i2: PASS, all eight items.**

## Bugs found by the dev runs (before the scored runs)

- A 5,000 character note read back one space short: the engine trimmed the ends of a note, but the locked rule says the text is otherwise
  unchanged. Fixed (text is kept as typed; one trailing space is the comment's own).
- An inserted button next to an inline link was 3.9 px off in the preview compared with the export, because the file gets a line break and
  indent that the preview did not. The preview now gets exactly the text the file gets.
- A comment before the first element of a fragment is hoisted by the parser to document level, so "directly before its element" is decided
  on the source text, not the parser's tree.

## Pins

Measured with `harness/measure-pins.ts` (`insert-check/results/pins-measurement.txt`): an unlinked phone font-size on `#t4`, then an insert or
a remove before it, then a linked desktop edit of `#t4`. Without remapping the later edit scaled the pinned value (20 px became 50 px at
390 and 640 px) and `listUnlinked` named the wrong paths; locked spec I33 fails with remapping switched off and passes with it on. Fixed for
insert and remove: pins are remapped (a removed element's pin is dropped). **Reorder has the same flaw and was not touched**; the same list with
a reorder loses the pin. Decision for Max.

## Result of run i2 (`insert-check/results/insert-summary.md`)

- Specs: 30 PASS, 6 REFUSED as declared (I11 `invalid-parent` for a table row, I12 `svg-insert`, I13 `parser-moves-element` for a div in a
  paragraph, I14 `invalid-parent` for a list, I18 `mixed-content`, I23 `protected-element`), 0 FAIL. Each reason was checked by reading the
  fixture: `email.html` line 31 is `<tr id="picks">`, `landing.html` line 14 is `<p class="lead">` and line 12 is `.hero-copy` holding an
  `h1`, a `p` and an `a`, `style-only.html` line 21 is `<ul id="list">`, `chart.svg` is an SVG file, and `body` is the page body.
- Regression: gate 40/40, real-page 20/20, responsive 19 PASS / 1 REFUSED, size 16/16 and Z17 to Z21 PASS with Z22 REFUSED, all 111 baseline
  exports byte-identical, 44 of 44 no-op round trip rows identical (11 new fixture files).
- Speed: worst preview 2.75 ms, worst apply 0.0702 ms, 10x page 8.2 ms and 0.564 ms; bundle 287,769 B raw and 82,978 B gzip (up 14,782 and
  5,182 bytes), all inside the thresholds.
- `npm test`: 190 tests (151 existing, untouched, plus 39 new in `engine/test/structure.test.ts`); typecheck, lint and build clean.

## Choices for Max (all marked in the ADR)

The neutralising rule and that note text is not trimmed; class prefixes and "smallest unused number"; the default styles; one note per element
plus one page note; blank text deletes a note; notes are recognised only in the exact spelling the engine writes; `ul`, `ol`, `dl` and `menu`
refuse direct children although the parser would accept them; text edit keeps the spaces around the text; remove does not remove override
rules earlier size or spacing edits appended for the element, and does not check HTML in-page links to a removed id.

## Open questions

- Reorder and pins (above).
- The unknown-edit change: before this branch any edit kind that was not `set` on an SVG file went to the offset code and wrote `x="NaN"`;
  an unknown kind is now refused. This is the only change to behaviour for existing input kinds, and it is for invalid input.
- `reorder` and `blockOf` now take a note into account; with no note they behave exactly as before (111/111 identical).

## Next

`git log --oneline main..feat/insert-comments-engine`, `cat insert-check/results/insert-summary.md`, then the push/PR/merge commands in the report.
