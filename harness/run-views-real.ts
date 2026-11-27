// Views real-page harness (docs/views-realpage-rules.md): the 16 V-specs and the 5 round trips on the real pages in ../ui-editor-realpages, scored by script.
//   GATE_RUN=<id> npx tsx harness/run-views-real.ts       (nothing under engine/ or src/ is touched; the real files are never copied into the repo)
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createModel, exportFiles, sources } from '../engine/src/index';
import { ROOT } from './fixtures';
import { serve } from './serve';
import { RFILES, RSPECS, checkFractional, filesOf, realInput, roundTripRow, type RealSpec } from './views-real-lib';
import type { VStep } from './views-lib';
import { evaluateViews, type Row } from './views-check';
import { writeSet } from './insert-lib';

const RUN = process.env.GATE_RUN ?? 'v1';
const OUT = join(ROOT, 'views-check/results'), CSV = join(OUT, 'realpage-results.csv'), TIMES = join(OUT, `realpage-times-${RUN}.json`);
const TMP = join(ROOT, 'views-check/tmp', `real-run-${RUN}`), RAW = join(ROOT, 'views-check/raw', `real-run-${RUN}`);
if (existsSync(CSV) && readFileSync(CSV, 'utf8').split('\n').some((l) => l.startsWith(`${RUN},`))) throw new Error(`run ${RUN} already exists in ${CSV}`);
rmSync(TMP, { recursive: true, force: true }); mkdirSync(TMP, { recursive: true }); mkdirSync(RAW, { recursive: true }); mkdirSync(OUT, { recursive: true });
execSync('node harness/bundle.mjs', { cwd: ROOT, stdio: 'inherit' });
const t0 = Date.now();
const { url, server } = await serve(ROOT);
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
await ctx.route('**/*', (r) => (r.request().url().startsWith('http://127.0.0.1') ? r.continue() : r.abort()));
const page = await ctx.newPage();
await page.goto(url);
await page.addScriptTag({ url: '/engine.js' });
await page.addScriptTag({ path: join(ROOT, 'harness/page-measure.js') });
await page.addScriptTag({ path: join(ROOT, 'harness/page-views.js') });
interface Out { refused: { step: number; code: string; message: string } | null; threw?: string; files?: Record<string, string>; stepFiles: Record<string, string>[]; unlinked?: unknown[]; customAfter?: { phone: number; tablet: number } | null }
const run = (spec: RealSpec, steps: VStep[]): Promise<Out> => {
  const i = realInput(spec.fixture);
  return page.evaluate(([f, st]) => (window as never as { runViewsSpec: (...a: unknown[]) => Promise<unknown> }).runViewsSpec(f, st), [{ file: i.file, kind: i.kind, source: i.source, companions: i.companions }, steps] as const) as Promise<Out>;
};
/** The harness's own reset: drop, in order, the element edits of the reset environment from the steps before it (independent of the engine's resetView). */
function filtered(steps: VStep[]): VStep[] {
  let out: VStep[] = [];
  for (const s of steps) { if (s.op === 'reset') out = out.filter((x) => !(['set', 'offset', 'reorder'].includes(x.op) && x.environment === s.env)); else out.push(s); }
  return out;
}
const saved = JSON.parse(readFileSync(join(ROOT, 'results/views/baseline-hashes.json'), 'utf8')) as Record<string, string>;
const sha = (t: string) => createHash('sha256').update(t).digest('hex');
const rows: (Row & { fixture: string; outcome: string })[] = [];
const outcomes = new Map<string, string>();
const times: Record<string, number> = {};

// Q8: the no-op round trip of each of the five files (the companion CSS included)
let ts = Date.now();
for (const [n, f] of RFILES.entries()) {
  const inp = realInput(f);
  let ok = false, detail = '';
  try { const r = roundTripRow(inp, exportFiles(sources(createModel(inp.source, inp.kind, inp.companions, inp.file)), [])); ok = r.pass; detail = r.detail; } catch (e) { detail = `engine threw: ${(e as Error).message}`; }
  rows.push({ id: `RT${String(n + 1).padStart(2, '0')}`, fixture: f, rule: 'RT', pass: ok, detail, outcome: ok ? 'PASS' : 'FAIL' });
  console.log(`RT${n + 1}`, f, ok ? 'PASS' : 'FAIL');
}
times.roundTrips = Date.now() - ts;

