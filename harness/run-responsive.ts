// Responsive iteration harness (docs/responsive-rules.md): the 20 specs in fixtures/responsive/edits.json plus the
// locked real-page edits R01 and R09, each checked at every test width. Every outcome is produced by this script,
// except that the truth of each REFUSED reason is checked afterwards by reading the file.
//   GATE_RUN=<n> npx tsx harness/run-responsive.ts [realPagesDir]
import { chromium } from 'playwright';
import type { Page } from 'playwright';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { diffLines } from 'diff';
import { normOrig } from './e5-amend';
import { createModel, exportFiles, sources } from '../engine/src/index';
import { ROOT } from './fixtures';
import { serve } from './serve';
import { precedingAllowed } from './e4-amend';

const RUN = process.env.GATE_RUN ?? '1';
// GATE_CONTROL=noop|collateral|reformat: scorer sanity check on deliberately broken exports (nothing is written to the results).
const CONTROL = process.env.GATE_CONTROL ?? '';
const REAL = resolve(process.argv[2] ?? join(ROOT, '../ui-editor-realpages'));
// SUITE=size runs fixtures/size/edits.json (docs/size-scaling-rules.md) instead of the responsive specs and R01/R09.
const SUITE = process.env.SUITE === 'size' ? 'size' : process.env.SUITE === 'size-flex' ? 'size-flex' : 'responsive';
const SDIR = SUITE === 'responsive' ? 'responsive-check' : 'size-check';
const OUT = join(ROOT, SDIR, 'results');
const CSV = join(OUT, `${SUITE === 'responsive' ? 'responsive' : SUITE}-results.csv`);
const TMP = join(ROOT, SDIR, 'tmp', CONTROL ? `control-${CONTROL}` : `run-${RUN}`);
const RAW = join(ROOT, SDIR, 'raw', CONTROL ? `control-${CONTROL}` : `run-${RUN}`);

interface Step { target: string; op: 'set' | 'offset' | 'reorder'; properties?: Record<string, string>; dx?: number; dy?: number; placement?: string; sibling?: string; environment?: string; link?: boolean }
interface Measure { target?: string; parent?: string; props?: string[]; bbox?: boolean; visualOrder?: boolean }
interface Spec {
  id: string; case: string; kind: string; fixture: string; steps: Step[]; measure: Measure; widths: number[];
  expected: Record<string, Record<string, unknown>>; legit: 'descendants' | 'flow' | 'reorder' | 'svg-ancestors';
  expectedOutcome: 'PASS' | 'REFUSED'; expectNotScaled?: string[]; real?: boolean;
}
interface Input { file: string; kind: 'html' | 'svg'; source: string; companions: Record<string, string>; dir: string }

if (!CONTROL && existsSync(CSV) && readFileSync(CSV, 'utf8').split('\n').some((l) => l.startsWith(`${RUN},`))) throw new Error(`run ${RUN} already exists in ${CSV}`);
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
mkdirSync(RAW, { recursive: true });
mkdirSync(OUT, { recursive: true });

const FIXDIR = SUITE === 'size' ? 'fixtures/size' : SUITE === 'size-flex' ? 'fixtures/size-flex' : 'fixtures/responsive';
const respSpecs = (JSON.parse(readFileSync(join(ROOT, FIXDIR, 'edits.json'), 'utf8')) as { edits: Spec[] }).edits;
const realFile = JSON.parse(readFileSync(join(ROOT, 'realpage-check/edits.json'), 'utf8')) as { companions: Record<string, Record<string, string>>; edits: { id: string; file: string; target: string; edit: { op: 'set'; properties: Record<string, string> }; legit: Spec['legit'] }[] };

// ---- inputs -----------------------------------------------------------------------------------
const inputs = new Map<string, Input>();
const fixtureInput = (file: string): Input => {
  let i = inputs.get(`r:${file}`);
  if (!i) { const dir = join(ROOT, FIXDIR); i = { file, kind: 'html', source: readFileSync(join(dir, file), 'utf8'), companions: {}, dir }; inputs.set(`r:${file}`, i); }
  return i;
};
const realInput = (file: string): Input => {
  let i = inputs.get(`p:${file}`);
  if (!i) {
    const companions: Record<string, string> = {};
    for (const [href, rel] of Object.entries(realFile.companions[file] ?? {})) companions[href] = readFileSync(join(REAL, rel), 'utf8');
    i = { file, kind: 'html', source: readFileSync(join(REAL, file), 'utf8'), companions, dir: REAL };
    inputs.set(`p:${file}`, i);
  }
  return i;
};

