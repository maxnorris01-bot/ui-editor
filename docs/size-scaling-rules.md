# Size scaling rules (LOCKED)

Locked in the commit `docs: lock size-scaling rules, fixtures and specs`. After that commit this file,
`fixtures/size/*` and `fixtures/size/edits.json` are never edited. If a definition turns out wrong, it is
recorded in the report and in `docs/working-notes-and-decisions.md`, and Max decides. The responsive
rules (`docs/responsive-rules.md`) and amendments 1 and 2 stay in force. Nothing here calls an LLM or a
paid service. Sections marked **(mine)** are operational definitions written by the implementing agent;
the rest is the brief's wording.

Question: **when a user resizes an element (width or height) with Link on, does the engine make the
other screen size follow the same ratio where the page declares a fixed length, leave flexible values
alone, and keep a px width from overflowing a phone, without changing any other element at any width?**

## 1. Behaviour being tested

For a LINKED `width` or `height` edit made in environment E (desktop = 1280 px, phone = 390 px), from the
old computed value v0 at E's width to the new px value v1 (ratio r = v1 / v0), for the OTHER environment O:

1. **Fixed declared lengths scale.** If the winning declaration for that property on the element at O's
   widths is a fixed length (`px`, `rem`, `em`, or a presentational HTML attribute such as `width="600"` or
   `height="40"`, treated as px), it is multiplied by r exactly as font-size is, and written as an
   element-scoped override inside O's media condition.
2. **Flexible or undeclared values are left alone.** If O's value is a percentage, `auto`, `vw`/`vh`,
   `calc`/`clamp`/`min`/`max`/`var`/`env`, a keyword, or not declared at all, the engine does not scale it and
   does not force the new pixel value into O: O keeps the page's own behaviour. The new value applies only
   inside E's media condition. A structured note says which environment was left alone and why.
