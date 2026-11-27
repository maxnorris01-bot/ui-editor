// Scorer check for the views real-page round (docs/views-realpage-rules.md section 6), run BEFORE the first scored run. The real pages are scored by the very same harness
// functions (evaluateViews, checkFractional, roundTripRow); here they are fed hand-built exports. (A) every non-SVG spec gets a reference export built from its stated truth
// (one rule per test width, written without the engine): it must PASS every check the engine-free pipeline can score; this also proves the stated values are reachable in plain Chromium.
// (B) 6 fault switches on lee munroe: each export must FAIL the check named. A control that does not behave STOPS the round.   npx tsx harness/controls-views-real.ts
import { chromium } from 'playwright';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './fixtures';
import { RSPECS, checkFractional, realInput, roundTripRow, filesOf, type RealSpec } from './views-real-lib';
import { regionOf, testWidths } from './views-lib';
import { evaluateViews, type Row, type VExtras } from './views-check';
import { loadAt, writeSet } from './insert-lib';

const TMP = join(ROOT, 'views-check/tmp/real-controls');
rmSync(TMP, { recursive: true, force: true }); mkdirSync(TMP, { recursive: true });
mkdirSync(join(ROOT, 'views-check/results'), { recursive: true });
const browser = await chromium.launch({ headless: true });
type Files = Record<string, string>;
const lines: string[] = [];
let stop = false;
const log = (s: string) => { console.log(s); lines.push(s); };
/** Put hand-written CSS where the engine would: before the last </style> of the page, or at the end of the linked stylesheet when there is one. No element is added. */
const withCss = (inp: ReturnType<typeof realInput>, css: string): Files => {
  const comp = Object.keys(inp.companions)[0];
  if (comp) return { ...filesOf(inp), [comp]: `${inp.companions[comp]}\n${css}` };
  const k = inp.source.lastIndexOf('</style>'); if (k < 0) throw new Error('no </style>');
  return { ...filesOf(inp), [inp.file]: `${inp.source.slice(0, k)}${css}${inp.source.slice(k)}` };
};

/** (A) the reference export of one spec: for every test width one `@media (width: Npx)` rule with the stated (or scaled) value; nothing for `original`. */
async function reference(spec: RealSpec): Promise<Files> {
  const inp = realInput(spec.fixture);
  const e = spec.expect;
  const dir = join(TMP, 'ref', spec.id); writeSet(dir, filesOf(inp));
  let css = '';
  for (const m of e.measured as { sel: string; prop: string; scaled?: number; desktop?: string; tablet?: string; phone?: string }[]) {
    for (const w of testWidths(inp, (e.extraWidths ?? []) as number[])) {
      const orig = (await loadAt(browser, dir, inp.file, w, { header: '', measured: [{ selector: m.sel, prop: m.prop }] }, false)).info.measured[0] as string;
      const want = m[regionOf(inp, w)];
      const val = m.scaled !== undefined ? `${+(parseFloat(orig) * m.scaled).toFixed(4)}px` : want === 'original' ? null : want;
      if (val) css += `@media (width: ${w}px) { ${m.sel} { ${m.prop}: ${val} !important; } }\n`;
    }
  }
  // V14 is a hand-written Tablet rule with the exact conditions the engine writes (the text check FT reads it)
  if (e.fracWidths) css = `@media (min-width: 768px) and (max-width: 991.98px) { #contact { background-color: #f1c40f !important; } }\n`;
  return withCss(inp, css);
}
const failing = (rows: Row[]) => rows.filter((r) => !r.pass).map((r) => r.rule);
const ENGINE_ONLY = new Set(['R', 'Q', 'F', 'U']);

log('(A) unfaulted controls: a reference export of every non-SVG spec, written from its stated truth without the engine, must PASS every check');
for (const spec of RSPECS.filter((s) => !s.fixture.endsWith('.svg'))) {
  const files = await reference(spec);
  const sp = JSON.parse(JSON.stringify(spec)) as RealSpec; delete sp.expect.undo;
  const inp = realInput(spec.fixture);
  const ex: VExtras = {};
  if (sp.steps.some((s) => s.op === 'reset')) ex.filteredRun = files;
  const rows = (await evaluateViews(browser, sp, inp, files, TMP, ex)).filter((r) => !ENGINE_ONLY.has(r.rule) || sp.steps.some((s) => s.op === 'reset'));
  if (sp.expect.fracWidths) for (const r of await checkFractional(browser, sp, inp, files, TMP)) rows.push({ id: spec.id, rule: r.rule, pass: r.pass, detail: r.detail });
  const bad = rows.filter((r) => !r.pass);
  log(`  ${spec.id} ${spec.fixture}: ${bad.length === 0 ? 'PASS' : `FAIL (${bad.map((r) => `${r.rule}: ${r.detail.slice(0, 160)}`).join(' | ')})`}  [${rows.map((r) => r.rule).join(' ')}]`);
  if (bad.length) stop = true;
}

