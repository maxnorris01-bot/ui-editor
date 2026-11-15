// Validates the hand-written Truth of fixtures/size/edits.json with plain Chromium and NO engine: each spec's `reference`
// CSS (what a person would write) is appended to the original page, and the measured values must equal `expected` at every
// width. Run before locking; also run after the lock to show the Truth is browser-measurable.
//   npx tsx harness/validate-size-specs.ts
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './fixtures';

const specs = (JSON.parse(readFileSync(join(ROOT, 'fixtures/' + (process.env.SIZE_DIR ?? 'size') + '/edits.json'), 'utf8')) as { edits: { id: string; fixture: string; widths: number[]; measure: { target: string; props: string[] }; expected: Record<string, Record<string, string>>; reference: string }[] }).edits;
const browser = await chromium.launch({ headless: true });
let bad = 0;
for (const s of specs) {
  const src = readFileSync(join(ROOT, 'fixtures/' + (process.env.SIZE_DIR ?? 'size'), s.fixture), 'utf8').replace('</head>', `<style>${s.reference}</style></head>`);
  const probs: string[] = [];
  for (const w of s.widths) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 800 }, javaScriptEnabled: false });
    const page = await ctx.newPage();
    await page.route('**/*', (r) => (/^(about|data|blob):/.test(r.request().url()) ? r.continue() : r.fulfill({ status: 200, contentType: 'text/html', body: src })));
    await page.goto('http://localhost/x.html');
    const got = (await page.evaluate(([sel, props]) => { const cs = getComputedStyle(document.querySelector(sel as string)!); return (props as string[]).map((p) => cs.getPropertyValue(p)); }, [s.measure.target, s.measure.props] as const)) as string[];
    s.measure.props.forEach((p, i) => { const want = s.expected[p]![String(w)]!; if (Math.abs(parseFloat(got[i]!) - parseFloat(want)) > 0.5) probs.push(`@${w} ${p} got ${got[i]} want ${want}`); });
    await ctx.close();
  }
  if (probs.length) bad++;
  console.log(s.id, probs.length ? `MISMATCH ${probs.join('; ')}` : 'ok');
}
await browser.close();
process.exit(bad ? 1 : 0);
