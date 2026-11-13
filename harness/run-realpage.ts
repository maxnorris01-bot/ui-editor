// Real-page check harness. Rules: docs/realpage-rules.md (reuses docs/gate-rules.md).
//   GATE_RUN=<n> npx tsx harness/run-realpage.ts [inputDir] [specFile]
// The real pages are read from inputDir (outside the repo, default ../ui-editor-realpages) and are never
// written into the repo; exports go to the gitignored realpage-check/tmp/. Every outcome is produced by
// this script, except that the truth of each REFUSED reason is checked afterwards by reading the file.
import { chromium } from 'playwright';
import type { Page } from 'playwright';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, totalmem, arch, release } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { diffLines } from 'diff';
import { createModel, exportFiles, sources } from '../engine/src/index';
import { ROOT } from './fixtures';
import { serve } from './serve';
import { precedingAllowed } from './e4-amend';
import { writeRealSummary } from './summary-real';

const RUN = process.env.GATE_RUN ?? '1';
const INPUT = resolve(process.argv[2] ?? join(ROOT, '../ui-editor-realpages'));
const SPEC = resolve(process.argv[3] ?? join(ROOT, 'realpage-check/edits.json'));
// GATE_CONTROL=noop|collateral|reformat: scorer sanity check on deliberately broken exports (no results committed).
const CONTROL = process.env.GATE_CONTROL ?? '';
const OUT = CONTROL ? join(ROOT, 'realpage-check/raw', `control-${CONTROL}`) : join(ROOT, 'realpage-check/results');
const CSV = join(OUT, 'realpage-results.csv');
const TMP = join(ROOT, 'realpage-check/tmp', `run-${RUN}`);
const RAW = join(ROOT, 'realpage-check/raw', `run-${RUN}`);
const TOL = 1;

interface OrderSpec { parent: string; key: { selector?: string; attr: string | string[]; length?: number }; values: string[] }
interface Spec {
  id: string; file: string; type: 'T1' | 'T2' | 'T3' | 'T4'; target: string;
  edit: { op: 'set'; properties: Record<string, string> } | { op: 'offset'; dx: number; dy: number } | { op: 'reorder'; move: string; placement: 'before' | 'after'; sibling: string };
  expected: { computed?: { selector: string; property: string; value: string }[]; bboxDelta?: { selector: string; dx?: number; dy?: number; dw?: number; dh?: number }; order?: OrderSpec };
  legit: 'descendants' | 'flow' | 'reorder' | 'svg-ancestors'; expectedFiles: string[];
}
interface Specs { companions: Record<string, Record<string, string>>; edits: Spec[] }
interface Input { file: string; kind: 'html' | 'svg'; source: string; companions: Record<string, string>; bytes: number }

const specs = JSON.parse(readFileSync(SPEC, 'utf8')) as Specs;
const files = [...new Set(specs.edits.map((e) => e.file))];
const inputs = new Map<string, Input>(files.map((file) => {
  const source = readFileSync(join(INPUT, file), 'utf8');
  const companions: Record<string, string> = {};
  for (const [href, rel] of Object.entries(specs.companions[file] ?? {})) companions[href] = readFileSync(join(INPUT, rel), 'utf8');
  return [file, { file, kind: file.endsWith('.svg') ? 'svg' : 'html', source, companions, bytes: Buffer.byteLength(source) }];
}));

type Outcome = 'PASS' | 'REFUSED' | 'FAIL';
interface Row { run: string; edit_id: string; file: string; type: string; rule: string; outcome: string; pass: boolean; detail: string }
const rows: Row[] = [];
const add = (edit_id: string, file: string, type: string, rule: string, pass: boolean, detail: string) =>
  rows.push({ run: RUN, edit_id, file, type, rule, outcome: '', pass, detail: detail.replace(/\s+/g, ' ').slice(0, 500) });

if (existsSync(CSV) && readFileSync(CSV, 'utf8').split('\n').some((l) => l.startsWith(`${RUN},`))) throw new Error(`run ${RUN} already exists in ${CSV}; use a new GATE_RUN for a labelled iteration`);
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
mkdirSync(RAW, { recursive: true });
mkdirSync(OUT, { recursive: true });

