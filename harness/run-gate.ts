// Step 4: the locked scoring harness. Rules and definitions: docs/gate-rules.md (sections 2 and 5).
// Every `pass` value below is produced by this script; nothing is judged by hand.
//   GATE_RUN=<n> npx tsx harness/run-gate.ts      (a new run number per labelled iteration)
import { chromium } from 'playwright';
import type { Page } from 'playwright';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diffLines } from 'diff';
import { createModel, exportFiles, sources } from '../engine/src/index';
import { loadEdits, loadFixtures, ROOT } from './fixtures';
import type { EditSpec, Fixture } from './fixtures';
import { serve } from './serve';
import { writeSummary } from './summary';

const RUN = process.env.GATE_RUN ?? '1';
const CSV = join(ROOT, 'results/gate-results.csv');
const RAW = join(ROOT, 'results/raw', `run-${RUN}`);
const TOL = 1;

interface Row { run: string; edit_id: string; file: string; type: string; rule: string; pass: boolean; detail: string }
const rows: Row[] = [];
const add = (edit_id: string, file: string, type: string, rule: string, pass: boolean, detail: string) =>
  rows.push({ run: RUN, edit_id, file, type, rule, pass, detail: detail.replace(/\s+/g, ' ').slice(0, 400) });

if (existsSync(CSV) && readFileSync(CSV, 'utf8').split('\n').some((l) => l.startsWith(`${RUN},`))) {
  throw new Error(`run ${RUN} already exists in results/gate-results.csv; use a new GATE_RUN for a labelled iteration`);
}
mkdirSync(RAW, { recursive: true });

// ---- helpers ---------------------------------------------------------------------------------
const norm = (s: string | null): string =>
  (s ?? '').toLowerCase().replace(/["']/g, '').replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').replace(/\bflow-start\b/g, 'flex-start').replace(/\bflow-end\b/g, 'flex-end').trim();
const near = (a: number, b: number) => Math.abs(a - b) <= TOL;

interface Dump {
  names: string[];
  rows: { tag: string; id: string | null; parent: number; rect: number[]; props: string[] }[];
  target: number; parent: number; parserErrors: number; rootName: string;
}
interface Spec { computed: { selector: string; property: string; value: string | null }[]; bbox: number[] | null; order: string[] | null }
interface Loaded { dump: Dump; spec: Spec; errors: string[]; navError: string | null }

const measureSrc = readFileSync(join(ROOT, 'harness/page-measure.js'), 'utf8');
const lineOf = (text: string, offset: number): number => {
  let n = 1;
  for (let i = 0; i < offset && i < text.length; i++) if (text[i] === '\n') n++;
  return n;
};

// ---- main ------------------------------------------------------------------------------------
execSync('node harness/bundle.mjs', { cwd: ROOT, stdio: 'inherit' });
const fixtures = loadFixtures();
const fx = new Map<string, Fixture>(fixtures.map((f) => [f.file, f]));
const edits = loadEdits().edits;
const work = mkdtempSync(join(tmpdir(), 'gate-'));

const { url, server } = await serve(ROOT);
const browser = await chromium.launch({ headless: true });
// Scripts-off context for original and exported documents (rules 5.1).
const offCtx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, javaScriptEnabled: false });
const engineCtx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const enginePage = await engineCtx.newPage();
await enginePage.goto(url);
await enginePage.addScriptTag({ url: '/engine.js' });
await enginePage.addScriptTag({ path: join(ROOT, 'harness/page-measure.js') });
await enginePage.addScriptTag({ path: join(ROOT, 'harness/page-gate.js') });

function writeSet(dir: string, files: Record<string, string>): void {
  mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
}

async function load(dir: string, file: string, expected: EditSpec['expected'], targetSel: string): Promise<Loaded> {
  const page: Page = await offCtx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  let navError: string | null = null;
  try {
    await page.goto(`file://${join(dir, file)}`, { waitUntil: 'load' });
  } catch (e) {
    navError = (e as Error).message;
  }
  try {
    const call = `${measureSrc};({dump: window.GateMeasure.fullDump(document, ${JSON.stringify(targetSel)}, ${JSON.stringify(expected.order?.parent ?? null)}), spec: window.GateMeasure.specMeasure(document, ${JSON.stringify(expected)})})`;
    const r = (await page.evaluate(call)) as { dump: Dump; spec: Spec };
    return { ...r, errors, navError };
  } finally {
    await page.close();
  }
}

