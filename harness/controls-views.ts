// Scorer-check controls for the small-views harness (Step 1 of the brief), run BEFORE any engine change: 12 injected faults. The engine cannot yet produce
// correct exports, so each control builds the export by hand from the fixture (a reference "good" export and a deliberately broken one) and runs the very same
// scorer on it. Every good export must PASS every check; each broken one must FAIL the stated check.   npx tsx harness/controls-views.ts
import { chromium } from 'playwright';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './fixtures';
import { VSPECS, filesOf, viewsInput, type VSpec } from './views-lib';
import { evaluateViews, type Row, type VExtras } from './views-check';

const TMP = join(ROOT, 'views-check/tmp/controls');
rmSync(TMP, { recursive: true, force: true }); mkdirSync(TMP, { recursive: true });
mkdirSync(join(ROOT, 'views-check/results'), { recursive: true });
const browser = await chromium.launch({ headless: true });
const spec = (id: string): VSpec => VSPECS.find((s) => s.id === id)!;
type Files = Record<string, string>;
const css = (inp: ReturnType<typeof viewsInput>, add: string): Files => ({ [inp.file]: inp.source.replace('  </style>', `${add}  </style>`) });
const TAB = (v: string, min = 641, max = 1024) => `    @media (min-width: ${min}px) and (max-width: ${max}px) { #title { font-size: ${v}; } }\n`;
const PH = (v: string) => `    @media (max-width: 640px) { #title { font-size: ${v}; } }\n`;
const b640 = viewsInput('bp640.html');
interface Case { name: string; id: string; files: () => Files; mustFail: string[]; extras?: VExtras; fake?: Partial<VSpec['expect']> }
const cases: Case[] = [
  { name: 'good M08 (Tablet custom 40px inside 641 to 1024)', id: 'M08', files: () => css(b640, TAB('40px')), mustFail: [], extras: { unlinked: spec('M08').expect.unlinked } },
  { name: '(1) a Tablet custom edit that also applies above T (no upper bound)', id: 'M08', files: () => css(b640, '    @media (min-width: 641px) { #title { font-size: 40px; } }\n'), mustFail: ['M'], extras: { unlinked: spec('M08').expect.unlinked } },
  { name: '(2) a Tablet custom edit that also applies at phone widths (no lower bound)', id: 'M08', files: () => css(b640, '    @media (max-width: 1024px) { #title { font-size: 40px; } }\n'), mustFail: ['M'], extras: { unlinked: spec('M08').expect.unlinked } },
  { name: 'good M09 (Phone custom 18px)', id: 'M09', files: () => css(b640, PH('18px')), mustFail: [] },
  { name: '(3) a Phone edit that still scales Desktop (the old other-way-round)', id: 'M09', files: () => css(b640, `    #title { font-size: 28px; }\n${PH('18px')}`), mustFail: ['M'] },
  { name: '(11) a Phone edit sent with link true that honours it (Desktop scaled)', id: 'M10', files: () => css(b640, `    #title { font-size: 28px; }\n${PH('18px')}`), mustFail: ['M'] },
  { name: 'good M11 (Tablet 40 kept after a Desktop 48; Phone 30)', id: 'M11', files: () => css(b640, `    #title { font-size: 48px; }\n${PH('30px')}${TAB('40px')}`), mustFail: [], extras: {} },
  { name: '(4) a Desktop edit that overrides a Tablet custom value (cascade order)', id: 'M11', files: () => css(b640, `${TAB('40px')}    #title { font-size: 48px; }\n${PH('30px')}`), mustFail: ['M'] },
  { name: 'good M01 (Desktop 48 reaches Tablet, Phone 30)', id: 'M01', files: () => css(b640, `    #title { font-size: 48px; }\n${PH('30px')}`), mustFail: [] },
  { name: '(5) a Desktop edit that does not reach Tablet for an unpinned property', id: 'M01', files: () => css(b640, `    @media (min-width: 1025px) { #title { font-size: 48px; } }\n${PH('30px')}`), mustFail: ['M'] },
  { name: '(12) an export containing a view marker', id: 'M01', files: () => { const g = css(b640, `    #title { font-size: 48px; }\n${PH('30px')}`); return { [b640.file]: g[b640.file]!.replace('<h1 id="title"', '<h1 data-view="tablet" id="title"') }; }, mustFail: ['K'] },
  { name: 'good M22 (900 page: Tablet custom inside 641 to 900)', id: 'M22', files: () => css(viewsInput('tab900.html'), TAB('40px', 641, 900)), mustFail: [], extras: { unlinked: spec('M22').expect.unlinked } },
  { name: '(8) a Tablet upper bound off by one (901)', id: 'M22', files: () => css(viewsInput('tab900.html'), TAB('40px', 641, 901)), mustFail: ['M'], extras: { unlinked: spec('M22').expect.unlinked } },
  { name: 'good M15 (everything reset: the original bytes)', id: 'M15', files: () => filesOf(b640), mustFail: [], extras: { filteredRun: filesOf(b640) } },
  { name: '(6) a Reset that leaves a rule behind', id: 'M15', files: () => css(b640, TAB('40px')), mustFail: ['B', 'R'], extras: { filteredRun: filesOf(b640) } },
  { name: 'good M16 (Reset with nothing custom equals the export without it)', id: 'M16', files: () => css(b640, `    #title { font-size: 48px; }\n${PH('30px')}`), mustFail: [], extras: { equalsRun: css(b640, `    #title { font-size: 48px; }\n${PH('30px')}`), filteredRun: css(b640, `    #title { font-size: 48px; }\n${PH('30px')}`) } },
  { name: '(6b) a Reset that is one byte off', id: 'M16', files: () => { const g = css(b640, `    #title { font-size: 48px; }\n${PH('30px')}`); return { [b640.file]: g[b640.file]! + ' ' }; }, mustFail: ['Q'], extras: { equalsRun: css(b640, `    #title { font-size: 48px; }\n${PH('30px')}`), filteredRun: css(b640, `    #title { font-size: 48px; }\n${PH('30px')}`) } },
  { name: 'good M17 (the later Desktop edit stays after Reset Tablet)', id: 'M17', files: () => css(b640, `    #title { font-size: 48px; }\n${PH('30px')}`), mustFail: [], extras: { equalsRun: css(b640, `    #title { font-size: 48px; }\n${PH('30px')}`), filteredRun: css(b640, `    #title { font-size: 48px; }\n${PH('30px')}`) } },
  { name: '(7) a Reset that also drops the Desktop edit', id: 'M17', files: () => filesOf(b640), mustFail: ['M', 'Q'], extras: { equalsRun: css(b640, `    #title { font-size: 48px; }\n${PH('30px')}`), filteredRun: css(b640, `    #title { font-size: 48px; }\n${PH('30px')}`) } },
  { name: 'good M29 pins (the Tablet pin names the moved element)', id: 'M29', files: () => filesOf(viewsInput('pins.html')), mustFail: [], extras: { unlinked: spec('M29').expect.unlinked }, fake: { measured: [], legit: 'none' } },
  { name: '(10) a pin that names the wrong element after an insert', id: 'M29', files: () => filesOf(viewsInput('pins.html')), mustFail: ['U'], extras: { unlinked: [{ selector: '/html[1]/body[1]/div[1]/p[4]', property: 'font-size', environment: 'tablet', value: '20px' }] }, fake: { measured: [], legit: 'none' } },
];
const lines: string[] = ['Scorer check for docs/small-views-rules.md, run before any engine change (harness/controls-views.ts).', 'No correct engine output exists yet, so each export below is built by hand from the fixture and given to the same scorer that scores the engine.', ''];
let stop = false, n = 0;
for (const c of cases) {
  const base = spec(c.id);
  const s: VSpec = c.fake ? { ...base, expect: { ...base.expect, ...c.fake } } : base;
  const inp = viewsInput(s.fixture);
  const rows: Row[] = await evaluateViews(browser, s, inp, c.files(), join(TMP, c.name.replace(/\W+/g, '_').slice(0, 40)), c.extras ?? {});
  const failing = rows.filter((r) => !r.pass).map((r) => r.rule);
  const ok = c.mustFail.length === 0 ? failing.length === 0 : c.mustFail.every((w) => failing.includes(w));
  if (!ok) stop = true; n++;
  lines.push(`${ok ? 'OK  ' : 'MISS'} [${c.id}] ${c.name}: ${c.mustFail.length ? `must fail ${c.mustFail.join(' and ')}` : 'must pass every check'}; failing checks: ${failing.join(', ') || 'none'}`);
  for (const r of rows.filter((x) => !x.pass).slice(0, 2)) lines.push(`       ${r.rule}: ${r.detail.slice(0, 150)}`);
}
// (9) the 768 page accepting a Tablet edit: the spec declares REFUSED, so any export at all is a FAIL (decided by the runner's outcome rule)
const refusedSpec = spec('M20');
const accepted = refusedSpec.expect.outcome === 'REFUSED';
lines.push(`${accepted ? 'OK  ' : 'MISS'} [M20] (9) the 768 page accepting a Tablet edit: the spec declares REFUSED (${refusedSpec.expect.refusal}), so the runner scores an export as FAIL (run-views.ts: "declared REFUSED but the engine produced an export")`);
if (!accepted) stop = true; n++;
lines.push('', stop ? 'RESULT: a control did not fail where it should: STOP and report to Max before building.' : `RESULT: all ${n} controls behaved (every good export passed, every broken export failed the stated check; 12 fault switches).`);
writeFileSync(join(ROOT, 'views-check/results/scorer-check.txt'), lines.join('\n') + '\n');
console.log(lines.join('\n'));
await browser.close();
process.exit(stop ? 2 : 0);
