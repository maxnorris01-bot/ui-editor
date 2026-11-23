// Scorer-check controls for the insert-and-comments harness (Step 1 of the brief), run BEFORE any engine change.
// The engine cannot produce exports yet, so each control builds the export by hand from the fixture with plain string
// operations (a reference "good" export and deliberately broken variants), then runs the very same scorer
// (evaluateExport) on it. The good one must PASS every check; each broken one must FAIL the stated check.
//   npx tsx harness/controls-insert.ts       (writes insert-check/results/scorer-check.txt)
import { chromium } from 'playwright';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './fixtures';
import { HEADER, SPECS, evaluateExport, fixtureInput, originalFiles, strip, type Row } from './insert-lib';

const TMP = join(ROOT, 'insert-check/tmp/controls');
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
const browser = await chromium.launch({ headless: true });
const spec = (id: string) => SPECS.find((s) => s.id === id)!;
type Files = Record<string, string>;
const must = (t: string, needle: string): string => { if (t.split(needle).length !== 2) throw new Error(`control builder: ${JSON.stringify(needle.slice(0, 50))} not unique`); return needle; };
const after = (t: string, line: string, add: string) => t.replace(must(t, line), () => `${line}${add}`);
const before = (t: string, line: string, add: string) => t.replace(must(t, line), () => `${add}${line}`);
const HDR = `<!-- ${HEADER} -->\n`;
const withHeader = (t: string) => t.replace('<!DOCTYPE html>\n', () => `<!DOCTYPE html>\n${HDR}`);
// the neutralising rule applied by the control builder (a reference for the scorer check only; the verdict never uses it)
const neutral = (s: string) => s.replace(/-{2,}/g, (m) => m.split('').join(' '));
const escapeText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const LEAD = '        <p class="lead">Fernhill Studio designs small, reliable tools that stay out of your way.</p>\n';
const TEXT_RULE = '.new-text-1 { max-width: 100%; overflow-wrap: break-word; }\n';
const BOX_RULE = '.new-box-1 { box-sizing: border-box; width: 200px; max-width: 100%; height: 120px; background: #d9d9d9; border: 1px solid #999999; }\n';
const HEADLINE = '        <h1 id="headline">Calm software for busy teams</h1>\n';
const CTA = '        <a class="cta" id="cta" href="#plans">See what we build</a>\n';

interface Case { name: string; spec: string; files: (o: Files) => Files; mustFail: string[]; extras?: object }
const L = fixtureInput('landing.html');
const O = originalFiles(L);
const landing = (h: string, c = O['landing.css']!): Files => ({ 'landing.html': h, 'landing.css': c });

const goodI01 = (): Files => landing(after(O['landing.html']!, LEAD, '        <p class="new-text-1">Text</p>\n'), O['landing.css']! + TEXT_RULE);
const goodI03 = (): Files => landing(after(O['landing.html']!, '      <div class="hero-copy">\n', '        <div class="new-box-1"></div>\n'), O['landing.css']! + BOX_RULE.replace('border: 1px solid #999999;', 'border: 1px solid #999999; border-radius: 12px;'));
const goodI05 = (): Files => landing(after(O['landing.html']!, CTA, '        <button type="button" class="new-button-1">Button</button>\n'), O['landing.css']! + '.new-button-1 { box-sizing: border-box; max-width: 100%; padding: 8px 16px; font: inherit; cursor: pointer; }\n');
const goodI25 = (): Files => landing(before(withHeader(O['landing.html']!), HEADLINE, '        <!-- NOTE FOR AI: Make this headline shorter and friendlier. -->\n'));
const NOTE_CTA = '        <!-- NOTE FOR AI: Link this button to the pricing page. -->\n';
const goodI26 = (): Files => landing(before(goodI25()['landing.html']!, CTA, NOTE_CTA));
const cardBuild = ['      <article class="card" id="card-build">', '        <h3>Build</h3>', '        <p>Keep every change small, reviewed and easy to undo.</p>', '      </article>'].join('\n') + '\n';
const PLAN = '      <article class="card" id="card-plan">\n';
const NOTE_BUILD = '      <!-- NOTE FOR AI: This card will become a pricing card. -->\n';
const goodI30 = (): Files => { let h = withHeader(O['landing.html']!).replace(cardBuild, ''); h = before(h, PLAN, NOTE_BUILD + cardBuild); return landing(h); };