// ---- no-op round trip, all 10 files ----------------------------------------------------------
const rtLoadOk = new Map<string, boolean>();
for (const [n, f] of fixtures.entries()) {
  const id = `RT${String(n + 1).padStart(2, '0')}`;
  const model = createModel(f.source, f.kind, f.companions, f.file);
  const out = exportFiles(sources(model), []);
  const want: Record<string, string> = { [f.file]: f.source, ...f.companions };
  const bad = Object.keys(want).filter((k) => out[k] !== want[k]);
  add(id, f.file, 'ROUNDTRIP', 'RT', bad.length === 0, bad.length ? `not byte-identical: ${bad.join(', ')}` : `byte-identical (${Object.keys(want).length} file(s), ${f.bytes} bytes)`);
  const dir = join(work, id);
  writeSet(dir, out);
  const l = await load(dir, f.file, {}, '');
  const e1 = !l.navError && l.errors.length === 0 && (f.kind === 'html' || (l.dump.rootName === 'svg' && l.dump.parserErrors === 0));
  rtLoadOk.set(f.file, e1);
  add(id, f.file, 'ROUNDTRIP', 'E1', e1, e1 ? 'loads, no page or console errors' : `${l.navError ?? ''} ${l.errors.join(' | ')} root=${l.dump.rootName} parsererror=${l.dump.parserErrors}`);
}

// ---- 40 edits --------------------------------------------------------------------------------
interface Span { file: string; start: number; end: number }
interface EngineOut {
  refused: { code: string; message: string } | null;
  patches?: unknown[]; files?: Record<string, string>; before?: Spec; after?: Spec;
  spans?: { startTag: number[]; element: number[]; rules: Span[]; moved: { start: number; end: number } | null };
  placement?: string; warnings: string[];
}

function layoutIdx(names: string[]): Set<number> {
  const L = new Set(['width', 'height', 'inline-size', 'block-size', 'perspective-origin', 'transform-origin']);
  return new Set(names.map((n, i) => (L.has(n) ? i : -1)).filter((i) => i >= 0));
}