for (const spec of RSPECS) {
  if (process.env.GATE_ONLY && !process.env.GATE_ONLY.split(',').includes(spec.id)) continue;
  ts = Date.now();
  const inp = realInput(spec.fixture);
  const start = rows.length;
  const add = (rule: string, pass: boolean, detail: string) => rows.push({ id: spec.id, fixture: spec.fixture, rule, pass, detail: detail.replace(/\s+/g, ' ').slice(0, 600), outcome: '' });
  const ex = spec.expect;
  let out: Out | null = null, threw = '';
  try { out = await run(spec, spec.steps); } catch (e) { threw = (e as Error).message; }
  let outcome = 'PASS';
  if (threw || out!.threw) { outcome = 'FAIL'; add('R1', false, `uncaught exception: ${threw || out!.threw}`); }
  else if (out!.refused) {
    const r = out!.refused;
    outcome = 'FAIL'; add('R1', false, `declared ${ex.outcome} but refused at step ${r.step} (${r.code}): ${r.message}`);
  } else if (ex.outcome === 'REFUSED') { outcome = 'FAIL'; add('R1', false, 'declared REFUSED but the engine produced an export'); }
  else {
    const files = out!.files!;
    const extras: Parameters<typeof evaluateViews>[5] = { unlinked: null, stepFiles: out!.stepFiles };
    if (spec.steps.some((s) => s.op === 'reset')) { const f = filtered(spec.steps); const r = await run(spec, f); extras.filteredRun = r.files ?? (f.length === 0 && !r.threw ? filesOf(inp) : null); }
    if (ex.undo) { extras.replays = []; for (let n = 1; n < spec.steps.length; n++) extras.replays.push((await run(spec, spec.steps.slice(0, n))).files ?? {}); extras.stepFiles = out!.stepFiles.slice(0, spec.steps.length - 1); }
    writeSet(join(RAW, spec.id), files);
    for (const r of await evaluateViews(browser, spec, inp, files, TMP, extras)) rows.push({ ...r, fixture: spec.fixture, outcome: '' });
    if (ex.customAfter) { const got = out!.customAfter ?? null; const ok = got !== null && got.phone === ex.customAfter.phone && got.tablet === ex.customAfter.tablet; add('CE', ok, ok ? `customEdits afterwards: phone ${got!.phone}, tablet ${got!.tablet}` : `customEdits afterwards ${JSON.stringify(got)} expected ${JSON.stringify(ex.customAfter)}`); }
    if (ex.fracWidths) for (const r of await checkFractional(browser, spec, inp, files, TMP)) add(r.rule, r.pass, r.detail);
    if (ex.savedHash) {
      const f = inp.file, key = ex.savedHash;
      add('SB', saved[key] !== undefined && sha(files[f] ?? '') === saved[key], `the export's sha256 ${sha(files[f] ?? '').slice(0, 12)} vs the saved real-page export ${key} ${String(saved[key]).slice(0, 12)}`);
      const d = await run(spec, spec.steps.map((s) => { const c = { ...s }; delete c.environment; return c; }));
      add('SD', !!d.files && Object.keys(files).every((k) => d.files![k] === files[k]), d.files ? 'the same edit with no environment gives the same bytes' : `the Desktop run did not export (${d.refused?.code ?? d.threw})`);
    }
    outcome = rows.slice(start).every((r) => r.pass) ? 'PASS' : 'FAIL';
  }
  for (const r of rows.slice(start)) r.outcome = outcome;
  outcomes.set(spec.id, outcome);
  times[spec.id] = Date.now() - ts;
  console.log(spec.id, outcome, `${((Date.now() - ts) / 1000).toFixed(0)}s`, rows.slice(start).filter((r) => !r.pass).map((r) => `${r.rule}: ${r.detail.slice(0, 200)}`).join(' || '));
}
await browser.close(); server.close();
times.total = Date.now() - t0;
writeFileSync(TIMES, JSON.stringify(times, null, 1) + '\n');
const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
const prev = existsSync(CSV) ? readFileSync(CSV, 'utf8').trimEnd() : 'run,id,fixture,rule,outcome,pass,detail';
writeFileSync(CSV, `${prev}\n${rows.map((r) => [RUN, r.id, r.fixture, r.rule, r.outcome, r.pass ? 'true' : 'false', q(r.detail)].join(',')).join('\n')}\n`);
console.log(JSON.stringify([...outcomes.values()].reduce((a, o) => ({ ...a, [o]: (a[o] ?? 0) + 1 }), {} as Record<string, number>)));
