// Regression check for the responsive iteration (docs/responsive-rules.md pass line item 3):
// compares the new engine's exports (new-exports/) with the baseline exports saved before the engine changed
// (baseline-exports/). For every edit whose target property has NO conditional (@media) rule anywhere in its page,
// the export must be BYTE-IDENTICAL. Edits whose property does have a media rule may differ.
//   npx tsx harness/regress.ts [realPagesDir]
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createModel } from '../engine/src/index';
import { ROOT, loadEdits } from './fixtures';

const REAL = resolve(process.argv[2] ?? join(ROOT, '../ui-editor-realpages'));
const BASE = join(ROOT, 'baseline-exports');
const NEW = join(ROOT, 'new-exports');

function files(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string, pre: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(d, e.name), `${pre}${e.name}/`);
      else out[`${pre}${e.name}`] = readFileSync(join(d, e.name), 'utf8');
    }
  };
  if (existsSync(dir)) walk(dir, '');
  return out;
}

const SHORT = new Set(['padding', 'margin', 'font']);
const family = (a: string, b: string) => a === b || (SHORT.has(a) && b.startsWith(a + '-')) || (SHORT.has(b) && a.startsWith(b + '-'));

function mediaProps(source: string, kind: 'html' | 'svg', companions: Record<string, string>, file: string): Set<string> {
  const m = createModel(source, kind, companions, file);
  const out = new Set<string>();
  for (const s of m.sheets) for (const r of s.rules) if (r.conditional) for (const d of r.decls) out.add(d.lprop);
  return out;
}

interface Item { suite: string; id: string; prop: string; hasMedia: boolean; identical: boolean }
const items: Item[] = [];

const gate = loadEdits().edits;
for (const e of gate) {
  const file = join(ROOT, 'fixtures', e.file);
  const comps: Record<string, string> = e.file === 'linked-css.html' ? { 'linked-css.css': readFileSync(join(ROOT, 'fixtures/linked-css.css'), 'utf8') } : {};
  const props = e.edit.op === 'set' ? Object.keys(e.edit.properties) : e.edit.op === 'offset' ? ['transform'] : [];
  const mp = mediaProps(readFileSync(file, 'utf8'), e.file.endsWith('.svg') ? 'svg' : 'html', comps, e.file);
  const hasMedia = props.some((p) => [...mp].some((q) => family(p, q)));
  const a = files(join(BASE, 'gate', e.id)), b = files(join(NEW, 'gate', e.id));
  items.push({ suite: 'gate', id: e.id, prop: props.join(',') || '(reorder)', hasMedia, identical: JSON.stringify(a) === JSON.stringify(b) });
}
const real = JSON.parse(readFileSync(join(ROOT, 'realpage-check/edits.json'), 'utf8')) as { companions: Record<string, Record<string, string>>; edits: { id: string; file: string; edit: { op: string; properties?: Record<string, string> } }[] };
for (const e of real.edits) {
  const comps: Record<string, string> = {};
  for (const [href, rel] of Object.entries(real.companions[e.file] ?? {})) comps[href] = readFileSync(join(REAL, rel), 'utf8');
  const props = e.edit.op === 'set' ? Object.keys(e.edit.properties!) : e.edit.op === 'offset' ? ['transform'] : [];
  const mp = mediaProps(readFileSync(join(REAL, e.file), 'utf8'), e.file.endsWith('.svg') ? 'svg' : 'html', comps, e.file);
  const hasMedia = props.some((p) => [...mp].some((q) => family(p, q)));
  const a = files(join(BASE, 'real', e.id)), b = files(join(NEW, 'real', e.id));
  items.push({ suite: 'real', id: e.id, prop: props.join(',') || '(reorder)', hasMedia, identical: JSON.stringify(a) === JSON.stringify(b) });
}
const noMedia = items.filter((i) => !i.hasMedia);
const result = {
  checked: items.length,
  noMediaRule: noMedia.length,
  byteIdentical: noMedia.filter((i) => i.identical).length,
  notIdentical: noMedia.filter((i) => !i.identical).map((i) => `${i.suite}:${i.id}`),
  withMediaRule: items.filter((i) => i.hasMedia).map((i) => ({ id: `${i.suite}:${i.id}`, prop: i.prop, identical: i.identical })),
};
mkdirSync(join(ROOT, 'responsive-check/results'), { recursive: true });
writeFileSync(join(ROOT, 'responsive-check/results/regression.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
