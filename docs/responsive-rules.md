# Responsive iteration rules (LOCKED)

Locked in the commit `docs: lock responsive iteration rules, fixtures and specs`. After that commit
this file, `fixtures/responsive/*` and `fixtures/responsive/edits.json` are never edited. If a
definition turns out wrong, it is recorded in the report and `docs/working-notes-and-decisions.md`,
and Max decides. The real-page specs `realpage-check/edits.json` are also unchanged.

Question: **when an edit is made at one screen width, does the engine scale the page's own
screen-specific values by the same ratio (linked), or keep the edit inside one environment
(unlinked), without touching any other element at any width?** Nothing here calls an LLM or a paid
service. Sections marked **(mine)** are operational definitions written by the implementing agent;
the rest is the brief's wording.

## 1. Behaviour being tested

- **Environment** of an edit: `desktop` (made while previewing at 1280 px) or `phone` (390 px).
  **Link** defaults to `true`.
- **Linked ratio edit** (font-size, padding, padding-*, margin, margin-*): the engine takes the
  current computed value at the environment's width as the old value and the edit's value as the new
  one (the new value must be in px), ratio = new / old, and multiplies the page's own declared
  values for that element and property in every other region (base rule and every `@media` rule
  matching the element) by the ratio: each number in a shorthand is multiplied, `auto` and keywords
  are left alone, the unit is kept. The user types nothing for the other widths.
- **Not ratios**: colour, font-family, weight, order, alignment, offsets and reorders. They apply at
  every width. **width and height are not scaled in this iteration** (a computed width often comes
  from layout, not a declared length): a linked width/height edit applies at every width, with a
  structured note.
- **Not scalable values** (`calc()`, `clamp()`, `min()`, `max()`, `var()`, `env()`, keywords such as
  `auto`, `inherit`, `large`): left as the page wrote them, never guessed, and reported in a
  structured note naming the property, the media condition, the value and the reason.
- **Unlinked edit**: applies only inside its environment. The other environment keeps what the page
  (or earlier edits) gave it. It **pins** that element's property in that environment: later edits
  made in the other environment, even linked, do not change a pinned value. Edits made in the pinned
  environment itself still change it. The scaling base is the current effective value after all
  earlier edits.
- **Breakpoint B (mine):** the largest `max-width` condition in px at or below 768 found in the
  page's CSS (every `<style>` block and every companion stylesheet, any at-rule nesting); otherwise
  767. Phone = widths at or below B, written `@media (max-width: Bpx)`. Desktop = widths above B,
  written `@media (min-width: (B+1)px)`. B+1 is the first Desktop width in the engine and the tests.
- **Moves**: a linked offset is the existing inline translate (same at every width); a linked
  reorder is a DOM reorder. An unlinked offset is a translate inside the environment's condition,
  composed with the effective declared transform. An unlinked reorder is the CSS `order` property
  inside the condition: it needs a flex or grid parent (otherwise REFUSED with that reason, not
  faked), and **(mine)** it can place the element only first or last among siblings whose `order`
  values are all equal (changing only the target's own `order`); any other position is REFUSED with
  that reason.
- **Review list**: a pure function `listUnlinked(state)` returns every unlinked or pinned override as
  `{selector, property, environment, value}`. The exported code carries no flags or markers.

## 2. Test widths and the Truth

**Test widths (mine):** 1280, 1024, 768, 390, plus, for every distinct `max-width`/`min-width` px
breakpoint in the page, that breakpoint and breakpoint + 1; for a page with no phone breakpoint of
its own, 767 and 768 (the default B). Each spec lists its widths explicitly. For the two real-page
specs the list is built from the page's CSS the same way (decimal breakpoints use the integer part
and integer part + 1).

**Truth, linked ratio edits:** at the preview width, the new value; at every other test width,
(the original computed value at that width) x ratio, within 0.5 px. For values that cannot be scaled
the expected value is the original computed value at those widths plus a structured note. Non-ratio
properties: the new value at every width. The hand-written numbers in each spec are the Truth; they
were checked against an independent reference stylesheet in plain Chromium before the lock (no
engine). For R01 and R09 the harness computes the Truth from the original page by the formula above
and writes the numbers into the results.

**Truth, unlinked edits:** at every test width inside the environment the edit was made in, the new
value; at every test width in the other environment, the original value (or the value left by
earlier edits in the list). Boundary widths: B is phone, B+1 is desktop. Pinned cases (an ordered
list of edits) have the expected values after the last edit written out in the spec by hand.

## 3. Outcomes and the five checks

Each edit (a spec with an ordered list of one or more edits is one unit) has one outcome:
**PASS** (E1 to E5 hold), **REFUSED** (structured refusal with a true, human-readable reason and no
change; the reason is quoted and checked by reading the file), **FAIL** (anything else, including an
uncaught exception). Spec S17 is expected to be REFUSED.

