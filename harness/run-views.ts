// Small-views harness (docs/small-views-rules.md): the 32 specs in fixtures/views/edits.json scored by script.   GATE_RUN=<id> npx tsx harness/run-views.ts
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createModel, exportFiles, sources } from '../engine/src/index';
import { ROOT } from './fixtures';
import { serve } from './serve';
import { VSPECS, filesOf, viewsInput, type VSpec, type VStep } from './views-lib';
import { evaluateViews, type Row } from './views-check';
import { writeSet } from './insert-lib';

const RUN = process.env.GATE_RUN ?? 'm1';
const OUT = join(ROOT, 'views-check/results'), CSV = join(OUT, 'views-results.csv');
const TMP = join(ROOT, 'views-check/tmp', `run-${RUN}`), RAW = join(ROOT, 'views-check/raw', `run-${RUN}`);
if (existsSync(CSV) && readFileSync(CSV, 'utf8').split('\n').some((l) => l.startsWith(`${RUN},`))) throw new Error(`run ${RUN} already exists in ${CSV}`);
rmSync(TMP, { recursive: true, force: true }); mkdirSync(TMP, { recursive: true }); mkdirSync(RAW, { recursive: true }); mkdirSync(OUT, { recursive: true });
execSync('node harness/bundle.mjs', { cwd: ROOT, stdio: 'inherit' });
const { url, server } = await serve(ROOT);
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
await ctx.route('**/*', (r) => (r.request().url().startsWith('http://127.0.0.1') ? r.continue() : r.abort()));
const page = await ctx.newPage();
await page.goto(url);
await page.addScriptTag({ url: '/engine.js' });
await page.addScriptTag({ path: join(ROOT, 'harness/page-measure.js') });
await page.addScriptTag({ path: join(ROOT, 'harness/page-views.js') });
interface Out { refused: { step: number; code: string; message: string } | null; threw?: string; files?: Record<string, string>; stepFiles: Record<string, string>[]; unlinked?: { selector: string; property: string; environment: string; value: string }[] }
const run = (spec: VSpec, steps: VStep[]): Promise<Out> => {
  const i = viewsInput(spec.fixture);
  return page.evaluate(([f, st]) => (window as never as { runViewsSpec: (...a: unknown[]) => Promise<unknown> }).runViewsSpec(f, st), [{ file: i.file, kind: i.kind, source: i.source, companions: i.companions }, steps] as const) as Promise<Out>;
};
/** The harness's own reset: drop, in order, the element edits of the reset environment from the steps before it (independent of the engine's resetView). */
function filtered(steps: VStep[]): VStep[] {
  let out: VStep[] = [];
  for (const s of steps) { if (s.op === 'reset') out = out.filter((x) => !(['set', 'offset', 'reorder'].includes(x.op) && x.environment === s.env)); else out.push(s); }
  return out;
}
const rows: (Row & { fixture: string; outcome: string })[] = [];
const outcomes = new Map<string, string>();
const fixtures = [...new Set(VSPECS.map((s) => s.fixture))];
for (const [n, f] of fixtures.entries()) {
  const inp = viewsInput(f);
  let ok = false, detail = '';
  try { const out = exportFiles(sources(createModel(inp.source, inp.kind, inp.companions, inp.file)), []); const fl = filesOf(inp); ok = Object.keys(fl).every((k) => out[k] === fl[k]); detail = ok ? 'byte-identical' : 'NOT byte-identical'; } catch (e) { detail = `engine threw: ${(e as Error).message}`; }
  rows.push({ id: `RT${String(n + 1).padStart(2, '0')}`, fixture: f, rule: 'RT', pass: ok, detail, outcome: ok ? 'PASS' : 'FAIL' });
}
for (const spec of VSPECS) {
  if (process.env.GATE_ONLY && spec.id !== process.env.GATE_ONLY) continue;
  const inp = viewsInput(spec.fixture);
  const start = rows.length;
  const add = (rule: string, pass: boolean, detail: string) => rows.push({ id: spec.id, fixture: spec.fixture, rule, pass, detail: detail.replace(/\s+/g, ' ').slice(0, 600), outcome: '' });
  const ex = spec.expect;
  let out: Out | null = null, threw = '';
  try { out = await run(spec, spec.steps); } catch (e) { threw = (e as Error).message; }
  let outcome = 'PASS';
  if (threw || out!.threw) { outcome = 'FAIL'; add('R1', false, `uncaught exception: ${threw || out!.threw}`); }
  else if (out!.refused) {
    const r = out!.refused;
    if (ex.outcome === 'REFUSED') { const ok = r.code === ex.refusal && r.step === spec.steps.length; add('R1', ok, `refused at step ${r.step} with ${r.code}${ok ? '' : `, declared ${ex.refusal}`}: ${r.message}`); outcome = ok ? 'REFUSED' : 'FAIL'; }
    else { outcome = 'FAIL'; add('R1', false, `declared PASS but refused at step ${r.step} (${r.code}): ${r.message}`); }
  } else if (ex.outcome === 'REFUSED') { outcome = 'FAIL'; add('R1', false, `declared REFUSED (${ex.refusal}) but the engine produced an export`); }
  else {
    const files = out!.files!;
    const extras: Parameters<typeof evaluateViews>[5] = { unlinked: out!.unlinked ?? null, stepFiles: out!.stepFiles };
    if (ex.equalsSteps) { const keep = new Set<number>(ex.equalsSteps); const non = spec.steps.filter((s) => s.op !== 'reset'); extras.equalsRun = (await run(spec, non.filter((_, i) => keep.has(i + 1)))).files ?? null; }
    if (spec.steps.some((s) => s.op === 'reset')) extras.filteredRun = (await run(spec, filtered(spec.steps))).files ?? null;
    if (ex.undo) { extras.replays = []; for (let n = 1; n < spec.steps.length; n++) extras.replays.push((await run(spec, spec.steps.slice(0, n))).files ?? {}); extras.stepFiles = out!.stepFiles.slice(0, spec.steps.length - 1); }
    writeSet(join(RAW, spec.id), files);
    for (const r of await evaluateViews(browser, spec, inp, files, TMP, extras)) rows.push({ ...r, fixture: spec.fixture, outcome: '' });
    outcome = rows.slice(start).every((r) => r.pass) ? 'PASS' : 'FAIL';
  }
  for (const r of rows.slice(start)) r.outcome = outcome;
  outcomes.set(spec.id, outcome);
  console.log(spec.id, outcome, rows.slice(start).filter((r) => !r.pass).map((r) => `${r.rule}: ${r.detail.slice(0, 150)}`).join(' || '));
}
await browser.close(); server.close();
const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
const prev = existsSync(CSV) ? readFileSync(CSV, 'utf8').trimEnd() : 'run,id,fixture,rule,outcome,pass,detail';
writeFileSync(CSV, `${prev}\n${rows.map((r) => [RUN, r.id, r.fixture, r.rule, r.outcome, r.pass ? 'true' : 'false', q(r.detail)].join(',')).join('\n')}\n`);
console.log(JSON.stringify([...outcomes.values()].reduce((a, o) => ({ ...a, [o]: (a[o] ?? 0) + 1 }), {} as Record<string, number>)));
