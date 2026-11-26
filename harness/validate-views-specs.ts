// Dry-run of fixtures/views/edits.json against the fixtures, in plain Chromium with NO engine (docs/small-views-rules.md section 7). For every spec with
// measured values it appends a hand-built REFERENCE stylesheet (the expected value per region, !important) to the original page and checks that the
// browser measures exactly the expected numbers at every test width, so the numbers are measurable and independent of the engine. It also checks selectors,
// B and T of each fixture and the declared reason of the REFUSED spec.   npx tsx harness/validate-views-specs.ts
import { chromium } from 'playwright';
import { join } from 'node:path';
import { VDIR, VSPECS, regionOf, phoneMax, tabletMin, tabletTop, testWidths, viewsInput } from './views-lib';

const browser = await chromium.launch({ headless: true });
const problems: string[] = [];
const bad = (id: string, m: string) => problems.push(`${id}: ${m}`);
for (const s of VSPECS) {
  const inp = viewsInput(s.fixture);
  const B = phoneMax(inp), T = tabletTop(inp);
  const ex = s.expect;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.addInitScript('window.__name = (f) => f;');
  await ctx.route('**/*', (r) => (r.request().url().startsWith('file:') ? r.continue() : r.abort()));
  await page.goto(`file://${join(VDIR, s.fixture)}`);
  for (const st of s.steps) {
    for (const sel of [st.target, st.sibling, st.anchor].filter((x): x is string => !!x && !/\.new-/.test(x))) {
      const n = await page.evaluate((q) => document.querySelectorAll(q).length, sel);
      if (n !== 1) bad(s.id, `selector ${sel} matches ${n}`);
    }
  }
  if (ex.outcome === 'REFUSED') { if (ex.reasonCheck?.phoneBreakpoint !== B) bad(s.id, `B is ${B}, spec says ${ex.reasonCheck?.phoneBreakpoint}`); await ctx.close(); console.log(s.id, 'refused-spec ok B', B); continue; }
  if (ex.measured) {
    const tMin = tabletMin(inp);
    const ws = testWidths(inp, (ex.extraWidths ?? []) as number[]);
    const ms = ex.measured as any[];
    const at = async (q: string, p: string) => page.evaluate(([qq, pp]) => getComputedStyle(document.querySelector(qq as string)!).getPropertyValue(pp as string), [q, p]);
    // originals first (for `scaled` and `original`), then the reference stylesheet
    const orig: Record<string, string> = {};
    for (const w of ws) { await page.setViewportSize({ width: w, height: 800 }); for (const m of ms) orig[`${m.sel}|${m.prop}|${w}`] = await at(m.sel, m.prop); }
    const wantAt = (m: any, w: number): string | null => {
      if (m.scaled !== undefined) return `${+(parseFloat(orig[`${m.sel}|${m.prop}|${w}`]!) * m.scaled).toFixed(4)}px`;
      const v = m.byWidth?.[String(w)] ?? m[regionOf(inp, w)];
      return v === 'original' ? null : v;
    };
    let ref = '';
    for (const m of ms) for (const w of ws) { const v = wantAt(m, w); if (v !== null) ref += `@media (min-width: ${w}px) and (max-width: ${w}px) { ${m.sel} { ${m.prop}: ${v} !important; } }\n`; }
    await page.evaluate((css) => { const el = document.createElementNS(document.documentElement.namespaceURI, 'style'); el.textContent = css; (document.head ?? document.documentElement).appendChild(el); }, ref);
    // the reference is written per exact width; the region columns must also describe the same numbers (checked against the per-width values)
    for (const w of ws) {
      await page.setViewportSize({ width: w, height: 800 });
      for (const m of ms) {
        const want = wantAt(m, w);
        if (want === null) continue;
        const got = await at(m.sel, m.prop);
        const ok = /px$/.test(want) && /px$/.test(got) ? Math.abs(parseFloat(got) - parseFloat(want)) <= 0.5 : got === want;
        if (!ok) bad(s.id, `@${w} (${regionOf(inp, w)}) ${m.sel} ${m.prop}: reference page gives ${got}, spec says ${want}`);
      }
    }
  }
  // the final path of pinned elements, by simulating the structural steps with the DOM API
  if (ex.unlinked && ex.unlinked.length) {
    await page.goto(`file://${join(VDIR, s.fixture)}`);
    const path = await page.evaluate((steps) => {
      let n = 0;
      for (const st of steps) {
        if (st.op === 'insert') { const el = document.createElement(st.kind === 'text' ? 'p' : 'div'); el.className = `new-${++n}`; const a = document.querySelector(st.anchor!)!; if (st.placement === 'before') a.before(el); else a.after(el); }
        else if (st.op === 'remove') document.querySelector(st.target!)!.remove();
        else if (st.op === 'reorder') { const t = document.querySelector(st.target!)!, sb = document.querySelector(st.sibling!)!; if (st.placement === 'before') sb.before(t); else sb.after(t); }
      }
      const pinned = steps.find((x) => x.op === 'set' && x.environment !== 'desktop')!;
      const e = document.querySelector(pinned.target!)!;
      const parts: string[] = [];
      for (let c: Element | null = e; c; c = c.parentElement) { const sibs = c.parentElement ? (Array.from(c.parentElement.children) as Element[]).filter((x) => x.localName === c!.localName) : [c]; parts.unshift(`${c.localName}[${sibs.indexOf(c) + 1}]`); }
      return '/' + parts.join('/');
    }, s.steps);
    if (path !== ex.unlinked[0].selector) bad(s.id, `pinned element path is ${path}, spec says ${ex.unlinked[0].selector}`);
  }
  await ctx.close();
  console.log(s.id, problems.some((p) => p.startsWith(s.id + ':')) ? 'PROBLEM' : 'ok', s.fixture, `B=${B} T=${T}`);
}
await browser.close();
if (problems.length) { console.log('\nPROBLEMS:\n' + problems.join('\n')); process.exit(1); }
console.log(`\nall ${VSPECS.length} specs consistent with their fixtures`);
