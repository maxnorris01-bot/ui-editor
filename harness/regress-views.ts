// Regression check for the small-views round (docs/small-views-rules.md section 6 item 2): every existing export is byte-identical to the baseline saved before the
// engine changed (results/views/baseline-hashes.json, the engine at main a5f954a), except the exports of the RETIRED specs S09 and Z09.
//   RUN=<id> npx tsx harness/regress-views.ts
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './fixtures';

const RUN = process.env.RUN ?? 'vh1';
const RETIRED = ['resp/S09/', 'size/Z09/'];
const base = JSON.parse(readFileSync(join(ROOT, 'results/views/baseline-hashes.json'), 'utf8')) as Record<string, string>;
const now: Record<string, string> = {};
const walk = (dir: string, pre: string) => {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) walk(join(dir, e.name), `${pre}${e.name}/`);
    else now[`${pre}${e.name}`] = createHash('sha256').update(readFileSync(join(dir, e.name))).digest('hex');
  }
};
walk(join(ROOT, 'new-exports'), '');
walk(join(ROOT, 'insert-check/raw', `run-${RUN}`), 'insert/');
walk(join(ROOT, 'harden-check/raw', `run-${RUN}`), 'harden/');
const isRetired = (k: string) => RETIRED.some((r) => k.startsWith(r));
const keys = Object.keys(base).filter((k) => !isRetired(k));
const missing = keys.filter((k) => !(k in now));
const different = keys.filter((k) => k in now && base[k] !== now[k]);
const extra = Object.keys(now).filter((k) => !(k in base));
const retired = Object.keys(base).filter(isRetired).map((k) => ({ file: k, changed: now[k] !== base[k] }));
const result = { baselineFiles: Object.keys(base).length, comparedFiles: keys.length, byteIdentical: keys.length - missing.length - different.length, different, missing, extra, retired };
if (process.env.WRITE) writeFileSync(join(ROOT, 'views-check/results/regression.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
process.exit(different.length || missing.length || extra.length ? 1 : 0);
