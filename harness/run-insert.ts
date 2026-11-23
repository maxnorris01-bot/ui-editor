// Insert and Comments engine spike harness (docs/insert-comments-rules.md): the 36 specs in fixtures/insert/edits.json,
// scored by script from the exported files and what headless Chromium says about them. No hand-judging.
//   GATE_RUN=<id> npx tsx harness/run-insert.ts
// Modes: GATE_RUN=i0 (Step 1, old engine: every spec must fail), and INSERT_CONTROLS=1 runs the scorer-check controls
// (harness/controls-insert.ts) instead of the specs. Nothing is written to the results CSV for controls.
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createModel, exportFiles, sources } from '../engine/src/index';
import { ROOT } from './fixtures';
import { serve } from './serve';
import { SPECS, evaluateExport, expandText, fixtureInput, originalFiles, writeSet, type Extras, type Row, type Spec, type Step } from './insert-lib';

const RUN = process.env.GATE_RUN ?? 'i1';
const OUT = join(ROOT, 'insert-check/results');
const CSV = join(OUT, 'insert-results.csv');
const TMP = join(ROOT, 'insert-check/tmp', `run-${RUN}`);
const RAW = join(ROOT, 'insert-check/raw', `run-${RUN}`);
if (existsSync(CSV) && readFileSync(CSV, 'utf8').split('\n').some((l) => l.startsWith(`${RUN},`))) throw new Error(`run ${RUN} already exists in ${CSV}; use a new GATE_RUN for a labelled iteration`);
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true }); mkdirSync(RAW, { recursive: true }); mkdirSync(OUT, { recursive: true });

execSync('node harness/bundle.mjs', { cwd: ROOT, stdio: 'inherit' });
const { url, server } = await serve(ROOT);
export const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
await ctx.route('**/*', (r) => (r.request().url().startsWith('http://127.0.0.1') ? r.continue() : r.abort()));
const page = await ctx.newPage();
await page.goto(url);
await page.addScriptTag({ url: '/engine.js' });
await page.addScriptTag({ path: join(ROOT, 'harness/page-measure.js') });
await page.addScriptTag({ path: join(ROOT, 'harness/page-insert.js') });

export interface EngineOut { refused: { step: number; code: string; message: string } | null; threw?: string; files?: Record<string, string>; stepFiles: Record<string, string>[]; unlinked?: Extras['unlinked']; notes?: Extras['listNotesExport']; preview?: Extras['preview']; done?: number }
const expandSteps = (steps: Step[]): Step[] => steps.map((s) => ({ ...s, text: s.text === undefined ? undefined : expandText(s.text) }));
const run = (spec: Spec, steps: Step[]): Promise<EngineOut> => {
  const inp = fixtureInput(spec.fixture);
  const boxSelectors = (spec.expect.created ?? []).map((c: { selector: string }) => c.selector);
  return page.evaluate(([f, st, o]) => (window as never as { runInsertSpec: (...a: unknown[]) => Promise<unknown> }).runInsertSpec(f, st, o),
    [{ file: inp.file, kind: inp.kind, source: inp.source, companions: inp.companions }, expandSteps(steps), { previewWidths: [1280, 390], boxSelectors }] as const) as Promise<EngineOut>;
};
const listNotesOf = (inp: ReturnType<typeof fixtureInput>, files: Record<string, string>) =>
  page.evaluate((f) => (window as never as { runListNotes: (f: unknown) => unknown }).runListNotes(f), { file: inp.file, kind: inp.kind, source: files[inp.file]!, companions: Object.fromEntries(Object.keys(inp.companions).map((k) => [k, files[k]!])) }) as Promise<Extras['listNotesExport']>;

const rows: (Row & { fixture: string; outcome: string })[] = [];
const outcomes = new Map<string, string>();

// ---- no-op round trips of every fixture file --------------------------------------------------------
const fixtures = [...new Set(SPECS.map((s) => s.fixture))];
for (const [n, f] of fixtures.entries()) {
  const inp = fixtureInput(f);
  const id = `RT${String(n + 1).padStart(2, '0')}`;
  let ok = false, detail = '';
  try {
    const out = exportFiles(sources(createModel(inp.source, inp.kind, inp.companions, inp.file)), []);
    const files = originalFiles(inp);
    ok = Object.keys(files).every((k) => out[k] === files[k]);
    detail = ok ? `byte-identical (${Object.keys(files).join(', ')})` : 'NOT byte-identical';
  } catch (e) { detail = `engine threw: ${(e as Error).message}`; }
  rows.push({ id, fixture: f, rule: 'RT', pass: ok, detail, outcome: ok ? 'PASS' : 'FAIL' });
}

