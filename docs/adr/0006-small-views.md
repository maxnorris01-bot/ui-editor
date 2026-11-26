# ADR 0006: Three views (Desktop, Tablet, Phone), custom small-view edits and Reset

Status: accepted for the small-views spike (2026-11-25). Rules, specs and pass line: `docs/small-views-rules.md` and amendment 1. Max's decisions of 2026-11-25 are the
starting point; choices marked **(mine)** are the implementing agent's and are listed for Max in the session note. Builds on ADR 0003 (responsive edits) and 0004/0005.

## Context

The engine had two environments (desktop, phone) and a Link flag with pins and a "Review unlinked" list, which Max found hard to use. The model he chose: Phone and Tablet start as
the Desktop setup scaled in proportion; an edit made in Phone or Tablet is custom to that view only and survives later Desktop edits; a view can be reset to the Desktop default.

## Decision

- `Environment` is `'desktop' | 'tablet' | 'phone'`. **Desktop edits are written exactly as before** (a rule from B+1 up and scaled values at the page's own other widths): no existing byte
  changes when no Tablet or Phone custom edit exists (182 baseline exports compared; only the two retired specs differ).
- **Ranges (mine):** B = `breakpointOf` (unchanged). `tabletMax(model)` = T: the page's largest `max-width` condition above 768 and at most 1100 px, else 1024. Phone = widths <= B, Tablet = whole
  widths from `floor(B)+1` to T, Desktop above T. `envCondition('tablet', b, t)` is `@media (min-width: (floor(b)+1)px) and (max-width: tpx)`. `chainEnv(chain, b, t)` tells three views apart
  (`'tablet'` for a chain that matches only the tablet range); without `t` it answers as before.
- **Phone and Tablet edits are always custom:** `link` is ignored; the value is written inside the view's own condition by the existing unlinked machinery and pinned (`Pin.environment` may be
  `'tablet'`). Offsets and reorders in a small view are the existing unlinked offset and CSS `order` reorder, with the same limits and refusals. `link: false` on a Desktop edit is unchanged.
  Content edits ignore the environment. SVG documents ignore it.
- **B = 768 (mine):** when `floor(B)+1 > 768` the Tablet frame's width is already a phone width, so a Tablet edit is refused with `tablet-covered-by-phone` (no change); a Phone edit covers 768.
  Fixtures and real pages in this case: 1 of 14 fixture pages (`bp768.html`), 0 of the 5 real pages (B: freelancer 767.98, lee munroe 640, mailgun 599, the two SVGs 767).
- **Cascade (decided by measurement): restate the view's rule.** A Desktop edit after a custom value for the same element and property would override it (the new Desktop rule is later and of equal
  specificity). The engine already restated a pinned page value for a group of conditional rules; `chainEnv` with `t` lets it recognise the Tablet group. For lines it writes that still match a width
  inside a pinned view with another value (the base rule, a group that spans both small views such as `max-width: 900px`, a width or height rule), `restatePins` writes the view's own earlier rule again after
  them (read from the model: all its declarations, so a flex-basis or the max-width guard come along). Nothing is added when the lines already keep the pinned value in force, so Phone cases that already worked
  keep their bytes. Alternatives rejected: scoping the Desktop rule to `min-width: T+1` for pinned properties (loses the Phone and unscaled values that need the base rule) and refusing every case (`pinned-conflict`
  stays only for a linked non-ratio edit of a pinned property, such as a colour, which would be written inline and override the view).
- **Reset:** pure functions in `engine/src/views.ts`. `resetView(edits, env)` returns the list without the element edits (`set`, `offset`, `reorder`) whose `environment` is `env` (`'tablet'` or `'phone'`); for
  `'desktop'` it returns the same list (not offered). `customEdits(edits, env)` returns what would be dropped (empty for Desktop). Content edits are never dropped. The page replays the result from the original, so the
  pins and every rule the dropped edits appended are gone and the export equals a list that never contained them. Later Desktop edits stay and are rewritten without the restatement they needed.
- **Pins across structural edits** already follow insert, remove and reorder (ADR 0004 and 0005) and carry the environment unchanged, so Tablet pins need no new code (spec M29).

## Edit shapes and API for the page

`{ op: 'set' | 'offset' | 'reorder', ..., environment: 'desktop' | 'tablet' | 'phone', link? }` (link is ignored for the small views); new exports `tabletMax`, `tabletMin`, `resetView`, `customEdits`;
`envCondition(env, b, t?)`; `chainEnv(chain, b, t?)`. New refusal code `tablet-covered-by-phone`. No new result fields. `listUnlinked` stays (pins now may be `'tablet'`).

## Consequences and limits

- Width and height edits scale the declared phone value and the Desktop value only (the existing size-scaling reference widths 390 and 1280); a width or height declared only for the tablet range is left alone with a note.
- A Desktop edit that would be written inline (a non-ratio property with media rules) after a custom value in a small view is still refused (`pinned-conflict`).
- Real pages whose own CSS has a tablet-only band (for example Bootstrap's `min-width: 768px and max-width: 991.98px`) get T = 991.98 and the Tablet range is B+1 to T; widths above T count as Desktop for custom ranges.

## Addendum (2026-11-25, follow-up round): Desktop edits of non-ratio properties and tablet-only declarations

Rules: `docs/small-views-followup-rules.md`. Decision (chosen by measurement, specs N01 to N13):
- **The `pinned-conflict` refusal is removed.** A Desktop edit of a non-ratio property is still written as before (in place, or an inline style when the page has media rules for it: same bytes when
  nothing is custom). Because an inline style beats every ordinary rule, each view where that element and property is custom gets its own rule written again after it, inside its own media condition and with
  `!important` (`viewRuleLine`, read from the model so all its declarations come along). Alternatives rejected: replacing the inline write by a scoped base rule (changes the bytes when nothing is custom) and
  scoping the Desktop value away from the custom view (loses the views that need it). Nothing needed to stay refused.
- **A length declared only for the tablet range** is scaled by a Desktop width or height edit (`linkedSize`): a chain that matches no phone and no desktop width (`chainEnv(chain, b, t) === 'tablet'`) with a fixed
  px, rem or em value gets a line with the scaled value inside the same condition (plus the width guard when the element has no max-width). Font-size and padding already scaled it; Phone is untouched by it.
- **Fractional breakpoints** (B = 575.98, T = 991.98) needed no change: the Tablet range starts at `floor(B)+1`.
