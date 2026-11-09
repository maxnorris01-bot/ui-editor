import { parse as parseCss } from 'postcss';
import type { AtRule, ChildNode, Container as PCContainer, Declaration, Rule } from 'postcss';
import type { Decl, ParsedFile, RuleNode } from './types';

const CONDITIONAL = /^(media|supports|container|document|scope|starting-style)$/i;
const SKIPPED = /^(keyframes|-webkit-keyframes|-moz-keyframes|font-face|page|property|counter-style|font-feature-values)$/i;

function toDecl(src: string, d: Declaration, base: number): Decl {
  const start = base + d.source!.start!.offset;
  // postcss `end.offset` is exclusive and includes a trailing `;` (verified in engine/test/css.test.ts).
  const end = base + d.source!.end!.offset;
  const between = d.raws.between ?? ':';
  const valueStart = start + d.prop.length + between.length;
  const raw = (d.raws.value as { raw?: string } | undefined)?.raw ?? d.value;
  const valueEnd = valueStart + raw.length;
  if (src.slice(valueStart, valueEnd) !== raw) {
    throw new Error(`css offset mismatch for "${d.prop}": expected ${JSON.stringify(raw)} got ${JSON.stringify(src.slice(valueStart, valueEnd))}`);
  }
  const impLen = d.important ? (d.raws.important ?? ' !important').length : 0;
  const contentEnd = valueEnd + impLen;
  return {
    prop: d.prop,
    lprop: d.prop.toLowerCase(),
    value: d.value,
    important: d.important,
    start,
    contentEnd,
    end,
    valueStart,
    valueEnd,
    hasSemicolon: end > contentEnd && src[end - 1] === ';',
    before: d.raws.before ?? '',
    between,
  };
}

/**
 * Parse CSS text that lives at `base` inside a file. Rules inside conditional at-rules are
 * returned with `conditional: true` (detected, never patched); keyframes and font-face are skipped.
 */
export function parseRules(file: string, src: string, base = 0, startOrder = 0, limit = src.length): { rules: RuleNode[]; next: number } {
  const text = src.slice(base, limit);
  let root;
  try {
    root = parseCss(text);
  } catch {
    return { rules: [], next: startOrder };
  }
  const rules: RuleNode[] = [];
  let order = startOrder;
  const visit = (parent: PCContainer, conditional: boolean) => {
    parent.each((n: ChildNode) => {
      if (n.type === 'atrule') {
        const a = n as AtRule;
        if (SKIPPED.test(a.name)) return;
        visit(a, conditional || CONDITIONAL.test(a.name));
      } else if (n.type === 'rule') {
        const r = n as Rule;
        const s = base + r.source!.start!.offset;
        const e = base + r.source!.end!.offset;
        const selRaw = (r.raws.selector as { raw?: string } | undefined)?.raw ?? r.selector;
        const open = src.indexOf('{', s + selRaw.length);
        const decls: Decl[] = [];
        r.each((c) => {
          if (c.type === 'decl') {
            const d = toDecl(src, c as Declaration, base);
            decls.push(d);
          }
        });
        rules.push({
          file,
          selector: r.selector,
          selectors: r.selectors,
          start: s,
          end: e,
          bodyStart: open + 1,
          bodyEnd: e - 1,
          decls,
          conditional,
          order: order++,
        });
        // Nested rules (CSS nesting) are not indexed.
      }
    });
  };
  visit(root, false);
  return { rules, next: order };
}

export function parseCssFile(file: string, source: string): ParsedFile {
  const { rules } = parseRules(file, source, 0, 0);
  return { file, kind: 'css', source, elements: [], rules, parseErrors: 0 };
}

/** Parse the declarations of an inline `style` attribute value located at [valueStart, valueEnd). */
export function parseInline(file: string, src: string, valueStart: number, valueEnd: number): { decls: Decl[]; bodyStart: number; bodyEnd: number } {
  const text = src.slice(valueStart, valueEnd);
  const wrapped = `a{${text}}`;
  const decls: Decl[] = [];
  try {
    const root = parseCss(wrapped);
    const rule = root.first as Rule | undefined;
    rule?.each((c) => {
      if (c.type !== 'decl') return;
      const d = c as Declaration;
      const start = d.source!.start!.offset - 2 + valueStart;
      const between = d.raws.between ?? ':';
      const vs = start + d.prop.length + between.length;
      const raw = (d.raws.value as { raw?: string } | undefined)?.raw ?? d.value;
      const ve = vs + raw.length;
      if (src.slice(vs, ve) !== raw) throw new Error(`inline style offset mismatch for "${d.prop}"`);
      const impLen = d.important ? (d.raws.important ?? ' !important').length : 0;
      const contentEnd = ve + impLen;
      const end = d.source!.end!.offset - 2 + valueStart;
      decls.push({
        prop: d.prop,
        lprop: d.prop.toLowerCase(),
        value: d.value,
        important: d.important,
        start,
        contentEnd,
        end: Math.min(end, valueEnd),
        valueStart: vs,
        valueEnd: ve,
        hasSemicolon: end > contentEnd && src[end - 1] === ';',
        before: d.raws.before ?? '',
        between,
      });
    });
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('inline style offset')) throw e;
  }
  void file;
  return { decls, bodyStart: valueStart, bodyEnd: valueEnd };
}

/** Split a selector list at top-level commas is done by postcss (`rule.selectors`). */
export type { Decl };
