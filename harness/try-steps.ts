// Developer tool: apply a list of steps (JSON) to a fixture with the current engine and print a diff of the export against the original.
//   npx tsx harness/try-steps.ts <fixtureDir> <file> '<steps json>'
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { diffLines } from 'diff';
import { ROOT } from './fixtures';
import { serve } from './serve';

const [dir, file, stepsJson] = process.argv.slice(2) as [string, string, string];
execSync('node harness/bundle.mjs', { cwd: ROOT, stdio: 'ignore' });
const { url, server } = await serve(ROOT);
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();
await ctx.route('**/*', (r) => (r.request().url().startsWith('http://127.0.0.1') ? r.continue() : r.abort()));
const page = await ctx.newPage();
await page.goto(url);
await page.addScriptTag({ url: '/engine.js' });
await page.addScriptTag({ path: join(ROOT, 'harness/page-measure.js') });
await page.addScriptTag({ path: join(ROOT, 'harness/page-insert.js') });
const base = resolve(ROOT, dir);
const companions: Record<string, string> = {};
if (file === 'landing.html') companions['landing.css'] = readFileSync(join(base, 'landing.css'), 'utf8');
const source = readFileSync(join(base, file), 'utf8');
const out = (await page.evaluate(([f, st]) => (window as never as { runInsertSpec: (...a: unknown[]) => Promise<unknown> }).runInsertSpec(f, st, { previewWidths: [] }), [{ file, kind: file.endsWith('.svg') ? 'svg' : 'html', source, companions }, JSON.parse(stepsJson)] as const)) as { refused?: unknown; threw?: string; files?: Record<string, string>; unlinked?: unknown };
if (out.threw || out.refused) console.log('REFUSED/THREW', JSON.stringify(out.refused ?? out.threw));
else {
  const orig: Record<string, string> = { [file]: source, ...companions };
  for (const [n, t] of Object.entries(out.files!)) {
    console.log(`--- ${n}`);
    for (const c of diffLines(orig[n] ?? '', t)) if (c.added || c.removed) process.stdout.write(c.value.split('\n').filter((l, i, a) => i < a.length - 1 || l).map((l) => `${c.added ? '+' : '-'} ${JSON.stringify(l)}`).join('\n') + '\n');
  }
  console.log('unlinked', JSON.stringify(out.unlinked));
}
await browser.close(); server.close();
