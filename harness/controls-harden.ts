// Scorer-check controls for the hardening harness (Step 1 of the brief), run BEFORE any engine change. The engine cannot yet produce the
// correct exports for H1, H2 or H3, so each control builds the export by hand from the fixture with plain string operations (a reference
// "good" export and deliberately broken variants) and runs the very same scorer on it. The good one must PASS every check; each broken
// one must FAIL the stated check.   npx tsx harness/controls-harden.ts   (writes harden-check/results/scorer-check.txt)
import { chromium } from 'playwright';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './fixtures';
import { HEADER, evaluateExport, type Row } from './insert-lib';
import { HSPECS, filesOf, hardenInput, hardenRows } from './harden-lib';

const TMP = join(ROOT, 'harden-check/tmp/controls');
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
const browser = await chromium.launch({ headless: true });
type Files = Record<string, string>;
const must = (t: string, n: string): string => { if (t.split(n).length !== 2) throw new Error(`control builder: ${JSON.stringify(n.slice(0, 50))} not unique`); return n; };
const rep = (t: string, from: string, to: string) => t.replace(must(t, from), () => to);
const H = (eol: string) => `<!-- ${HEADER} -->${eol}`;
const BOXR = '.new-box-1 { box-sizing: border-box; width: 200px; max-width: 100%; height: 120px; background: #d9d9d9; border: 1px solid #999999; }';
const TEXTR = '.new-text-1 { max-width: 100%; overflow-wrap: break-word; }';

interface Case { name: string; spec: string; files: () => Files; mustFail: string[]; unlinked?: { selector: string; property: string; environment: string; value: string }[] }
const spec = (id: string) => HSPECS.find((s) => s.id === id)!;

// H01 (pins.html): reorder #t3 first, pinned phone value kept
const pins = hardenInput('pins.html');
const goodH01 = (): Files => {
  let h = pins.source;
  h = rep(h, '    <p class="t" id="t3">Three</p>\n', '');
  h = rep(h, '    <p class="t" id="t1">One</p>\n', '    <p class="t" id="t3">Three</p>\n    <p class="t" id="t1">One</p>\n');
  h = rep(h, '  </style>\n', '    @media (max-width: 640px) { #t3 { font-size: 20px; } }\n    #t3 { font-size: 40px; }\n    @media (max-width: 640px) { #t3 { font-size: 20px; } }\n  </style>\n');
  return { 'pins.html': h };
};
const pinOk = [{ selector: '/html[1]/body[1]/div[1]/p[1]', property: 'font-size', environment: 'phone', value: '20px' }];
const pinStale = [{ selector: '/html[1]/body[1]/div[1]/p[3]', property: 'font-size', environment: 'phone', value: '20px' }];

// H07 (landing, LF): the original, or the original with a leftover scoped rule
const land = hardenInput('landing.html');
// H11 (collision)
const coll = hardenInput('collision.html');
// H12 (crlf landing)
const cl = hardenInput('crlf/landing.html');
const E = '\r\n';
const goodH12 = (): Files => {
  let h = cl.source;
  h = rep(h, `<!DOCTYPE html>${E}`, `<!DOCTYPE html>${E}${H(E)}<!-- NOTE FOR AI (whole page): Whole page -->${E}`);
  h = rep(h, `        <h1 id="headline">Calm software for busy teams</h1>${E}`, `        <!-- NOTE FOR AI: Line one${E}Line two -->${E}        <h1 id="headline">Calm software for busy teams</h1>${E}`);
  h = rep(h, `        <p class="lead">Fernhill Studio designs small, reliable tools that stay out of your way.</p>${E}`, `        <p class="lead">Fernhill Studio designs small, reliable tools that stay out of your way.</p>${E}        <div class="new-box-1"></div>${E}`);
  return { 'landing.html': h, 'landing.css': cl.companions['landing.css']! + BOXR + E };
};
// H15 (mixed)
const mx = hardenInput('mixed.html');
const goodH15 = (): Files => {
  let h = mx.source;
  h = rep(h, '<!DOCTYPE html>\n', `<!DOCTYPE html>\n${H('\n')}`);
  h = rep(h, '</style>\n', `${BOXR}\n${TEXTR}\n</style>\n`);
  h = rep(h, '<p id="first">First (LF zone)</p>\n', '<p id="first">First (LF zone)</p>\n<div class="new-box-1"></div>\n');
  h = rep(h, '<p id="last">Last (CRLF zone)</p>\r\n', '<!-- NOTE FOR AI: Zone note -->\r\n<p id="last">Last (CRLF zone)</p>\r\n<p class="new-text-1">Text</p>\r\n');
  return { 'mixed.html': h };
};
// H18 (neighbours, oracle)
const nb = hardenInput('neighbours.html');
const goodH18 = (): Files => {
  let h = nb.source;
  h = rep(h, '  </style>\n', `    ${TEXTR}\n  </style>\n`);
  h = rep(h, '  <h2 id="h">Heading</h2>\n', '  <h2 id="h">Heading</h2>\n  <p class="new-text-1">Text</p>\n');
  return { 'neighbours.html': h };
};