log('(B) 6 fault switches on lee munroe: each broken export must FAIL the stated check; the matching good export must PASS');
const L = realInput('leemunroe-email.html');
const BLUE = 'rgb(41, 128, 185)', RED = 'rgb(192, 57, 43)';
const T4 = 'a[target="_blank"]';
const spec = (id: string) => RSPECS.find((s) => s.id === id)!;
const adhoc = (id: string, steps: RealSpec['steps'], measured: unknown[]): RealSpec => ({ id, title: id, fixture: L.file, steps, expect: { outcome: 'PASS', extraWidths: [800], measured, legit: 'descendants' } as RealSpec['expect'] });
interface Case { name: string; spec: RealSpec; css: string; mustFail: string[]; extras?: VExtras; }
const cases: Case[] = [
  { name: 'good V06 (Phone custom colour inside max-width 640)', spec: spec('V06'), css: `@media (max-width: 640px) { ${T4} { color: #2980b9 !important; } }\n`, mustFail: [] },
  { name: 'fault 1: Phone edit that also changes a width above B (max-width 700 instead of 640)', spec: spec('V06'), css: `@media (max-width: 700px) { ${T4} { color: #2980b9 !important; } }\n`, mustFail: ['M'] },
  { name: 'good Phone custom then Desktop colour (Phone rule re-emitted after the Desktop rule)', spec: adhoc('C2', [{ op: 'set', target: T4, properties: { color: '#2980b9' }, environment: 'phone' }, { op: 'set', target: T4, properties: { color: '#c0392b' } }], [{ sel: T4, prop: 'color', desktop: RED, tablet: RED, phone: BLUE }]), css: `${T4} { color: #c0392b !important; }\n@media (max-width: 640px) { ${T4} { color: #2980b9 !important; } }\n`, mustFail: [] },
  { name: 'fault 2: a Desktop edit that overwrites the custom view (no re-emitted Phone rule)', spec: adhoc('C2', [{ op: 'set', target: T4, properties: { color: '#2980b9' }, environment: 'phone' }, { op: 'set', target: T4, properties: { color: '#c0392b' } }], [{ sel: T4, prop: 'color', desktop: RED, tablet: RED, phone: BLUE }]), css: `${T4} { color: #c0392b !important; }\n`, mustFail: ['M'] },
  { name: 'good Reset (no rule left)', spec: adhoc('C3', [{ op: 'set', target: T4, properties: { color: '#2980b9' }, environment: 'phone' }, { op: 'reset', env: 'phone' } as never], [{ sel: T4, prop: 'color', desktop: 'original', tablet: 'original', phone: 'original' }]), css: '', mustFail: [], extras: { filteredRun: filesOf(L) } },
  { name: 'fault 3: Reset that leaves the Phone rule behind', spec: adhoc('C3', [{ op: 'set', target: T4, properties: { color: '#2980b9' }, environment: 'phone' }, { op: 'reset', env: 'phone' } as never], [{ sel: T4, prop: 'color', desktop: 'original', tablet: 'original', phone: 'original' }]), css: `@media (max-width: 640px) { ${T4} { color: #2980b9 !important; } }\n`, mustFail: ['M', 'R'], extras: { filteredRun: filesOf(L) } },
  { name: 'fault 4: a collateral change on an unedited element (the first paragraph turns blue)', spec: spec('V06'), css: `@media (max-width: 640px) { ${T4} { color: #2980b9 !important; } }\ntd.wrapper > p:nth-of-type(1) { color: #123456; }\n`, mustFail: ['C'] },
  { name: 'good V09 (Tablet custom background inside 641 to 1024)', spec: spec('V09'), css: `@media (min-width: 641px) and (max-width: 1024px) { table.body { background-color: #f1c40f !important; } }\n`, mustFail: [] },
  { name: 'fault 5: a Tablet edit that reaches Phone widths (max-width 1024 only)', spec: spec('V09'), css: `@media (max-width: 1024px) { table.body { background-color: #f1c40f !important; } }\n`, mustFail: ['M'] },
];
for (const c of cases) {
  const files = c.css ? withCss(L, c.css) : filesOf(L);
  const rows = await evaluateViews(browser, c.spec, L, files, TMP, c.extras ?? {});
  const got = failing(rows);
  const ok = c.mustFail.length === 0 ? got.length === 0 : c.mustFail.every((r) => got.includes(r));
  log(`  ${ok ? 'OK  ' : 'BAD '} ${c.name}: ${got.length ? `fails ${[...new Set(got)].join(', ')}` : 'passes every check'}${c.mustFail.length ? ` (must fail ${c.mustFail.join(' and ')})` : ' (must pass)'}`);
  if (!ok) stop = true;
}
{
  const good = roundTripRow(L, filesOf(L));
  const bad = roundTripRow(L, { ...filesOf(L), [L.file]: `${L.source} ` });
  const ok = good.pass && !bad.pass;
  log(`  ${ok ? 'OK  ' : 'BAD '} fault 6: a no-op round trip that changes one byte: unchanged export ${good.pass ? 'passes' : 'FAILS'}; one extra space at the end ${bad.pass ? 'PASSES' : 'fails'} (${bad.detail})`);
  if (!ok) stop = true;
}
await browser.close();
log(stop ? 'SCORER CHECK FAILED: a control did not behave; the round STOPS.' : 'SCORER CHECK PASSED: every unfaulted control passes and each of the 6 faults fails the check named.');
writeFileSync(join(ROOT, 'views-check/results/realpage-scorer-check.txt'), lines.join('\n') + '\n');
process.exit(stop ? 1 : 0);
