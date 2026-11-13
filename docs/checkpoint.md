# Engine gate: checkpoint after Step 3 (speed measured, scoring NOT run)

Status: **waiting for Max to approve speed thresholds.** The scoring harness (Step 4) has not been
written or run. Nothing below says whether the 40 edits pass.

## What exists

- `fixtures/` (10 files) and `fixtures/edits.json` (40 edits), locked in commit `090b9ef`.
- `engine/`: TypeScript (strict) library, 96 unit tests passing (`make node-test`), runs in a
  browser. parse5 + postcss for source offsets; edits are text patches against the original text.
  See `docs/adr/0002-engine-parsers-and-patch-export.md` and the docstring at the top of
  `engine/src/edit.ts` for the placement rules and the limits.
- `harness/speed.ts` (this checkpoint's measurements). `harness/run-gate.ts` does not exist yet.
- Python scaffolding untouched: `make lint` and `make test` pass as on `main`.

## Machine and versions

Apple M5 (`Mac17,4`), 10 cores, 32 GiB, macOS (Darwin 25.6.0), arm64. Node v24.21.0, Playwright
1.65.0, headless Chromium 158.0.8127.18 (Playwright's own build, not Max's Chrome). Viewport
1280 x 800. Measured 2026-11-08, raw numbers in `results/timing.json`.

## Speed numbers

"Source in to preview ready" = engine `createModel` (parse + stylesheet model) plus `createPreview`
(build the sandboxed scripts-off iframe, wait for load, pair every element with its source node).
Median of 20 runs per file. "First" is run 1 of the 20 (cold). Apply = `applyEdit` plus export of
that file's T1 edit, timed as batches of 200 divided by 200 (the page timer is only 0.1 ms
resolution), median of 20 batches.

| fixture | bytes | elements | preview median ms | first run ms | apply+export median |
|---|---:|---:|---:|---:|---:|
| flex-layout.html | 2,054 | 29 | 1.5 | 7.4 | 4.5 µs |
| grid-table.html | 1,547 | 34 | 1.3 | 2.1 | 3.5 µs |
| grouped-transforms.svg | 1,253 | 18 | 1.9 | 3.3 | 0.8 µs |
| inline-styles.html | 1,584 | 15 | 1.1 | 1.7 | 2.7 µs |
| large-page.html | 14,712 | 251 | 2.5 | 5.0 | 33.8 µs |
| linked-css.html | 744 (+css) | 19 | 1.2 | 2.1 | 2.5 µs |
| messy.html | 1,219 | 18 | 1.1 | 1.9 | 2.5 µs |
| shapes-text.svg | 917 | 9 | 1.8 | 2.3 | 0.5 µs |
| shared-classes.html | 1,257 | 19 | 1.1 | 1.3 | 2.0 µs |
| style-block.html | 1,275 | 14 | 1.1 | 1.7 | 2.0 µs |

- Preview ready: worst median **2.5 ms** (large-page), median of medians 1.25 ms, worst first run 7.4 ms.
- Apply + export: worst median **0.034 ms** (large-page). Excludes applying the DOM operations to
  the preview and excludes re-parsing after the edit (the next edit's model).
- Bundle (esbuild, minified IIFE, browser target): **252,897 bytes raw, 71,239 bytes gzip**.
  Breakdown of the raw size: parse5 139,801 (of which the `entities` table is 33,288), postcss
  56,992, engine code 20,882, everything else under 1,000.
- Largest fixture: `large-page.html`, **14,712 bytes**, 403 lines, 251 elements.

All 10 files built a preview and every element paired with its source node (the pairing throws on
any mismatch). All 10 T1 edits returned a result rather than a refusal; that is a plumbing status,
not a correctness check, and it was not compared with the specs.

## Proposed speed thresholds (for Max to set)

| item | proposed threshold | reason |
|---|---|---|
| preview ready, median per file, 20 runs | <= 100 ms | Under the point where paste-then-see feels laggy; about 40x headroom over the slowest measured file (2.5 ms) to absorb slower laptops and phones. |
| apply one edit + export, median per file | <= 10 ms | Inside one 16 ms frame, so it can run on every drag step; about 300x headroom over 0.034 ms. |
| bundle, gzip | <= 100 KB | Fits a static-page budget with about 40% headroom over 71 KB for fixes. |
| bundle, raw | <= 350 KB | Same reasoning, about 40% over 253 KB. |
| largest tested input | report only (14,712 bytes) | Fixtures are small; the thresholds above are only claimed up to that size. |

Honest caveats: these are measured on a fast machine with a warm cache; real pasted pages can be
10x to 100x bigger than `large-page.html`; the preview time excludes images and web fonts (none in
the fixtures). The cheapest test that would settle the size question: replicate `large-page.html`'s
body 10x (about 150 KB) and 100x and re-run `npm run speed`. Not done, because it is not part of
the brief; say the word.

## Things to know before Step 4

1. **A bug was found and fixed before this checkpoint, via the speed run's refusal status.** The
   first speed run showed 3 of the 10 T1 edits refused as `shorthand-mix` (flex-layout,
   shared-classes, large-page). Cause: my property-family check treated any two `font-*`
   properties as related (for example `font-size` vs `font-family`); only a shorthand against its
   longhands should conflict. Fixed in `engine/src/edit.ts` with a regression test. No spec was
   consulted and nothing was scored, but you should know the engine changed after seeing a
   refusal, so you can judge whether Step 4 should count that as an iteration. I treated it as
   pre-gate development because no gate result existed yet.
2. Before the speed run was sound, the preview/source pairing also failed once in unit tests
   (the preview swaps `<link>` for `<style>`); fixed in the same commit range, test added.
3. Known engine limits (full list in the `applyEdit` docstring): refuses `!important` conflicts,
   edits inside `@media`, shorthand/longhand mixes for padding, margin and font, HTML offsets
   under a transformed ancestor or on `display:inline` elements, SVG elements shared through
   `<defs>`/`<use>`, and SVG elements styled by a `<style>` rule. A refusal counts as a FAIL for
   that edit in the gate.
4. The fixtures were written by the same agent that wrote the engine, probably easier than real
   pasted code.

## Next

Reply with the thresholds you want (or "use the proposed ones"). Then I commit
`docs: add speed thresholds`, write `harness/run-gate.ts`, run the no-op round trip on all 10
files first, then the 40 edits, and report the verdict computed from the locked rules only.
