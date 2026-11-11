# Speed thresholds (set by Max, fixed before any scoring)

Set on 2026-11-10 after the Step 3 checkpoint (`docs/checkpoint.md`). They are not changed after
the scoring run. Verdict rule (`docs/gate-rules.md`, section 3): PASS needs the pass line and every
threshold below to be met.

| item | threshold |
|---|---|
| preview ready, median per fixture file, 20 runs | <= 100 ms |
| apply one edit + export, median per fixture file | <= 10 ms |
| bundle, gzip | <= 100 KB (102,400 bytes) |
| bundle, raw | <= 350 KB (358,400 bytes) |
| largest tested fixture | report only |

## Scaling check (added by Max)

A 10x and a 100x copy of `large-page.html` are built in memory by `harness/scale.ts` and are not
committed. The body content is repeated as valid HTML in one document, with every `id` made unique
by a numeric suffix. Same timing method as the fixtures (20 runs for preview ready; batched apply
of one T1 edit plus export).

| item | threshold |
|---|---|
| 10x copy, preview ready, median | <= 250 ms |
| 10x copy, apply one edit + export, median | <= 50 ms |
| 100x copy, both | report only |

## Iteration log note

"Iteration 0" is the shorthand-mix fix made before any scoring; see `docs/checkpoint.md` and the
session notes. It is reported as iteration 0 in the gate summary.
