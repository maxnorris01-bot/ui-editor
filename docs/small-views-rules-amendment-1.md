# Small views rules, amendment 1 (scorer details found while running the specs against the first engine build)

Written after the lock commit `647ff3b` and **before the scored run**; the locked files are not edited (a flaw found before anything is scored is a re-lock with a numbered
amendment). The first development run of the harness (`mdev1`, nothing counted) showed three scorer details that disagree with what the locked rules mean. Every item is **(mine)**.

1. **Descendants of an edited element may change.** The collateral rule in section 4 says "the layout consequences the edit may legitimately have (the `flow` class of
   `docs/gate-rules.md` 5.5)", and that class includes the target's descendants (a font size is inherited). The harness compared them strictly (M32: the `<strong>` and `<br>`
   inside the edited table cell changed font size by inheritance). It now excludes the subtrees of the edited targets, as the `flow` class does.
2. **Resolved grid track sizes are layout-resolved properties.** `grid-template-columns` and `grid-template-rows` computed values are the resolved track widths: when a grid item gets an
   explicit width they legitimately change on the grid container (M26). They are added to the layout-resolved list (with `width`, `height`, `inline-size`, `block-size`, `perspective-origin`,
   `transform-origin`) for the elements the `flow` class already allows to change layout, for the views specs only.
3. **No new horizontal overflow does not apply to an offset.** A translate moves a box (M18's 10 px shift of a full-width block makes the page 10 px wider at 768 by definition). The
   overflow part of the collateral check is skipped for specs whose steps are offsets; it still applies to every other spec.
