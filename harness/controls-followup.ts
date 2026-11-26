// Scorer-check controls for the small-views follow-up (Step 1 of its brief), run BEFORE any engine change: 6 injected faults, each a hand-built export given to
// the same scorer as the engine's.   VIEWS_SET=followup npx tsx harness/controls-followup.ts   (writes views-check/results/followup-scorer-check.txt)
export {};
process.env.VIEWS_SET = 'followup';
const { chromium } = await import('playwright');
const { mkdirSync, rmSync, writeFileSync } = await import('node:fs');
const { join } = await import('node:path');
const { ROOT } = await import('./fixtures');
const { VSPECS, filesOf, viewsInput } = await import('./views-lib');
const { evaluateViews } = await import('./views-check');
const TMP = join(ROOT, 'views-check/tmp/followup-controls');
rmSync(TMP, { recursive: true, force: true }); mkdirSync(TMP, { recursive: true }); mkdirSync(join(ROOT, 'views-check/results'), { recursive: true });
const browser = await chromium.launch({ headless: true });
const spec = (id: string) => VSPECS.find((s) => s.id === id)!;
type Files = Record<string, string>;
const css = (file: string, add: string): Files => { const i = viewsInput(file); return { [i.file]: i.source.replace('  </style>', `${add}  </style>`) }; };
const RED = '    #title { color: #aa0000; }\n';
const PH = (v: string, imp = '') => `    @media (max-width: 640px) { #title { color: ${v}${imp}; } }\n`;
const TB = (v: string) => `    @media (min-width: 641px) and (max-width: 1024px) { #title { color: ${v}; } }\n`;
const FS = (min: string, max: string) => `    @media (min-width: ${min}px) and (max-width: ${max}px) { #title { font-size: 36px; } }\n`;
interface Case { name: string; id: string; files: () => Files; mustFail: string[]; extras?: Parameters<typeof evaluateViews>[5] }
const n06 = css('colours.html', RED);
const cases: Case[] = [
  { name: 'good N01 (Desktop red after a Phone custom green: the phone rule is written again with !important after the Desktop rule)', id: 'N01', files: () => css('colours.html', `${PH('#008000')}${RED}${PH('#008000', ' !important')}`), mustFail: [] },
  { name: '(1) a Desktop non-ratio edit that overwrites a custom view\'s value', id: 'N01', files: () => css('colours.html', `${PH('#008000')}    #title { color: #aa0000 !important; }\n`), mustFail: ['M'] },
  { name: 'good N02 (Desktop red after a Tablet custom green)', id: 'N02', files: () => css('colours.html', `${TB('#008000')}${RED}${TB('#008000').replace('; }', ' !important; }')}`), mustFail: [] },
  { name: '(2) a Desktop non-ratio edit that does not reach an uncustomised view (Phone stays navy)', id: 'N02', files: () => css('colours.html', `${TB('#008000')}    @media (min-width: 1025px) { #title { color: #aa0000; } }\n`), mustFail: ['M'] },
  { name: '(3) the pinned rule re-emitted without its media condition (it leaks to every view)', id: 'N01', files: () => css('colours.html', `${PH('#008000')}${RED}    #title { color: #008000 !important; }\n`), mustFail: ['M'] },
  { name: 'good N06 (Reset Tablet after a later Desktop colour: the Desktop edit stays)', id: 'N06', files: () => n06, mustFail: [], extras: { equalsRun: n06, filteredRun: n06 } },
  { name: '(4) a Reset that leaves the view\'s rule behind (inert here: the Desktop rule comes later, so only the byte checks can see it)', id: 'N06', files: () => css('colours.html', `${TB('#008000')}${RED}`), mustFail: ['Q', 'R'], extras: { equalsRun: n06, filteredRun: n06 } },
  { name: 'good N13 (custom Tablet font-size 36 from 576 to 991.98)', id: 'N13', files: () => css('bootstrap.html', FS('576', '991.98')), mustFail: [] },
  { name: '(5) the tablet upper bound off by one at T = 991.98 (992.98)', id: 'N13', files: () => css('bootstrap.html', FS('576', '992.98')), mustFail: ['M'] },
  { name: '(6) the fractional breakpoint rounded wrongly (the Tablet range starts at 575, not 576)', id: 'N13', files: () => css('bootstrap.html', FS('575', '991.98')), mustFail: ['M'] },
];
const lines: string[] = ['Scorer check for docs/small-views-followup-rules.md, run before any engine change (harness/controls-followup.ts): 6 fault switches.', 'Each export below is built by hand from the fixture and given to the same scorer that scores the engine.', ''];
let stop = false, n = 0;
for (const c of cases) {
  const s = spec(c.id);
  const rows = await evaluateViews(browser, s, viewsInput(s.fixture), c.files(), join(TMP, c.name.replace(/\W+/g, '_').slice(0, 40)), c.extras ?? {});
  const failing = rows.filter((r) => !r.pass).map((r) => r.rule);
  const ok = c.mustFail.length === 0 ? failing.length === 0 : c.mustFail.every((w) => failing.includes(w));
  if (!ok) stop = true; n++;
  lines.push(`${ok ? 'OK  ' : 'MISS'} [${c.id}] ${c.name}: ${c.mustFail.length ? `must fail ${c.mustFail.join(' and ')}` : 'must pass every check'}; failing checks: ${failing.join(', ') || 'none'}`);
  for (const r of rows.filter((x) => !x.pass).slice(0, 2)) lines.push(`       ${r.rule}: ${r.detail.slice(0, 150)}`);
}
lines.push('', stop ? 'RESULT: a control did not fail where it should: STOP and report to Max before building.' : `RESULT: all ${n} controls behaved (every good export passed, every broken export failed the stated check; 6 fault switches).`);
writeFileSync(join(ROOT, 'views-check/results/followup-scorer-check.txt'), lines.join('\n') + '\n');
console.log(lines.join('\n'));
void filesOf;
await browser.close();
process.exit(stop ? 2 : 0);