const realWidths = (inp: Input): number[] => {
  const text = [inp.source, ...Object.values(inp.companions)].join('\n');
  const set = new Set<number>([1280, 1024, 768, 390]);
  for (const m of text.matchAll(/(?:max|min)-width\s*:\s*(\d+(?:\.\d+)?)px/g)) { const v = Math.floor(parseFloat(m[1]!)); set.add(v); set.add(v + 1); }
  return [...set].sort((a, b) => b - a);
};
const specs: Spec[] = [...respSpecs];
for (const id of SUITE !== 'responsive' ? [] : ['R01', 'R09']) {
  const r = realFile.edits.find((e) => e.id === id)!;
  const inp = realInput(r.file);
  specs.push({ id, case: 'real-page', kind: 'linked', fixture: r.file, real: true, steps: [{ target: r.target, op: 'set', properties: r.edit.properties, environment: 'desktop', link: true }],
    measure: { target: r.target, props: ['font-size'] }, widths: realWidths(inp), expected: {}, legit: r.legit, expectedOutcome: 'PASS' });
}
const inputOf = (s: Spec) => (s.real ? realInput(s.fixture) : fixtureInput(s.fixture));

// ---- helpers ----------------------------------------------------------------------------------
interface Row { run: string; id: string; case: string; kind: string; fixture: string; rule: string; outcome: string; pass: boolean; detail: string }
const rows: Row[] = [];
const add = (s: { id: string; case: string; kind: string; fixture: string }, rule: string, pass: boolean, detail: string) =>
  rows.push({ run: RUN, id: s.id, case: s.case, kind: s.kind, fixture: s.fixture, rule, outcome: '', pass, detail: detail.replace(/\s+/g, ' ').slice(0, 700) });

