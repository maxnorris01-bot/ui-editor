// Independent scorer additions for the engine hardening round (docs/hardening-rules.md). Builds on harness/insert-lib.ts (checks A, B, C,
// E, O, M, U, F, V, E1) and adds: byte checks for the H-specs (`hbytes`), a line-ending check on every permitted region (`regionEol`),
// the browser oracle for neighbour selectors, and undo-with-pins. Nothing here reads the engine's model.
import type { Browser } from 'playwright';
import { diffChars } from 'diff';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ROOT } from './fixtures';
import { HEADER, expandText, loadAt, testWidths, writeSet, type Input, type Row, type Spec } from './insert-lib';

export const HDIR = join(ROOT, 'fixtures/harden');
export const HSPECS = (JSON.parse(readFileSync(join(HDIR, 'edits.json'), 'utf8')) as { specs: Spec[] }).specs;

export function hardenInput(fixture: string): Input {
  const dir = join(HDIR, dirname(fixture));
  const file = fixture.split('/').pop()!;
  const companions: Record<string, string> = {};
  if (file === 'landing.html') companions['landing.css'] = readFileSync(join(dir, 'landing.css'), 'utf8');
  return { file, kind: file.endsWith('.svg') ? 'svg' : 'html', source: readFileSync(join(dir, file), 'utf8'), companions, dir };
}
export const filesOf = (i: Input): Record<string, string> => ({ [i.file]: i.source, ...i.companions });

// ---------------------------------------------------------------------------------------------------------------
// Region stripping that understands CRLF and a last line without a final newline
// ---------------------------------------------------------------------------------------------------------------
export interface HRegion { kind: 'element' | 'rule' | 'comment'; start: number; end: number; whole: boolean; text: string }
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function stripH(text: string, classes: string[]): { text: string; regions: HRegion[] } {
  const found: { kind: HRegion['kind']; start: number; end: number }[] = [];
  for (const m of text.matchAll(/<!--([\s\S]*?)-->/g)) if (m[1]!.startsWith(' NOTE FOR AI') || m[1] === ` ${HEADER} `) found.push({ kind: 'comment', start: m.index!, end: m.index! + m[0].length });
  for (const c of classes) {
    for (const m of text.matchAll(new RegExp(`<(p|div|button)\\b[^>]*\\bclass="${esc(c)}"[^>]*>[\\s\\S]*?</\\1>`, 'g'))) found.push({ kind: 'element', start: m.index!, end: m.index! + m[0].length });
    for (const m of text.matchAll(new RegExp(`\\.${esc(c)}\\s*\\{[^}]*\\}`, 'g'))) found.push({ kind: 'rule', start: m.index!, end: m.index! + m[0].length });
  }
  found.sort((a, b) => a.start - b.start);
  let t = text;
  const regions: HRegion[] = [];
  for (const r of [...found].reverse()) {
    const ls = t.lastIndexOf('\n', r.start - 1) + 1;
    const lead = t.slice(ls, r.start);
    const m = /^[ \t]*(\r?\n|$)/.exec(t.slice(r.end));
    if (/^[ \t]*$/.test(lead) && m) {
      if (m[1] === '' && ls > 0) { const from = t[ls - 2] === '\r' ? ls - 2 : ls - 1; regions.push({ ...r, whole: true, text: t.slice(from) }); t = t.slice(0, from); }
      else { regions.push({ ...r, whole: true, text: t.slice(ls, r.end + m[0].length) }); t = t.slice(0, ls) + t.slice(r.end + m[0].length); }
    } else { regions.push({ ...r, whole: false, text: t.slice(r.start, r.end) }); t = t.slice(0, r.start) + t.slice(r.end); }
  }
  return { text: t, regions: regions.sort((a, b) => a.start - b.start) };
}
const classesOf = (spec: Spec): string[] => (spec.expect.created ?? []).map((c: { selector: string }) => c.selector.replace(/^\./, ''));
const lonely = (t: string) => ({ lf: (t.match(/(?<!\r)\n/g) ?? []).length, cr: (t.match(/\r(?!\n)/g) ?? []).length });

