# Responsive rules, amendment 1 (E4, preceding siblings in the same line)

`docs/responsive-rules.md` stays as locked. This file adds one amendment to it. Nothing else changes.

## What changes

E4 ("nothing else changed") already lets some things differ as the legitimate consequence of an
edit: the layout-resolved computed properties (`width`, `height`, `inline-size`, `block-size`,
`perspective-origin`, `transform-origin`) and the bounding box, for the elements that the spec's
`legit` class names (as defined in `docs/gate-rules.md` section 5.5 and used so far for ancestors,
following siblings and their descendants).

Amendment 1 extends that same allowance to the **preceding siblings** of the target and of each of
the target's ancestors, and to all of their descendants, but only when:

1. the container (the parent of the target, or of that ancestor) is a table row (`tr`) or a flex or
   grid container, and
2. only for the layout-resolved properties and the bounding box (size and position consequences).

Any other computed property differing on any element is still a FAIL: colour, font, margin and
padding as declared, `order`, visibility, `display`, and so on. Elements outside those containers
get no new allowance.

**Operational definition (mine).** "Flex or grid container" means the original document's computed
`display` of the container is `flex`, `inline-flex`, `grid` or `inline-grid`. "Table row" means the
container's tag is `tr`. The check is made on the original document, at the width being tested.

## Why

Table cells in one row share the row's height, and flex or grid items in one line share the cross
size. When an edit makes one cell or item taller, its neighbours before it in source order grow too.
No engine can avoid that, so the old rule (following siblings only) had a gap.

## When and by whom

Made after seeing responsive run 1's result (R01 failing E4: an empty spacer cell before the edited
cell grew from 414 to 424.4 px), on 2026-11-12, by Max's decision. It applies to all suites from
here on. R01 under the locked rules stays recorded as FAIL in run 1; iteration 2 reports R01 under
both the locked and the amended E4.

E5 and all other rules are unchanged.
