// Scaling check (added with the speed thresholds): 10x and 100x copies of large-page.html, built in
// memory and never written to the repo. Same timing method as harness/speed.ts. Merges into
// results/timing.json under `scaling`.
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEdits, loadFixtures, ROOT } from './fixtures';
import { serve } from './serve';

const RUNS = 20;
const THRESH = { '10x': { previewMs: 250, applyMs: 50 } } as const;

/** Repeat the <body> content n times with every id (and in-page #fragment) made unique. */
export function scaleHtml(src: string, n: number): string {
  const open = src.indexOf('<body>') + '<body>'.length;
  const close = src.lastIndexOf('</body>');
  const inner = src.slice(open, close);
  const copies: string[] = [];
  for (let k = 0; k < n; k++) copies.push(inner.replace(/\bid="([^"]+)"/g, (_m, id: string) => `id="${id}-${k}"`));
  return src.slice(0, open) + copies.join('') + src.slice(close);
}

execSync('node harness/bundle.mjs', { cwd: ROOT, stdio: 'inherit' });
const base = loadFixtures().find((f) => f.file === 'large-page.html')!;
const t1 = loadEdits().edits.find((e) => e.file === 'large-page.html' && e.type === 'T1')!;
const variants = [1, 10, 100].map((n) => {
  const source = n === 1 ? base.source : scaleHtml(base.source, n);
  const spec = n === 1 ? t1 : { ...t1, target: `${t1.target}-0` };
  return { label: `${n}x`, fixture: { file: 'large-page.html', kind: 'html' as const, source, companions: {}, bytes: Buffer.byteLength(source) }, spec };
});

const { url, server } = await serve(ROOT);
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })).newPage();
await page.goto(url);
await page.addScriptTag({ url: '/engine.js' });
await page.addScriptTag({ path: join(ROOT, 'harness/page-speed.js') });
const out: Record<string, unknown> = {};
for (const v of variants) {
  const rows = (await page.evaluate(([f, e, n]) => (window as never as { runSpeed: (...a: unknown[]) => Promise<unknown[]> }).runSpeed(f, e, n), [[v.fixture], { 'large-page.html': v.spec }, RUNS] as const)) as {
    bytes: number; elements: number; previewMs: { median: number }; applyMs: { median: number }; applyStatus: string; applyRefusal: string;
  }[];
  const r = rows[0]!;
  const th = (THRESH as Record<string, { previewMs: number; applyMs: number }>)[v.label];
  out[v.label] = {
    bytes: r.bytes, elements: r.elements, previewMedianMs: r.previewMs.median, applyMedianMs: r.applyMs.median,
    applyStatus: r.applyStatus + (r.applyRefusal ? ':' + r.applyRefusal : ''),
    threshold: th ?? 'report only',
    pass: th ? r.previewMs.median <= th.previewMs && r.applyMs.median <= th.applyMs && r.applyStatus === 'ok' : null,
  };
  console.log(v.label, JSON.stringify(out[v.label]));
}
await browser.close();
server.close();
const p = join(ROOT, 'results/timing.json');
const t = JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
t.scaling = { measuredAt: new Date().toISOString(), runs: RUNS, ...out };
writeFileSync(p, JSON.stringify(t, null, 2) + '\n');
