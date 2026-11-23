// Regression check for the insert-and-comments iteration (docs/insert-comments-rules.md section 5 item 2): every existing edit
// must export byte-identical to the baseline saved before the engine changed (results/insert/baseline-hashes.json, made with
// the engine at main 27065d8). No existing edit is exempt.
//   npx tsx harness/regress-insert.ts      (new-exports/ vs the hashes)
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './fixtures';

const base = JSON.parse(readFileSync(join(ROOT, 'results/insert/baseline-hashes.json'), 'utf8')) as Record<string, string>;
const now: Record<string, string> = {};
const walk = (dir: string, pre: string) => {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) walk(join(dir, e.name), `${pre}${e.name}/`);
    else now[`${pre}${e.name}`] = createHash('sha256').update(readFileSync(join(dir, e.name))).digest('hex');
  }
};
walk(join(ROOT, 'new-exports'), '');
const missing = Object.keys(base).filter((k) => !(k in now));
const different = Object.keys(base).filter((k) => k in now && base[k] !== now[k]);
const extra = Object.keys(now).filter((k) => !(k in base));
const result = { baselineFiles: Object.keys(base).length, byteIdentical: Object.keys(base).length - missing.length - different.length, different, missing, extra };
if (process.env.WRITE) writeFileSync(join(ROOT, 'insert-check/results/regression.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
process.exit(different.length || missing.length || extra.length ? 1 : 0);
