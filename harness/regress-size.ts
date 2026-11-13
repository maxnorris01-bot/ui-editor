// Regression check for the size-scaling iteration (docs/size-scaling-rules.md section 4 item 2): every existing edit that is NOT
// listed as a width/height edit must export byte-identical to the baseline saved before the engine change.
//   npx tsx harness/regress-size.ts      (baseline-exports/ vs new-exports/, both gitignored)
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './fixtures';

const LISTED = new Set(['gate/E02', 'gate/E10', 'gate/E14', 'gate/E18', 'real/R02', 'real/R06', 'real/R14', 'real/R18', 'resp/S18']);
const walk = (dir: string, pre: string, out: Record<string, string>) => {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) walk(join(dir, e.name), `${pre}${e.name}/`, out);
    else out[`${pre}${e.name}`] = createHash('sha256').update(readFileSync(join(dir, e.name))).digest('hex');
  }
};
const base: Record<string, string> = {}, now: Record<string, string> = {};
walk(join(ROOT, 'baseline-exports'), '', base);
walk(join(ROOT, 'new-exports'), '', now);
const edits = new Set(Object.keys(base).map((k) => k.split('/').slice(0, 2).join('/')));
const rows = [...edits].sort().map((id) => {
  const bf = Object.keys(base).filter((k) => k.startsWith(`${id}/`)), nf = Object.keys(now).filter((k) => k.startsWith(`${id}/`));
  const identical = bf.length === nf.length && bf.every((k) => base[k] === now[k]);
  return { id, listed: LISTED.has(id), identical };
});
const required = rows.filter((r) => !r.listed);
const result = {
  checked: rows.length,
  requiredIdentical: required.length,
  byteIdentical: required.filter((r) => r.identical).length,
  notIdentical: required.filter((r) => !r.identical).map((r) => r.id),
  listed: rows.filter((r) => r.listed).map((r) => ({ id: r.id, identical: r.identical })),
};
writeFileSync(join(ROOT, 'size-check/results/regression.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
