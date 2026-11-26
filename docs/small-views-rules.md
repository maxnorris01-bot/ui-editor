# Small views engine rules (LOCKED)

Locked in the commit `docs: lock small views engine rules, fixtures and specs`. After that commit this file, `fixtures/views/*` and
`fixtures/views/edits.json` are never edited; a flaw found before anything is scored is a re-lock (a new commit, numbered amendments). All earlier rules,
specs and amendments stay in force except the RETIRED list in section 5. Brief: `~/Desktop/Projects/ui-editor-small-views-engine-brief.md` (Max's decisions of
2026-11-25). Nothing here calls an LLM or a paid service. Sections marked **(mine)** are operational definitions written by the implementing agent.

Question: **with three views (Desktop, Tablet, Phone), does a Desktop edit reach the small views in proportion, does an edit made in Tablet or Phone stay in its
own view and survive later Desktop edits, does Reset of a view give back exactly the list that never had those edits, and does nothing else change?**

## 1. Behaviour

1. `Environment` is `'desktop' | 'tablet' | 'phone'`. A Desktop edit is written as today (a rule from B+1 up, scaled values at the page's own other widths); a Desktop
   edit made when no Tablet or Phone custom edit exists exports byte-identical files to the saved baseline.
2. For `environment: 'phone'` or `'tablet'` the `link` flag is IGNORED: the edit is custom, written inside that view's media condition and pinned there (pins carry
   `'tablet'` too). The old "an edit made in Phone with link on also scales Desktop" is removed. `link: false` on a Desktop edit keeps its meaning.
3. A custom edit never reaches Desktop or the other small view. A later Desktop edit of the same element and property does not override it, still reaches every
   other width and every unpinned property.
4. `resetView(edits, env)` returns the list without the element edits (`set`, `offset`, `reorder`) whose `environment` is `env` (`'tablet'` or `'phone'`); for
   `'desktop'` it returns the list unchanged (Reset of Desktop is not offered). `customEdits(edits, env)` returns the edits that would be dropped. Replaying the result
   from the original gives the export; it equals the export of a list that never contained those edits, byte for byte. Content edits (insert, text, remove, note) are
   never dropped and ignore the environment.
5. SVG documents have no environments: the field is ignored there.
6. Content edits are unchanged. Offsets and unlinked reorders keep today's rules and refusals (an unlinked reorder only places an element first or last among siblings
   whose `order` values are all equal; the CSS `order` property needs a flex or grid parent).

## 2. Ranges (mine)

B = `breakpointOf(model)`: the page's largest `max-width` condition at or below 768 px (em and rem times 16), else 767. T = `tabletMax(model)`: the page's largest `max-width`
condition above 768 and at most 1100 px, else 1024. Only `max-width` conditions of at-rules are read (a `max-width` property in a rule is not a condition).
**Phone** = widths `<= B`. **Tablet** = widths from `floor(B)+1` to `T` (the first whole width above B; for B = 767.98 that is 768). **Desktop** (for custom ranges) = widths above T.
Tablet condition: `@media (min-width: (floor(B)+1)px) and (max-width: Tpx)`; Phone: `@media (max-width: Bpx)`. A Desktop edit keeps today's representation (a rule from B+1 up) and
therefore also covers the tablet range unless that property is pinned in Tablet.
**The B = 768 case:** when `floor(B)+1 > 768` the Tablet frame's width (768) is already a phone width, so there is no tablet band and a Tablet edit is REFUSED with the code
`tablet-covered-by-phone`, no change; a Phone edit covers 768. Count: 1 of the 14 fixture pages (`bp768.html`) and 0 of the 5 real pages (their B: freelancer 767.98, lee munroe
640, mailgun 599, the two SVGs 767).

## 3. "A property is customised in a view" (mine)

An engine-written custom edit leaves a pin `{ selector (the element's path), property, environment, value }`. A property is customised in a view while its pin exists; edits made
in that view update the pin's value; Reset removes the pin by dropping the edit. A Desktop edit of a pinned property keeps the pinned value in force in that view's range by
re-stating the view's own rule after the Desktop rules it would otherwise be overridden by (the representation is decided by measurement and is stated in the ADR).
A linked non-ratio edit of a pinned property that cannot be written safely may still be refused (`pinned-conflict`) with its true reason.

## 4. Independent checks (Chromium, headless, never Max's Chrome; the verdict never reads the engine's model)

`harness/views-lib.ts` defines B, T, the regions and the test widths itself, from this file. Test widths per page: 1280, 1024, 768, 390, B, floor(B)+1, T, T+1.
- **Truth (`measured`):** for each width the region is phone (`<= B`), tablet (`<= T`) or desktop; the computed value of the property at that width equals the spec's
  hand-written value for the region, within 0.5 px (`original`: the value measured on the original page at that width). Each number was validated in plain Chromium without the
  engine by `harness/validate-views-specs.ts` (a reference stylesheet per spec).
