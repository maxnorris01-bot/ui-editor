// Shared by the small-views harness (docs/small-views-rules.md): the fixtures, the INDEPENDENT definition of the ranges (written from the rules, not
// from the engine), the test widths, and the region truth. Nothing here reads the engine.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './fixtures';

export const VDIR = join(ROOT, 'fixtures/views');
export interface Measured { sel: string; prop: string; desktop: string; tablet: string; phone: string }
export interface VStep { op: string; target?: string; properties?: Record<string, string>; environment?: string; link?: boolean; env?: string; dx?: number; dy?: number; placement?: string; sibling?: string; kind?: string; anchor?: string }
export interface VSpec { id: string; title: string; fixture: string; steps: VStep[]; expect: Record<string, any> }
export const VSPECS = (JSON.parse(readFileSync(join(VDIR, 'edits.json'), 'utf8')) as { specs: VSpec[] }).specs;

export interface VInput { file: string; kind: 'html' | 'svg'; source: string; companions: Record<string, string>; dir: string }
export function viewsInput(fixture: string): VInput {
  const companions: Record<string, string> = {};
  if (fixture === 'landing.html') companions['landing.css'] = readFileSync(join(VDIR, 'landing.css'), 'utf8');
  return { file: fixture, kind: fixture.endsWith('.svg') ? 'svg' : 'html', source: readFileSync(join(VDIR, fixture), 'utf8'), companions, dir: VDIR };
}
export const filesOf = (i: VInput): Record<string, string> => ({ [i.file]: i.source, ...i.companions });

const px = (n: string, u?: string) => (u === 'em' || u === 'rem' ? parseFloat(n) * 16 : parseFloat(n));
/** Conditions of every @media in the page's own CSS, as text (the rules doc, section 2: B and T are read from max-width conditions only). */
export function maxWidths(i: VInput): number[] {
  const text = [i.source, ...Object.values(i.companions)].join('\n');
  const out: number[] = [];
  for (const m of text.matchAll(/@media[^{]*\{/g)) for (const q of m[0].matchAll(/max-width\s*:\s*(\d+(?:\.\d+)?)\s*(px|em|rem)?/gi)) out.push(px(q[1]!, q[2]?.toLowerCase()));
  return out;
}
/** B: the largest max-width at or below 768, else 767. */
export const phoneMax = (i: VInput): number => { const v = maxWidths(i).filter((n) => n <= 768); return v.length ? Math.max(...v) : 767; };
/** T: the largest max-width above 768 and at most 1100, else 1024. */
export const tabletTop = (i: VInput): number => { const v = maxWidths(i).filter((n) => n > 768 && n <= 1100); return v.length ? Math.max(...v) : 1024; };
/** The first whole width above B. */
export const tabletMin = (i: VInput): number => Math.floor(phoneMax(i)) + 1;
export const hasTablet = (i: VInput): boolean => tabletMin(i) <= 768;

export function testWidths(i: VInput): number[] {
  const B = phoneMax(i), T = tabletTop(i);
  return [...new Set([1280, 1024, 768, 390, Math.floor(B), Math.floor(B) + 1, Math.floor(T), Math.floor(T) + 1])].sort((a, b) => b - a);
}
export type Region = 'phone' | 'tablet' | 'desktop';
export const regionOf = (i: VInput, w: number): Region => (w <= phoneMax(i) ? 'phone' : w <= tabletTop(i) ? 'tablet' : 'desktop');