// ---------------------------------------------------------------------------------------------------------------
// hbytes and regionEol
// ---------------------------------------------------------------------------------------------------------------
export function hbytesCheck(spec: Spec, orig: Record<string, string>, exp: Record<string, string>, primary: string, without: Record<string, string> | null): string[] {
  const b = spec.expect.hbytes;
  const p: string[] = [];
  if (b === undefined || b === 'none') return p;
  const files = Object.keys(orig);
  const same = (f: string, want: string, why: string) => { if ((exp[f] ?? '') !== want) p.push(`${f}: ${why} (${Buffer.byteLength(exp[f] ?? '')} bytes vs expected ${Buffer.byteLength(want)})`); };
  const noRemoved = (f: string) => { const r = diffChars(orig[f]!, exp[f] ?? '').filter((c) => c.removed); if (r.length) p.push(`${f}: ${r.length} removed text run(s): ${JSON.stringify(r[0]!.value.slice(0, 50))}`); };
  if (b === 'equals-original') { for (const f of files) same(f, orig[f]!, 'not byte-identical to the original'); return p; }
  if (b === 'additive') {
    const cls = classesOf(spec);
    for (const f of files) {
      const so = stripH(orig[f]!, cls).text, sx = stripH(exp[f] ?? '', cls);
      if (sx.text !== so) p.push(`${f}: after removing the permitted regions the file differs from the original (${Buffer.byteLength(sx.text)} vs ${Buffer.byteLength(so)} bytes)`);
      noRemoved(f);
      if (f === primary && spec.expect.format === 'lines' && sx.regions.some((r) => r.kind !== 'rule' && !r.whole)) p.push('an inserted element or comment does not occupy whole lines');
    }
    return p;
  }
  if (b.equalsRunWithout) {
    if (!without) p.push('no run without the stated steps available');
    else for (const f of files) same(f, without[f] ?? '', 'differs from the export of the same list without the stated steps');
    return p;
  }
  let want = orig[primary]!;
  if (b.replace) { if (want.split(b.replace[0]).length !== 2) p.push('replace literal not unique'); want = want.replace(b.replace[0], () => b.replace[1]); }
  for (const r of (b.removed ?? []) as string[]) want = want.replace(r, '');
  same(primary, want, 'not the original with only the stated change(s)');
  for (const f of files) if (f !== primary) { if (b.othersAdditive) noRemoved(f); else same(f, orig[f]!, 'a file that must not change was changed'); }
  return p;
}

export function eolCheck(spec: Spec, orig: Record<string, string>, exp: Record<string, string>): string[] {
  const p: string[] = [];
  const want = spec.expect.regionEol as Record<string, ('crlf' | 'lf')[]> | undefined;
  if (!want) return p;
  const cls = classesOf(spec);
  for (const [f, list] of Object.entries(want)) {
    const regions = stripH(exp[f] ?? '', cls).regions;
    if (regions.length !== list.length) { p.push(`${f}: ${regions.length} added regions, expected ${list.length}`); continue; }
    regions.forEach((r, i) => {
      const l = lonely(r.text);
      const crlf = (r.text.match(/\r\n/g) ?? []).length;
      if (list[i] === 'crlf' && (l.lf > 0 || l.cr > 0)) p.push(`${f}: added ${r.kind} #${i + 1} has ${l.lf} lone LF and ${l.cr} lone CR in a CRLF place`);
      if (list[i] === 'lf' && (crlf > 0 || l.cr > 0)) p.push(`${f}: added ${r.kind} #${i + 1} has CR characters in an LF place`);
    });
  }
  for (const f of Object.keys(orig)) { const a = lonely(orig[f]!), x = lonely(exp[f] ?? ''); if (x.cr > a.cr) p.push(`${f}: a lone CR was added`); }
  return p;
}

