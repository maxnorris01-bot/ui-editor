// Dry-run of fixtures/insert/edits.json against the fixtures themselves, in plain headless Chromium, with NO engine
// (docs/insert-comments-rules.md section 5). It checks that the facts each spec relies on are true of the files: selectors
// are unique, expected parents and positions are what the DOM says, the literals used for byte checks occur exactly once,
// the reason for each expected refusal is true of the page, the class names and element counts are right, and the pages
// have no horizontal overflow before any edit.
//   npx tsx harness/validate-insert-specs.ts
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './fixtures';

const DIR = join(ROOT, 'fixtures/insert');
const file = JSON.parse(readFileSync(join(DIR, 'edits.json'), 'utf8')) as { specs: Spec[]; header: string };
interface Spec { id: string; fixture: string; steps: Record<string, unknown>[]; expect: Record<string, any> }
const problems: string[] = [];
const bad = (id: string, msg: string) => problems.push(`${id}: ${msg}`);
const count = (hay: string, needle: string) => (needle === '' ? 0 : hay.split(needle).length - 1);

const browser = await chromium.launch({ headless: true });
const pageCache = new Map<string, import('playwright').Page>();
async function load(fixture: string, width = 1280) {
  const key = `${fixture}@${width}`;
  let p = pageCache.get(key);
  if (!p) {
    const ctx = await browser.newContext({ viewport: { width, height: 800 }, javaScriptEnabled: true });
    await ctx.route('**/*', (r) => (r.request().url().startsWith('file:') ? r.continue() : r.abort()));
    p = await ctx.newPage();
    await p.goto(`file://${join(DIR, fixture)}`);
    pageCache.set(key, p);
  }
  return p;
}

