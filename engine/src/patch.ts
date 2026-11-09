import type { Attr, Container, Decl, ElementNode, Patch } from './types';

/** Escape a CSS value for placement inside an attribute quoted with `quote`. */
export function escapeForAttr(value: string, quote: Attr['quote']): string {
  if (quote === '"') return value.replace(/"/g, "'");
  if (quote === "'") return value.replace(/'/g, '"');
  return value;
}

/** Replace only the value of an existing declaration (the `!important` flag is left untouched). */
export function replaceDeclValue(file: string, d: Decl, value: string, quote: Attr['quote'] | null = null): Patch {
  return { file, start: d.valueStart, end: d.valueEnd, text: quote === null ? value : escapeForAttr(value, quote) };
}

/**
 * Append declarations to a rule body or an inline style, mimicking the neighbouring formatting
 * (separator, spacing after the colon, line breaks and indentation of the last declaration).
 * Returns a single insertion patch, or null when there is nothing to add.
 */
export function appendDecls(
  file: string,
  c: Container,
  pairs: [string, string][],
  kind: 'rule' | 'inline',
  quote: Attr['quote'] = '',
): Patch | null {
  if (pairs.length === 0) return null;
  const esc = (v: string) => (kind === 'inline' ? escapeForAttr(v, quote) : v);
  const last = c.decls[c.decls.length - 1];
  if (!last) {
    if (kind === 'inline') {
      return { file, start: c.bodyStart, end: c.bodyStart, text: pairs.map(([p, v]) => `${p}: ${esc(v)}`).join('; ') };
    }
    return { file, start: c.bodyStart, end: c.bodyStart, text: pairs.map(([p, v]) => ` ${p}: ${esc(v)};`).join('') };
  }
  if (last.hasSemicolon) {
    return {
      file,
      start: last.end,
      end: last.end,
      text: pairs.map(([p, v]) => `${last.before}${p}${last.between}${esc(v)};`).join(''),
    };
  }
  return {
    file,
    start: last.contentEnd,
    end: last.contentEnd,
    text: pairs.map(([p, v]) => `;${last.before}${p}${last.between}${esc(v)}`).join(''),
  };
}

/** Insertion point for a new attribute: just before the `>` or `/>` that closes the start tag. */
export function attrInsertPoint(src: string, el: ElementNode): number {
  const tail = src.slice(el.start, el.startTagEnd);
  const m = /\s*\/?>$/.exec(tail);
  return el.start + (m ? m.index : tail.length);
}

/** Attribute name spelling for a new attribute: upper-case when the tag itself is written upper-case. */
export function attrNameFor(el: ElementNode, name: string): string {
  const upper = el.tag === el.tag.toUpperCase() && /[A-Z]/.test(el.tag) && el.namespace === 'html';
  return upper ? name.toUpperCase() : name;
}

export function addAttribute(file: string, src: string, el: ElementNode, name: string, value: string): Patch {
  const at = attrInsertPoint(src, el);
  const v = escapeForAttr(value, '"');
  return { file, start: at, end: at, text: ` ${attrNameFor(el, name)}="${v}"` };
}

/** Apply patches to text. Patches must not overlap; they are applied from the end to the start. */
export function applyPatches(source: string, patches: Patch[]): string {
  const sorted = [...patches].sort((a, b) => b.start - a.start || b.end - a.end);
  for (let i = 1; i < sorted.length; i++) {
    const hi = sorted[i - 1]!;
    const lo = sorted[i]!;
    if (lo.end > hi.start) throw new Error(`overlapping patches at ${lo.start}-${lo.end} and ${hi.start}-${hi.end}`);
  }
  let out = source;
  for (const p of sorted) out = out.slice(0, p.start) + p.text + out.slice(p.end);
  return out;
}

/**
 * export(source, patches): text with the patches applied. Never re-serialises a tree; every byte
 * outside a patched range is the original byte.
 */
export function exportFiles(sources: Record<string, string>, patches: Patch[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [file, text] of Object.entries(sources)) {
    out[file] = applyPatches(
      text,
      patches.filter((p) => p.file === file),
    );
  }
  return out;
}
