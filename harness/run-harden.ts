// Engine hardening harness (docs/hardening-rules.md): the 20 specs in fixtures/harden/edits.json, scored by script from the exported
// files and what headless Chromium says about them. No hand-judging.
//   GATE_RUN=<id> npx tsx harness/run-harden.ts
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createModel, exportFiles, sources } from '../engine/src/index';
import { ROOT } from './fixtures';
import { serve } from './serve';
import { evaluateExport, expandText, writeSet, type Extras, type Row, type Spec, type Step } from './insert-lib';
import { HSPECS, filesOf, hardenInput, hardenRows } from './harden-lib';

const RUN = process.env.GATE_RUN ?? 'h1';
const OUT = join(ROOT, 'harden-check/results');
const CSV = join(OUT, 'harden-results.csv');
const TMP = join(ROOT, 'harden-check/tmp', `run-${RUN}`);
const RAW = join(ROOT, 'harden-check/raw', `run-${RUN}`);
if (existsSync(CSV) && readFileSync(CSV, 'utf8').split('\n').some((l) => l.startsWith(`${RUN},`))) throw new Error(`run ${RUN} already exists in ${CSV}; use a new GATE_RUN`);
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true }); mkdirSync(RAW, { recursive: true }); mkdirSync(OUT, { recursive: true });

execSync('node harness/bundle.mjs', { cwd: ROOT, stdio: 'inherit' });
const { url, server } = await serve(ROOT);
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
await ctx.route('**/*', (r) => (r.request().url().startsWith('http://127.0.0.1') ? r.continue() : r.abort()));
const page = await ctx.newPage();
await page.goto(url);
await page.addScriptTag({ url: '/engine.js' });
await page.addScriptTag({ path: join(ROOT, 'harness/page-measure.js') });
await page.addScriptTag({ path: join(ROOT, 'harness/page-insert.js') });

interface EngineOut { refused: { step: number; code: string; message: string } | null; threw?: string; files?: Record<string, string>; stepFiles: Record<string, string>[]; stepUnlinked?: unknown[][]; unlinked?: Extras['unlinked']; preview?: Extras['preview'] }
const expandSteps = (steps: Step[]): Step[] => steps.map((s) => ({ ...s, text: s.text === undefined ? undefined : expandText(s.text) }));
const run = (spec: Spec, steps: Step[]): Promise<EngineOut> => {
  const inp = hardenInput(spec.fixture);
  const boxSelectors = (spec.expect.created ?? []).map((c: { selector: string }) => c.selector);
  return page.evaluate(([f, st, o]) => (window as never as { runInsertSpec: (...a: unknown[]) => Promise<unknown> }).runInsertSpec(f, st, o),
    [{ file: inp.file, kind: inp.kind, source: inp.source, companions: inp.companions }, expandSteps(steps), { previewWidths: [1280, 390], boxSelectors }] as const) as Promise<EngineOut>;
};

const rows: (Row & { fixture: string; outcome: string })[] = [];
const outcomes = new Map<string, string>();
const fixtures = [...new Set(HSPECS.map((s) => s.fixture))];
for (const [n, f] of fixtures.entries()) {
  const inp = hardenInput(f);
  let ok = false, detail = '';
  try {
    const out = exportFiles(sources(createModel(inp.source, inp.kind, inp.companions, inp.file)), []);
    const files = filesOf(inp);
    ok = Object.keys(files).every((k) => out[k] === files[k]);
    detail = ok ? `byte-identical (${Object.keys(files).join(', ')})` : 'NOT byte-identical';
  } catch (e) { detail = `engine threw: ${(e as Error).message}`; }
  rows.push({ id: `RT${String(n + 1).padStart(2, '0')}`, fixture: f, rule: 'RT', pass: ok, detail, outcome: ok ? 'PASS' : 'FAIL' });
}