const norm = (s: string | null): string =>
  (s ?? '').toLowerCase().replace(/["']/g, '').replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').replace(/\bflow-start\b/g, 'flex-start').replace(/\bflow-end\b/g, 'flex-end').trim();
const near = (a: number, b: number) => Math.abs(a - b) <= TOL;
const lineOf = (text: string, offset: number): number => { let n = 1; for (let i = 0; i < offset && i < text.length; i++) if (text[i] === '\n') n++; return n; };

interface Dump { names: string[]; rows: { tag: string; id: string | null; parent: number; rect: number[]; props: string[]; key: string | null }[]; target: number; parent: number; parserErrors: number; rootName: string }
interface Spec1 { computed: { selector: string; property: string; value: string | null }[]; bbox: number[] | null; order: (string | null)[] | null }
interface Loaded { dump: Dump; spec: Spec1; errors: string[]; navError: string | null }

const measureSrc = readFileSync(join(ROOT, 'harness/page-measure-real.js'), 'utf8');
const isLocal = (u: string) => u.startsWith('file:') || u.startsWith('about:') || u.startsWith('blob:') || u.startsWith('data:') || u.startsWith('http://127.0.0.1');

execSync('node harness/bundle.mjs', { cwd: ROOT, stdio: 'inherit' });
const { url, server } = await serve(ROOT);
const browser = await chromium.launch({ headless: true });
// Both contexts: other hosts aborted so original, exported and preview loads are identical and offline.
const offCtx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, javaScriptEnabled: false });
await offCtx.route('**/*', (r) => (isLocal(r.request().url()) ? r.continue() : r.abort()));
const engineCtx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
await engineCtx.route('**/*', (r) => (isLocal(r.request().url()) ? r.continue() : r.abort()));
const enginePage = await engineCtx.newPage();
await enginePage.goto(url);
await enginePage.addScriptTag({ url: '/engine.js' });
await enginePage.addScriptTag({ path: join(ROOT, 'harness/page-measure-real.js') });
await enginePage.addScriptTag({ path: join(ROOT, 'harness/page-gate.js') });

