# Views real-page rules: amendment 1

**Made before the first scored run** (after the scorer check, run only on hand-built exports, showed a flaw in the locked rules; no engine export had been scored). Locked files
(`docs/views-realpage-rules.md`, `views-check/realpage-edits.json`) are not edited; where this amendment differs, this amendment governs. Sections marked **(mine)** are operational definitions.

## The flaw

Rules section 3 says V14 measures the fractional boundaries B = 767.98 and T = 991.98 "in an iframe whose CSS width is the exact fractional value". The scorer check showed that Chromium cannot do that:
an iframe `width: 767.98px` reports `innerWidth` 768, and `matchMedia('(max-width: 767.98px)')` is **false** inside it (the media-query viewport is snapped to whole pixels; an iframe of 767.5 px also reports
768). A fractional viewport cannot be set through Playwright either (whole pixels only), and window-size plus device-scale-factor flags did not give one in headless Chromium (`innerWidth` 1001 for a
1000-pixel window). The brief allowed for this ("if the browser can set it"). The widths 767.98, 767.5 and 992.98 are therefore NOT tested in a browser.

## What replaces it (mine)

V14 (and nothing else) is scored at these whole widths, as listed in `harness/views-real-lib.ts` `FRAC_WIDTHS`: **767** (Phone, the original's value), **768** (Tablet, the new value), **991** (Tablet),
**992** (Desktop, the original's value), **993** (Desktop). 767/768 and 991/992 are the whole-pixel neighbours of B = 767.98 and T = 991.98 (floor(B), floor(B)+1, floor(T), floor(T)+1). Collateral is
checked at the same widths (check FC). And a **text check FT**: the text the export added to the files contains the exact condition `@media (min-width: 768px) and (max-width: 991.98px)` (so T is
written as read, 991.98, not rounded to 991 or 992). FT is a reading of the engine's output text, not a browser measurement, and the report says so. The locked V14 widths 767.5, 767.98, 991.98 and
992.98 are listed as "could not be tested". Pass line item 4 reads: the whole widths of V14 hold, FT holds, and V15 and V16 equal the saved bytes.

The unfaulted scorer controls for V14 pass the same three checks (FR, FC, FT). The six fault switches of section 6 are unchanged; FT's failing direction is not among them (a seventh switch would exceed the brief's
limit of six) and is not scorer-checked.
