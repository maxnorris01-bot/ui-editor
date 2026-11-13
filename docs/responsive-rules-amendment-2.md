# Responsive rules, amendment 2 (E5, a missing final newline)

`docs/responsive-rules.md` and `docs/responsive-rules-amendment-1.md` stay as they are. This file adds
one amendment to E5 (minimal diff). Nothing else changes.

## What changes

When the ORIGINAL file lacks a final newline, and the export differs only by appended content that
begins with exactly one newline character directly after the original's last character, the
original's last line counts as unchanged. For the line diff, the original and the export are compared
with that single end-of-file newline difference normalised away.

Any other change to the last line, any second newline difference, or any change anywhere else is
still an E5 failure.

**Operational definition (mine).** The normalisation applies when all of these hold: the original does
not end with `\n`; the export starts with the original's full text followed by `\n`; the character after
that `\n` exists and is not another `\n` (so there is appended content, and it begins with exactly one
newline). Then the original is compared as if it had one final `\n`. In every other case the original
and the export are compared as they are. It is applied per file, in all suites' E5.

## Why

Git and line diffs report the old last line as changed only because the file had no end-of-file
newline. The text of that line is the same.

## When and by whom

Made after seeing R09's result (iteration 2, E5 failing on `css/styles.css`), on 2026-11-12, by Max's
decision, as the second post-hoc amendment of this iteration. It applies to all suites from here on.
R09 under the locked E5 stays recorded as FAIL.

E4, amendment 1 and every other rule are unchanged.
