// The independent scorer for the small-views round (docs/small-views-rules.md section 4). Works on exported FILES and what Chromium says about them.
import type { Browser } from 'playwright';
import { diffChars } from 'diff';
import { join } from 'node:path';
import { loadAt, writeSet, collateral, type Dump } from './insert-lib';
import { regionOf, testWidths, type VInput, type VSpec, filesOf } from './views-lib';

export interface Row { id: string; rule: string; pass: boolean; detail: string }
export interface VExtras {
  /** Files of the export of the list built from the spec's kept steps (`equalsSteps`) and of the harness-filtered list (reset applied by the harness itself). */
  equalsRun?: Record<string, string> | null;
  filteredRun?: Record<string, string> | null;
  unlinked?: { selector: string; property: string; environment: string; value: string }[] | null;
  stepFiles?: Record<string, string>[] | null;
  replays?: Record<string, string>[] | null;
}

/** Resolved grid track sizes are layout-resolved (amendment 1, item 2): blank them in both documents. */
function blankTracks(d: Dump): Dump {
  const idx = ['grid-template-columns', 'grid-template-rows'].map((n) => d.names.indexOf(n)).filter((i) => i >= 0);
  return { ...d, rows: d.rows.map((r) => ({ ...r, props: r.props.map((v, i) => (idx.includes(i) ? '' : v)) })) };
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
void esc;

export async function evaluateViews(browser: Browser, spec: VSpec, inp: VInput, files: Record<string, string>, tmp: string, ex: VExtras = {}): Promise<Row[]> {
  const rows: Row[] = [];
  const add = (rule: string, pass: boolean, detail: string) => rows.push({ id: spec.id, rule, pass, detail: detail.replace(/\s+/g, ' ').slice(0, 600) });
  const e = spec.expect;
  const orig = filesOf(inp);
  const dirO = join(tmp, spec.id, 'original'), dirX = join(tmp, spec.id, 'exported');
  writeSet(dirO, orig); writeSet(dirX, files);
  const widths = testWidths(inp, (e.extraWidths ?? []) as number[]);
  const measured = (e.measured ?? []) as import('./views-lib').Measured[];
  const base = { header: '', measured: measured.map((m) => ({ selector: m.sel, prop: m.prop })) };
  const O: Record<number, Awaited<ReturnType<typeof loadAt>>> = {}, X: Record<number, Awaited<ReturnType<typeof loadAt>>> = {};
  for (const w of widths) { O[w] = await loadAt(browser, dirO, inp.file, w, base, true); X[w] = await loadAt(browser, dirX, inp.file, w, base, true); }
  const w0 = widths[0]!;
  // loads
  const fresh = X[w0]!.errors.filter((m) => !O[w0]!.errors.includes(m));
  add('E1', !X[w0]!.navError && fresh.length === 0 && X[w0]!.info.elementCount === O[w0]!.info.elementCount + (e.elementDelta ?? 0), fresh.join(' | ') || `loads, element count ${X[w0]!.info.elementCount}`);
  // truth
  const pm: string[] = [];
  for (const w of widths) for (const [i, m] of measured.entries()) {
    const want = m.byWidth?.[String(w)] ?? m[regionOf(inp, w)];
    const got = X[w]!.info.measured[i] as string | null;
    const origV = O[w]!.info.measured[i] as string | null;
    const ref = m.scaled !== undefined ? (origV !== null ? `${+(parseFloat(origV) * m.scaled).toFixed(4)}px` : null) : want === 'original' ? origV : (want ?? null);
    const ok = got !== null && ref !== null && (/px$/.test(ref) && /px$/.test(got) ? Math.abs(parseFloat(got) - parseFloat(ref)) <= 0.5 : got === ref);
    if (!ok) pm.push(`@${w} (${regionOf(inp, w)}) ${m.sel} ${m.prop} got ${got} want ${ref}`);
  }
  if (measured.length) add('M', pm.length === 0, pm.slice(0, 4).join(' | ') || `measured values as stated at ${widths.length} widths`);
  // collateral and overflow
  const pc: string[] = [];
  const targets = [...new Set(spec.steps.filter((s) => s.op !== 'reset' && s.target && !s.target.startsWith('.new-')).map((s) => s.target!))];
  for (const w of widths) {
    const over = X[w]!.info.scrollWidth - Math.max(X[w]!.info.clientWidth, O[w]!.info.scrollWidth);
    if ((w === 390 || w === 768) && over > 0.5 && !spec.steps.some((x) => x.op === 'offset')) pc.push(`@${w}: horizontal overflow ${over}px`);
    if (e.legit === 'none' || e.legit === 'svg-ancestors') continue;
    const od = blankTracks(O[w]!.dump as Dump), xd = blankTracks(X[w]!.dump as Dump);
    const slots: number[] = [];
    const skip = new Set<number>();
    for (const t of targets) {
      const r = await loadAt(browser, dirO, inp.file, w, { header: '', dumpTarget: t }, true);
      slots.push(r.dump!.target);
      const sub = (i: number): number[] => [i, ...od.rows.map((q, k) => (q.parent === i ? k : -1)).filter((k) => k >= 0).flatMap(sub)];
      if (r.dump!.target >= 0) sub(r.dump!.target).forEach((k) => skip.add(k));
    }
    const bad = od.rows.length === xd.rows.length ? collateral(od, xd, skip, new Set(skip), 'text', slots) : [`element count ${od.rows.length} vs ${xd.rows.length}`];
    if (bad.length) pc.push(`@${w}: ${bad.length} element(s): ${bad.slice(0, 2).join(' || ')}`);
  }
  add('C', pc.length === 0, pc.slice(0, 3).join(' | ') || 'no other element changed; no new horizontal overflow at 390 and 768');
  // no markers
  const added = Object.keys(orig).flatMap((f) => diffChars(orig[f]!, files[f] ?? '').filter((c) => c.added).map((c) => c.value)).join('\n');
  const marker = /data-view|data-env|data-tablet|data-phone|tablet|phone|<!--/i.exec(added);
  add('K', !marker, marker ? `the export gained "${marker[0]}"` : 'the text added to the original carries no view marker, flag or comment');
  // bytes
  if (e.bytes === 'equals-original') { const bad = Object.keys(orig).filter((f) => files[f] !== orig[f]); add('B', bad.length === 0, bad.length ? `${bad.join(', ')} not byte-identical to the original` : 'byte-identical to the original'); }
  if (e.equalsSteps) { const bad = ex.equalsRun ? Object.keys(orig).filter((f) => files[f] !== ex.equalsRun![f]) : ['(no run)']; add('Q', bad.length === 0, bad.length ? `${bad.join(', ')} differs from the export of the list without the dropped edits` : 'equals the export of the list built without the dropped edits, byte for byte'); }
  if (spec.steps.some((s) => s.op === 'reset')) { const bad = ex.filteredRun ? Object.keys(orig).filter((f) => files[f] !== ex.filteredRun![f]) : ['(no run)']; add('R', bad.length === 0, bad.length ? `${bad.join(', ')} differs from the list the harness filtered itself` : 'the reset equals the list the harness filtered by environment'); }
  if (e.unlinked) { const ok = JSON.stringify(ex.unlinked ?? null) === JSON.stringify(e.unlinked); add('U', ok, ok ? 'the pins name the right element' : `listUnlinked ${JSON.stringify(ex.unlinked)} expected ${JSON.stringify(e.unlinked)}`); }
  if (e.undo) { const pu: string[] = []; if (!ex.stepFiles || !ex.replays) pu.push('no replays'); else ex.replays.forEach((r, n) => { if (JSON.stringify(r) !== JSON.stringify(ex.stepFiles![n])) pu.push(`replay of the first ${n + 1} step(s) differs`); }); add('F', pu.length === 0, pu.join(' | ') || 'undo by replay gives the same bytes at every step'); }
  return rows;
}