- **Collateral:** every element other than the target has the same computed styles and bounding box as in the original at every test width within 0.5 px, except the layout
  consequences the edit may legitimately have (the `flow` class of `docs/gate-rules.md` 5.5 with amendment 1 for text reflow and flex siblings; `reorder` for CSS order).
- **No overflow:** the export's page is not wider than the original's at 390 and 768 (`scrollWidth` at most the larger of the viewport and the original's).
- **Reset:** the export after the reset steps equals, byte for byte, the export of the list whose kept steps the spec names (`equalsSteps`, 1-based among the non-reset steps) or the
  original (`bytes: equals-original`); its computed values equal the page that never had the dropped edits (they are the spec's `measured`). The harness also filters the list itself
  (independently of `resetView`) and compares.
- **No markers:** the text added to the original contains no `data-view`, `data-env`, `data-tablet`, `data-phone`, `tablet` or `phone`, and no comment.
- **Pins:** `listUnlinked` after the last step equals the spec's `unlinked` (paths hand-simulated with the DOM API).
- **Undo by replay:** replaying the first n steps from the original gives exactly the bytes after step n of the full run.
- **No-op round trips:** every fixture parsed and exported with no edits is byte-identical.
- **Outcome:** PASS (every declared check holds), REFUSED-as-declared (the engine refused at the last step with exactly the declared code, nothing written), or FAIL.

## 5. RETIRED list (written before any run)

Retired specs and tests report RETIRED, never PASS. Each makes an edit with `environment: 'phone'` and `link: true` or reads the "other way round" scaling:
| retired | what it does | reason | replaced by |
|---|---|---|---|
| `fixtures/responsive/edits.json` S09 | Phone edit 20 px with link true scales the Desktop and the page's own phone value | the engine no longer scales Desktop from a Phone edit | M09, M10, M31 |
| `fixtures/size/edits.json` Z09 | Phone width edit with link true scales a Desktop declared width | same | M09 (font-size), M21 (width at 768) and the Desktop width specs M04, M05 |
| `engine/test/responsive.test.ts` "gives the same ratio whichever environment the edit was made in" | Phone edit with link on writes `#a { font-size: 50px; }` | same | M09, M10 |
Everything else is mapped, not retired: unlinked or `link: false` Phone edits (S11 to S20 phone parts, Z12, Z13, hardening H01 to H06, insert I33) already mean "custom" and must keep their bytes.

## 6. Pass line

1. Every M-spec meets its declared outcome, 0 FAIL. 2. Regression: gate 40/40, real-page 20/20, responsive and size specs PASS except S09 and Z09 (RETIRED), the 36 insert and 20 hardening
specs unchanged, every Desktop-origin edit in every existing suite byte-identical to the saved baseline (hashes in `results/views/`). 3. All no-op round trips byte-identical. 4. Speed thresholds still met (the
bundle size is reported). 5. `npm test`: no fewer than the baseline passes plus new, 0 fail (the retired unit test is the only one that may change); typecheck, lint and build clean. 6. Scorer check passed
(Step 1). 7. Locked files byte-identical. 8. One complete final run on the final commit. Decided in advance: any miss fails the round; no tuning; name the cheapest next test; post-run changes are
labelled iterations and both runs stay on record.

## 7. Fixtures and specs

`fixtures/views/`: `bp640.html` (title, paragraph, box, card; phone rule at 640), `bp480.html`, `bp767.html`, `bp768.html` (phone rule at 768), `nobp.html` (no media rule), `tab900.html` (adds a 900 px rule),
`tab1024.html` (adds a 1024 px rule), `mediaonly.html` (the heading size only inside media rules), `flex.html`, `grid.html`, and the built-in samples `landing.html` + `landing.css`, `email.html`,
`chart.svg` (byte-identical copies from `portfolio-site`) and `pins.html` (the hardening copy). `edits.json`: 32 specs M01 to M32 (M01 to M07 Desktop edits reach the small views; M08 to M13 and M31
custom edits and the cascade; M14 to M17 Reset; M18 and M19 offset and reorder; M20 to M23 the 768, 900 and 1024 pages; M24 to M26 media-only, flex and grid; M27 SVG; M28 and M29 structure and pins; M30
undo; M32 the email). The numbers of the Desktop specs are the ratio of the new to the old Desktop computed value applied to the page's own value at the other widths. **Stated limit (mine):** width and height
edits scale the declared phone value and the Desktop value only; a width or height declared only for the tablet range is left alone with a note (the existing size-scaling behaviour is not changed), so no spec has one.
