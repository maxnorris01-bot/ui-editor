# README after release (2026-11-27)

Branch `docs/readme-live`, from `main` at `f023d72`. Docs only: `README.md` (one sentence), this note, one working-notes entry. Nothing pushed.

## Changed
README line 11, Demo. Before: "That page is hidden until its release, so the link returns "Page not found" until then." After: "The page is released and the link works (checked 2026-11-27)." The sentence about no screenshot or GIF is kept: there is no `images/` folder.

## Other README lines checked for dependence on the repo being private or the page unreleased
- Line 5 (badge): URL matches `ci.yml`; now renders (200). Unchanged.
- Line 7 (badge caveat): describes the workflow only. Unchanged.
- Line 75 (clone URL): works anonymously. Unchanged.
- Lines 72 and 99 ("fresh clone", "author's machine"): still true. Unchanged.
- No other "private", "hidden", "release" or "access" wording found.

## Checks
- `git -c credential.helper= ls-remote` (no prompt) printed `f023d72f108d83d77d544c51c8ea8d1c56a7f2b1 HEAD`.
- Badge: HTTP 200.
- Links (curl -sIL, browser User-Agent): 200 for the live page, the repository, the badge, htmldrag.com, dev.to, cssstudio.ai, Chrome docs, Mozilla add-on, Chrome Web Store, Product Hunt. 403 for alternativeto.net and microlaunch.net, 429 for everydev.ai: these refuse automated requests, not shown dead.
- The live page's HTML does not contain "page not found" (HTTP status only; not browsed).

## Open
The site sends `X-Robots-Tag: noindex` (Max is checking); the README does not claim the page is indexed.
