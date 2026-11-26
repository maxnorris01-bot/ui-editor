# Small views follow-up rules (LOCKED)

Locked in the commit `docs: lock small views follow-up rules and specs`. After it this file, `fixtures/views-followup/*` and `fixtures/views-followup/edits.json` are never edited; a flaw found
before anything is scored is a re-lock (a new commit, numbered amendments). `docs/small-views-rules.md` and its amendment 1, and every earlier rule, stay in force (ranges, checks, outcomes). Brief:
`~/Desktop/Projects/ui-editor-small-views-followup-brief.md`. Sections marked **(mine)** are operational definitions written by the implementing agent.

Question: **after a view is customised, does a Desktop edit of a colour, font or other non-ratio property always work (the custom view keeps its value, every other view follows), and do tablet-only
declarations and fractional breakpoints behave?**

## 1. Behaviour

1. A Desktop edit of a non-ratio property (colour, font-family, font-weight, text-align, ...) is no longer refused with `pinned-conflict` when the same element and property is custom in Phone or Tablet. It is
   written as today (same bytes when nothing is custom) and each custom view's pinned value is kept in force by re-emitting the view's own rule after the Desktop rule, inside its own media condition (the
   mechanism the ratio path uses, `docs/adr/0006-small-views.md`).
2. A Desktop edit changes nothing in a view where that property is custom, and reaches every other view and region. Reset of the view afterwards leaves the later Desktop edit in force and the export equals
   the export of the list built without the dropped edits, byte for byte.
3. Tablet-only declarations (a width, height, font-size or padding the page declares only inside the tablet range): a Desktop edit scales them from the page's own value (every region's own value is multiplied by
   the ratio); a custom Tablet edit covers the whole Tablet range.
4. A Bootstrap-style page (fractional breakpoints) works: B = 575.98 and T = 991.98 by the locked definitions; widths 575, 576, 767, 768, 991 and 992 behave as the ranges say (575 Phone; 576 to 991 Tablet; 992 Desktop).
No other behaviour changes; every existing suite keeps its bytes.

## 2. Truth for every spec (mine)

Computed values of the target at every test width (1280, 1024, 768, 390, floor(B), floor(B)+1, floor(T), floor(T)+1 and a spec's `extraWidths`), within 0.5 px: a custom view keeps its value inside its range; every
other region follows the Desktop edit (the spec's hand-written value, or `scaled`: the original computed value at that width times the Desktop edit's ratio, which is what "scaled into the tablet range from the page's
own value" means); `original`: the original page's value. Collateral: every other element unchanged within 0.5 px except the allowance of `docs/small-views-rules.md` section 4 and amendment 1; no new horizontal overflow
at 390 and 768; Reset equality byte for byte; the export carries no view markers; undo by replay; no-op round trips. All checks are those of `harness/views-check.ts` (`VIEWS_SET=followup`). Every number was validated
in plain Chromium without the engine by `harness/validate-views-specs.ts`.

## 3. What is still refused (mine)

None was found to need a refusal: the non-ratio cascade is written with the view's own rule re-emitted with `!important` after the Desktop inline declaration (see the ADR addendum), which holds for every
property and every nesting the fixtures exercise. The existing refusal codes stay for everything else (`important-conflict`, `shorthand-mix`, `tablet-covered-by-phone`). If the build finds a case that cannot be
written safely, it is reported and the refusal is kept for exactly that case, with its code, in a labelled amendment.

## 4. Fixtures and specs

`fixtures/views-followup/`: `colours.html` (B 640; colour, font-family and text-align declared on `.h` and `.t`), `tabonly.html` (B 640, T 1024; `.h` font-size, `.box` width, height and padding and `.card` padding
declared only for 769 to 1024, plus phone rules), `bootstrap.html` (hand-written, B 575.98, T 991.98: `max-width: 575.98px`, `min-width: 767.98px`, `max-width: 991.98px`; by the locked definition a
`max-width: 767.98px` condition would make B = 767.98, as for the freelancer page, so 767.98 appears only as a `min-width`). `edits.json`: 13 specs N01 to N13:

| spec | case |
|---|---|
| N01 | Desktop colour after a Phone custom colour |
| N02 | Desktop colour after a Tablet custom colour |
| N03 | the reverse order (Desktop colour, then Phone custom) |
| N04 | Desktop font-family and text-align after Tablet custom ones |
| N05 | Desktop colour after BOTH views custom |
| N06 | Reset Tablet after a later Desktop colour: the Desktop edit stays |
| N07 | custom on one element, Desktop edit on another: no effect on the first |
| N08 | tablet-only width, Desktop width edit |
| N09 | tablet-only font-size, Desktop edit |
| N10 | tablet-only font-size, custom Tablet edit |
| N11 | tablet-only padding, Desktop edit |
| N12 | Bootstrap-style page, one Desktop size edit at the six widths |
| N13 | Bootstrap-style page, one custom Tablet edit at the six widths |

## 5. Pass line

0 FAIL in the N-specs and the 32 M-specs (M20 stays REFUSED); every earlier suite as in the small-views run (180 of 180 compared exports byte-identical, the retired S09 and Z09 excepted); no-op round trips
byte-identical; speed thresholds met; `npm test`, typecheck, lint and build clean with no fewer passes than the baseline plus new; scorer check passed (Step 1, 6 switches); locked files byte-identical; one complete
final run on the final commit. Any miss fails the round; no tuning; post-run changes are labelled iterations.