const norm = (s: string | null): string => (s ?? '').toLowerCase().replace(/["']/g, '').replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim();
const lineOf = (text: string, offset: number): number => { let n = 1; for (let i = 0; i < offset && i < text.length; i++) if (text[i] === '\n') n++; return n; };
const isPx = (v: string) => /^-?[\d.]+px$/.test(v.trim());
const close = (a: string, b: string, tol: number) => (isPx(a) && isPx(b) ? Math.abs(parseFloat(a) - parseFloat(b)) <= tol : norm(a) === norm(b));
const isLocal = (u: string) => u.startsWith('file:') || u.startsWith('about:') || u.startsWith('blob:') || u.startsWith('data:') || u.startsWith('http://127.0.0.1');

function writeSet(dir: string, set: Record<string, string>): void {
  for (const [name, text] of Object.entries(set)) { mkdirSync(dirname(join(dir, name)), { recursive: true }); writeFileSync(join(dir, name), text); }
}

const libSrc = readFileSync(join(ROOT, 'harness/page-measure-real.js'), 'utf8') + ';' + readFileSync(join(ROOT, 'harness/page-measure-resp.js'), 'utf8');

execSync('node harness/bundle.mjs', { cwd: ROOT, stdio: 'inherit' });
const { url, server } = await serve(ROOT);
const browser = await chromium.launch({ headless: true });
const engineCtx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
await engineCtx.route('**/*', (r) => (isLocal(r.request().url()) ? r.continue() : r.abort()));
const enginePage = await engineCtx.newPage();
await enginePage.goto(url);
await enginePage.addScriptTag({ url: '/engine.js' });
await enginePage.addScriptTag({ path: join(ROOT, 'harness/page-measure-resp.js') });
await enginePage.addScriptTag({ path: join(ROOT, 'harness/page-resp.js') });

interface Dump { names: string[]; rows: { tag: string; id: string | null; parent: number; rect: number[]; props: string[] }[]; target: number; rootName: string }
type OutT = { refused: { code: string; message: string } | null; files?: Record<string, string>; before?: Record<string, { props?: Record<string, string>; bbox?: number[]; visualOrder?: string[] }>; after?: Record<string, { props?: Record<string, string>; bbox?: number[]; visualOrder?: string[] }>; notes?: { property: string; condition: string; value: string; reason: string }[]; spans?: { startTag: number[] }; placements?: string[]; unlinked?: unknown[] };
interface AtWidth { m: Record<string, unknown>; dump: Dump | null; errors: string[]; navError: string | null }

/** Load a page at one viewport width (JavaScript off, other hosts aborted) and measure it. */
async function loadAt(dir: string, file: string, width: number, measure: Measure, dump: boolean, targetSel: string | null = null): Promise<AtWidth> {
  const ctx = await browser.newContext({ viewport: { width, height: 800 }, deviceScaleFactor: 1, javaScriptEnabled: false });
  await ctx.route('**/*', (r) => (isLocal(r.request().url()) ? r.continue() : r.abort()));
  const page: Page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
  let navError: string | null = null;
  try { await page.goto(`file://${join(dir, file)}`, { waitUntil: 'load' }); } catch (e) { navError = (e as Error).message; }
  try {
    const call = `${libSrc};({m: window.RespMeasure.measure(document, ${JSON.stringify(measure)}), dump: ${dump ? `window.GateMeasure.fullDump(document, ${JSON.stringify(targetSel ?? measure.target ?? null)}, null)` : 'null'}})`;
    const r = (await page.evaluate(call)) as { m: Record<string, unknown>; dump: Dump | null };
    return { ...r, errors, navError };
  } finally { await ctx.close(); }
}

const layoutIdx = (names: string[]) => new Set(names.map((n, i) => (['width', 'height', 'inline-size', 'block-size', 'perspective-origin', 'transform-origin'].includes(n) ? i : -1)).filter((i) => i >= 0));
function e4(spec: Spec, orig: Dump, exp: Dump, amended = true): string[] {
  if (orig.rows.length !== exp.rows.length) return [`element count ${orig.rows.length} vs ${exp.rows.length}`];
  const n = orig.rows.length;
  const kids = (p: number) => orig.rows.map((r, i) => (r.parent === p ? i : -1)).filter((i) => i >= 0);
  const subtree = (i: number): number[] => [i, ...kids(i).flatMap(subtree)];
  const t = orig.target;
  const anc = (i: number): number[] => { const o: number[] = []; for (let c = orig.rows[i]!.parent; c >= 0; c = orig.rows[c]!.parent) o.push(c); return o; };
  const followingSibs = (i: number) => kids(orig.rows[i]!.parent).filter((s) => s > i);
  const flowSet = (x: number): Set<number> => { const s = new Set<number>(anc(x)); for (const a of [x, ...anc(x)]) for (const sib of followingSibs(a)) subtree(sib).forEach((k) => s.add(k)); return s; };
  const desc = new Set(subtree(t).filter((i) => i !== t));
  const L = layoutIdx(orig.names);
  let layoutAllowed = new Set<number>();
  let bboxOnly = new Set<number>();
  if (spec.legit === 'flow') layoutAllowed = flowSet(t);
  else if (spec.legit === 'reorder') { const p = orig.rows[t]!.parent; layoutAllowed = new Set([...anc(t), ...subtree(p), ...flowSet(p)]); }
  else if (spec.legit === 'svg-ancestors') bboxOnly = new Set(anc(t));
  if (amended && (spec.legit === 'flow' || spec.legit === 'reorder')) for (const k of precedingAllowed(orig.rows, orig.names, t)) layoutAllowed.add(k);
  const expIndex = new Map<string, number>(exp.names.map((nm, i) => [nm, i]));
  const bad: string[] = [];
  for (let i = 0; i < n; i++) {
    if (i === t || desc.has(i)) continue;
    const a = orig.rows[i]!, b = exp.rows[i]!;
    const lay = layoutAllowed.has(i), bb = lay || bboxOnly.has(i);
    const what: string[] = [];
    if (!bb && !a.rect.every((v, k) => Math.abs(v - b.rect[k]!) <= 1)) what.push(`bbox [${a.rect.map((v) => +v.toFixed(1))}] -> [${b.rect.map((v) => +v.toFixed(1))}]`);
    for (let k = 0; k < a.props.length; k++) {
      if (lay && L.has(k)) continue;
      const name = orig.names[k]!;
      const kb = expIndex.get(name);
      const bv = kb === undefined ? '(missing)' : b.props[kb]!;
      if (norm(a.props[k]!) !== norm(bv)) what.push(`${name}: ${norm(a.props[k]!).slice(0, 30)} -> ${norm(bv).slice(0, 30)}`);
    }
    if (what.length) bad.push(`el#${i} <${a.tag}${a.id ? '#' + a.id : ''}> ${what.slice(0, 2).join('; ')}`);
  }
  return bad;
}

function e5(spec: Spec, inp: Input, out: Record<string, string>, startTag: number[], amended = true): { problems: string[]; diff: string } {
  const orig: Record<string, string> = { [inp.file]: inp.source, ...inp.companions };
  const problems: string[] = [];
  let added = 0, mediaAdded = 0, removedTotal = 0;
  for (const name of Object.keys(orig)) {
    const o = orig[name]!, x = out[name] ?? '';
    if (o === x) continue;
    let oldLine = 1;
    const lo = name === inp.file ? lineOf(inp.source, startTag[0]!) : -1;
    const hi = name === inp.file ? lineOf(inp.source, Math.max(startTag[0]!, startTag[1]! - 1)) : -1;
    for (const c of diffLines(amended ? normOrig(o, x) : o, x)) {
      const lines = c.value.split('\n');
      if (lines[lines.length - 1] === '') lines.pop();
      if (c.removed) {
        removedTotal += lines.length;
        for (let k = 0; k < lines.length; k++) if (oldLine + k < lo || oldLine + k > hi) problems.push(`${name}: removed line ${oldLine + k} is outside the target's start tag`);
        oldLine += lines.length;
      } else if (c.added) { added += lines.length; mediaAdded += lines.filter((l) => l.trim().startsWith('@media')).length; }
      else oldLine += lines.length;
    }
  }
  const allowance = 3 * spec.steps.length + 2 * mediaAdded;
  if (added > allowance) problems.push(`${added} changed or added lines, allowance ${allowance}`);
  return { problems, diff: `added=${added} removed=${removedTotal} allowance=${allowance}` };
}

// ---- no-op round trips for the new fixtures ---------------------------------------------------
const files9 = [...new Set(respSpecs.map((s) => s.fixture))];
for (const [n, file] of files9.entries()) {
  const inp = fixtureInput(file);
  const id = `RT${String(n + 1).padStart(2, '0')}`;
  const tag = { id, case: 'roundtrip', kind: 'roundtrip', fixture: file };
  try {
    const out = exportFiles(sources(createModel(inp.source, inp.kind, inp.companions, inp.file)), []);
    add(tag, 'RT', out[file] === inp.source, out[file] === inp.source ? `byte-identical (${Buffer.byteLength(inp.source)} bytes)` : 'NOT byte-identical');
    writeSet(join(TMP, id), out);
    const r = await loadAt(join(TMP, id), file, 1280, {}, false);
    add(tag, 'E1', !r.navError && r.errors.length === 0, r.errors.join(' | ') || 'no-op export loads, no errors');
  } catch (e) { add(tag, 'RT', false, `engine threw: ${(e as Error).message}`); }
}

// ---- the specs --------------------------------------------------------------------------------
const outcomes = new Map<string, { outcome: string; notes: unknown[]; diff: string }>();
for (const spec of specs) {
  if (process.env.GATE_ONLY && spec.id !== process.env.GATE_ONLY) continue;
  const inp = inputOf(spec);
  const startRow = rows.length;
  const origFiles: Record<string, string> = { [inp.file]: inp.source, ...inp.companions };
  const dirO = join(TMP, spec.id, 'original');
  writeSet(dirO, origFiles);
  let out = null as OutT | null;
  let threw = '';
  try {
    out = (await enginePage.evaluate(([f, st, w, m]) => (window as never as { runRespSpec: (...a: unknown[]) => Promise<unknown> }).runRespSpec(f, st, w, m), [{ file: inp.file, kind: inp.kind, source: inp.source, companions: inp.companions }, spec.steps, spec.widths, spec.measure] as const)) as typeof out;
  } catch (e) { threw = (e as Error).message; }
  const tag = spec;
  let outcome = 'PASS';
  if (threw) {
    outcome = 'FAIL';
    add(tag, 'E1', false, `uncaught exception: ${threw}`);
  } else if (out!.refused) {
    const why = `structured refusal (${out!.refused.code}): ${out!.refused.message}`;
    outcome = spec.expectedOutcome === 'REFUSED' ? 'REFUSED' : 'REFUSED';
    for (const r of ['E1', 'E2', 'E3', 'E4', 'E5']) add(tag, r, false, why);
  } else if (spec.expectedOutcome === 'REFUSED') {
    outcome = 'FAIL';
    add(tag, 'E2', false, 'expected a refusal but the engine produced an export');
  } else {
    let files = out!.files!;
    if (CONTROL) {
      const m = files[inp.file] ?? inp.source;
      if (CONTROL === 'samewidth' || CONTROL === 'overflow' || CONTROL === 'refgood') {
        // Scorer check for the size suite: the phone value wrongly equals the desktop value, or overflows the phone container.
        // Built from the spec's hand-written reference CSS (not from the engine), so only the sabotage can make E2 fail.
        const refSrc = inp.source.replace('</head>', `<style>${(spec as Spec & { reference?: string }).reference ?? ''}</style></head>`);
        const st = spec.steps[spec.steps.length - 1]!;
        const prop = Object.keys(st.properties ?? {})[0] ?? 'width';
        const val = CONTROL === 'refgood' ? '' : CONTROL === 'samewidth' ? st.properties![prop]! : '3000px';
        const css = CONTROL === 'refgood' ? '' : `<style>@media (max-width: 640px) { ${spec.measure.target} { ${prop}: ${val} !important; flex-basis: ${val} !important; max-width: none !important; } }</style>`;
        files = { ...files, [inp.file]: refSrc.replace('</head>', `${css}</head>`) };
      } else
      if (CONTROL === 'lastline' || CONTROL === 'twonl') {
        const name = [inp.file, ...Object.keys(inp.companions)].find((n) => !origFiles[n]!.endsWith('\n') && (files[n] ?? '').startsWith(origFiles[n]!) && files[n] !== origFiles[n]) ?? inp.file;
        const o = origFiles[name]!, x = files[name] ?? '';
        files = { ...files, [name]: `${x.slice(0, o.length)}${CONTROL === 'lastline' ? ' ' : '\n'}${x.slice(o.length)}` };
      } else
      files = CONTROL === 'noop' ? { ...origFiles } : CONTROL === 'reformat' ? { ...files, [inp.file]: m.replace('\n', '\n ') } : { ...files, [inp.file]: m.replace('</head>', '<style>p,li,td,div,span,h1,h2,h3,a{color:#123456 !important}</style></head>') };
    }
    const dirX = join(TMP, spec.id, 'exported');
    writeSet(dirX, files);
    if (process.env.EXPORT_DIR && !CONTROL) writeSet(join(process.env.EXPORT_DIR, SUITE === 'responsive' ? 'resp' : SUITE, spec.id), files);
    // original measurements per width (and expected values for the real-page specs, from the formula)
    const O: Record<number, AtWidth> = {}, X: Record<number, AtWidth> = {};
    for (const w of spec.widths) { O[w] = await loadAt(dirO, inp.file, w, spec.measure, true, spec.steps[0]!.target); X[w] = await loadAt(dirX, inp.file, w, spec.measure, true, spec.steps[0]!.target); }
    let expected = spec.expected;
    if (spec.real) {
      const o1280 = parseFloat((O[1280]!.m.props as Record<string, string>)['font-size']!);
      const ratio = parseFloat(Object.values(spec.steps[0]!.properties!)[0]!) / o1280;
      expected = { 'font-size': Object.fromEntries(spec.widths.map((w) => [String(w), `${+(parseFloat((O[w]!.m.props as Record<string, string>)['font-size']!) * ratio).toFixed(4)}px`])) };
    }
    // E1
    const p1: string[] = [];
    const w0 = spec.widths[0]!;
    const fresh = X[w0]!.errors.filter((e) => !O[w0]!.errors.includes(e));
    if (X[w0]!.navError) p1.push(`navigation: ${X[w0]!.navError}`);
    if (fresh.length) p1.push(`new errors: ${fresh.join(' | ')}`);
    try {
      const comps: Record<string, string> = {};
      for (const k of Object.keys(inp.companions)) comps[k] = files[k] ?? '';
      const a = createModel(inp.source, inp.kind, inp.companions, inp.file), b = createModel(files[inp.file] ?? '', inp.kind, comps, inp.file);
      if (b.primary.parseErrors > a.primary.parseErrors) p1.push(`engine re-parse errors ${b.primary.parseErrors} > ${a.primary.parseErrors}`);
      if (b.primary.elements.length !== a.primary.elements.length) p1.push(`engine element count ${a.primary.elements.length} -> ${b.primary.elements.length}`);
    } catch (e) { p1.push(`engine re-parse threw: ${(e as Error).message}`); }
    if (O[w0]!.dump!.rows.length !== X[w0]!.dump!.rows.length) p1.push('DOM element count differs');
    add(tag, 'E1', p1.length === 0, p1.join(' | ') || 'loads, no new errors, re-parse clean, counts equal');
    // E2 and E3
    const p2: string[] = [], p3: string[] = [];
    for (const w of spec.widths) {
      const xm = X[w]!.m as { props?: Record<string, string>; bbox?: number[]; visualOrder?: string[] };
      const om = O[w]!.m as { bbox?: number[] };
      const pa = out!.after![w]!, pb = out!.before![w]!;
      for (const [k, byW] of Object.entries(expected)) {
        if (k === 'bboxDelta') {
          const want = (byW as Record<string, { dx: number; dy: number }>)[String(w)]!;
          const got = [xm.bbox![0]! - om.bbox![0]!, xm.bbox![1]! - om.bbox![1]!];
          if (Math.abs(got[0]! - want.dx) > 1 || Math.abs(got[1]! - want.dy) > 1) p2.push(`@${w} bbox delta got [${got.map((v) => +v.toFixed(1))}] want [${want.dx},${want.dy}]`);
          const pv = [pa.bbox![0]! - pb.bbox![0]!, pa.bbox![1]! - pb.bbox![1]!];
          if (Math.abs(pv[0]! - got[0]!) > 1 || Math.abs(pv[1]! - got[1]!) > 1) p3.push(`@${w} bbox delta preview [${pv.map((v) => +v.toFixed(1))}] vs export [${got.map((v) => +v.toFixed(1))}]`);
        } else if (k === 'visualOrder') {
          const want = (byW as Record<string, string[]>)[String(w)]!;
          if (JSON.stringify(xm.visualOrder) !== JSON.stringify(want)) p2.push(`@${w} order got ${JSON.stringify(xm.visualOrder)} want ${JSON.stringify(want)}`);
          if (JSON.stringify(pa.visualOrder) !== JSON.stringify(xm.visualOrder)) p3.push(`@${w} order preview ${JSON.stringify(pa.visualOrder)} vs export ${JSON.stringify(xm.visualOrder)}`);
        } else {
          const want = (byW as Record<string, string>)[String(w)]!;
          const got = xm.props![k]!;
          if (!close(got, want, 0.5)) p2.push(`@${w} ${k} got ${got} want ${want}`);
          if (!close(pa.props![k]!, got, 1)) p3.push(`@${w} ${k} preview ${pa.props![k]} vs export ${got}`);
        }
      }
    }
    if (spec.expectNotScaled) for (const prop of spec.expectNotScaled) if (!out!.notes!.some((n) => n.property === prop)) p2.push(`no "not scaled" note for ${prop}`);
    add(tag, 'E2', p2.length === 0, p2.slice(0, 4).join(' | ') || `matches the Truth at ${spec.widths.length} widths${spec.real ? `; expected ${JSON.stringify(expected['font-size'])}` : ''}`);
    add(tag, 'E3', p3.length === 0, p3.slice(0, 4).join(' | ') || `preview and export agree at ${spec.widths.length} widths`);
    // E4
    const p4: string[] = [], p4L: string[] = [];
    for (const w of spec.widths) {
      const bad = e4(spec, O[w]!.dump!, X[w]!.dump!, true); if (bad.length) p4.push(`@${w}: ${bad.length} element(s): ${bad.slice(0, 2).join(' || ')}`);
      const badL = e4(spec, O[w]!.dump!, X[w]!.dump!, false); if (badL.length) p4L.push(`@${w}: ${badL.length} element(s): ${badL.slice(0, 2).join(' || ')}`);
    }
    add(tag, 'E4', p4.length === 0, p4.slice(0, 3).join(' | ') || `no other element changed at ${spec.widths.length} widths (amended E4)`);
    add(tag, 'E4L', p4L.length === 0, p4L.slice(0, 3).join(' | ') || `no other element changed at ${spec.widths.length} widths (locked E4)`);
    // E5
    const r5 = e5(spec, inp, files, out!.spans!.startTag);
    const r5L = e5(spec, inp, files, out!.spans!.startTag, false);
    add(tag, 'E5L', r5L.problems.length === 0, `${r5L.diff}${r5L.problems.length ? ' | ' + r5L.problems.slice(0, 3).join(' | ') : ''} (locked E5)`);
    add(tag, 'E5', r5.problems.length === 0, `${r5.diff}${r5.problems.length ? ' | ' + r5.problems.slice(0, 3).join(' | ') : ''}`);
    outcome = rows.slice(startRow).filter((r) => r.rule !== 'E4L' && r.rule !== 'E5L').every((r) => r.pass) ? 'PASS' : 'FAIL';
  }
  const notes = out && !out.refused ? out.notes ?? [] : [];
  rows.push({ run: RUN, id: spec.id, case: spec.case, kind: spec.kind, fixture: spec.fixture, rule: 'NOTES', outcome: '', pass: true, detail: JSON.stringify(notes).slice(0, 600) });
  for (const r of rows.slice(startRow)) r.outcome = outcome;
  outcomes.set(spec.id, { outcome, notes, diff: '' });
  writeFileSync(join(RAW, `${spec.id}.json`), JSON.stringify({ spec: { id: spec.id, steps: spec.steps }, outcome, refused: out?.refused ?? null, placements: out?.placements, notes, unlinked: out?.unlinked }, null, 2));
}

await browser.close();
server.close();

const header = 'run,id,case,kind,fixture,rule,outcome,pass,detail';
const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
const lines = rows.map((r) => [r.run, r.id, r.case, r.kind, r.fixture, r.rule, r.outcome, r.pass ? 'true' : 'false', q(r.detail)].join(','));
if (CONTROL) {
  const by = new Map<string, number>();
  for (const r of rows) if (!r.pass && r.rule !== 'E4L' && r.rule !== 'E5L' && r.rule !== 'NOTES') by.set(r.rule, (by.get(r.rule) ?? 0) + 1);
  console.log(`CONTROL ${CONTROL}: specs failing per rule`, JSON.stringify([...by.entries()].sort()));
  if (process.env.CONTROL_DETAIL) for (const r of rows) if (!r.pass && r.rule === process.env.CONTROL_DETAIL) console.log(r.id, r.detail.slice(0, 200));
  process.exit(0);
}
const prev = existsSync(CSV) ? readFileSync(CSV, 'utf8').trimEnd() : header;
writeFileSync(CSV, `${prev}\n${lines.join('\n')}\n`);
const tally = [...outcomes.values()].reduce((a, o) => ({ ...a, [o.outcome]: (a[o.outcome] ?? 0) + 1 }), {} as Record<string, number>);
console.log(JSON.stringify(tally));
for (const [id, o] of outcomes) console.log(id, o.outcome, o.notes.length ? `notes=${o.notes.length}` : '');