function writeSet(dir: string, set: Record<string, string>): void {
  for (const [name, text] of Object.entries(set)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
}

async function load(dir: string, file: string, expected: Spec['expected'], targetSel: string): Promise<Loaded> {
  const page: Page = await offCtx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
  let navError: string | null = null;
  try { await page.goto(`file://${join(dir, file)}`, { waitUntil: 'load' }); } catch (e) { navError = (e as Error).message; }
  try {
    const call = `${measureSrc};({dump: window.GateMeasure.fullDump(document, ${JSON.stringify(targetSel)}, ${JSON.stringify(expected.order ?? null)}), spec: window.GateMeasure.specMeasure(document, ${JSON.stringify(expected)})})`;
    const r = (await page.evaluate(call)) as { dump: Dump; spec: Spec1 };
    return { ...r, errors, navError };
  } finally { await page.close(); }
}

const e1Problems = (f: Input, X: Loaded, O: Loaded, out: Record<string, string>): string[] => {
  const probs: string[] = [];
  if (X.navError) probs.push(`navigation: ${X.navError}`);
  const fresh = X.errors.filter((e) => !O.errors.includes(e));
  if (fresh.length) probs.push(`new errors vs original: ${fresh.join(' | ')}`);
  if (f.kind === 'svg' && (X.dump.rootName !== 'svg' || X.dump.parserErrors)) probs.push(`root=${X.dump.rootName} parsererror=${X.dump.parserErrors}`);
  try {
    const comps: Record<string, string> = {};
    for (const k of Object.keys(f.companions)) comps[k] = out[k] ?? '';
    const before = createModel(f.source, f.kind, f.companions, f.file);
    const after = createModel(out[f.file] ?? '', f.kind, comps, f.file);
    if (after.primary.parseErrors > before.primary.parseErrors) probs.push(`engine re-parse errors ${after.primary.parseErrors} > ${before.primary.parseErrors}`);
    if (after.primary.elements.length !== before.primary.elements.length) probs.push(`engine element count ${before.primary.elements.length} -> ${after.primary.elements.length}`);
  } catch (e) { probs.push(`engine re-parse threw: ${(e as Error).message}`); }
  if (X.dump.rows.length !== O.dump.rows.length) probs.push(`DOM element count ${O.dump.rows.length} -> ${X.dump.rows.length}`);
  for (const k of Object.keys(f.companions)) if (!out[k] || out[k]!.length === 0) probs.push(`companion ${k} not exported or empty`);
  return probs;
};

// ---- no-op round trip ------------------------------------------------------------------------
const rtFail = new Set<string>();
for (const [n, f] of [...inputs.values()].entries()) {
  const id = `RT${String(n + 1).padStart(2, '0')}`;
  try {
    const model = createModel(f.source, f.kind, f.companions, f.file);
    const out = exportFiles(sources(model), []);
    const want: Record<string, string> = { [f.file]: f.source, ...f.companions };
    for (const [name, text] of Object.entries(want)) {
      const ok = out[name] === text;
      add(id, name, 'ROUNDTRIP', 'RT', ok, ok ? `byte-identical (${Buffer.byteLength(text)} bytes)` : 'NOT byte-identical');
      if (!ok) rtFail.add(f.file);
    }
    const dir = join(TMP, id);
    writeSet(dir, out);
    writeSet(join(TMP, `${id}-orig`), want);
    const O2 = await load(join(TMP, `${id}-orig`), f.file, {}, '');
    const X = await load(dir, f.file, {}, '');
    const probs = e1Problems(f, X, O2, out);
    add(id, f.file, 'ROUNDTRIP', 'E1', probs.length === 0, probs.join(' | ') || 'no-op export loads, no new errors');
    if (probs.length) rtFail.add(f.file);
  } catch (e) {
    add(id, f.file, 'ROUNDTRIP', 'RT', false, `engine threw: ${(e as Error).message}`);
    rtFail.add(f.file);
  }
}

// ---- E4, E5 ----------------------------------------------------------------------------------
const layoutIdx = (names: string[]) => new Set(names.map((n, i) => (['width', 'height', 'inline-size', 'block-size', 'perspective-origin', 'transform-origin'].includes(n) ? i : -1)).filter((i) => i >= 0));

function e4(spec: Spec, orig: Dump, exp: Dump): { pass: boolean; detail: string } {
  if (orig.rows.length !== exp.rows.length) return { pass: false, detail: `element count ${orig.rows.length} vs ${exp.rows.length}` };
  const n = orig.rows.length;
  const kids = (d: Dump, p: number) => d.rows.map((r, i) => (r.parent === p ? i : -1)).filter((i) => i >= 0);
  const subtree = (d: Dump, i: number): number[] => [i, ...kids(d, i).flatMap((k) => subtree(d, k))];
  const pair = Array.from({ length: n }, (_, i) => i);
  if (spec.expected.order) {
    if (orig.parent < 0 || exp.parent < 0) return { pass: false, detail: 'order parent not found' };
    const oc = kids(orig, orig.parent), xc = kids(exp, exp.parent);
    if (oc.length !== xc.length) return { pass: false, detail: `parent child count ${oc.length} vs ${xc.length}` };
    const used = new Set<number>();
    for (const i of oc) {
      const key = orig.rows[i]!.key;
      const j = key === null ? undefined : xc.find((c) => exp.rows[c]!.key === key && !used.has(c));
      if (j === undefined) return { pass: false, detail: `cannot pair child with key ${key}` };
      used.add(j);
      const so = subtree(orig, i), sx = subtree(exp, j);
      if (so.length !== sx.length) return { pass: false, detail: `subtree size differs for key ${key}` };
      so.forEach((a, k) => { pair[a] = sx[k]!; });
    }
  }
  const t = orig.target;
  const anc = (i: number): number[] => { const o: number[] = []; for (let c = orig.rows[i]!.parent; c >= 0; c = orig.rows[c]!.parent) o.push(c); return o; };
  const followingSibs = (i: number) => kids(orig, orig.rows[i]!.parent).filter((s) => s > i);
  const flowSet = (x: number): Set<number> => {
    const s = new Set<number>(anc(x));
    for (const a of [x, ...anc(x)]) for (const sib of followingSibs(a)) subtree(orig, sib).forEach((k) => s.add(k));
    return s;
  };
  const desc = new Set(subtree(orig, t).filter((i) => i !== t));
  const L = layoutIdx(orig.names);
  let layoutAllowed = new Set<number>();
  let bboxOnly = new Set<number>();
  if (spec.legit === 'flow') layoutAllowed = flowSet(t);
  else if (spec.legit === 'reorder') { const p = orig.rows[t]!.parent; layoutAllowed = new Set([...anc(t), ...subtree(orig, p), ...flowSet(p)]); }
  else if (spec.legit === 'svg-ancestors') bboxOnly = new Set(anc(t));
  if (spec.legit === 'flow' || spec.legit === 'reorder') for (const k of precedingAllowed(orig.rows, orig.names, t)) layoutAllowed.add(k); // amendment 1
  const expIndex = new Map<string, number>(exp.names.map((nm, i) => [nm, i]));
  const bad: string[] = [];
  let compared = 0;
  for (let i = 0; i < n; i++) {
    if (i === t || desc.has(i)) continue;
    const a = orig.rows[i]!, b = exp.rows[pair[i]!]!;
    compared++;
    const lay = layoutAllowed.has(i), bb = lay || bboxOnly.has(i);
    const what: string[] = [];
    if (!bb && !a.rect.every((v, k) => near(v, b.rect[k]!))) what.push(`bbox [${a.rect.map((v) => +v.toFixed(2))}] -> [${b.rect.map((v) => +v.toFixed(2))}]`);
    // Compare by property NAME: the order of custom properties in getComputedStyle differs between loads.
    for (let k = 0; k < a.props.length; k++) {
      if (lay && L.has(k)) continue;
      const name = orig.names[k]!;
      const kb = expIndex.get(name);
      const bv = kb === undefined ? '(missing)' : b.props[kb]!;
      if (norm(a.props[k]!) !== norm(bv)) what.push(`${name}: ${norm(a.props[k]!).slice(0, 40)} -> ${norm(bv).slice(0, 40)}`);
    }
    if (what.length) bad.push(`el#${i} <${a.tag}${a.id ? '#' + a.id : ''}> ${what.slice(0, 3).join('; ')}${what.length > 3 ? ` (+${what.length - 3})` : ''}`);
  }
  return bad.length === 0 ? { pass: true, detail: `${compared} elements compared, ${desc.size} descendants and the target excluded` } : { pass: false, detail: `${bad.length} element(s) changed: ${bad.slice(0, 3).join(' || ')}` };
}

interface Spans { startTag: number[]; element: number[]; rules: { file: string; start: number; end: number }[]; moved: { start: number; end: number } | null }
function e5(spec: Spec, f: Input, out: Record<string, string>, spans: Spans): { pass: boolean; detail: string; diff: string } {
  const orig: Record<string, string> = { [f.file]: f.source, ...f.companions };
  const problems: string[] = [];
  const diffs: string[] = [];
  for (const name of Object.keys(orig)) {
    const o = orig[name]!, x = out[name] ?? '';
    if (!spec.expectedFiles.includes(name)) { if (o !== x) problems.push(`${name} changed but is not in expectedFiles`); continue; }
    if (o === x) { diffs.push(`${name}: unchanged`); continue; }
    const removed: string[] = [], added: string[] = [], removedAt: number[] = [], addedAt: number[] = [];
    let oldLine = 1, newLine = 1;
    for (const c of diffLines(o, x)) {
      const lines = c.value.split('\n');
      if (lines[lines.length - 1] === '') lines.pop();
      if (c.removed) lines.forEach((l) => { removed.push(l); removedAt.push(oldLine++); });
      else if (c.added) lines.forEach((l) => { added.push(l); addedAt.push(newLine++); });
      else { oldLine += lines.length; newLine += lines.length; }
    }
    const long = [...removed, ...added].some((l) => l.length > 2000);
    const allowed: [number, number][] = [];
    if (spec.edit.op === 'reorder') { if (name === f.file && spans.moved) allowed.push([spans.moved.start, spans.moved.end]); }
    else {
      if (name === f.file) allowed.push([spans.startTag[0]!, spans.startTag[1]!]);
      for (const r of spans.rules) if (r.file === name) allowed.push([r.start, r.end]);
    }
    if (long) {
      // Character level (docs/realpage-rules.md 4.4, operational definition by the implementing agent).
      let p = 0;
      const lim = Math.min(o.length, x.length);
      while (p < lim && o[p] === x[p]) p++;
      let s = 0;
      while (s < lim - p && o[o.length - 1 - s] === x[x.length - 1 - s]) s++;
      const a = p, b = o.length - s;
      const bytes = Math.max(Buffer.byteLength(o.slice(a, b)), Buffer.byteLength(x.slice(a, x.length - s)));
      diffs.push(`${name}: ${bytes} bytes changed (character level, long lines)`);
      if (!allowed.some(([lo, hi]) => a >= lo && b <= hi)) problems.push(`${name}: changed region [${a},${b}) is outside the allowed source span(s) ${JSON.stringify(allowed)}`);
      if (spec.edit.op === 'reorder' && [...o.slice(a, b)].sort().join('') !== [...x.slice(a, x.length - s)].sort().join('')) problems.push(`${name}: changed region is not a permutation`);
    } else if (spec.edit.op === 'reorder') {
      const ms = spans.moved!;
      const lo = lineOf(f.source, ms.start), hi = lineOf(f.source, Math.max(ms.start, ms.end - 1));
      diffs.push(`${name}: -${removed.length}/+${added.length} lines (moved)`);
      const stray = [...removedAt, ...addedAt].filter((ln) => ln < lo || ln > hi);
      if (stray.length) problems.push(`${name}: changed lines outside the moved span ${lo}-${hi}: ${stray.slice(0, 5).join(',')}`);
      if ([...removed].sort().join('\n') !== [...added].sort().join('\n')) problems.push(`${name}: removed lines are not a permutation of added lines`);
    } else {
      const changed = Math.max(removed.length, added.length);
      diffs.push(`${name}: -${removed.length}/+${added.length} lines`);
      if (changed > 3) problems.push(`${name}: ${changed} changed lines (max 3)`);
      const spansL = allowed.map(([lo, hi]) => [lineOf(o, lo), lineOf(o, Math.max(lo, hi - 1))] as [number, number]);
      for (const ln of removedAt) if (!spansL.some(([a, b]) => ln >= a && ln <= b)) problems.push(`${name}: removed line ${ln} is outside the target's start tag and matching rules`);
    }
  }
  const diff = diffs.join('; ');
  return problems.length ? { pass: false, detail: `diff=${diff} | ${problems.join(' | ')}`, diff } : { pass: true, detail: `diff=${diff}`, diff };
}

interface EngineOut {
  refused: { code: string; message: string } | null;
  patches?: unknown[]; files?: Record<string, string>; before?: Spec1; after?: Spec1; spans?: Spans; placement?: string; warnings: string[];
}
/** Deliberately broken exports for the scorer sanity check (GATE_CONTROL). */
function sabotage(f: Input, files: Record<string, string>, mode: string): Record<string, string> {
  const orig: Record<string, string> = { [f.file]: f.source, ...f.companions };
  const main = files[f.file] ?? f.source;
  if (mode === 'noop') return orig;
  if (mode === 'reformat') return { ...files, [f.file]: main.replace('\n', '\n ') };
  // collateral: extra CSS rules that change other elements
  if (f.kind === 'html') return { ...files, [f.file]: main.replace('</head>', '<style>p,li,td,div,span,h1,h2,h3,a{color:#123456 !important}</style></head>') };
  return { ...files, [f.file]: main.replace(/<svg[^>]*>/, (m) => `${m}<style>text,path,rect{fill:#123456 !important}</style>`) };
}
const outcomes = new Map<string, { outcome: Outcome; note: string }>();

for (const spec of specs.edits) {
  const f = inputs.get(spec.file)!;
  const T = spec.type;
  const origFiles: Record<string, string> = { [f.file]: f.source, ...f.companions };
  let out: EngineOut;
  let threw = false;
  try {
    out = (await enginePage.evaluate(([fixture, s]) => (window as never as { runGateEdit: (...a: unknown[]) => Promise<unknown> }).runGateEdit(fixture, s), [f, spec] as const)) as EngineOut;
  } catch (e) {
    out = { refused: { code: 'uncaught-exception', message: (e as Error).message }, warnings: [] };
    threw = true;
  }
  let exported = out.refused ? origFiles : out.files!;
  if (CONTROL) exported = sabotage(f, exported, CONTROL);
  if (process.env.EXPORT_DIR) writeSet(join(process.env.EXPORT_DIR, 'real', spec.id), exported);
  writeSet(join(TMP, spec.id, 'exported'), exported);
  writeSet(join(TMP, spec.id, 'original'), origFiles);
  const O = await load(join(TMP, spec.id, 'original'), f.file, spec.expected, spec.target);
  const X = await load(join(TMP, spec.id, 'exported'), f.file, spec.expected, spec.target);
  const probs = e1Problems(f, X, O, exported);
  add(spec.id, spec.file, T, 'E1', probs.length === 0, probs.join(' | ') || 'loads, no new errors, re-parse clean, counts equal');
  const startRows = rows.length - 1;
  if (out.refused) {
    const kind = threw ? 'uncaught exception' : 'structured refusal';
    const why = `${kind} (${out.refused.code}): ${out.refused.message}`;
    for (const r of ['E2', 'E3', 'E4', 'E5']) add(spec.id, spec.file, T, r, false, why);
    outcomes.set(spec.id, { outcome: threw ? 'FAIL' : 'REFUSED', note: why });
    writeFileSync(join(RAW, `${spec.id}.json`), JSON.stringify({ spec, refused: out.refused, threw }, null, 2));
  } else {
    const ex = spec.expected;
    const p2: string[] = [];
    for (const [k, c] of (ex.computed ?? []).entries()) { const got = X.spec.computed[k]?.value ?? null; if (norm(got) !== norm(c.value)) p2.push(`${c.selector} ${c.property}: got "${got}", want "${c.value}"`); }
    const deltaOf = (a: number[] | null, b: number[] | null) => (a && b ? [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!, b[3]! - a[3]!] : null);
    const keys = ['dx', 'dy', 'dw', 'dh'] as const;
    const xd = deltaOf(O.spec.bbox, X.spec.bbox);
    if (ex.bboxDelta) { if (!xd) p2.push('bbox not measurable'); else keys.forEach((k, i) => { const w = ex.bboxDelta![k]; if (w !== undefined && !near(xd[i]!, w)) p2.push(`${k}: got ${+xd[i]!.toFixed(2)}, want ${w}`); }); }
    if (ex.order && JSON.stringify(X.spec.order) !== JSON.stringify(ex.order.values)) p2.push(`order: got ${JSON.stringify(X.spec.order)}, want ${JSON.stringify(ex.order.values)}`);
    add(spec.id, spec.file, T, 'E2', p2.length === 0, p2.join(' | ') || 'all expected values match');
    const p3: string[] = [];
    for (const [k, c] of (ex.computed ?? []).entries()) { const a = out.after!.computed[k]?.value ?? null, b = X.spec.computed[k]?.value ?? null; if (norm(a) !== norm(b)) p3.push(`${c.selector} ${c.property}: preview "${a}" vs export "${b}"`); }
    if (ex.bboxDelta) { const pd = deltaOf(out.before!.bbox, out.after!.bbox); if (!pd || !xd) p3.push('bbox not measurable'); else keys.forEach((k, i) => { if (ex.bboxDelta![k] !== undefined && !near(pd[i]!, xd[i]!)) p3.push(`${k}: preview ${+pd[i]!.toFixed(2)} vs export ${+xd[i]!.toFixed(2)}`); }); }
    if (ex.order && JSON.stringify(out.after!.order) !== JSON.stringify(X.spec.order)) p3.push(`order: preview ${JSON.stringify(out.after!.order)} vs export ${JSON.stringify(X.spec.order)}`);
    add(spec.id, spec.file, T, 'E3', p3.length === 0, p3.join(' | ') || 'preview and export agree on every named value');
    const r4 = e4(spec, O.dump, X.dump);
    add(spec.id, spec.file, T, 'E4', r4.pass, r4.detail);
    const r5 = e5(spec, f, exported, out.spans!);
    add(spec.id, spec.file, T, 'E5', r5.pass, r5.detail);
    outcomes.set(spec.id, { outcome: rows.slice(startRows).every((r) => r.pass) ? 'PASS' : 'FAIL', note: `placement: ${out.placement}` });
    writeFileSync(join(RAW, `${spec.id}.json`), JSON.stringify({ spec, placement: out.placement, warnings: out.warnings, patches: out.patches, e4: r4, e5: r5 }, null, 2));
  }
  for (const r of rows.slice(startRows)) r.outcome = outcomes.get(spec.id)!.outcome;
}

// ---- information only: timings on the real files (not part of the verdict) --------------------
await enginePage.addScriptTag({ path: join(ROOT, 'harness/page-speed.js') });
const t1: Record<string, unknown> = {};
for (const e of specs.edits) if (e.type === 'T1') t1[e.file] = e;
let timing: unknown = null;
try {
  const speedRows = (await enginePage.evaluate(([fx, e, n]) => (window as never as { runSpeed: (...a: unknown[]) => Promise<unknown> }).runSpeed(fx, e, n), [[...inputs.values()], t1, 20] as const)) as unknown[];
  timing = speedRows;
} catch (e) { timing = { error: (e as Error).message }; }
const chromiumVersion = browser.version();
await browser.close();
server.close();

if (CONTROL) {
  const by = new Map<string, { pass: number; fail: number }>();
  for (const r of rows.filter((x) => x.type !== 'ROUNDTRIP')) { const k = `${r.file.endsWith('.svg') ? 'svg' : 'html'} ${r.rule}`; const c = by.get(k) ?? { pass: 0, fail: 0 }; if (r.pass) c.pass++; else c.fail++; by.set(k, c); }
  console.log(`CONTROL ${CONTROL}:`, JSON.stringify([...by.entries()].sort()));
  process.exit(0);
}
const header = 'run,edit_id,file,type,rule,outcome,pass,detail';
const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
const lines = rows.map((r) => [r.run, r.edit_id, r.file, r.type, r.rule, r.outcome, r.pass ? 'true' : 'false', q(r.detail)].join(','));
const prev = existsSync(CSV) ? readFileSync(CSV, 'utf8').trimEnd() : header;
writeFileSync(CSV, `${prev}\n${lines.join('\n')}\n`);

let model = 'unknown';
try { model = execSync('sysctl -n hw.model', { encoding: 'utf8' }).trim(); } catch { /* not macOS */ }
const tfile = join(OUT, 'timing.json');
const all = existsSync(tfile) ? (JSON.parse(readFileSync(tfile, 'utf8')) as Record<string, unknown>) : {};
all[`run${RUN}`] = {
  informationOnly: true, measuredAt: new Date().toISOString(), runsPerFile: 20,
  machine: { model, cpu: cpus()[0]?.model, cores: cpus().length, ramGiB: +(totalmem() / 2 ** 30).toFixed(1), os: `${process.platform} ${release()}`, arch: arch() },
  versions: { node: process.version, chromium: chromiumVersion },
  perFile: timing,
};
writeFileSync(tfile, JSON.stringify(all, null, 2) + '\n');
writeRealSummary();
console.log(readFileSync(join(OUT, 'realpage-summary.md'), 'utf8'));
