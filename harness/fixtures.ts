import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const ROOT = join(import.meta.dirname, '..');
export const FIXTURES = join(ROOT, 'fixtures');

export interface EditSpec {
  id: string;
  file: string;
  type: 'T1' | 'T2' | 'T3' | 'T4';
  target: string;
  edit:
    | { op: 'set'; properties: Record<string, string> }
    | { op: 'offset'; dx: number; dy: number }
    | { op: 'reorder'; move: string; placement: 'before' | 'after'; sibling: string };
  expected: {
    computed?: { selector: string; property: string; value: string }[];
    bboxDelta?: { selector: string; dx?: number; dy?: number; dw?: number; dh?: number };
    order?: { parent: string; ids: string[] };
  };
  legit: 'descendants' | 'flow' | 'reorder' | 'svg-ancestors';
  expectedFiles: string[];
  note?: string;
}

export interface EditsFile {
  version: number;
  viewport: { width: number; height: number };
  tolerance_px: number;
  edits: EditSpec[];
}

export const loadEdits = (): EditsFile => JSON.parse(readFileSync(join(FIXTURES, 'edits.json'), 'utf8')) as EditsFile;

export interface Fixture {
  file: string;
  kind: 'html' | 'svg';
  source: string;
  /** Companion CSS by href (only linked-css.html has one). */
  companions: Record<string, string>;
  bytes: number;
}

export function loadFixtures(): Fixture[] {
  return readdirSync(FIXTURES)
    .filter((f) => f.endsWith('.html') || f.endsWith('.svg'))
    .sort()
    .map((file) => {
      const source = readFileSync(join(FIXTURES, file), 'utf8');
      const companions: Record<string, string> = {};
      if (file === 'linked-css.html') companions['linked-css.css'] = readFileSync(join(FIXTURES, 'linked-css.css'), 'utf8');
      return { file, kind: file.endsWith('.svg') ? 'svg' : 'html', source, companions, bytes: Buffer.byteLength(source) };
    });
}