const H = SPECS.find((s) => s.id === 'I31')!.steps;
const hostileBase = fixtureInput('hostile.html');
const goodI31 = (): Files => {
  let h = withHeader(hostileBase.source);
  for (const [i, s] of H.entries()) { const t = typeof s.text === 'string' ? s.text : s.text!.repeat.repeat(s.text!.times); h = h.replace(`  <p id="h${i + 1}">`, () => `  <!-- NOTE FOR AI: ${neutral(t)} -->\n  <p id="h${i + 1}">`); }
  return { 'hostile.html': h };
};
const goodI19 = (): Files => {
  let h = hostileBase.source;
  for (const [i, s] of spec('I19').steps.entries()) { const t = typeof s.text === 'string' ? s.text : s.text!.repeat.repeat(s.text!.times); h = h.replace(`<p id="h${i + 1}">Placeholder ${i + 1}</p>`, () => `<p id="h${i + 1}">${escapeText(t)}</p>`); }
  return { 'hostile.html': h };
};

const cases: Case[] = [
  // I01: insert a text paragraph after the lead; rule in the companion CSS
  { name: 'good I01 (reference export)', spec: 'I01', files: goodI01, mustFail: [] },
  { name: 'insert at the wrong position (after the CTA link instead of after the lead)', spec: 'I01', files: () => landing(after(O['landing.html']!, CTA, '        <p class="new-text-1">Text</p>\n'), O['landing.css']! + TEXT_RULE), mustFail: ['A'] },
  { name: 'rule written inline although a companion CSS exists', spec: 'I01', files: () => landing(after(O['landing.html']!, LEAD, '        <p class="new-text-1" style="max-width: 100%; overflow-wrap: break-word;">Text</p>\n')), mustFail: ['P1'] },
  { name: 'an extra space on a line outside the change', spec: 'I01', files: () => { const g = goodI01(); return { ...g, 'landing.html': g['landing.html']!.replace('<title>Fernhill Studio</title>', '<title>Fernhill Studio </title>') }; }, mustFail: ['B'] },
  { name: 'a changed (re-indented) neighbouring line', spec: 'I01', files: () => { const g = goodI01(); return { ...g, 'landing.html': g['landing.html']!.replace('        <h1 id="headline">', '          <h1 id="headline">') }; }, mustFail: ['B'] },
  // I03 and the 390 px overflow
  { name: 'good I03 (reference export)', spec: 'I03', files: goodI03, mustFail: [] },
  { name: 'an insert that overflows the 390 px phone (800px wide, no max-width)', spec: 'I03', files: () => { const g = goodI03(); return { ...g, 'landing.css': g['landing.css']!.replace('width: 200px; max-width: 100%;', 'width: 800px;') }; }, mustFail: ['C'] },
  // I05 button
  { name: 'good I05 (reference export)', spec: 'I05', files: goodI05, mustFail: [] },
  { name: 'a button without type="button"', spec: 'I05', files: () => { const g = goodI05(); return { ...g, 'landing.html': g['landing.html']!.replace(' type="button"', '') }; }, mustFail: ['A'] },
  // I22 remove leaves its rule behind
  { name: 'good I22 (the original bytes)', spec: 'I22', files: () => ({ ...O }), mustFail: [] },
  { name: 'a remove that leaves its rule behind', spec: 'I22', files: () => landing(O['landing.html']!, O['landing.css']! + BOX_RULE), mustFail: ['B'] },
  // notes
  { name: 'good I25 (reference export)', spec: 'I25', files: goodI25, mustFail: [] },
  { name: 'a missing header (note without header)', spec: 'I25', files: () => landing(before(O['landing.html']!, HEADLINE, '        <!-- NOTE FOR AI: Make this headline shorter and friendlier. -->\n')), mustFail: ['E'] },
  { name: 'a header with the wrong text position (after <html>, not after the DOCTYPE)', spec: 'I25', files: () => landing(before(O['landing.html']!.replace('<html lang="en">\n', () => `<html lang="en">\n${HDR}`), HEADLINE, '        <!-- NOTE FOR AI: Make this headline shorter and friendlier. -->\n')), mustFail: ['E'] },
  { name: 'good I26 (reference export)', spec: 'I26', files: goodI26, mustFail: [] },
  { name: 'a duplicated header', spec: 'I26', files: () => { const g = goodI26(); return { ...g, 'landing.html': g['landing.html']!.replace(HDR, HDR + HDR) }; }, mustFail: ['E'] },
  { name: 'good I30 (reference export, the note moved with its card)', spec: 'I30', files: goodI30, mustFail: [] },
  { name: 'a note not moved by a reorder (it stays where the card was)', spec: 'I30', files: () => { let h = withHeader(O['landing.html']!).replace(cardBuild, ''); h = before(h, PLAN, cardBuild); h = h.replace(`      </article>\n    </section>`, () => `      </article>\n    </section>`); h = after(h, '      <article class="card" id="card-plan">\n        <h3>Plan</h3>\n        <p>Sketch the work on a shared board that never gets noisy.</p>\n      </article>\n', NOTE_BUILD); return landing(h); }, mustFail: ['E'] },
  // hostile
  { name: 'good I31 (reference export, every note neutralised)', spec: 'I31', files: goodI31, mustFail: [] },
  { name: '"-->" left un-neutralised in a comment', spec: 'I31', files: () => { const g = goodI31(); return { 'hostile.html': g['hostile.html']!.replace('<!-- NOTE FOR AI: - -> -->', '<!-- NOTE FOR AI: --> -->') }; }, mustFail: ['E', 'B'] },
  { name: 'good I19 (reference export, every text escaped)', spec: 'I19', files: goodI19, mustFail: [] },
  { name: 'an unescaped <script> in edited text', spec: 'I19', files: () => { const g = goodI19(); return { 'hostile.html': g['hostile.html']!.replace('&lt;script&gt;alert(1)&lt;/script&gt;', '<script>alert(1)</script>') }; }, mustFail: ['A', 'D'] },
];