function e4(spec: EditSpec, orig: Dump, exp: Dump): { pass: boolean; detail: string } {
  if (orig.rows.length !== exp.rows.length) return { pass: false, detail: `element count ${orig.rows.length} vs ${exp.rows.length}` };
  const n = orig.rows.length;
  const kids = (p: number) => orig.rows.map((r, i) => (r.parent === p ? i : -1)).filter((i) => i >= 0);
  const subtree = (i: number): number[] => [i, ...kids(i).flatMap(subtree)];
  const expKids = (p: number) => exp.rows.map((r, i) => (r.parent === p ? i : -1)).filter((i) => i >= 0);
  const subtree2 = (i: number): number[] => [i, ...expKids(i).flatMap(subtree2)];

  // pairing: orig index -> exported index
  const pair = Array.from({ length: n }, (_, i) => i);
  if (spec.expected.order) {
    const p = orig.parent;
    if (p < 0 || exp.parent < 0) return { pass: false, detail: 'order parent not found' };
    const oc = kids(p), xc = expKids(exp.parent);
    if (oc.length !== xc.length) return { pass: false, detail: `parent child count ${oc.length} vs ${xc.length}` };
    const usedX = new Set<number>();
    const idlessX = xc.filter((j) => !exp.rows[j]!.id);
    let idl = 0;
    for (const i of oc) {
      const id = orig.rows[i]!.id;
      let j: number | undefined;
      if (id) j = xc.find((c) => exp.rows[c]!.id === id);
      else j = idlessX[idl++];
      if (j === undefined || usedX.has(j)) return { pass: false, detail: `cannot pair child ${id ?? '(no id)'}` };
      usedX.add(j);
      const so = subtree(i), sx = subtree2(j);
      if (so.length !== sx.length) return { pass: false, detail: `subtree size differs for ${id ?? i}` };
      so.forEach((a, k) => { pair[a] = sx[k]!; });
    }
  }

  const t = orig.target;
  const anc = (i: number): number[] => { const o: number[] = []; for (let c = orig.rows[i]!.parent; c >= 0; c = orig.rows[c]!.parent) o.push(c); return o; };
  const followingSibs = (i: number) => kids(orig.rows[i]!.parent).filter((s) => s > i);
  const flowSet = (x: number): Set<number> => {
    const s = new Set<number>(anc(x));
    for (const a of [x, ...anc(x)]) for (const sib of followingSibs(a)) subtree(sib).forEach((k) => s.add(k));
    return s;
  };
  const desc = new Set(subtree(t).filter((i) => i !== t));
  const L = layoutIdx(orig.names);
  let layoutAllowed = new Set<number>();
  let bboxOnly = new Set<number>();
  if (spec.legit === 'flow') layoutAllowed = flowSet(t);
  else if (spec.legit === 'reorder') {
    const p = orig.rows[t]!.parent;
    layoutAllowed = new Set([...anc(t), ...subtree(p), ...flowSet(p)]);
  } else if (spec.legit === 'svg-ancestors') bboxOnly = new Set(anc(t));

  const bad: string[] = [];
  let compared = 0;
  for (let i = 0; i < n; i++) {
    if (i === t || desc.has(i)) continue;
    const a = orig.rows[i]!, b = exp.rows[pair[i]!]!;
    compared++;
    const lay = layoutAllowed.has(i), bb = lay || bboxOnly.has(i);
    const what: string[] = [];
    if (!bb && !a.rect.every((v, k) => near(v, b.rect[k]!))) what.push(`bbox [${a.rect.map((v) => +v.toFixed(2))}] -> [${b.rect.map((v) => +v.toFixed(2))}]`);
    for (let k = 0; k < a.props.length; k++) {
      if (lay && L.has(k)) continue;
      if (norm(a.props[k]!) !== norm(b.props[k]!)) what.push(`${orig.names[k]}: ${norm(a.props[k]!)} -> ${norm(b.props[k]!)}`);
    }
    if (what.length) bad.push(`el#${i} <${a.tag}${a.id ? '#' + a.id : ''}> ${what.slice(0, 3).join('; ')}${what.length > 3 ? ` (+${what.length - 3})` : ''}`);
  }
  return bad.length === 0
    ? { pass: true, detail: `${compared} elements compared, ${desc.size} descendants and the target excluded` }
    : { pass: false, detail: `${bad.length} element(s) changed: ${bad.slice(0, 3).join(' || ')}` };
}

