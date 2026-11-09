# 0002. Engine: parse5 + postcss for source offsets, patch-based export

- **Status:** accepted (for the gate; revisit after the verdict)
- **Date:** 2026-11-08

## Context
The engine gate (`docs/gate-rules.md`) asks whether a small browser-side library can write visual
edits back into a visitor's own HTML/SVG/CSS text without changing anything else, including
indentation, tag case, quoting, comments, entities and inline scripts. That rules out any approach
that re-prints the tree. The library must run in a browser (no Node-only APIs) and stay small
because it ships on a static page.

## Options considered
1. **Parse to a tree, edit the tree, re-serialise.** Simple, but loses formatting (case, quoting,
   whitespace, unclosed tags, entities) by construction. This is the failed approach the brief
   names; not built, not even for comparison.
2. **parse5 (with `sourceCodeLocationInfo`) for HTML and SVG, postcss for CSS, edits as text
   patches against the original string.** parse5 follows the HTML spec, so its element tree matches
   what Chromium builds (including implied `html/head/body/tbody` and implied end tags), which lets
   the preview DOM be paired with source nodes by document order. It reports offsets for every
   element, start tag and end tag; attribute value offsets are recovered with a small tokenizer
   over the start-tag text. postcss reports offsets for rules and declarations (end offsets are
   exclusive and include the trailing `;`). Both run in a browser.
3. **A hand-written tokenizer for everything.** Smallest bundle, but re-implements HTML's implied
   end tags and error recovery; high risk of silently disagreeing with the browser.
4. **An XML parser (e.g. fast-xml-parser, sax) for SVG.** Preserves case and order, but fails on
   pasted SVG that is not well-formed XML, and a second parser adds bundle weight. Checked instead:
   parse5 keeps SVG element case (`linearGradient`), attribute order and offsets, and treats a
   leading `<?xml ... ?>` as a comment, so it is used for SVG too.

## Decision
Option 2. `parse(source, kind)` returns element trees with offsets (HTML/SVG) or rule/declaration
offsets (CSS). `applyEdit` produces text patches against the original text and a matching list of
live-DOM operations from the same resolved edit. `export` applies patches from the end to the
start and never serialises a tree. The preview is a scripts-off sandboxed iframe whose elements
are paired with source nodes by pre-order index.

Because parse5 parses SVG as HTML foreign content, SVG that is only valid as XML (CDATA subtleties,
custom entities, XML namespaces declared in unusual ways) can be mis-split. That is a stated limit
of v1, not hidden.

## Consequences
- Formatting preservation is by construction for everything outside patched ranges.
- Reordering moves whole source lines when the element owns its lines; elements with no end tag
  need their trailing whitespace trimmed (parse5 includes it in the element range).
- Placement needs real selector matching and computed style, so `applyEdit` takes a `Probe` backed
  by the live preview document (jsdom stands in during unit tests).
- Bundle size is dominated by parse5 and postcss; measured in `docs/checkpoint.md`.
