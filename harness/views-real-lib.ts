// Shared by the views real-page round (docs/views-realpage-rules.md): the five real files outside the repo, the 16 specs, the fractional-width measurement.
// Nothing here reads the engine. The files are never copied into the repo: exports and dumps go to the gitignored views-check/tmp and views-check/raw.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Browser } from 'playwright';
import { diffChars } from 'diff';
import { ROOT } from './fixtures';
import { collateral, loadAt, writeSet, type Dump } from './insert-lib';
import { filesOf, type VInput, type VSpec } from './views-lib';

export const RP = resolve(ROOT, process.env.REALPAGES ?? '../ui-editor-realpages');
export interface RealSpec extends VSpec { expect: VSpec['expect'] & { fracWidths?: Record<string, string>; savedHash?: string; customAfter?: { phone: number; tablet: number } } }
export const RSPECS = (JSON.parse(readFileSync(join(ROOT, 'views-check/realpage-edits.json'), 'utf8')) as { specs: RealSpec[] }).specs;
export const RFILES = ['leemunroe-email.html', 'mailgun-action.html', 'freelancer-index.html', 'fibonacci-spiral.svg', 'normal-distribution.svg'];

export function realInput(file: string): VInput {
  const companions: Record<string, string> = {};
  if (file === 'freelancer-index.html') companions['css/styles.css'] = readFileSync(join(RP, 'css/styles.css'), 'utf8');
  return { file, kind: file.endsWith('.svg') ? 'svg' : 'html', source: readFileSync(join(RP, file), 'utf8'), companions, dir: RP };
}
export { filesOf };


/** Amendment 1 (docs/views-realpage-amendment-1.md): Chromium snaps the media-query viewport to whole pixels (an iframe 767.98 px wide reports innerWidth 768 and `(max-width: 767.98px)` is false), so a
 *  fractional width cannot be set. V14 is scored at these whole widths instead (floor(B)-ish, floor(B)+1, floor(T), floor(T)+1, floor(T)+2) and by a text check of the condition the export wrote. */
export const FRAC_WIDTHS: Record<number, 'original' | 'new'> = { 767: 'original', 768: 'new', 991: 'new', 992: 'original', 993: 'original' };
export interface FracRow { rule: string; pass: boolean; detail: string }
export async function checkFractional(browser: Browser, spec: RealSpec, inp: VInput, files: Record<string, string>, tmp: string): Promise<FracRow[]> {
  const measured = (spec.expect.measured ?? []) as { sel: string; prop: string; tablet?: string }[];
  const dirO = join(tmp, spec.id, 'frac-original'), dirX = join(tmp, spec.id, 'frac-exported');
  writeSet(dirO, filesOf(inp)); writeSet(dirX, files);
  const ms = measured.map((m) => ({ selector: m.sel, prop: m.prop }));
  const target = spec.steps.find((s) => s.target)?.target ?? null;
  const bad: string[] = [], badC: string[] = [];
  let n = 0;
  for (const [ws, want] of Object.entries(FRAC_WIDTHS)) {
    const w = Number(ws);
    const o = await loadAt(browser, dirO, inp.file, w, { header: '', measured: ms, dumpTarget: target }, true);
    const x = await loadAt(browser, dirX, inp.file, w, { header: '', measured: ms }, true);
    ms.forEach((_, i) => { n++; const ref = want === 'original' ? o.info.measured[i] : measured[i]!.tablet; if (x.info.measured[i] !== ref) bad.push(`@${ws} ${measured[i]!.sel} ${measured[i]!.prop} got ${x.info.measured[i]} want ${ref}`); });
    const od = o.dump as Dump, xd = x.dump as Dump;
    const skip = new Set<number>(); const sub = (i: number): number[] => [i, ...od.rows.map((q, k) => (q.parent === i ? k : -1)).filter((k) => k >= 0).flatMap(sub)];
    if (od.target >= 0) sub(od.target).forEach((k) => skip.add(k));
    const c = od.rows.length === xd.rows.length ? collateral(od, xd, skip, new Set(skip), 'text', [od.target]) : [`element count ${od.rows.length} vs ${xd.rows.length}`];
    if (c.length) badC.push(`@${ws}: ${c.length} element(s): ${c.slice(0, 2).join(' || ')}`);
  }
  // text check: the text the export added carries the exact fractional condition (the browser cannot be set to 767.98 or 991.98)
  const orig = filesOf(inp);
  const added = Object.keys(orig).flatMap((f) => diffChars(orig[f]!, files[f] ?? '').filter((c) => c.added).map((c) => c.value)).join('\n');
  const cond = /@media\s*\(\s*min-width:\s*768px\s*\)\s*and\s*\(\s*max-width:\s*991\.98px\s*\)/.test(added);
  return [
    { rule: 'FR', pass: bad.length === 0, detail: bad.slice(0, 4).join(' | ') || `${n} values at the whole widths ${Object.keys(FRAC_WIDTHS).join(', ')} as the ranges say (767.98 and 991.98 themselves cannot be set in Chromium, amendment 1)` },
    { rule: 'FC', pass: badC.length === 0, detail: badC.slice(0, 3).join(' | ') || 'no other element changed at those widths' },
    { rule: 'FT', pass: cond, detail: cond ? 'the export wrote the condition (min-width: 768px) and (max-width: 991.98px) exactly' : 'the text added to the files does not contain the condition (min-width: 768px) and (max-width: 991.98px)' },
  ];
}

/** Q8: the no-op round trip of one file: the export of the empty list is byte-identical to the source, companions included. Shared by the run and by the scorer controls. */
export function roundTripRow(inp: VInput, out: Record<string, string>): { pass: boolean; detail: string } {
  const fl = filesOf(inp);
  const bad = Object.keys(fl).filter((k) => out[k] !== fl[k]);
  const ok = bad.length === 0 && Object.keys(out).length === Object.keys(fl).length;
  return { pass: ok, detail: ok ? `byte-identical (${Object.keys(fl).join(', ')})` : `NOT byte-identical: ${bad.join(', ')}` };
}