function e5(spec: EditSpec, f: Fixture, out: Record<string, string>, spans: NonNullable<EngineOut['spans']>): { pass: boolean; detail: string } {
  const orig: Record<string, string> = { [f.file]: f.source, ...f.companions };
  const problems: string[] = [];
  const summary: string[] = [];
  for (const name of Object.keys(orig)) {
    const o = orig[name]!, x = out[name] ?? '';
    if (!spec.expectedFiles.includes(name)) {
      if (o !== x) problems.push(`${name} changed but is not in expectedFiles`);
      continue;
    }
    if (o === x) { problems.push(`${name} is unchanged`); continue; }
    const changes = diffLines(o, x);
    const removed: string[] = [], added: string[] = [], removedAt: number[] = [], addedAt: number[] = [];
    let oldLine = 1, newLine = 1;
    for (const c of changes) {
      const lines = c.value.split('\n');
      if (lines[lines.length - 1] === '') lines.pop();
      if (c.removed) lines.forEach((l) => { removed.push(l); removedAt.push(oldLine++); });
      else if (c.added) lines.forEach((l) => { added.push(l); addedAt.push(newLine++); });
      else { oldLine += lines.length; newLine += lines.length; }
    }
    const changed = Math.max(removed.length, added.length);
    summary.push(`${name}: -${removed.length}/+${added.length} lines`);
    if (spec.edit.op === 'reorder') {
      const ms = spans.moved!;
      const lo = lineOf(f.source, ms.start), hi = lineOf(f.source, Math.max(ms.start, ms.end - 1));
      const stray = [...removedAt, ...addedAt].filter((ln) => ln < lo || ln > hi);
      if (stray.length) problems.push(`${name}: changed lines outside the moved span ${lo}-${hi}: ${stray.slice(0, 5).join(',')}`);
      if ([...removed].sort().join('\n') !== [...added].sort().join('\n')) problems.push(`${name}: removed lines are not a permutation of added lines`);
    } else {
      if (changed > 3) problems.push(`${name}: ${changed} changed lines (max 3)`);
      const allowed: [number, number][] = [];
      if (name === f.file) allowed.push([lineOf(f.source, spans.startTag[0]!), lineOf(f.source, Math.max(spans.startTag[0]!, spans.startTag[1]! - 1))]);
      for (const r of spans.rules) if (r.file === name) allowed.push([lineOf(o, r.start), lineOf(o, Math.max(r.start, r.end - 1))]);
      for (const ln of removedAt) if (!allowed.some(([a, b]) => ln >= a && ln <= b)) problems.push(`${name}: removed line ${ln} is outside the target's start tag and matching rules`);
    }
  }
  return problems.length ? { pass: false, detail: problems.join(' | ') } : { pass: true, detail: summary.join('; ') };
}

