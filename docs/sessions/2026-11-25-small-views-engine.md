# Session: small views, engine spike (2026-11-25)

Branch `feat/small-views-engine`, from `main` at `a5f954a`. Nothing pushed; no UI; `portfolio-site` untouched; no LLM or paid service. Brief: `~/Desktop/Projects/ui-editor-small-views-engine-brief.md`.

## What and why

Max's new responsive model: Phone and Tablet follow Desktop in proportion by default; an edit made in Phone or Tablet is custom to that view and survives later Desktop edits; a view can be reset. This spike
proves the engine side only: Tablet as a third environment, small-view edits that are always custom (the Link flag ignored), the Desktop cascade over pinned values, `resetView` and `customEdits`.

## What was done

1. **Step 0, lock (`647ff3b`):** `docs/small-views-rules.md` (ranges, `tabletMax`, "customised in a view", checks, the RETIRED list written before any run), 14 fixture pages in `fixtures/views/` and 32 specs M01 to M32.
   Every expected number was validated in plain Chromium without the engine (`harness/validate-views-specs.ts`: a hand-built reference stylesheet per spec).
2. **Step 1:** baseline of 182 exports (`results/views/baseline-hashes.json`); the old engine fails 23 of the 32 specs (it treats `tablet` as "not phone"; `resetView` does not exist; the 768 page accepts a
   Tablet edit); 22 scorer controls behave (12 fault switches, under the 14 limit, `views-check/results/scorer-check.txt`); the earlier suites' faults and the insert and hardening controls were re-run.
3. **Step 2:** Tablet and `tabletMax` (`85e44f4`), custom Phone and Tablet edits plus the cascade (`40a085f`), `resetView` and `customEdits`, ADR 0006 and
   known limits. The five existing suites, the 36 insert and 20 hardening specs were re-run after the engine commits: 180 of 180 compared exports byte-identical.
4. **Amendment 1 (before the scored run):** three scorer details found by a development run (descendants of an edited element, resolved grid track sizes, no overflow rule for an offset). Rules unchanged.
5. **Step 3, scored run `m1` on `6e480ed`: PASS, all eight items** (`views-check/results/views-summary.md`).

## Result of run m1

- 32 M-specs: 31 PASS, M20 REFUSED as declared (`tablet-covered-by-phone`; `bp768.html` has its phone breakpoint at 768), 0 FAIL.
- Regression: gate 40/40, real-page 20/20, responsive 18 PASS + 1 REFUSED (S09 RETIRED), size 15/16 (Z09 RETIRED) and flex 5 + Z22 REFUSED, insert 30 + 6, hardening 20; 180 of 180 compared exports
  byte-identical (only the two retired specs' exports changed); 68 of 68 no-op round trip rows identical.
- Speed: preview 2.55 ms, apply 0.072 ms, 10x page 8.05 ms and 0.574 ms; bundle 292,255 B raw, 84,637 B gzip (up 2,374 and 779 bytes on the hardening engine); all inside thresholds.
- `npm test`: 214 passed (204 + 10 new in `engine/test/views.test.ts`), 1 skipped (the retired unit test), 0 failed; typecheck, lint, build clean.

## RETIRED

`fixtures/responsive/edits.json` S09, `fixtures/size/edits.json` Z09 and the unit test "gives the same ratio whichever environment the edit was made in" (`engine/test/responsive.test.ts`, now `it.skip`
with a comment): each made a Phone edit with link on that scaled Desktop. Replaced by M09, M10, M31 (and M21).

## Decisions for Max

- **The ranges:** Tablet = `floor(B)+1` to T; T = the page's largest `max-width` above 768 and up to 1100 (a page with its own 900 breakpoint has T = 900), else 1024; widths above T are Desktop for custom
  ranges. A Desktop edit still covers the tablet range (rule from B+1 up).
- **B = 768 refusal:** 1 of 14 fixture pages, 0 of 5 real pages. If you would rather have Phone mean "up to 767" on such pages, the Phone definition changes, not the refusal.
- **The cascade representation:** the view's own rule is written again after the Desktop rules (measured, restated from the model so a flex-basis or the width guard come along); scoping the Desktop rule to
  `min-width: T+1` was rejected (it loses Phone). A Desktop edit of a non-ratio property that is also custom in a view is still refused (`pinned-conflict`).
- **Reset of Desktop:** `resetView(edits, 'desktop')` returns the list unchanged; `customEdits(edits, 'desktop')` is empty.
- **Width/height** keep scaling only the Phone and Desktop declarations (no tablet-only declared width).

## What the page will need

Edit shape `{ op, ..., environment: 'desktop' | 'tablet' | 'phone', link? }` (link ignored for the small views); exports `tabletMax`, `tabletMin`, `resetView`, `customEdits`, `envCondition(env, b, t?)`,
`chainEnv(chain, b, t?)`; the refusal code `tablet-covered-by-phone`; `Pin.environment` may be `'tablet'`. No new result fields. Vendoring into `portfolio-site` = rebuild `engine.js` with the README's command, add
these to `engine.d.ts` (`Environment`, the new functions), and drop the Link checkbox, dots and Review list in the page: not done here.

## Could not verify

The specs were written by Claude Code (Chromium only, fixed widths, no pointer interaction); no spec has a tablet-only declared width or a real page with a tablet band (Bootstrap's, T = 991.98) was not edited;
a Desktop edit after a Tablet custom `colour` is refused rather than handled. Mistake to report: after the controls run the earlier insert and hardening scripts rewrote two `scorer-check.txt` files without their
appended notes; I put the committed text back with `git show HEAD:<file> > <file>` (not a git checkout).

## Next

`git log --oneline main..feat/small-views-engine`, `cat views-check/results/views-summary.md`.
