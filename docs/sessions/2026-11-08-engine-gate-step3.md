# Session: engine gate, Steps 0 to 3 (stopped for speed thresholds)

Written for someone with no context. Branch `feat/engine-gate`, nothing pushed.

## What changed and why

The project asks one question: can a small browser-side engine take pasted HTML or SVG, apply
visual edits (typography, size, move) and write them back into the visitor's own source text so
the exported file renders as edited, changes nothing else and keeps the original formatting. This
session built everything except the scoring run, and stopped where the brief says to stop: Max
sets the speed thresholds before the 40 edits are scored.

- **Step 0, locked first (commit `090b9ef`):** `docs/gate-rules.md` (the brief's rules plus my
  operational definitions), 10 hand-written fixtures (`fixtures/`), and `fixtures/edits.json`
  (40 edits, 4 per file, expected results as browser-measurable values). Before locking I checked
  every selector is unique and ran a crude DOM-manipulation oracle (not the engine) over the
  expected values; 39 matched, and E15's `flex-end` is serialised `flow-end` by this Chromium, so
  the rules carry a value alias instead of the spec changing.
- **Step 1:** Node project (`package.json`, strict TypeScript 7, vitest, playwright, esbuild,
  tsx), Makefile targets `node-install`, `node-test`, `gate`, `.gitignore` additions made before
  generating anything, ADR 0002 (parse5 + postcss, patch-based export).
- **Step 2:** `engine/src/`: `parse`, `describe`/`select`, `applyEdit` (text patches plus matching
  live-DOM operations from one resolved edit), `export` (patches applied end to start, never
  re-serialising), preview (scripts-off sandboxed iframe, elements paired to source nodes), 96 unit
  tests. Placement rules and limits are in the docstring of `engine/src/edit.ts`.
- **Step 3:** `harness/speed.ts` measures speed only; `docs/checkpoint.md` has the numbers and
  proposed thresholds.

Key decisions (reasons in ADR 0002 and `docs/working-notes-and-decisions.md`): text patches not
tree re-printing; reorders move whole source lines (so indentation travels with the element,
including elements with no end tag); a rule is edited only if it targets exactly one element and
would still win the cascade, otherwise a `style` attribute is added; offsets prepend a translate
and SVG offsets are converted through the element's screen matrix.

## Choices Max made mid-session

None. The brief was followed as written.

## Eval numbers

No LLM, no evals run (`make eval-fast` not applicable: nothing here touches prompts or agent
logic; `make eval-fast-live` deliberately not run). Gate scoring has not been run.

Speed (Apple M5, Node v24.21.0, Chromium 158.0.8127.18, 20 runs per file): worst preview-ready
median 2.5 ms; worst apply+export median 0.034 ms; bundle 252,897 B raw / 71,239 B gzip; largest
fixture 14,712 B. Thresholds: not set yet (proposals in `docs/checkpoint.md`).

## Test, lint, typecheck

- `npx tsc --noEmit` (strict): clean.
- `npx vitest run`: 96 passed.
- `make lint`: clean. `make test`: 3 passed (Python scaffolding untouched).

## Flag for review before this merges

1. **Engine bug found and fixed before any scoring**, via a refusal status in the speed run (3 of
   10 T1 edits refused as `shorthand-mix` because `font-size` vs `font-family` were treated as
   related). No spec was consulted. Max may want Step 4 to count it as an iteration; details in
   `docs/checkpoint.md`.
2. Fixtures are small and written by the same agent as the engine; likely easier than real pasted
   code.
3. The unit tests use small synthetic snippets, not the fixtures or the 40 specs, on purpose, to
   keep Step 4 uncontaminated.

## Next command

Read `docs/checkpoint.md`, then reply with the speed thresholds (or "use the proposed ones").
Read-only checks in the meantime: `git log --oneline`, `git diff main --stat`, `make node-test`.
