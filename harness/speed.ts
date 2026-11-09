// Step 3: speed measurements only. Does not score edits against the locked specs.
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { cpus, totalmem, arch, release } from 'node:os';
import { join } from 'node:path';
import { loadEdits, loadFixtures, ROOT } from './fixtures';
import { serve } from './serve';

const RUNS = 20;

execSync('node harness/bundle.mjs', { cwd: ROOT, stdio: 'inherit' });
const size = JSON.parse(readFileSync(join(ROOT, 'build/engine-size.json'), 'utf8')) as { rawBytes: number; gzipBytes: number };

const fixtures = loadFixtures();
const edits = loadEdits().edits;
const t1: Record<string, unknown> = {};
for (const e of edits) if (e.type === 'T1') t1[e.file] = e;

const { url, server } = await serve(ROOT);
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.error('pageerror', e.message));
await page.goto(url);
await page.addScriptTag({ url: '/engine.js' });
await page.addScriptTag({ path: join(ROOT, 'harness/page-speed.js') });
const rows = (await page.evaluate(([f, e, n]) => (window as never as { runSpeed: (...a: unknown[]) => Promise<unknown> }).runSpeed(f, e, n), [fixtures, t1, RUNS] as const)) as {
  file: string; bytes: number; elements: number;
  previewMs: { median: number; min: number; max: number; first: number };
  applyMs: { median: number; min: number; max: number };
  applyStatus: string; applyRefusal: string;
}[];
const chromiumVersion = browser.version();
await browser.close();
server.close();

let model = 'unknown';
try { model = execSync('sysctl -n hw.model', { encoding: 'utf8' }).trim(); } catch { /* not macOS */ }
const timing = {
  measuredAt: new Date().toISOString(),
  runsPerFile: RUNS,
  machine: { model, cpu: cpus()[0]?.model, cores: cpus().length, ramGiB: +(totalmem() / 2 ** 30).toFixed(1), os: `${process.platform} ${release()}`, arch: arch() },
  versions: { node: process.version, chromium: chromiumVersion, playwright: (JSON.parse(readFileSync(join(ROOT, 'node_modules/playwright/package.json'), 'utf8')) as { version: string }).version },
  bundle: size,
  largestFixture: rows.reduce((a, b) => (b.bytes > a.bytes ? b : a)),
  perFile: rows,
  overall: {
    medianOfMedians_previewMs: median(rows.map((r) => r.previewMs.median)),
    worstMedian_previewMs: Math.max(...rows.map((r) => r.previewMs.median)),
    medianOfMedians_applyMs: median(rows.map((r) => r.applyMs.median)),
    worstMedian_applyMs: Math.max(...rows.map((r) => r.applyMs.median)),
  },
};
function median(a: number[]): number {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
mkdirSync(join(ROOT, 'results'), { recursive: true });
writeFileSync(join(ROOT, 'results/timing.json'), JSON.stringify(timing, null, 2) + '\n');
console.table(rows.map((r) => ({ file: r.file, bytes: r.bytes, els: r.elements, 'preview med ms': +r.previewMs.median.toFixed(1), 'first ms': +r.previewMs.first.toFixed(1), 'apply med ms': +r.applyMs.median.toFixed(3), apply: r.applyStatus + (r.applyRefusal ? ':' + r.applyRefusal : '') })));
console.log(JSON.stringify({ bundle: size, overall: timing.overall, machine: timing.machine, versions: timing.versions }, null, 2));
