// Measurement for the brief's pin question: after an unlinked (pinned) edit, can an insert, a remove or a reorder make the pin
// name the wrong element, so that a later LINKED edit scales a value it should have left alone? Each list pins #t4 at phone
// (font-size 20px), makes a structural edit before it, then edits #t4 linked at desktop (16px -> 40px). Right answer: phone stays
// 20px at 640 and 390, desktop is 40px, and listUnlinked names #t4's path after the edit.
//   npx tsx harness/measure-pins.ts [label]
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './fixtures';
import { serve } from './serve';
import { fixtureInput, loadAt, writeSet, HEADER } from './insert-lib';

execSync('node harness/bundle.mjs', { cwd: ROOT, stdio: 'ignore' });
const { url, server } = await serve(ROOT);
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.route('**/*', (r) => (r.request().url().startsWith('http://127.0.0.1') ? r.continue() : r.abort()));
const page = await ctx.newPage();
await page.goto(url);
await page.addScriptTag({ url: '/engine.js' });
await page.addScriptTag({ path: join(ROOT, 'harness/page-measure.js') });
await page.addScriptTag({ path: join(ROOT, 'harness/page-insert.js') });
const inp = fixtureInput('pins.html');
const pin = { op: 'set', target: '#t4', properties: { 'font-size': '20px' }, environment: 'phone', link: false };
const linked = { op: 'set', target: '#t4', properties: { 'font-size': '40px' }, environment: 'desktop', link: true };
const lists: Record<string, unknown[]> = {
  'insert before #t1': [pin, { op: 'insert', kind: 'text', anchor: '#t1', placement: 'before' }, linked],
  'remove #t1': [pin, { op: 'remove', target: '#t1' }, linked],
  'reorder #t4 before #t1': [pin, { op: 'reorder', target: '#t4', placement: 'before', sibling: '#t1' }, linked],
};
const lines: string[] = [`pin measurement, label: ${process.argv[2] ?? 'final engine'}`];
for (const [name, steps] of Object.entries(lists)) {
  const out = (await page.evaluate(([f, st]) => (window as never as { runInsertSpec: (...a: unknown[]) => Promise<unknown> }).runInsertSpec(f, st, { previewWidths: [] }), [{ file: inp.file, kind: inp.kind, source: inp.source, companions: {} }, steps] as const)) as { refused: { message: string } | null; threw?: string; files: Record<string, string>; unlinked: unknown[] };
  if (out.threw || out.refused) { lines.push(`${name}: ${out.threw ?? out.refused!.message}`); continue; }
  writeSet(join(ROOT, 'insert-check/tmp/pins', name.replace(/\W+/g, '_')), out.files);
  const vals: string[] = [];
  for (const w of [1280, 641, 640, 390]) {
    const r = await loadAt(browser, join(ROOT, 'insert-check/tmp/pins', name.replace(/\W+/g, '_')), 'pins.html', w, { header: HEADER, measured: [{ selector: '#t4', prop: 'font-size' }] }, false);
    vals.push(`@${w} ${r.info.measured[0]}`);
  }
  const ok = vals.join(' ') === '@1280 40px @641 40px @640 20px @390 20px';
  lines.push(`${name}: #t4 font-size ${vals.join(', ')}; listUnlinked ${JSON.stringify(out.unlinked)} => ${ok ? 'pin held' : 'PIN LOST (the later linked edit scaled the pinned value)'}`);
}
console.log(lines.join('\n'));
await browser.close();
server.close();
void readFileSync;
