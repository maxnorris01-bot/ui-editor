// Amendment 1 to E4 (docs/responsive-rules-amendment-1.md): preceding siblings of the target and of its ancestors, and their
// descendants, may change in bounding box and layout-resolved properties only, when their container is a table row or a
// flex or grid container (computed on the ORIGINAL document, at the width being tested). Operational definition (mine).
interface Row { parent: number; tag: string; props: string[] }
export function precedingAllowed(rows: Row[], names: string[], t: number): Set<number> {
  const di = names.indexOf('display');
  const out = new Set<number>();
  const kids = (p: number) => rows.map((r, i) => (r.parent === p ? i : -1)).filter((i) => i >= 0);
  const subtree = (i: number): number[] => [i, ...kids(i).flatMap(subtree)];
  const isLine = (c: number) => c >= 0 && (rows[c]!.tag.toLowerCase() === 'tr' || /^(inline-)?(flex|grid)$|^flow-/.test(rows[c]!.props[di] ?? '') || ['flex', 'inline-flex', 'grid', 'inline-grid'].includes(rows[c]!.props[di] ?? ''));
  for (let x = t; x >= 0; x = rows[x]!.parent) {
    const p = rows[x]!.parent;
    if (p < 0 || !isLine(p)) continue;
    for (const s of kids(p)) if (s < x) subtree(s).forEach((k) => out.add(k));
  }
  return out;
}