const cases: Case[] = [
  { name: 'good H01 (reference export: the pin followed its element)', spec: 'H01', files: goodH01, mustFail: [], unlinked: pinOk },
  { name: 'a pin not remapped after a reorder: the later linked edit scaled it (phone value 50px)', spec: 'H01', files: () => { const g = goodH01(); return { 'pins.html': g['pins.html']!.replace(/#t3 \{ font-size: 20px; \}/g, '#t3 { font-size: 50px; }') }; }, mustFail: ['M'], unlinked: pinOk },
  { name: 'a pin not remapped after a reorder: listUnlinked still names the old path', spec: 'H01', files: goodH01, mustFail: ['U'], unlinked: pinStale },
  { name: 'good H07 (the original bytes)', spec: 'H07', files: () => ({ ...filesOf(land) }), mustFail: [] },
  { name: 'a leftover scoped rule after insert, set and remove (companion CSS)', spec: 'H07', files: () => ({ ...filesOf(land), 'landing.css': land.companions['landing.css']! + '[data-ue="1"] { width: 300px; }\n' }), mustFail: ['BH'] },
  { name: 'a leftover own rule after insert and remove (companion CSS)', spec: 'H07', files: () => ({ ...filesOf(land), 'landing.css': land.companions['landing.css']! + BOXR + '\n' }), mustFail: ['BH'] },
  { name: 'good H08 (the original bytes)', spec: 'H08', files: () => filesOf(hardenInput('style-only.html')), mustFail: [] },
  { name: 'a leftover scoped rule in the page\'s style block', spec: 'H08', files: () => { const o = hardenInput('style-only.html'); return { 'style-only.html': rep(o.source, '  </style>\n', '    @media (max-width: 640px) { [data-ue="1"] { width: 200px; } }\n  </style>\n') }; }, mustFail: ['BH'] },
  { name: 'good H11 (the page rule stays)', spec: 'H11', files: () => ({ 'collision.html': rep(coll.source, '  <div id="existing" class="new-box-1"></div>\n', '') }), mustFail: [] },
  { name: 'a deleted page-authored rule (.new-box-1 written by the page)', spec: 'H11', files: () => ({ 'collision.html': rep(rep(coll.source, '  <div id="existing" class="new-box-1"></div>\n', ''), '    .new-box-1 { width: 40px; height: 40px; background: #cc3333; }\n', '') }), mustFail: ['BH'] },
  { name: 'good H12 (reference export, every added break CRLF)', spec: 'H12', files: goodH12, mustFail: [] },
  { name: 'a lone LF added to a CRLF file (the header written with LF)', spec: 'H12', files: () => { const g = goodH12(); return { ...g, 'landing.html': rep(g['landing.html']!, `${H(E)}`, `${H('\n')}`) }; }, mustFail: ['EOL'] },
  { name: 'a lone LF added to a CRLF file (the appended rule written with LF)', spec: 'H12', files: () => { const g = goodH12(); return { ...g, 'landing.css': g['landing.css']!.slice(0, -2) + '\n' }; }, mustFail: ['EOL'] },
  { name: 'a lone LF inside a note with a typed line break in a CRLF file', spec: 'H12', files: () => { const g = goodH12(); return { ...g, 'landing.html': rep(g['landing.html']!, `Line one${E}Line two`, 'Line one\nLine two') }; }, mustFail: ['EOL'] },
  { name: 'good H15 (reference export, each added break follows the nearest one)', spec: 'H15', files: goodH15, mustFail: [] },
  { name: 'a CRLF added to an LF file (the header in the LF zone written with CRLF)', spec: 'H15', files: () => { const g = goodH15(); return { 'mixed.html': rep(g['mixed.html']!, H('\n'), H('\r\n')) }; }, mustFail: ['EOL'] },
  { name: 'a mixed file normalised to LF', spec: 'H15', files: () => ({ 'mixed.html': goodH15()['mixed.html']!.replace(/\r\n/g, '\n') }), mustFail: ['BH', 'EOL'] },
  { name: 'a mixed file normalised to CRLF', spec: 'H15', files: () => ({ 'mixed.html': goodH15()['mixed.html']!.replace(/\r?\n/g, '\r\n') }), mustFail: ['BH', 'EOL'] },
  { name: 'good H18 (reference export, the oracle agrees)', spec: 'H18', files: goodH18, mustFail: [] },
  { name: 'the H4 oracle given a wrong neighbour style (the next paragraph recoloured)', spec: 'H18', files: () => { const g = goodH18(); return { 'neighbours.html': rep(g['neighbours.html']!, '  </style>\n', '    #p1 { color: #123456; }\n  </style>\n') }; }, mustFail: ['ORC'] },
];

const lines: string[] = ['Scorer check for docs/hardening-rules.md, run before any engine change (harness/controls-harden.ts).',
  'The engine cannot yet produce correct exports for the H1, H2 and H3 cases, so each export below is built by hand from the fixture (plain string operations) and given to the same scorer that scores the engine.', ''];
let stop = false;
let n = 0;
for (const c of cases) {
  const s = spec(c.spec);
  const inp = hardenInput(s.fixture);
  const files = c.files();
  const dir = join(TMP, c.name.replace(/\W+/g, '_').slice(0, 40));
  const base: Row[] = await evaluateExport(browser, s, inp, files, dir, { unlinked: c.unlinked ?? null });
  const more: Row[] = await hardenRows(browser, s, inp, files, dir, {});
  const rows = [...base, ...more].filter((r) => !(r.rule === 'U' && c.unlinked === undefined));
  const failing = rows.filter((r) => !r.pass).map((r) => r.rule);
  const ok = c.mustFail.length === 0 ? failing.length === 0 : c.mustFail.every((w) => failing.includes(w));
  if (!ok) stop = true;
  n++;
  lines.push(`${ok ? 'OK  ' : 'MISS'} [${c.spec}] ${c.name}: ${c.mustFail.length === 0 ? 'must pass every check' : `must fail ${c.mustFail.join(' and ')}`}; failing checks: ${failing.join(', ') || 'none'}`);
  for (const r of rows.filter((x) => !x.pass).slice(0, 2)) lines.push(`       ${r.rule}: ${r.detail.slice(0, 160)}`);
}
lines.push('', stop ? 'RESULT: a control did not fail where it should: STOP and report to Max before building.' : `RESULT: all ${n} controls behaved (every good export passed, every broken export failed the stated check).`);
writeFileSync(join(ROOT, 'harden-check/results/scorer-check.txt'), lines.join('\n') + '\n');
console.log(lines.join('\n'));
await browser.close();
process.exit(stop ? 2 : 0);