// ---------------------------------------------------------------------------------------------------------------
// The browser oracle for neighbour selectors
// ---------------------------------------------------------------------------------------------------------------
const BOX = 'box-sizing: border-box; width: 200px; max-width: 100%; height: 120px; background: #d9d9d9; border: 1px solid #999999';
const ORACLE_KIND: Record<string, { tag: string; style: string; text: string }> = {
  text: { tag: 'p', style: 'max-width: 100%; overflow-wrap: break-word', text: 'Text' },
  rect: { tag: 'div', style: BOX, text: '' },
  rounded: { tag: 'div', style: `${BOX}; border-radius: 12px`, text: '' },
  ellipse: { tag: 'div', style: `${BOX}; border-radius: 50%`, text: '' },
  button: { tag: 'button', style: 'box-sizing: border-box; max-width: 100%; padding: 8px 16px; font: inherit; cursor: pointer', text: 'Button' },
};
const libSrc = () => readFileSync(join(ROOT, 'harness/page-measure.js'), 'utf8');
const normS = (s: string) => s.toLowerCase().replace(/["']/g, '').replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim();
export function closeStr(a: string, b: string): boolean {
  if (normS(a) === normS(b)) return true;
  const ta = normS(a).split(/[\s,]+/), tb = normS(b).split(/[\s,]+/);
  if (ta.length !== tb.length) return false;
  return ta.every((x, i) => x === tb[i] || (/^-?[\d.]+(px)?$/.test(x) && /^-?[\d.]+(px)?$/.test(tb[i]!) && Math.abs(parseFloat(x) - parseFloat(tb[i]!)) <= 0.5));
}
interface Dump { names: string[]; rows: { tag: string; id: string | null; parent: number; rect: number[]; props: string[] }[] }

/** Compare two dumps row by row (paired in document order with the skipped rows left out). */
export function compareDumps(a: Dump, b: Dump, skipA: Set<number>, skipB: Set<number>): string[] {
  const A = a.rows.map((_, i) => i).filter((i) => !skipA.has(i)), B = b.rows.map((_, i) => i).filter((i) => !skipB.has(i));
  if (A.length !== B.length) return [`element count ${A.length} (oracle) vs ${B.length} (export)`];
  const bi = new Map<string, number>(b.names.map((n, i) => [n, i]));
  const bad: string[] = [];
  for (let k = 0; k < A.length; k++) {
    const x = a.rows[A[k]!]!, y = b.rows[B[k]!]!;
    if (x.tag !== y.tag) { bad.push(`el#${A[k]} <${x.tag}> vs <${y.tag}>`); continue; }
    const what: string[] = [];
    if (!x.rect.every((v, q) => Math.abs(v - y.rect[q]!) <= 0.5)) what.push(`box [${x.rect.map((v) => +v.toFixed(1))}] vs [${y.rect.map((v) => +v.toFixed(1))}]`);
    for (let q = 0; q < x.props.length; q++) {
      const j = bi.get(a.names[q]!);
      const yv = j === undefined ? '(missing)' : y.props[j]!;
      if (!closeStr(x.props[q]!, yv)) what.push(`${a.names[q]}: ${normS(x.props[q]!).slice(0, 30)} vs ${normS(yv).slice(0, 30)}`);
    }
    if (what.length) bad.push(`el#${A[k]} <${x.tag}${x.id ? '#' + x.id : ''}> ${what.slice(0, 2).join('; ')}`);
  }
  return bad;
}

export async function oracleCheck(browser: Browser, spec: Spec, inp: Input, exportDir: string, createdSels: string[]): Promise<string[]> {
  const problems: string[] = [];
  const widths = testWidths(inp);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, javaScriptEnabled: true });
  await ctx.route('**/*', (r) => (r.request().url().startsWith('file:') ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  await page.addInitScript('window.__name = (f) => f;');
  for (const w of widths) {
    await page.setViewportSize({ width: w, height: 800 });
    await page.goto(`file://${join(writeOriginal(inp), inp.file)}`);
    const oracle = (await page.evaluate(({ lib, steps, kinds }) => {
      // eslint-disable-next-line no-eval
      (0, eval)(lib);
      const marks: Element[] = [];
      for (const st of steps) {
        if (st.op === 'insert') {
          const k = kinds[st.kind as string]!;
          const el = document.createElement(k.tag);
          el.setAttribute('style', k.style);
          if (k.text) el.textContent = k.text;
          const a = document.querySelector(st.anchor as string)!;
          if (st.placement === 'before') a.before(el); else if (st.placement === 'after') a.after(el); else if (st.placement === 'first-child') a.prepend(el); else a.append(el);
          marks.push(el);
        } else if (st.op === 'remove') document.querySelector(st.target as string)!.remove();
      }
      const all = (window as unknown as { GateMeasure: { walk: (d: Document) => Element[]; fullDump: (d: Document, a: null, b: null) => unknown } }).GateMeasure;
      const els = all.walk(document);
      return { dump: all.fullDump(document, null, null) as Dump, created: marks.map((m) => els.indexOf(m)) };
    }, { lib: libSrc(), steps: spec.steps, kinds: ORACLE_KIND })) as { dump: Dump; created: number[] };
    const sels = createdSels;
    const x = await loadAt(browser, exportDir, inp.file, w, { header: HEADER, indexSel: sels }, true);
    const skipX = new Set<number>(sels.map((s) => x.info.indexOf[s] as number).filter((i) => i >= 0));
    if (skipX.size !== oracle.created.length) { problems.push(`@${w}: ${skipX.size} created elements in the export, ${oracle.created.length} in the oracle`); continue; }
    const bad = compareDumps(oracle.dump, x.dump!, new Set(oracle.created), skipX);
    if (bad.length) problems.push(`@${w}: ${bad.length} element(s) differ from the browser's own answer: ${bad.slice(0, 2).join(' || ')}`);
  }
  await ctx.close();
  return problems;
}
const written = new Map<string, string>();
function writeOriginal(inp: Input): string {
  let d = written.get(inp.file + inp.dir);
  if (!d) { d = join(ROOT, 'harden-check/tmp/oracle', inp.dir.replace(/\W+/g, '_')); writeSet(d, filesOf(inp)); written.set(inp.file + inp.dir, d); }
  return d;
}

// ---------------------------------------------------------------------------------------------------------------
// Everything added for the H-specs, as rows
// ---------------------------------------------------------------------------------------------------------------
export interface HExtras { without?: Record<string, string> | null; replayUnlinked?: unknown[][] | null; stepUnlinked?: unknown[][] | null }

export async function hardenRows(browser: Browser, spec: Spec, inp: Input, files: Record<string, string>, tmp: string, extras: HExtras): Promise<Row[]> {
  const rows: Row[] = [];
  const add = (rule: string, pass: boolean, detail: string) => rows.push({ id: spec.id, rule, pass, detail: detail.replace(/\s+/g, ' ').slice(0, 700) });
  const ex = spec.expect;
  const orig = filesOf(inp);
  if (ex.hbytes !== undefined && ex.hbytes !== 'none') {
    const pb = hbytesCheck(spec, orig, files, inp.file, extras.without ?? null);
    add('BH', pb.length === 0, pb.join(' | ') || `bytes as stated (${typeof ex.hbytes === 'string' ? ex.hbytes : Object.keys(ex.hbytes).join('+')})`);
  }
  if (ex.regionEol) { const pe = eolCheck(spec, orig, files); add('EOL', pe.length === 0, pe.join(' | ') || 'every added line break matches its place; no lone CR; nothing normalised'); }
  if (ex.oracle) {
    const dir = join(tmp, spec.id, 'exported');
    const po = await oracleCheck(browser, spec, inp, dir, (ex.created ?? []).map((c: { selector: string }) => c.selector));
    add('ORC', po.length === 0, po.join(' | ') || `every other element matches the browser's own answer at ${testWidths(inp).length} widths`);
  }
  if (ex.undoPins) {
    const a = extras.stepUnlinked, b = extras.replayUnlinked;
    const pu: string[] = [];
    if (!a || !b) pu.push('no per-step pin lists available');
    else b.forEach((r, n) => { if (JSON.stringify(r) !== JSON.stringify(a[n])) pu.push(`replaying the first ${n + 1} step(s) gives different pins than after step ${n + 1} of the full run`); });
    add('UP', pu.length === 0, pu.join(' | ') || 'replay gives the same pins at every step');
  }
  void expandText;
  return rows;
}