3. **Overflow guard (width only).** Any width the engine writes or scales in px gets `max-width: 100%` in the
   same scoped rule, but only when the element's computed `max-width` at that environment's width is `none`
   (the page's own max-width is never overridden). Height gets no guard.
4. **Unlinked** width/height edits keep the existing behaviour (only inside E, pinned, no guard). **Moves are
   unchanged.**
5. **SVG** elements keep their current behaviour.
6. Everything else in the responsive rules stays (one phone breakpoint B, pins, `listUnlinked`, scoped
   overrides, no collateral change at any width).

### Operational definitions (mine)

- **Winning declaration at O** is decided at O's reference width (390 for phone, 1280 for desktop) among
  the CSS rules that match the element and whose media conditions hold there, plus the element's own
  `style` attribute, by the normal cascade (importance, then inline, then specificity, then order). A
  presentational attribute (`width`, `height`) counts only when no CSS rule or inline declaration for the
  property applies. It is a **fixed length** when the value is a single number-with-unit token in `px`, `rem`
  or `em` (or a bare number or `Npx` for the attribute). Anything else (`%`, `auto`, `vw`, `vh`, functions,
  keywords, no declaration, an attribute in `%`) is flexible or undeclared.
- Where fixed lengths in E and O end up equal and both need the same guard, the engine may write one
  unconditional scoped rule; the results are the same.
- The edit's new value must be px. A non-px new value, or no usable old value, falls back to the old
  behaviour (applies at every width) with a note.
- A property with `!important` in a matching page rule is refused (`important-conflict`), as for font-size.
- Only the winner at O's reference width is scaled; other breakpoints inside the same environment are not.

## 2. Test widths and the Truth

**Test widths:** 1280, 1024, 768, 641, 640, 390 for every spec (every fixture has the one breakpoint
`max-width: 640px`, so B = 640 and B + 1 = 641). Each spec lists its widths.

**Truth, linked edits:** at E's widths, the new value. At O's widths: if the winning declaration there is a
fixed length, the original declared value x r; otherwise the ORIGINAL computed value at that width,
unchanged. A width is capped at the element's container content width where the guard applies, and the
element's own `max-width` stands. Tolerance 0.5 px.

**Truth, unlinked edits:** the new value at every width inside the edited environment; the original (or
what earlier edits left) in the other. Pinned cases (an ordered list) have the final numbers written out
in the spec.

The numbers in each spec were checked in plain Chromium with NO engine: `harness/validate-size-specs.ts`
appends each spec's hand-written `reference` CSS to the original page and compares the measured values with
`expected` at every width (all 16 matched before this lock).

## 3. Outcomes and the five checks

Each edit (a spec with an ordered list is one unit) is **PASS** (E1 to E5 hold at ALL test widths, as in
`docs/responsive-rules.md` section 3 with amendments 1 and 2), **REFUSED** (structured refusal with a true
reason and no change) or **FAIL** (anything else, including an uncaught exception).

E5 budget: at most 3 changed or added lines for the base value plus 2 per added line that begins with
`@media`, per edit in the list (as in the responsive rules).

## 4. Pass line

1. The 16 specs: at least **15 PASS** and **zero FAIL** (a non-pass must be a true REFUSED).
2. Regression with the new engine: gate 40/40; real-page edits 20/20; responsive specs unchanged (19 PASS,
   1 REFUSED, 0 FAIL). Every existing edit NOT listed in section 6 exports byte-identical to the baseline
   saved before the engine change. The listed width/height edits must still PASS E1 to E5 at the widths
   they were scored at before.
3. All no-op round trips byte-identical (the existing 25 plus the 6 new fixtures).
4. The locked speed thresholds (`docs/speed-thresholds.md`) still hold.
5. The scorer check (before the engine change) passed.

Decided in advance: any miss means the iteration FAILS. Report plainly, do not tune rules or specs, name the
cheapest next test. No second engine change without reporting first. Run 1 is the scored run; a later run
after an engine change is a labelled iteration.

## 5. The 16 specs

`fixtures/size/edits.json`, over six pages (`fixtures/size/`). Every spec also carries a `reference` CSS
used only by the validation script.

| spec | case | page | what |
|---|---|---|---|
| Z01 | a | size-basic.html | desktop width edit, phone declares 300px in a media rule: scaled |
| Z02 | b | size-basic.html | phone declares 80%: left alone, note |
| Z03 | c | size-basic.html | phone width undeclared (block, auto): left alone, note |
| Z04 | d | size-units.html | base in rem, phone in em: scaled |
| Z05 | e | size-basic.html | height with a px phone override: scaled |
| Z06 | f | size-height.html | height auto on phone: left alone, note |
| Z07 | g | size-guard.html | scaled width larger than the phone container: capped by the guard |
| Z08 | h | size-guard.html | element with its own max-width: no guard, its max-width stands |
| Z09 | i | size-envs.html | edit made at phone width, desktop declares a fixed width: scaled |
| Z10 | j | size-units.html | clamp() on phone: left alone, note |
| Z11 | k | size-basic.html | shared class, only the selected element changes |
| Z12 | l | size-envs.html | unlinked width (existing behaviour) |
| Z13 | m | size-envs.html | pinned phone width survives a later linked desktop edit |
| Z14 | n | size-attrs.html | width from an HTML `width` attribute (email-style table) |
| Z15 | o | size-attrs.html | img with width/height attributes and a phone media rule |
| Z16 | p | size-height.html | width then height edited in sequence on one element |

## 6. Existing edits whose property is width or height

These are the only existing edits allowed to differ in bytes from the baseline:

- Engine gate: E02, E10, E14, E18.
- Real-page: R02, R06 (HTML height), R14, R18 (SVG width; SVG keeps its behaviour, so they are expected to stay
  byte-identical).
- Responsive: S18 (unlinked width; unchanged behaviour, expected byte-identical).

Every other edit of the 40 + 20 + 20 must be byte-identical.

## 7. Scorer additions

Besides the usual controls (unchanged file, collateral CSS, one added space), the scorer is checked with an
export where the phone width wrongly equals the desktop value, and one where the width overflows the phone
container; both must fail E2 at a phone width.