const widthsFor = (fixture: string): number[] => {
  const texts = [readFileSync(join(DIR, fixture), 'utf8')];
  if (fixture === 'landing.html') texts.push(readFileSync(join(DIR, 'landing.css'), 'utf8'));
  const set = new Set<number>([1280, 1024, 768, 390]);
  let any = false;
  for (const m of texts.join('\n').matchAll(/\(\s*(?:max|min)-width\s*:\s*(\d+(?:\.\d+)?)px/g)) { any = true; const v = Math.floor(parseFloat(m[1]!)); set.add(v); set.add(v + 1); }
  if (!any) set.add(767);
  return [...set].sort((a, b) => b - a);
};

for (const s of file.specs) {
  const src = readFileSync(join(DIR, s.fixture), 'utf8');
  const page = await load(s.fixture);
  const ex = s.expect;
  const created = new Set<string>();
  for (const [n, st] of s.steps.entries()) {
    const sels = [st.anchor, st.target, st.sibling].filter((x): x is string => typeof x === 'string' && x !== 'page');
    for (const sel of sels) {
      if (/\.new-/.test(sel)) { if (!s.steps.slice(0, n).some((p) => p.op === 'insert')) bad(s.id, `step ${n + 1} uses ${sel} but no earlier insert`); continue; }
      const c = await page.evaluate((q) => { try { return document.querySelectorAll(q).length; } catch { return -1; } }, sel);
      if (c !== 1) bad(s.id, `step ${n + 1} selector ${sel} matches ${c} elements in the original (need exactly 1)`);
    }
    if (st.op === 'insert') created.add(String(st.kind));
  }
  // expected parent and position of the first inserted element, from the DOM
  if (ex.created) {
    const first = s.steps.find((st) => st.op === 'insert');
    for (const c of ex.created as { selector: string; parent: string; index: number; tag: string }[]) {
      if (!first) { bad(s.id, 'created is declared but there is no insert step'); break; }
      const got = await page.evaluate(([anchor, placement, parent]) => {
        const a = document.querySelector(anchor as string)!;
        let p: Element | null, i: number;
        if (placement === 'before') { p = a.parentElement; i = Array.prototype.indexOf.call(p!.children, a); }
        else if (placement === 'after') { p = a.parentElement; i = Array.prototype.indexOf.call(p!.children, a) + 1; }
        else if (placement === 'first-child') { p = a; i = 0; } else { p = a; i = a.children.length; }
        const want = document.querySelector(parent as string);
        return { same: p === want, index: i, parentTag: p!.localName };
      }, [first.anchor, first.placement, c.parent] as const);
      // the index is only comparable for the first insert of a list that has no earlier structural edit
      if (!got.same) bad(s.id, `created parent ${c.parent} is not the DOM parent of the anchor placement`);
      else if (got.index !== c.index) bad(s.id, `created index ${c.index} but the DOM says ${got.index}`);
      if (!/^(p|div|button)$/.test(c.tag)) bad(s.id, `created tag ${c.tag} is not one of p, div, button`);
    }
  }
  // refusals: the reason must be true of the file
  if (ex.outcome === 'REFUSED') {
    const rc = ex.reasonCheck as { selector?: string; tag?: string; hasChildElements?: boolean; documentRoot?: string } | undefined;
    if (!rc || !ex.refusal) bad(s.id, 'REFUSED spec lacks refusal code or reasonCheck');
    else if (rc.documentRoot) {
      const root = await page.evaluate(() => document.documentElement.localName);
      if (root !== rc.documentRoot) bad(s.id, `document root is ${root}, spec says ${rc.documentRoot}`);
    } else {
      const info = await page.evaluate((q) => { const e = document.querySelector(q); return e ? { tag: e.localName, kids: e.children.length } : null; }, rc.selector!);
      if (!info) bad(s.id, `reasonCheck selector ${rc.selector} not found`);
      else {
        if (rc.tag && info.tag !== rc.tag) bad(s.id, `reasonCheck: ${rc.selector} is <${info.tag}>, spec says <${rc.tag}>`);
        if (rc.hasChildElements && info.kids === 0) bad(s.id, `reasonCheck: ${rc.selector} has no child elements`);
      }
    }
  }
  // literals for byte checks
  const b = ex.bytes;
  const once = (t: string, what: string) => { const c = count(src, t); if (c !== 1) bad(s.id, `${what} occurs ${c} times in ${s.fixture} (need exactly 1)`); };
  if (b && typeof b === 'object') {
    if (b.replace) once(b.replace[0], 'replace.from');
    for (const r of b.removed ?? []) once(r, 'removed block');
    if (b.stripNotesThen?.moveBefore) { once(b.stripNotesThen.moveBefore.lines, 'moveBefore.lines'); once(b.stripNotesThen.moveBefore.before, 'moveBefore.before'); }
    for (const id of b.innerOf ?? []) if (count(src, `<p id="${id}">`) !== 1) bad(s.id, `innerOf ${id} not found once`);
  }
  // class names
  if (ex.cls) {
    const n = Number(/-(\d+)$/.exec(ex.cls)![1]);
    const prefix = ex.cls.replace(/-\d+$/, '');
    for (let k = 1; k < n; k++) if (count(src, `${prefix}-${k}`) === 0) bad(s.id, `class ${ex.cls} is declared but ${prefix}-${k} is unused in the fixture, so the next free number would be lower`);
    if (count(src, ex.cls) !== 0) bad(s.id, `class ${ex.cls} already occurs in the fixture`);
  }
  for (const [sel, n] of Object.entries(ex.countOf ?? {})) {
    const c = await page.evaluate((q) => document.querySelectorAll(q).length, sel);
    if (c !== n) bad(s.id, `countOf ${sel}: ${c}, spec says ${n}`);
  }
  if (typeof ex.styleElements === 'number') {
    const c = await page.evaluate(() => document.querySelectorAll('style').length);
    if (c !== ex.styleElements) bad(s.id, `fixture has ${c} <style> elements, spec says ${ex.styleElements}`);
  }
  // elementDelta: subtree sizes of removed elements
  if (typeof ex.elementDelta === 'number') {
    const rm = s.steps.filter((st) => st.op === 'remove' && !/\.new-/.test(String(st.target)));
    let tot = 0;
    for (const st of rm) tot += await page.evaluate((q) => document.querySelector(q)!.querySelectorAll('*').length + 1, String(st.target));
    if (-tot !== ex.elementDelta) bad(s.id, `elementDelta ${ex.elementDelta} but the removed subtrees have ${tot} elements`);
  }
  if (ex.headerAfter === 'doctype' && !/^<!DOCTYPE/i.test(src)) bad(s.id, 'headerAfter doctype but the file does not start with a DOCTYPE');
  if (ex.headerAfter === 'start' && /^\s*<\?xml/.test(src)) bad(s.id, 'headerAfter start but the file has an XML declaration');
  if (ex.order) {
    const ids = await page.evaluate((q) => Array.from(document.querySelector(q)!.children).map((c) => c.id), ex.order.parent as string);
    for (const id of ex.order.ids as string[]) if (!ids.includes(id)) bad(s.id, `order id ${id} is not a child of ${ex.order.parent}`);
  }
  if (ex.listNotesOriginal) {
    const found = await page.evaluate(() => {
      const out: { id: string; text: string }[] = [];
      const w = document.createTreeWalker(document, NodeFilter.SHOW_COMMENT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        const d = (n as Comment).data;
        if (!d.startsWith(' NOTE FOR AI: ')) continue;
        let s = n.nextSibling;
        while (s && s.nodeType === 3 && !/\S/.test(s.textContent ?? '')) s = s.nextSibling;
        if (s && s.nodeType === 1) out.push({ id: (s as Element).id, text: d.slice(' NOTE FOR AI: '.length).replace(/ $/, '') });
      }
      return out;
    });
    const want = (ex.listNotesOriginal.notes as { target: string; read: string }[]).map((x) => ({ id: x.target.slice(1), text: x.read }));
    if (JSON.stringify(found) !== JSON.stringify(want)) bad(s.id, `notes already in the fixture are ${JSON.stringify(found)}, spec says ${JSON.stringify(want)}`);
  }
  if (ex.headerCount !== undefined && s.fixture === 'header-present.html' && count(src, file.header) !== 1) bad(s.id, 'header text should occur once in header-present.html');
  // no horizontal overflow before the edit, at every test width
  const widths = widthsFor(s.fixture);
  for (const w of widths) {
    const p = await load(s.fixture, w);
    const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (over > 0 && !/^(email\.html|chart\.svg)$/.test(s.fixture)) bad(s.id, `original already overflows horizontally by ${over}px at ${w}`);
  }
  console.log(`${s.id} ${problems.some((p) => p.startsWith(s.id + ':')) ? 'PROBLEM' : 'ok'}  ${s.fixture}  widths ${widths.join(',')}`);
}
await browser.close();
if (problems.length) { console.log('\nPROBLEMS:\n' + problems.join('\n')); process.exit(1); }
console.log(`\nall ${file.specs.length} specs consistent with their fixtures`);
