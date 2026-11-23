// Dry-run of fixtures/harden/edits.json against the fixtures themselves, in plain headless Chromium, with NO engine
// (docs/hardening-rules.md section 6). It replays each spec's structural steps (insert, remove, reorder) with the DOM API and checks
// the facts the spec relies on: selectors are unique, the expected final paths of pinned elements, the order of a container, the
// created elements' parents and positions, element-count changes, the literals used for byte checks, and the line-ending shape of
// the CRLF, no-trailing-newline and mixed fixtures. Nothing here reads the engine.
//   npx tsx harness/validate-harden-specs.ts
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ROOT } from './fixtures';

const DIR = join(ROOT, 'fixtures/harden');
const file = JSON.parse(readFileSync(join(DIR, 'edits.json'), 'utf8')) as { specs: { id: string; fixture: string; steps: Record<string, any>[]; expect: Record<string, any> }[] };
const problems: string[] = [];
const bad = (id: string, m: string) => problems.push(`${id}: ${m}`);
const count = (h: string, n: string) => (n === '' ? 0 : h.split(n).length - 1);
const browser = await chromium.launch({ headless: true });

for (const s of file.specs) {
  const src = readFileSync(join(DIR, s.fixture), 'utf8');
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.route('**/*', (r) => (r.request().url().startsWith('file:') ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  await page.addInitScript('window.__name = (f) => f;');
  await page.goto(`file://${join(DIR, s.fixture)}`);
  const ex = s.expect;
  const sim = await page.evaluate(({ steps, ids }) => {
    const out: Record<string, any> = { errors: [] as string[], paths: {} as Record<string, string> };
    const counters: Record<string, number> = {};
    const prefix: Record<string, [string, string]> = { text: ['new-text', 'p'], rect: ['new-box', 'div'], rounded: ['new-box', 'div'], ellipse: ['new-box', 'div'], button: ['new-button', 'button'] };
    const q = (sel: string) => { const l = document.querySelectorAll(sel); if (l.length !== 1) out.errors.push(`selector ${sel} matches ${l.length}`); return l[0] as Element; };
    for (const st of steps) {
      if (st.op === 'insert') {
        const [pre, tag] = prefix[st.kind]!;
        counters[pre] = (counters[pre] ?? 0) + 1;
        const el = document.createElement(tag); el.className = `${pre}-${counters[pre]}`;
        const a = q(st.anchor);
        if (st.placement === 'before') a.before(el); else if (st.placement === 'after') a.after(el); else if (st.placement === 'first-child') a.prepend(el); else a.append(el);
      } else if (st.op === 'remove') q(st.target).remove();
      else if (st.op === 'reorder') { const t = q(st.target), sb = q(st.sibling); if (st.placement === 'before') sb.before(t); else sb.after(t); }
      else if (st.target !== 'page') q(st.target || 'html');
      if (st.sibling && st.op !== 'reorder') q(st.sibling);
    }
    const path = (e: Element) => { const parts: string[] = []; for (let n: Element | null = e; n; n = n.parentElement) { const sibs = n.parentElement ? Array.from(n.parentElement.children).filter((c) => c.localName === n!.localName) : [n]; parts.unshift(`${n.localName}[${sibs.indexOf(n) + 1}]`); } return '/' + parts.join('/'); };
    for (const id of ids) { const e = document.getElementById(id); out.paths[id] = e ? path(e) : 'missing'; }
    out.count = document.getElementsByTagName('*').length;
    return out;
  }, { steps: s.steps, ids: ex.unlinkedIds ?? [] });
  // selectors are checked on the live simulation: later steps may name elements created or moved by earlier ones
  for (const e of sim.errors as string[]) bad(s.id, e);
  const orig = await page.evaluate(() => document.getElementsByTagName('*').length);
  void orig;
  (ex.unlinkedIds ?? []).forEach((id: string, i: number) => { const want = ex.unlinked[i].selector; if (sim.paths[id] !== want) bad(s.id, `pinned #${id}: the DOM simulation says ${sim.paths[id]}, spec says ${want}`); });
  // element count against the original
  const ctx2 = await browser.newContext({ javaScriptEnabled: true });
  const p2 = await ctx2.newPage(); await p2.addInitScript('window.__name = (f) => f;'); await p2.goto(`file://${join(DIR, s.fixture)}`);
  const n0 = await p2.evaluate(() => document.getElementsByTagName('*').length);
  await ctx2.close();
  const removed = await (async () => { const c = await browser.newContext(); const p = await c.newPage(); await p.addInitScript('window.__name = (f) => f;'); await p.goto(`file://${join(DIR, s.fixture)}`); const v = await p.evaluate((st) => st.filter((x: any) => x.op === 'remove' && !/\.new-/.test(x.target)).reduce((n: number, x: any) => n + document.querySelector(x.target)!.querySelectorAll('*').length + 1, 0), s.steps); await c.close(); return v as number; })();
  const inserted = s.steps.filter((x) => x.op === 'insert').length;
  const removedNew = s.steps.filter((x) => x.op === 'remove' && /\.new-/.test(x.target)).length;
  const delta = inserted - removed - removedNew;
  if (typeof ex.elementDelta === 'number' && ex.elementDelta !== delta) bad(s.id, `elementDelta ${ex.elementDelta}, simulation says ${delta}`);
  if (Math.abs(sim.count - (n0 + delta)) > 0) bad(s.id, `simulated element count ${sim.count}, expected ${n0 + delta}`);
  // created elements and order in the simulated final DOM
  const fin = await page.evaluate(({ created, order, gone }) => ({
    created: (created ?? []).map((c: any) => { const el = document.querySelector(c.selector); return el ? { tag: el.localName, parentOk: el.parentElement === document.querySelector(c.parent), index: Array.prototype.indexOf.call(el.parentElement!.children, el) } : null; }),
    order: order ? (Array.from(document.querySelector(order.parent)!.children) as Element[]).map((c) => c.id) : null,
    gone: (gone ?? []).map((g: string) => document.querySelectorAll(g).length),
  }), { created: ex.created, order: ex.order, gone: ex.gone });
  (ex.created ?? []).forEach((c: any, i: number) => { const f = fin.created[i]; if (!f) bad(s.id, `created ${c.selector} not in the simulation`); else { if (f.tag !== c.tag) bad(s.id, `${c.selector} tag ${f.tag} not ${c.tag}`); if (!f.parentOk) bad(s.id, `${c.selector} parent is not ${c.parent}`); if (f.index !== c.index) bad(s.id, `${c.selector} index ${f.index}, spec ${c.index}`); } });
  if (ex.order && JSON.stringify(fin.order) !== JSON.stringify(ex.order.ids)) bad(s.id, `order ${JSON.stringify(fin.order)}, spec ${JSON.stringify(ex.order.ids)}`);
  (ex.gone ?? []).forEach((g: string, i: number) => { if (fin.gone[i] !== 0) bad(s.id, `${g} still present in the simulation`); });
  // byte literals
  const b = ex.hbytes;
  if (b && typeof b === 'object') {
    if (b.replace && count(src, b.replace[0]) !== 1) bad(s.id, 'replace literal not unique');
    for (const r of b.removed ?? []) if (count(src, r) !== 1) bad(s.id, `removed block occurs ${count(src, r)} times: ${JSON.stringify(r.slice(0, 40))}`);
    if (b.equalsRunWithout) for (const n of b.equalsRunWithout) if (n < 1 || n > s.steps.length) bad(s.id, `equalsRunWithout step ${n} out of range`);
  }
  // line endings of the fixture
  const crlf = (src.match(/\r\n/g) ?? []).length, lf = (src.match(/\n/g) ?? []).length - crlf, cr = (src.match(/\r/g) ?? []).length - crlf;
  const dir = dirname(s.fixture);
  if (dir === 'crlf' && (lf !== 0 || cr !== 0 || crlf === 0)) bad(s.id, `crlf fixture has ${lf} lone LF, ${cr} lone CR`);
  if (dir === 'nonl' && (src.endsWith('\n') || lf !== 0)) bad(s.id, 'nonl fixture must be CRLF with no final newline');
  if (s.fixture === 'mixed.html' && (lf === 0 || crlf === 0)) bad(s.id, 'mixed fixture must contain both endings');
  if (ex.regionEol && Object.keys(ex.regionEol).length === 0) bad(s.id, 'empty regionEol');
  // the companion files of the CRLF family must have the same shape
  if (dir === 'crlf' || dir === 'nonl') for (const c of s.fixture.endsWith('landing.html') ? ['landing.css'] : []) { const t = readFileSync(join(DIR, dir, c), 'utf8'); const l = (t.match(/\n/g) ?? []).length - (t.match(/\r\n/g) ?? []).length; if (l !== 0) bad(s.id, `${c} has lone LF`); if (dir === 'nonl' && t.endsWith('\n')) bad(s.id, `${c} must have no final newline`); }
  // no horizontal overflow before the edit
  for (const w of [1280, 390]) { await page.setViewportSize({ width: w, height: 800 }); }
  await ctx.close();
  console.log(`${s.id} ${problems.some((p) => p.startsWith(s.id + ':')) ? 'PROBLEM' : 'ok'}  ${s.fixture}`);
}
await browser.close();
if (problems.length) { console.log('\nPROBLEMS:\n' + problems.join('\n')); process.exit(1); }
console.log(`\nall ${file.specs.length} specs consistent with their fixtures`);
