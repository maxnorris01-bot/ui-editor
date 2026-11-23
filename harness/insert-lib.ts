// Independent scorer for the insert-and-comments engine spike (docs/insert-comments-rules.md). Every function here works on
// exported FILES and on what a browser reports about them; none of it reads the engine's model or the engine's own helpers
// (the neutralised read-back texts come from the spec, written by hand). Used by run-insert.ts for the scored run and by the
// scorer-check controls (controls-insert.ts) on deliberately broken exports.
import type { Browser } from 'playwright';
import { diffChars, diffLines } from 'diff';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { precedingAllowed } from './e4-amend';
import { ROOT } from './fixtures';

export const FIXDIR = join(ROOT, 'fixtures/insert');
const parsed = JSON.parse(readFileSync(join(FIXDIR, 'edits.json'), 'utf8')) as { header: string; specs: Spec[] };
export const HEADER = parsed.header;
export const SPECS = parsed.specs;

export type Text = string | { repeat: string; times: number };
export const expandText = (t: Text): string => (typeof t === 'string' ? t : t.repeat.repeat(t.times));
export interface Step { op: string; target?: string; anchor?: string; sibling?: string; placement?: string; kind?: string; text?: Text; read?: Text | { same: true }; properties?: Record<string, string>; environment?: string; link?: boolean }
export interface Spec { id: string; title: string; fixture: string; steps: Step[]; expect: Record<string, any> }
export interface Input { file: string; kind: 'html' | 'svg'; source: string; companions: Record<string, string>; dir: string }
export interface Row { id: string; rule: string; pass: boolean; detail: string }

export function fixtureInput(file: string): Input {
  const companions: Record<string, string> = {};
  if (file === 'landing.html') companions['landing.css'] = readFileSync(join(FIXDIR, 'landing.css'), 'utf8');
  return { file, kind: file.endsWith('.svg') ? 'svg' : 'html', source: readFileSync(join(FIXDIR, file), 'utf8'), companions, dir: FIXDIR };
}
export const originalFiles = (i: Input): Record<string, string> => ({ [i.file]: i.source, ...i.companions });
export function writeSet(dir: string, set: Record<string, string>): void {
  for (const [name, text] of Object.entries(set)) { mkdirSync(dirname(join(dir, name)), { recursive: true }); writeFileSync(join(dir, name), text); }
}

