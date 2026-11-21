import { parse as parse5 } from 'parse5';
import type { DefaultTreeAdapterMap } from 'parse5';
import type { Attr, CommentInfo, ElementNode, Kind, ParsedFile } from './types';

type P5Node = DefaultTreeAdapterMap['node'];
type P5Element = DefaultTreeAdapterMap['element'];

function isElement(n: P5Node): n is P5Element {
  return 'tagName' in n && typeof (n as P5Element).tagName === 'string';
}

/**
 * Tokenise the attributes of one start tag, keeping source offsets and the exact spelling.
 * `from` is the offset just after `<tagname`; `to` is the end of the start tag (after `>`).
 */
export function scanAttrs(src: string, from: number, to: number): Attr[] {
  const attrs: Attr[] = [];
  let i = from;
  const isSpace = (c: string | undefined) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';
  while (i < to) {
    while (i < to && (isSpace(src[i]) || src[i] === '/')) i++;
    if (i >= to || src[i] === '>') break;
    const nameStart = i;
    while (i < to && !isSpace(src[i]) && src[i] !== '=' && src[i] !== '>' && !(src[i] === '/' && src[i + 1] === '>')) i++;
    const name = src.slice(nameStart, i);
    let j = i;
    while (j < to && isSpace(src[j])) j++;
    let value: string | null = null;
    let valueStart = i;
    let valueEnd = i;
    let quote: Attr['quote'] = '';
    let end = i;
    if (src[j] === '=') {
      j++;
      while (j < to && isSpace(src[j])) j++;
      const q = src[j];
      if (q === '"' || q === "'") {
        const close = src.indexOf(q, j + 1);
        const stop = close === -1 || close >= to ? to - 1 : close;
        valueStart = j + 1;
        valueEnd = stop;
        quote = q;
        end = Math.min(stop + 1, to);
      } else {
        valueStart = j;
        let k = j;
        while (k < to && !isSpace(src[k]) && src[k] !== '>') k++;
        valueEnd = k;
        end = k;
      }
      value = src.slice(valueStart, valueEnd);
      i = end;
    }
    attrs.push({ name, lname: name.toLowerCase(), start: nameStart, end, value, valueStart, valueEnd, quote });
  }
  return attrs;
}

/** Trim whitespace from the end of an element's range when it has no end tag. */
export function contentEnd(src: string, el: ElementNode): number {
  if (el.endTagStart !== -1 || el.implied) return el.end;
  let e = el.end;
  while (e > el.startTagEnd && /\s/.test(src[e - 1] ?? '')) e--;
  return e;
}

/**
 * Parse HTML or SVG with parse5 and return elements with source offsets.
 *
 * Limits (stated, not hidden): SVG goes through the HTML parser (foreign content), so SVG that is
 * valid only as XML (custom entities, unusual CDATA use) can be split differently than a browser's
 * XML parser would. `<template>` contents are not indexed.
 */
export function parseMarkup(file: string, source: string, kind: Exclude<Kind, 'css'>): ParsedFile {
  const errors: unknown[] = [];
  const doc = parse5(source, { sourceCodeLocationInfo: true, onParseError: (e) => errors.push(e) });
  const elements: ElementNode[] = [];
  const nodeOf = new Map<P5Element, ElementNode>();

  const walk = (n: P5Element, parent: ElementNode | null): ElementNode => {
    const loc = n.sourceCodeLocation;
    const implied = !loc;
    let tag = n.tagName;
    let attrs: Attr[] = [];
    let start = -1;
    let end = -1;
    let startTagEnd = -1;
    let endTagStart = -1;
    let selfClosing = false;
    if (loc && loc.startTag) {
      start = loc.startOffset;
      end = loc.endOffset;
      startTagEnd = loc.startTag.endOffset;
      endTagStart = loc.endTag ? loc.endTag.startOffset : -1;
      const m = /^<([^\s/>]+)/.exec(source.slice(start, start + 256));
      if (m && m[1]) tag = m[1];
      attrs = scanAttrs(source, start + 1 + tag.length, startTagEnd);
      selfClosing = /\/\s*>$/.test(source.slice(start, startTagEnd));
    }
    const ns = n.namespaceURI as string;
    const el: ElementNode = {
      index: elements.length,
      tag,
      ltag: tag.toLowerCase(),
      namespace: ns.endsWith('xhtml') ? 'html' : ns.endsWith('svg') ? 'svg' : 'other',
      implied,
      start,
      end,
      startTagEnd,
      endTagStart,
      selfClosing,
      attrs,
      parent,
      children: [],
    };
    elements.push(el);
    nodeOf.set(n, el);
    for (const c of n.childNodes) if (isElement(c)) el.children.push(walk(c, el));
    return el;
  };

  const findSvg = (n: P5Node): P5Element | null => {
    if (isElement(n)) {
      if (n.tagName.toLowerCase() === 'svg' && (n.namespaceURI as string).endsWith('svg')) return n;
    }
    if ('childNodes' in n) {
      for (const c of n.childNodes) {
        const r = findSvg(c);
        if (r) return r;
      }
    }
    return null;
  };

  if (kind === 'svg') {
    const root = findSvg(doc);
    if (root) walk(root, null);
  } else {
    for (const c of doc.childNodes) if (isElement(c)) walk(c, null);
  }
  return { file, kind, source, elements, rules: [], parseErrors: errors.length, comments: collectComments(doc, nodeOf, elements) };
}

type P5Parent = DefaultTreeAdapterMap['parentNode'];

/** Every comment node with its source range and the element it directly precedes (only whitespace text between). */
function collectComments(doc: P5Parent, nodeOf: Map<P5Element, ElementNode>, elements: ElementNode[]): CommentInfo[] {
  const byStart = new Map<number, ElementNode>();
  for (const e of elements) if (!e.implied) byStart.set(e.start, e);
  const out: CommentInfo[] = [];
  const visit = (n: P5Parent, parent: ElementNode | null) => {
    const kids = n.childNodes;
    for (let i = 0; i < kids.length; i++) {
      const c = kids[i]!;
      if (c.nodeName === '#comment') {
        const loc = (c as { sourceCodeLocation?: { startOffset: number; endOffset: number } | null }).sourceCodeLocation;
        if (!loc) continue;
        let j = i + 1;
        while (j < kids.length && kids[j]!.nodeName === '#text' && /^\s*$/.test((kids[j] as unknown as { value: string }).value)) j++;
        const next = kids[j];
        const nl = next && isElement(next) ? next.sourceCodeLocation : null;
        out.push({ start: loc.startOffset, end: loc.endOffset, data: (c as unknown as { data: string }).data, parent: parent ? parent.index : -1, precedes: nl ? (byStart.get(nl.startOffset)?.index ?? -1) : -1 });
      } else if (isElement(c)) {
        const mine = nodeOf.get(c);
        if (mine) visit(c, mine);
      }
    }
  };
  visit(doc, null);
  return out.sort((a, b) => a.start - b.start);
}