for (const spec of HSPECS) {
  if (process.env.GATE_ONLY && spec.id !== process.env.GATE_ONLY) continue;
  const inp = hardenInput(spec.fixture);
  const start = rows.length;
  const add = (rule: string, pass: boolean, detail: string) => rows.push({ id: spec.id, fixture: spec.fixture, rule, pass, detail: detail.replace(/\s+/g, ' ').slice(0, 700), outcome: '' });
  const ex = spec.expect;
  let out: EngineOut | null = null, threw = '';
  try { out = await run(spec, spec.steps); } catch (e) { threw = (e as Error).message; }
  let outcome = 'PASS';
  if (threw || out!.threw) { outcome = 'FAIL'; add('R1', false, `uncaught exception: ${threw || out!.threw}`); }
  else if (out!.refused) { outcome = 'FAIL'; add('R1', false, `declared PASS but the engine refused at step ${out!.refused.step} (${out!.refused.code}): ${out!.refused.message}`); }
  else {
    const files = out!.files!;
    const rt = (f: Record<string, string>): boolean => { try { const comps = Object.fromEntries(Object.keys(inp.companions).map((k) => [k, f[k]!])); const o = exportFiles(sources(createModel(f[inp.file]!, inp.kind, comps, inp.file)), []); return Object.keys(f).every((k) => o[k] === f[k]); } catch { return false; } };
    const extras: Extras = { preview: out!.preview, stepFiles: out!.stepFiles, unlinked: out!.unlinked, roundTrip: rt };
    extras.again = (await run(spec, spec.steps)).files ?? null;
    const replayUnlinked: unknown[][] = [];
    if (ex.undo) {
      extras.replays = [];
      for (let n = 1; n < spec.steps.length; n++) { const r = await run(spec, spec.steps.slice(0, n)); extras.replays.push(r.files ?? {}); replayUnlinked.push((r.unlinked as unknown[]) ?? []); }
      extras.stepFiles = out!.stepFiles.slice(0, spec.steps.length - 1);
    }
    let without: Record<string, string> | null = null;
    const hb = ex.hbytes;
    if (hb && typeof hb === 'object' && hb.equalsRunWithout) { const drop = new Set<number>(hb.equalsRunWithout); without = (await run(spec, spec.steps.filter((_, i) => !drop.has(i + 1)))).files ?? null; }
    writeSet(join(RAW, spec.id), files);
    const base = await evaluateExport(browser, spec, inp, files, TMP, extras);
    const more = await hardenRows(browser, spec, inp, files, TMP, { without, replayUnlinked, stepUnlinked: (out!.stepUnlinked ?? []).slice(0, spec.steps.length - 1) });
    for (const r of [...base, ...more]) rows.push({ ...r, fixture: spec.fixture, outcome: '' });
    outcome = rows.slice(start).every((r) => r.pass) ? 'PASS' : 'FAIL';
  }
  for (const r of rows.slice(start)) r.outcome = outcome;
  outcomes.set(spec.id, outcome);
  console.log(spec.id, outcome, rows.slice(start).filter((r) => !r.pass).map((r) => `${r.rule}: ${r.detail.slice(0, 150)}`).join(' || '));
}
await browser.close();
server.close();
const header = 'run,id,fixture,rule,outcome,pass,detail';
const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
const prev = existsSync(CSV) ? readFileSync(CSV, 'utf8').trimEnd() : header;
writeFileSync(CSV, `${prev}\n${rows.map((r) => [RUN, r.id, r.fixture, r.rule, r.outcome, r.pass ? 'true' : 'false', q(r.detail)].join(',')).join('\n')}\n`);
const tally = [...outcomes.values()].reduce((a, o) => ({ ...a, [o]: (a[o] ?? 0) + 1 }), {} as Record<string, number>);
console.log(JSON.stringify(tally), 'round trips', rows.filter((r) => r.rule === 'RT' && r.pass).length, '/', fixtures.length);