export function testWidths(inp: Input): number[] {
  const text = [inp.source, ...Object.values(inp.companions)].join('\n');
  const set = new Set<number>([1280, 1024, 768, 390]);
  let any = false;
  for (const m of text.matchAll(/\(\s*(?:max|min)-width\s*:\s*(\d+(?:\.\d+)?)px/g)) { any = true; const v = Math.floor(parseFloat(m[1]!)); set.add(v); set.add(v + 1); }
  if (!any) set.add(767);
  return [...set].sort((a, b) => b - a);
}
export const breakpointOf = (inp: Input): number => {
  const text = [inp.source, ...Object.values(inp.companions)].join('\n');
  const all = [...text.matchAll(/\(\s*max-width\s*:\s*(\d+(?:\.\d+)?)px/g)].map((m) => Math.floor(parseFloat(m[1]!))).filter((v) => v <= 768);
  return all.length ? Math.max(...all) : 767;
};

// ---------------------------------------------------------------------------------------------------------------
// Region stripping (docs section 2)
// ---------------------------------------------------------------------------------------------------------------
export interface Region { kind: 'element' | 'rule' | 'comment'; start: number; end: number; whole: boolean }
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function findRegions(text: string, classes: string[], withComments = true): Omit<Region, 'whole'>[] {
  const out: Omit<Region, 'whole'>[] = [];
  if (withComments) {
    for (const m of text.matchAll(/<!--([\s\S]*?)-->/g)) {
      const d = m[1]!;
      if (d.startsWith(' NOTE FOR AI') || d === ` ${HEADER} `) out.push({ kind: 'comment', start: m.index!, end: m.index! + m[0].length });
    }
  }
  for (const c of classes) {
    for (const m of text.matchAll(new RegExp(`<(p|div|button)\\b[^>]*\\bclass="${esc(c)}"[^>]*>[\\s\\S]*?</\\1>`, 'g'))) out.push({ kind: 'element', start: m.index!, end: m.index! + m[0].length });
    for (const m of text.matchAll(new RegExp(`\\.${esc(c)}\\s*\\{[^}]*\\}`, 'g'))) out.push({ kind: 'rule', start: m.index!, end: m.index! + m[0].length });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Remove the permitted regions: a region alone on its line(s) goes with its line break; otherwise only its own text. */
export function strip(text: string, classes: string[], withComments = true): { text: string; regions: Region[] } {
  let t = text;
  const regions: Region[] = [];
  for (const r of findRegions(text, classes, withComments).reverse()) {
    const ls = t.lastIndexOf('\n', r.start - 1) + 1;
    const lead = t.slice(ls, r.start);
    const m = /^[ \t]*(\r?\n|$)/.exec(t.slice(r.end));
    if (/^[ \t]*$/.test(lead) && m) {
      if (m[1] === '' && ls > 0) t = t.slice(0, ls - 1); // last line of a file without a final newline: take the newline before it
      else t = t.slice(0, ls) + t.slice(r.end + m[0].length);
      regions.push({ ...r, whole: true });
    } else {
      t = t.slice(0, r.start) + t.slice(r.end);
      regions.push({ ...r, whole: false });
    }
  }
  return { text: t, regions };
}

const classesOf = (spec: Spec): string[] => (spec.expect.created ?? []).map((c: { selector: string }) => c.selector.replace(/^\./, ''));

// ---------------------------------------------------------------------------------------------------------------
// Bytes (check B)
// ---------------------------------------------------------------------------------------------------------------
export function bytesCheck(spec: Spec, orig: Record<string, string>, exp: Record<string, string>, primary: string): string[] {
  const b = spec.expect.bytes;
  const p: string[] = [];
  if (b === undefined || b === 'none') return p;
  const files = Object.keys(orig);
  const same = (f: string, want: string, why: string) => { if ((exp[f] ?? '') !== want) p.push(`${f}: ${why} (${Buffer.byteLength(exp[f] ?? '')} bytes vs expected ${Buffer.byteLength(want)})`); };
  if (b === 'equals-original') { for (const f of files) same(f, orig[f]!, 'not byte-identical to the original'); return p; }
  if (b === 'additive') {
    const cls = classesOf(spec);
    for (const f of files) {
      const o = orig[f]!, x = exp[f] ?? '';
      const so = strip(o, cls), sx = strip(x, cls);
      if (sx.text !== so.text) p.push(`${f}: after removing the permitted regions the file differs from the original (${Buffer.byteLength(sx.text)} vs ${Buffer.byteLength(so.text)} bytes)`);
      const inline = spec.expect.format === 'inline';
      const d = inline ? diffChars(o, x) : diffLines(o, x);
      const removed = d.filter((c) => c.removed);
      if (removed.length) p.push(`${f}: ${removed.length} removed ${inline ? 'text run' : 'line'} hunk(s) (a neighbouring ${inline ? 'character' : 'line'} changed): ${JSON.stringify(removed[0]!.value.slice(0, 60))}`);
      if (f === primary && spec.expect.format) {
        const own = sx.regions.filter((r) => r.kind !== 'rule');
        if (spec.expect.format === 'lines' && own.some((r) => !r.whole)) p.push('an inserted element or comment does not occupy whole lines');
        if (spec.expect.format === 'inline' && own.some((r) => r.kind === 'element' && r.whole)) p.push('expected the element on its neighbour\'s line (no whitespace invented) but it was written on its own line');
      }
    }
    return p;
  }
  const prim = orig[primary]!;
  for (const f of files) if (f !== primary) same(f, orig[f]!, 'a file that must not change was changed');
  if (b.replace) {
    if (prim.split(b.replace[0]).length !== 2) p.push('spec literal not unique in the original');
    same(primary, prim.replace(b.replace[0], () => b.replace[1]), 'not the original with only the stated text replaced');
  } else if (b.removed) {
    let want = prim;
    for (const r of b.removed as string[]) want = want.replace(r, '');
    same(primary, want, 'not the original with only the stated block(s) removed');
  } else if (b.innerOf) {
    const norm = (t: string) => (b.innerOf as string[]).reduce((s, id) => s.replace(new RegExp(`(<p id="${id}">)[\\s\\S]*?(</p>)`), '$1$2'), t);
    if (norm(exp[primary] ?? '') !== norm(prim)) p.push('something outside the inner text of the edited elements changed');
  } else if (b.stripNotesThen) {
    const mv = b.stripNotesThen.moveBefore as { lines: string; before: string };
    const stripped = strip(exp[primary] ?? '', []).text;
    const base = prim.replace(mv.lines, '');
    const at = base.indexOf(mv.before);
    const want = at < 0 ? '(spec error)' : base.slice(0, at) + mv.lines + base.slice(at);
    if (stripped !== want) p.push('after removing notes and the header the file is not the original with the block moved as stated');
  }
  return p;
}

// ---------------------------------------------------------------------------------------------------------------
// Browser measurements
// ---------------------------------------------------------------------------------------------------------------
const isLocal = (u: string) => u.startsWith('file:') || u.startsWith('about:') || u.startsWith('blob:') || u.startsWith('data:') || u.startsWith('http://127.0.0.1');
const libSrc = () => readFileSync(join(ROOT, 'harness/page-measure.js'), 'utf8') + ';' + readFileSync(join(ROOT, 'harness/page-insert-measure.js'), 'utf8');

export interface Dump { names: string[]; rows: { tag: string; id: string | null; parent: number; rect: number[]; props: string[] }[]; target: number; rootName: string }
export interface Loaded { info: Record<string, any>; dump: Dump | null; errors: string[]; navError: string | null }
export interface Params { created?: unknown[]; gone?: string[]; notes?: { selector: string }[]; header: string; order?: unknown; boxSel?: string[]; measured?: { selector: string; prop: string }[]; textSel?: string[]; indexSel?: string[]; subtreeSel?: string[]; dumpTarget?: string | null }

export async function loadAt(browser: Browser, dir: string, file: string, width: number, params: Params, dump: boolean): Promise<Loaded> {
  const ctx = await browser.newContext({ viewport: { width, height: 800 }, deviceScaleFactor: 1, javaScriptEnabled: false });
  await ctx.route('**/*', (r) => (isLocal(r.request().url()) ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
  let navError: string | null = null;
  try { await page.goto(`file://${join(dir, file)}`, { waitUntil: 'load' }); } catch (e) { navError = (e as Error).message; }
  try {
    const call = `${libSrc()};({info: window.InsMeasure.info(document, ${JSON.stringify(params)}), dump: ${dump ? `window.GateMeasure.fullDump(document, ${JSON.stringify(params.dumpTarget ?? null)}, null)` : 'null'}})`;
    const r = (await page.evaluate(call)) as { info: Record<string, any>; dump: Dump | null };
    return { ...r, errors, navError };
  } finally { await ctx.close(); }
}

// ---------------------------------------------------------------------------------------------------------------
// Collateral (check C)
// ---------------------------------------------------------------------------------------------------------------
const norm = (s: string) => s.toLowerCase().replace(/["']/g, '').replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim();
const LAYOUT = ['width', 'height', 'inline-size', 'block-size', 'perspective-origin', 'transform-origin'];
export type Mode = 'none' | 'text' | 'insert' | 'remove';

export function collateral(o: Dump, x: Dump, skipO: Set<number>, skipX: Set<number>, mode: Mode, slotsO: number[]): string[] {
  const OL = o.rows.map((_, i) => i).filter((i) => !skipO.has(i));
  const XL = x.rows.map((_, i) => i).filter((i) => !skipX.has(i));
  if (OL.length !== XL.length) return [`element count differs: ${OL.length} comparable in the original, ${XL.length} in the export`];
  for (let k = 0; k < OL.length; k++) if (o.rows[OL[k]!]!.tag !== x.rows[XL[k]!]!.tag) return [`element sequence differs at #${OL[k]}: <${o.rows[OL[k]!]!.tag}> vs <${x.rows[XL[k]!]!.tag}>`];
  const kids = (p: number) => o.rows.map((r, i) => (r.parent === p ? i : -1)).filter((i) => i >= 0);
  const subtree = (i: number): number[] => [i, ...kids(i).flatMap(subtree)];
  const anc = (i: number): number[] => { const out: number[] = []; for (let c = o.rows[i]!.parent; c >= 0; c = o.rows[c]!.parent) out.push(c); return out; };
  const following = (i: number) => kids(o.rows[i]!.parent).filter((s) => s > i);
  const flowSet = (t: number): Set<number> => { const s = new Set<number>(anc(t)); for (const a of [t, ...anc(t)]) for (const sib of following(a)) subtree(sib).forEach((k) => s.add(k)); return s; };
  let allowed = new Set<number>();
  for (const slotO of mode === 'none' ? [] : slotsO.filter((q) => q >= 0)) {
    if (mode === 'text') flowSet(slotO).forEach((k) => allowed.add(k));
    else { [...anc(slotO), ...subtree(slotO)].forEach((k) => allowed.add(k)); flowSet(slotO).forEach((k) => allowed.add(k)); }
    for (const k of precedingAllowed(o.rows, o.names, slotO)) allowed.add(k);
  }
  const L = new Set(LAYOUT.map((n) => o.names.indexOf(n)).filter((i) => i >= 0));
  const xIndex = new Map<string, number>(x.names.map((nm, i) => [nm, i]));
  const bad: string[] = [];
  for (let k = 0; k < OL.length; k++) {
    const i = OL[k]!;
    if (mode === 'text' && slotsO.includes(i)) continue;
    const a = o.rows[i]!, b = x.rows[XL[k]!]!;
    const lay = allowed.has(i);
    const what: string[] = [];
    if (!lay && !a.rect.every((v, q) => Math.abs(v - b.rect[q]!) <= 1)) what.push(`box [${a.rect.map((v) => +v.toFixed(1))}] -> [${b.rect.map((v) => +v.toFixed(1))}]`);
    for (let q = 0; q < a.props.length; q++) {
      if (lay && L.has(q)) continue;
      const name = o.names[q]!;
      const kb = xIndex.get(name);
      const bv = kb === undefined ? '(missing)' : b.props[kb]!;
      if (norm(a.props[q]!) !== norm(bv)) what.push(`${name}: ${norm(a.props[q]!).slice(0, 30)} -> ${norm(bv).slice(0, 30)}`);
    }
    if (what.length) bad.push(`el#${i} <${a.tag}${a.id ? '#' + a.id : ''}> ${what.slice(0, 2).join('; ')}`);
  }
  return bad;
}

// ---------------------------------------------------------------------------------------------------------------
// The checks for one export
// ---------------------------------------------------------------------------------------------------------------
export interface Extras {
  /** The preview's own measurements (engine harness page) at widths 1280 and 390, or null when not available (controls). */
  preview?: Record<number, { scrollHeight: number; boxes: Record<string, number[]> }> | null;
  /** Files after each step of the full run, and the files a fresh replay of the first n steps gives (index n-1). */
  stepFiles?: Record<string, string>[] | null;
  replays?: Record<string, string>[] | null;
  /** Files of a second full replay, and of the same list without its note steps. */
  again?: Record<string, string> | null;
  noNotes?: Record<string, string> | null;
  /** The engine's listNotes() of the original and of the export (indexes are element indexes), or null. */
  listNotesOriginal?: { page: unknown; notes: { index: number; text: string }[] } | null;
  listNotesExport?: { page: unknown; notes: { index: number; text: string }[] } | null;
  unlinked?: { selector: string; property: string; environment: string; value: string }[] | null;
  roundTrip?: (files: Record<string, string>) => boolean;
}

const readOf = (spec: Spec, i: number, n: { target: string; read: unknown }): string => {
  if (typeof n.read === 'string') return n.read;
  const step = spec.steps.filter((s) => s.op === 'note' && s.target === n.target).pop();
  return expandText(step!.text!);
};

export async function evaluateExport(browser: Browser, spec: Spec, inp: Input, files: Record<string, string>, tmp: string, extras: Extras = {}): Promise<Row[]> {
  const rows: Row[] = [];
  const add = (rule: string, pass: boolean, detail: string) => rows.push({ id: spec.id, rule, pass, detail: detail.replace(/\s+/g, ' ').slice(0, 700) });
  const ex = spec.expect;
  const orig = originalFiles(inp);
  const dirO = join(tmp, spec.id, 'original'), dirX = join(tmp, spec.id, 'exported');
  writeSet(dirO, orig);
  writeSet(dirX, files);
  const widths = testWidths(inp);
  const params: Params = {
    created: ex.created, gone: ex.gone, header: HEADER, order: ex.order,
    notes: (ex.notes ?? []).map((n: { target: string }) => ({ selector: n.target })),
    textSel: (ex.textEquals ?? []).map((t: { selector: string }) => t.selector),
    measured: (ex.measured ?? []).map((m: { selector: string; prop: string }) => ({ selector: m.selector, prop: m.prop })),
    boxSel: (ex.created ?? []).map((c: { selector: string }) => c.selector),
    indexSel: (ex.notes ?? []).map((n: { target: string }) => n.target),
  };
  (params as Params & { order: unknown }).order = ex.order;
  const createdSel: string | null = ex.created?.[0]?.selector ?? null;
  const goneSel: string | null = ex.gone?.[0] ?? null;
  // original document (no created selectors, no read-backs)
  const baseParams: Params = { header: HEADER, boxSel: [], created: [], gone: [], notes: [], measured: [], textSel: [], dumpTarget: goneSel };
  const O: Record<number, Loaded> = {}, X: Record<number, Loaded> = {};
  for (const w of widths) {
    O[w] = await loadAt(browser, dirO, inp.file, w, { ...baseParams }, true);
    X[w] = await loadAt(browser, dirX, inp.file, w, { ...params, dumpTarget: createdSel }, true);
  }
  const w0 = widths[0]!;
  const x0 = X[w0]!.info, o0 = O[w0]!.info;
  const removeSels = spec.steps.filter((st) => st.op === 'remove').map((st) => st.target!);
  const sizes = (await loadAt(browser, dirO, inp.file, w0, { ...baseParams, subtreeSel: removeSels.filter((q) => !q.startsWith('.new-')) }, false)).info.subtree as number[];
  let si = 0;
  const removed = removeSels.reduce((n, q) => n + (q.startsWith('.new-') ? 1 : sizes[si++]!), 0);
  const delta = typeof ex.elementDelta === 'number' ? ex.elementDelta : spec.steps.filter((st) => st.op === 'insert').length - removed;

  // E1 loads
  const p1: string[] = [];
  const fresh = X[w0]!.errors.filter((e) => !O[w0]!.errors.includes(e));
  if (X[w0]!.navError) p1.push(`navigation: ${X[w0]!.navError}`);
  if (fresh.length) p1.push(`new errors: ${fresh.join(' | ')}`);
  if (x0.parserErrors > o0.parserErrors) p1.push(`parser errors ${o0.parserErrors} -> ${x0.parserErrors}`);
  if (x0.elementCount !== o0.elementCount + delta) p1.push(`element count ${o0.elementCount} -> ${x0.elementCount}, expected ${o0.elementCount + delta}`);
  if (extras.roundTrip && !extras.roundTrip(files)) p1.push('zero-edit round trip of the export is not byte-identical');
  add('E1', p1.length === 0, p1.join(' | ') || 'loads, no new errors, element count as expected, zero-edit round trip identical');

  // A: created elements
  if (ex.created || ex.gone || ex.textEquals) {
    const pa: string[] = [];
    for (const [i, c] of (ex.created ?? []).entries()) {
      const r = x0.created[i];
      if (r.count !== 1) { pa.push(`${c.selector}: ${r.count} matches in the export (need exactly 1)`); continue; }
      if (r.tag !== c.tag) pa.push(`${c.selector}: tag <${r.tag}> not <${c.tag}>`);
      if (!r.parentMatches) pa.push(`${c.selector}: not a child of ${c.parent}`);
      if (r.index !== c.index) pa.push(`${c.selector}: position ${r.index} among its siblings, expected ${c.index}`);
      if (r.text !== c.text) pa.push(`${c.selector}: text ${JSON.stringify(r.text)} not ${JSON.stringify(c.text)}`);
      if (!r.hasClass) pa.push(`${c.selector}: class attribute missing`);
      for (const [k, v] of Object.entries(c.attrs ?? {})) if (r.attrs[k] !== v) pa.push(`${c.selector}: attribute ${k}=${JSON.stringify(r.attrs[k])}, expected ${JSON.stringify(v)}`);
    }
    for (const [i, s] of (ex.gone ?? []).entries()) if (x0.gone[i] !== 0) pa.push(`${s}: still present (${x0.gone[i]} matches)`);
    for (const [i, t] of (ex.textEquals ?? []).entries()) {
      const before = (await loadAt(browser, dirO, inp.file, w0, { ...baseParams, textSel: [t.selector] }, false)).info.textOf[0] as string;
      const lead = /^\s*/.exec(before)![0], trail = /\s*$/.exec(before.slice(lead.length))![0];
      const typed = expandText(spec.steps.filter((s) => s.op === 'text' && s.target === t.selector).pop()?.text ?? t.text);
      const want = lead + typed + trail;
      if (x0.textOf[i] !== want) pa.push(`${t.selector}: textContent ${JSON.stringify(String(x0.textOf[i]).slice(0, 60))} is not exactly the typed text ${JSON.stringify(want.slice(0, 60))}`);
    }
    add('A', pa.length === 0, pa.join(' | ') || 'created/removed/edited elements are as stated (count, tag, parent, position, text, attributes)');
  }

  // placement of the rule (where the styles of an inserted element went)
  if (ex.ruleIn) {
    const pr: string[] = [];
    const cls: string = ex.cls;
    const ruleRe = new RegExp(`\\.${esc(cls)}\\s*\\{[^}]*max-width\\s*:\\s*100%[^}]*\\}`);
    if (ex.ruleIn === 'inline') {
      for (const [f, t] of Object.entries(files)) if (new RegExp(`\\.${esc(cls)}\\s*\\{`).test(t)) pr.push(`${f}: a rule for .${cls} exists although the page has no stylesheet`);
      const sa = x0.created[0]?.styleAttr as string | null;
      if (!sa || !/max-width\s*:\s*100%/.test(sa)) pr.push(`the element's style attribute lacks max-width: 100% (${JSON.stringify(sa)})`);
    } else {
      const host = ex.ruleIn === 'document' ? inp.file : ex.ruleIn;
      if (!ruleRe.test(files[host] ?? '')) pr.push(`no rule for .${cls} with max-width: 100% in ${host}`);
      for (const f of Object.keys(files)) if (f !== host && new RegExp(`\\.${esc(cls)}\\s*\\{`).test(files[f]!)) pr.push(`${f}: the rule also appears here`);
      if (ex.ruleIn === 'document' && !(x0.styleTexts as string[]).some((t) => ruleRe.test(t))) pr.push('the rule is not inside a <style> element of the page');
      if (x0.created[0]?.styleAttr) pr.push('the new element also carries an inline style attribute although its rule is in a stylesheet');
    }
    if (typeof ex.styleElements === 'number' && x0.styleCount !== ex.styleElements) pr.push(`${x0.styleCount} <style> elements, expected ${ex.styleElements} (a new <style> block must never be created)`);
    for (const f of Object.keys(files)) if (!(f in orig)) pr.push(`new file ${f} was created`);
    add('P1', pr.length === 0, pr.join(' | ') || `rule/inline style placed as stated (${ex.ruleIn})`);
  }

  // B: bytes
  if (ex.bytes !== undefined && ex.bytes !== 'none') {
    const pb = bytesCheck(spec, orig, files, inp.file);
    add('B', pb.length === 0, pb.join(' | ') || `outside the permitted region(s) every byte of every file is the original's (${typeof ex.bytes === 'string' ? ex.bytes : Object.keys(ex.bytes)[0]})`);
  }

  // C: collateral and overflow
  const kinds = new Set(spec.steps.map((s) => s.op));
  const touchesOthers = spec.steps.some((s) => ['set', 'reorder', 'offset'].includes(s.op) && !String(s.target).startsWith('.new-'));
  const mode: Mode = ex.bytes === 'equals-original' ? 'none' : kinds.has('remove') ? 'remove' : kinds.has('insert') ? 'insert' : kinds.has('text') ? 'text' : 'none';
  const pc: string[] = [];
  for (const w of widths) {
    const over = X[w]!.info.scrollWidth - Math.max(X[w]!.info.clientWidth, O[w]!.info.scrollWidth);
    if (over > 0.5) pc.push(`@${w}: horizontal overflow, scrollWidth ${X[w]!.info.scrollWidth} vs viewport ${X[w]!.info.clientWidth}`);
    if (touchesOthers) continue;
    const od = O[w]!.dump!, xd = X[w]!.dump!;
    const skipX = new Set<number>(), skipO = new Set<number>();
    const sub = (d: Dump, i: number): number[] => [i, ...d.rows.map((r, k) => (r.parent === i ? k : -1)).filter((k) => k >= 0).flatMap((k) => sub(d, k))];
    let slot = -1;
    if (mode === 'insert' && createdSel && xd.target >= 0) { sub(xd, xd.target).forEach((k) => skipX.add(k)); const par = xd.rows[xd.target]!.parent; slot = par; }
    if (mode === 'remove' && goneSel && od.target >= 0) { sub(od, od.target).forEach((k) => skipO.add(k)); slot = od.rows[od.target]!.parent; }
    const slots: number[] = [];
    if (mode === 'text') for (const st of spec.steps) { const probe = await loadAt(browser, dirO, inp.file, w, { ...baseParams, dumpTarget: st.target! }, true); slots.push(probe.dump!.target); }
    // map the slot (a row of the original, or of the export for inserts) to a row of the original
    let slotO = slot;
    if (mode === 'insert' && slot >= 0) { const XL = xd.rows.map((_, i) => i).filter((i) => !skipX.has(i)); slotO = XL.indexOf(slot); const OLl = od.rows.map((_, i) => i).filter((i) => !skipO.has(i)); slotO = slotO >= 0 ? OLl[slotO]! : -1; }
    if (mode === 'insert' && slotO < 0 && ex.created) { pc.push(`@${w}: cannot locate the created element's parent in the export`); continue; }
    const bad = collateral(od, xd, skipO, skipX, mode, mode === 'text' ? slots : [slotO]);
    if (bad.length) pc.push(`@${w}: ${bad.length} element(s): ${bad.slice(0, 2).join(' || ')}`);
  }
  add('C', pc.length === 0, pc.slice(0, 3).join(' | ') || `no other element changed at ${widths.length} widths${touchesOthers ? ' (collateral compare skipped: the list edits existing elements by design; overflow checked)' : ` (${mode})`}; no horizontal overflow`);

  // D: hostile strings
  if (ex.hostile) {
    const pd: string[] = [];
    if (x0.scriptCount !== o0.scriptCount) pd.push(`script nodes ${o0.scriptCount} -> ${x0.scriptCount}`);
    if (x0.elementCount !== o0.elementCount + delta) pd.push(`elements ${o0.elementCount} -> ${x0.elementCount}`);
    const notesWanted = (ex.notes ?? []).length + (ex.pageNote ? 1 : 0);
    const headerGain = (x0.headerCount as number) - (o0.headerCount as number);
    if ((x0.commentTotal as number) - (o0.commentTotal as number) !== notesWanted + headerGain - (o0.noteComments as number)) pd.push(`comment nodes ${o0.commentTotal} -> ${x0.commentTotal}, expected one per note (${notesWanted}) plus ${headerGain} header`);
    if (inp.kind === 'svg' || ex.svgWellFormed) { if (x0.parserErrors > 0 || x0.rootName !== 'svg') pd.push(`SVG did not load as well-formed XML (parser errors ${x0.parserErrors}, root ${x0.rootName})`); }
    add('D', pd.length === 0, pd.join(' | ') || 'no new elements, no new script nodes, one comment node per note, text exact');
  }
  if (ex.svgWellFormed && !ex.hostile) {
    const parse = (await browserParseXml(browser, files[inp.file]!));
    add('D', parse === '' && x0.rootName === 'svg' && x0.parserErrors === 0, parse || 'SVG export is well-formed XML');
  }

  // E: notes and header
  if (ex.notes || ex.headerCount !== undefined || ex.pageNote) {
    const pe: string[] = [];
    for (const [i, n] of (ex.notes ?? []).entries()) {
      const got = x0.notes[i];
      const want = ` NOTE FOR AI: ${readOf(spec, i, n)} `;
      if (got.missing) pe.push(`${n.target}: element not found`);
      else if (got.data !== want) pe.push(`${n.target}: comment before it is ${JSON.stringify(got.data === null ? null : String(got.data).slice(0, 70))}, expected ${JSON.stringify(want.slice(0, 70))}`);
      else if (got.count !== 1) pe.push(`${n.target}: ${got.count} notes before it (one per element)`);
    }
    if (ex.headerCount !== undefined && x0.headerCount !== ex.headerCount) pe.push(`${x0.headerCount} header comment(s), expected ${ex.headerCount}`);
    if (x0.headerCount > 0 && ex.headerAfter === 'doctype' && !x0.header.previousIsDoctype) pe.push('the header is not directly after the DOCTYPE');
    if (x0.headerCount > 0 && ex.headerAfter === 'start' && !x0.header.isFirstNode) pe.push('the header is not the first node of the file');
    if (ex.pageNote) {
      const want = ` NOTE FOR AI (whole page): ${ex.pageNote.read} `;
      if (!(x0.pageNote as string[]).includes(want) || (x0.pageNote as string[]).length !== 1) pe.push(`page note ${JSON.stringify(x0.pageNote)} is not exactly [${JSON.stringify(want)}]`);
      if (x0.header && x0.header.nextData !== want) pe.push('the page note does not sit right after the header');
    }
    const expectNotes = (ex.notes ?? []).length + (ex.pageNote ? 1 : 0);
    if (ex.notes && x0.noteComments !== expectNotes) pe.push(`${x0.noteComments} NOTE comments in the export, expected ${expectNotes}`);
    add('E', pe.length === 0, pe.join(' | ') || 'notes read back exactly through comment nodes; header count and position as stated');
  }

  // order, measured, unlinked
  if (ex.order) { const ok = JSON.stringify(x0.order) === JSON.stringify(ex.order.ids); add('O', ok, ok ? `order ${JSON.stringify(x0.order)}` : `order ${JSON.stringify(x0.order)}, expected ${JSON.stringify(ex.order.ids)}`); }
  if (ex.measured) {
    const bp = breakpointOf(inp);
    const pm: string[] = [];
    for (const w of widths) for (const [i, m] of ex.measured.entries()) {
      const want = w > bp ? m.by.hi : m.by.lo;
      const got = X[w]!.info.measured[i] as string | null;
      const ok = got !== null && (/px$/.test(want) && /px$/.test(got) ? Math.abs(parseFloat(got) - parseFloat(want)) <= 0.5 : got === want);
      if (!ok) pm.push(`@${w} ${m.selector} ${m.prop} ${got} want ${want}`);
    }
    add('M', pm.length === 0, pm.slice(0, 4).join(' | ') || `measured values as stated at ${widths.length} widths`);
  }
  if (ex.unlinked) {
    const got = extras.unlinked ?? null;
    const ok = got !== null && JSON.stringify(got) === JSON.stringify(ex.unlinked);
    add('U', ok, ok ? 'the review list names the right element' : `listUnlinked ${JSON.stringify(got)} expected ${JSON.stringify(ex.unlinked)}`);
  }

  // F: undo, replay, notes-off
  if (extras.again !== undefined && extras.again !== null) {
    const same = JSON.stringify(extras.again) === JSON.stringify(files);
    add('F1', same, same ? 'replaying the full list from the original gives identical bytes' : 'a second replay of the same list gave different bytes');
  }
  if (ex.undo) {
    const sf = extras.stepFiles ?? null, rp = extras.replays ?? null;
    const pu: string[] = [];
    if (!sf || !rp) pu.push('no step files or replays available');
    else pu.push(...undoProblems(sf, rp));
    add('F2', pu.length === 0, pu.join(' | ') || `undo by replay: the first n steps replayed equal the earlier bytes exactly for n = 1..${(rp ?? []).length}`);
  }
  if (ex.notesOff) {
    const pn: string[] = [];
    if (!extras.noNotes) pn.push('no notes-off run available');
    else for (const f of Object.keys(orig)) {
      const stripped = strip(files[f] ?? '', []).text;
      if (stripped !== (extras.noNotes[f] ?? '')) pn.push(`${f}: the export with notes stripped differs from the export of the same list without its note edits`);
    }
    add('F3', pn.length === 0, pn.join(' | ') || 'notes-off: the same list without note edits equals the full export with notes stripped');
  }

  // preview equals export
  if (extras.preview) {
    const pv: string[] = [];
    for (const w of [1280, 390]) {
      const pr = extras.preview[w];
      if (!pr) continue;
      const xi = (await loadAt(browser, dirX, inp.file, w, { ...params, dumpTarget: null }, false)).info;
      if (Math.abs(pr.scrollHeight - xi.scrollHeight) > 1) pv.push(`@${w} document height preview ${pr.scrollHeight} vs export ${xi.scrollHeight}`);
      for (const [sel, box] of Object.entries(pr.boxes)) { const eb = xi.boxes[sel] as number[] | undefined; if (!eb || box.some((v, k) => Math.abs(v - eb[k]!) > 1)) pv.push(`@${w} ${sel} box preview [${box.map((v) => +v.toFixed(1))}] vs export [${eb?.map((v) => +v.toFixed(1))}]`); }
    }
    add('V', pv.length === 0, pv.join(' | ') || 'preview and export agree (document height and created element box at 1280 and 390)');
  }

  // listNotes
  if (ex.listNotesOriginal || extras.listNotesExport) {
    const pl: string[] = [];
    const idxO = await loadAt(browser, dirO, inp.file, w0, { ...baseParams, indexSel: (ex.listNotesOriginal?.notes ?? []).map((n: { target: string }) => n.target) }, false);
    if (ex.listNotesOriginal) {
      const want = (ex.listNotesOriginal.notes as { target: string; read: string }[]).map((n) => ({ index: idxO.info.indexOf[n.target] as number, text: n.read }));
      const got = extras.listNotesOriginal?.notes ?? null;
      if (!got || JSON.stringify(got.map((n) => ({ index: n.index, text: n.text }))) !== JSON.stringify(want)) pl.push(`listNotes(original) ${JSON.stringify(got)} expected ${JSON.stringify(want)}`);
    }
    if (ex.notes) {
      const want = (ex.notes as { target: string; read: unknown }[]).map((n, i) => ({ index: x0.indexOf[n.target] as number, text: readOf(spec, i, n) })).sort((a, b) => a.index - b.index);
      const got = extras.listNotesExport?.notes ?? null;
      if (!got || JSON.stringify(got.map((n) => ({ index: n.index, text: n.text })).sort((a, b) => a.index - b.index)) !== JSON.stringify(want)) pl.push(`listNotes(export) ${JSON.stringify(got)} expected ${JSON.stringify(want)}`);
    }
    add('L', pl.length === 0, pl.join(' | ') || 'listNotes returns exactly the notes in the file, with their elements and texts');
  }
  return rows;
}

/** Undo by replay: replaying the first n steps from the original must give exactly the bytes the full run had after step n. */
export function undoProblems(stepFiles: Record<string, string>[], replays: Record<string, string>[]): string[] {
  const p: string[] = [];
  for (let n = 0; n < replays.length; n++) if (JSON.stringify(replays[n]) !== JSON.stringify(stepFiles[n])) p.push(`replaying the first ${n + 1} step(s) differs from the bytes after step ${n + 1} of the full run`);
  return p;
}

async function browserParseXml(browser: Browser, text: string): Promise<string> {
  const ctx = await browser.newContext({ javaScriptEnabled: true });
  const page = await ctx.newPage();
  try {
    return await page.evaluate((t) => { const d = new DOMParser().parseFromString(t, 'image/svg+xml'); const e = d.getElementsByTagName('parsererror')[0]; return e ? (e.textContent ?? 'parsererror').slice(0, 200) : ''; }, text);
  } finally { await ctx.close(); }
}