- **E1 Loads:** the export loads in headless Chromium (JavaScript off, other hosts aborted) with no
  new errors versus the original, the engine re-parse reports no more parse errors and the same
  element count, and the no-op round trip stays byte-identical. Console errors that only say a
  resource failed to load are not counted (as in `docs/realpage-rules.md` 4.2).
- **E2 Matches the Truth** at ALL the spec's test widths (px values within 0.5 px, bounding-box
  deltas within 1 px, colours and orders exact). Visual order **(mine)** = the ids of the parent's
  element children sorted by (top, left) of their bounding boxes.
- **E3 Matches the preview:** the exported file at each test width gives the same measured values
  as the engine's live preview path applied to the original and viewed at that width (within 1 px,
  colours exact). The preview path applies the engine's DOM operations step by step to one preview,
  then the preview iframe is resized to each width.
- **E4 Nothing else changed:** at every test width, for every element other than the target, all
  computed properties (compared by property name) and the bounding box equal the original's within
  1 px, except what the spec's `legit` class allows (`docs/gate-rules.md` 5.5; the target is
  excluded). Pairing is by document-order index (the DOM is not reordered by these specs).
- **E5 Minimal diff (mine, from the brief):** only the target's start tag (the hook attribute
  counts as part of it) may have changed lines; everything else is added lines (the appended
  override rules); no other byte changes. The number of changed plus added lines is at most
  3 x (number of edits in the spec) + 2 x (number of added lines that begin with `@media`).
  Line diff via jsdiff `diffLines`; removed lines must lie inside the target's start tag.

## 4. Pass line (iteration)

1. Re-run the locked real-page edits R01 and R09 (unchanged specs): both PASS, evaluated at all test
   widths including their own breakpoints, with Truth computed from the original page.
2. The 20 specs here: at least 18 PASS and zero FAIL; a non-pass must be a true REFUSED (S17 is the
   only expected one).
3. Regression: all 40 engine-gate edits and the other 18 real-page edits still PASS, and for every
   edit whose target property has no `@media` rule anywhere in its page (no conditional rule
   declaring that property, in any file of the page; offsets count as `transform`; reorders have no
   property), the new engine's export is BYTE-IDENTICAL to the baseline export saved in Step 1.
4. All no-op round trips are byte-identical (40 gate fixtures, the 5 real files plus the stylesheet,
   the 9 new fixtures).
5. The speed thresholds in `docs/speed-thresholds.md` still hold (rerun the speed harness).

Decided in advance: any miss in 1 to 5 means the iteration FAILS. Report plainly, do not tune rules
or specs, name the cheapest next test, do not revert anything; Max decides. Run 1 is the scored run;
a later run after an engine or harness change is a labelled iteration, both are reported.

## 5. The 20 specs

`fixtures/responsive/edits.json`: ten linked cases (a to i, with (b) split into S02 rem and S03 em
so that there are ten) and ten unlinked or pinned cases (j to s), over nine pages:

| spec | case | page | what |
|---|---|---|---|
| S01 | a | text-scale.html | px font-size, phone override, shared class (one element only) |
| S02 | b | units.html | rem values |
| S03 | b | units.html | em values |
| S04 | c | spacing.html | padding and margin shorthand with several values |
| S05 | d | edge-values.html | phone rule written with !important |
| S06 | e | edge-values.html | clamp() in the media rule (not scalable, note expected) |
| S07 | f | colour.html | colour edit, page changes colour at phone |
| S08 | g | two-conditions.html | max-width and min-width rules on one property |
| S09 | h | text-scale.html | edit made at phone width scales desktop |
| S10 | i | two-conditions.html | property with no media rule (behaves as before) |
| S11 | j | text-scale.html | desktop linked 40 to 48, then phone unlinked 16 |
| S12 | k | colour.html | desktop-only colour, same colour at phone |
| S13 | l | spacing.html | phone-only margin |
| S14 | m | text-scale.html | pinned value survives a later linked desktop edit |
| S15 | n | moves.html | phone-only offset composed with an existing rotate |
| S16 | o | moves.html | phone-only reorder in a flex parent (CSS order) |
| S17 | p | moves.html | phone-only reorder in a block parent: REFUSED |
| S18 | q | moves.html | phone-only width |
| S19 | r | no-media.html | desktop-only edit, no media rules, default B = 767 |
| S20 | s | boundary.html | own breakpoint 700: widths 700 (phone) and 701 (desktop) |

Mechanism choices the specs do not depend on (documented in the ADR): element-scoped override rules
appended to the page's last stylesheet, an existing `id` or a `data-ue` hook attribute, `!important`
only where the page's own rule uses it (or an inline declaration must be beaten).

## 6. Information only

How many of the 20 real-page and 20 new edits produce "not scaled" notes, and the diff size of each
scaled edit. Median preview-ready and edit-and-export times are reported by the speed harness.