// ---- the specs --------------------------------------------------------------------------------------
const roundTrip = (inp: ReturnType<typeof fixtureInput>) => (files: Record<string, string>): boolean => {
  try {
    const comps = Object.fromEntries(Object.keys(inp.companions).map((k) => [k, files[k]!]));
    const out = exportFiles(sources(createModel(files[inp.file]!, inp.kind, comps, inp.file)), []);
    return Object.keys(files).every((k) => out[k] === files[k]);
  } catch { return false; }
};

for (const spec of SPECS) {
  if (process.env.GATE_ONLY && spec.id !== process.env.GATE_ONLY) continue;
  const inp = fixtureInput(spec.fixture);
  const start = rows.length;
  const add = (rule: string, pass: boolean, detail: string) => rows.push({ id: spec.id, fixture: spec.fixture, rule, pass, detail: detail.replace(/\s+/g, ' ').slice(0, 700), outcome: '' });
  const ex = spec.expect;
  let out: EngineOut | null = null, threw = '';
  try { out = await run(spec, spec.steps); } catch (e) { threw = (e as Error).message; }
  let outcome = 'PASS';
  if (threw || out!.threw) {
    outcome = 'FAIL';
    add('R1', false, `uncaught exception: ${threw || out!.threw}`);
  } else if (out!.refused) {
    const r = out!.refused;
    if (ex.outcome === 'REFUSED') {
      const okCode = r.code === ex.refusal, okStep = r.step === spec.steps.length;
      add('R1', okCode && okStep, `refused at step ${r.step} with code ${r.code}${okCode ? '' : `, declared ${ex.refusal}`}: ${r.message}`);
      add('R2', true, 'a refusal changes nothing (the edit result carries no patches); the reason is checked against the fixture by validate-insert-specs.ts');
      outcome = okCode && okStep ? 'REFUSED' : 'FAIL';
    } else {
      outcome = 'FAIL';
      add('R1', false, `declared PASS but the engine refused at step ${r.step} (${r.code}): ${r.message}`);
    }
  } else if (ex.outcome === 'REFUSED') {
    outcome = 'FAIL';
    add('R1', false, `declared REFUSED (${ex.refusal}) but the engine produced an export`);
  } else {
    const files = out!.files!;
    const extras: Extras = { preview: out!.preview, stepFiles: out!.stepFiles, unlinked: out!.unlinked, roundTrip: roundTrip(inp) };
    const again = await run(spec, spec.steps);
    extras.again = again.files ?? null;
    if (ex.undo) {
      extras.replays = [];
      for (let n = 1; n < spec.steps.length; n++) { const r = await run(spec, spec.steps.slice(0, n)); extras.replays.push(r.files ?? {}); }
      extras.stepFiles = out!.stepFiles.slice(0, spec.steps.length - 1);
    }
    if (ex.notesOff) { const r = await run(spec, spec.steps.filter((s) => s.op !== 'note')); extras.noNotes = r.files ?? null; }
    if (ex.listNotesOriginal) { extras.listNotesOriginal = await listNotesOf(inp, originalFiles(inp)); extras.listNotesExport = await listNotesOf(inp, files); }
    writeSet(join(RAW, spec.id), files);
    for (const r of await evaluateExport(browser, spec, inp, files, TMP, extras)) rows.push({ ...r, fixture: spec.fixture, outcome: '' });
    outcome = rows.slice(start).every((r) => r.pass) ? 'PASS' : 'FAIL';
  }
  for (const r of rows.slice(start)) r.outcome = outcome;
  outcomes.set(spec.id, outcome);
  console.log(spec.id, outcome, rows.slice(start).filter((r) => !r.pass).map((r) => `${r.rule}: ${r.detail.slice(0, 140)}`).join(' || '));
}

await browser.close();
server.close();
const header = 'run,id,fixture,rule,outcome,pass,detail';
const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
const prev = existsSync(CSV) ? readFileSync(CSV, 'utf8').trimEnd() : header;
writeFileSync(CSV, `${prev}\n${rows.map((r) => [RUN, r.id, r.fixture, r.rule, r.outcome, r.pass ? 'true' : 'false', q(r.detail)].join(',')).join('\n')}\n`);
const tally = [...outcomes.values()].reduce((a, o) => ({ ...a, [o]: (a[o] ?? 0) + 1 }), {} as Record<string, number>);
console.log(JSON.stringify(tally), 'round trips', rows.filter((r) => r.rule === 'RT' && r.pass).length, '/', fixtures.length);
