// Amendment 2 to E5 (docs/responsive-rules-amendment-2.md): when the ORIGINAL lacks a final newline and the export is the
// original plus a newline plus appended content (exactly one newline directly after the original's last character), the
// original is compared as if it ended with that newline. Operational definition (mine); applies per file.
export function normOrig(o: string, x: string): string {
  if (o === '' || o.endsWith('\n')) return o;
  if (!x.startsWith(`${o}\n`)) return o;
  const next = x[o.length + 1];
  if (next === undefined || next === '\n') return o;
  return `${o}\n`;
}