const errored: string[] = [];
for (const spec of edits) {
  const f = fx.get(spec.file)!;
  const T = spec.type;
  let out: EngineOut;
  try {
    out = (await enginePage.evaluate(([fixture, s]) => (window as never as { runGateEdit: (...a: unknown[]) => Promise<unknown> }).runGateEdit(fixture, s), [f, spec] as const)) as EngineOut;
  } catch (e) {
    out = { refused: { code: 'harness-error', message: (e as Error).message }, warnings: [] };
    errored.push(spec.id);
  }
  const origFiles: Record<string, string> = { [f.file]: f.source, ...f.companions };
  const files = out.refused ? origFiles : out.files!;
  const dirX = join(work, spec.id, 'exported');
  const dirO = join(work, spec.id, 'original');
  writeSet(dirX, files);
  writeSet(dirO, origFiles);
  const O = await load(dirO, f.file, spec.expected, spec.target);
  const X = await load(dirX, f.file, spec.expected, spec.target);

  // E1
  const probs: string[] = [];
  if (X.navError) probs.push(`navigation: ${X.navError}`);
  if (X.errors.length) probs.push(X.errors.join(' | '));
  if (f.kind === 'svg' && (X.dump.rootName !== 'svg' || X.dump.parserErrors)) probs.push(`root=${X.dump.rootName} parsererror=${X.dump.parserErrors}`);
  try {
    const comps: Record<string, string> = {};
    for (const k of Object.keys(f.companions)) comps[k] = files[k] ?? '';
    const before = createModel(f.source, f.kind, f.companions, f.file);
    const after = createModel(files[f.file] ?? '', f.kind, comps, f.file);
    if (after.primary.parseErrors > before.primary.parseErrors) probs.push(`engine re-parse errors ${after.primary.parseErrors} > ${before.primary.parseErrors}`);
    if (after.primary.elements.length !== before.primary.elements.length) probs.push(`engine element count ${before.primary.elements.length} -> ${after.primary.elements.length}`);
  } catch (e) {
    probs.push(`engine re-parse threw: ${(e as Error).message}`);
  }
  if (X.dump.rows.length !== O.dump.rows.length) probs.push(`DOM element count ${O.dump.rows.length} -> ${X.dump.rows.length}`);
  for (const k of Object.keys(f.companions)) if (!files[k] || files[k]!.length === 0) probs.push(`companion ${k} not exported or empty`);
  add(spec.id, spec.file, T, 'E1', probs.length === 0, probs.join(' | ') || 'loads, no errors, re-parse clean, counts equal');

  if (out.refused) {
    const why = `refused (${out.refused.code}): ${out.refused.message}`;
    for (const r of ['E2', 'E3', 'E4', 'E5']) add(spec.id, spec.file, T, r, false, why);
    writeFileSync(join(RAW, `${spec.id}.json`), JSON.stringify({ spec, refused: out.refused }, null, 2));
    continue;
  }

  // E2
  const ex = spec.expected;
  const p2: string[] = [];
  for (const [k, c] of (ex.computed ?? []).entries()) {
    const got = X.spec.computed[k]?.value ?? null;
    if (norm(got) !== norm(c.value)) p2.push(`${c.selector} ${c.property}: got "${got}", want "${c.value}"`);
  }
  const deltaOf = (a: number[] | null, b: number[] | null) => (a && b ? [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!, b[3]! - a[3]!] : null);
  const keys = ['dx', 'dy', 'dw', 'dh'] as const;
  const xd = deltaOf(O.spec.bbox, X.spec.bbox);
  if (ex.bboxDelta) {
    if (!xd) p2.push('bbox not measurable');
    else keys.forEach((k, i) => { const w = ex.bboxDelta![k]; if (w !== undefined && !near(xd[i]!, w)) p2.push(`${k}: got ${+xd[i]!.toFixed(2)}, want ${w}`); });
  }
  if (ex.order && JSON.stringify(X.spec.order) !== JSON.stringify(ex.order.ids)) p2.push(`order: got ${JSON.stringify(X.spec.order)}, want ${JSON.stringify(ex.order.ids)}`);
  add(spec.id, spec.file, T, 'E2', p2.length === 0, p2.join(' | ') || 'all expected values match');

  // E3
  const p3: string[] = [];
  for (const [k, c] of (ex.computed ?? []).entries()) {
    const a = out.after!.computed[k]?.value ?? null, b = X.spec.computed[k]?.value ?? null;
    if (norm(a) !== norm(b)) p3.push(`${c.selector} ${c.property}: preview "${a}" vs export "${b}"`);
  }
  if (ex.bboxDelta) {
    const pd = deltaOf(out.before!.bbox, out.after!.bbox);
    if (!pd || !xd) p3.push('bbox not measurable');
    else keys.forEach((k, i) => { if (ex.bboxDelta![k] !== undefined && !near(pd[i]!, xd[i]!)) p3.push(`${k}: preview ${+pd[i]!.toFixed(2)} vs export ${+xd[i]!.toFixed(2)}`); });
  }
  if (ex.order && JSON.stringify(out.after!.order) !== JSON.stringify(X.spec.order)) p3.push(`order: preview ${JSON.stringify(out.after!.order)} vs export ${JSON.stringify(X.spec.order)}`);
  add(spec.id, spec.file, T, 'E3', p3.length === 0, p3.join(' | ') || 'preview and export agree on every named value');

  // E4, E5
  const r4 = e4(spec, O.dump, X.dump);
  add(spec.id, spec.file, T, 'E4', r4.pass, r4.detail);
  const r5 = e5(spec, f, files, out.spans!);
  add(spec.id, spec.file, T, 'E5', r5.pass, r5.detail);
  writeFileSync(join(RAW, `${spec.id}.json`), JSON.stringify({ spec, placement: out.placement, warnings: out.warnings, patches: out.patches, e4: r4, e5: r5 }, null, 2));
}

await browser.close();
server.close();

const header = 'run,edit_id,file,type,rule,pass,detail';
const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
const lines = rows.map((r) => [r.run, r.edit_id, r.file, r.type, r.rule, r.pass ? 'true' : 'false', q(r.detail)].join(','));
const prev = existsSync(CSV) ? readFileSync(CSV, 'utf8').trimEnd() : header;
writeFileSync(CSV, `${prev}\n${lines.join('\n')}\n`);
if (errored.length) console.error('harness errors on', errored.join(', '));
writeSummary(RUN);
console.log(readFileSync(join(ROOT, 'results/gate-summary.md'), 'utf8'));