const lines: string[] = ['Scorer check for docs/insert-comments-rules.md, run before any engine change (harness/controls-insert.ts).',
  'No engine output exists yet, so each export below is built by hand from the fixture (plain string operations) and given to the same scorer (evaluateExport) that scores the engine.', ''];
let stop = false;
const results: { name: string; ok: boolean }[] = [];
for (const c of cases) {
  const s = spec(c.spec);
  const rows: Row[] = await evaluateExport(browser, s, fixtureInput(s.fixture), c.files(O), join(TMP, c.name.replace(/\W+/g, '_').slice(0, 40)), {});
  const failing = rows.filter((r) => !r.pass).map((r) => r.rule);
  const want = c.mustFail;
  const ok = want.length === 0 ? failing.length === 0 : want.every((w) => failing.includes(w));
  results.push({ name: c.name, ok });
  if (!ok) stop = true;
  lines.push(`${ok ? 'OK  ' : 'MISS'} [${c.spec}] ${c.name}: ${want.length === 0 ? 'must pass every check' : `must fail ${want.join(' and ')}`}; failing checks: ${failing.join(', ') || 'none'}`);
  for (const r of rows.filter((x) => !x.pass).slice(0, 2)) lines.push(`       ${r.rule}: ${r.detail.slice(0, 150)}`);
}
// undo and notes-off comparison logic, checked directly (their inputs are engine runs, so the controls feed them hand-made runs)
import { undoProblems } from './insert-lib';
const full = [{ 'a.html': 'one' }, { 'a.html': 'one two' }, { 'a.html': 'one two three' }];
const goodReplays = [{ 'a.html': 'one' }, { 'a.html': 'one two' }];
const badReplays = [{ 'a.html': 'one' }, { 'a.html': 'one tw0' }];
const u1 = undoProblems(full, goodReplays).length === 0, u2 = undoProblems(full, badReplays).length > 0;
lines.push(`${u1 ? 'OK  ' : 'MISS'} an undo by replay that is exact passes`, `${u2 ? 'OK  ' : 'MISS'} an undo that is one byte off fails (F2)`);
if (!u1 || !u2) stop = true;
const sx = strip('<!DOCTYPE html>\n' + HDR + '<p>x</p>\n', []).text === '<!DOCTYPE html>\n<p>x</p>\n';
lines.push(`${sx ? 'OK  ' : 'MISS'} stripping the header from a file restores the plain file (notes-off comparison input)`);
if (!sx) stop = true;
lines.push('', stop ? 'RESULT: a control did not fail where it should: STOP and report to Max before building.' : `RESULT: all ${results.length + 3} controls behaved (every good export passed, every broken export failed the stated check).`);
writeFileSync(join(ROOT, 'insert-check/results/scorer-check.txt'), lines.join('\n') + '\n');
console.log(lines.join('\n'));
await browser.close();
process.exit(stop ? 2 : 0);
