import { parseInline } from './css';
import { contentEnd } from './markup';
import {
  addAttribute,
  appendDecls,
  applyPatches,
  attrInsertPoint,
  attrNameFor,
  escapeForAttr,
  replaceDeclValue,
} from './patch';
import { emptyState, htmlSetResponsive, htmlUnlinkedOffset, htmlUnlinkedReorder } from './responsive';
import { specificity } from './specificity';
import { applyContentEdit, blockWithNote, reorderPins } from './structure';
import type { Attr, Decl, DomOp, Edit, EditResult, EditState, ElementEdit, ElementNode, Model, Patch, Probe, RuleNode } from './types';

/**
 * applyEdit(model, edit, probe)
 *
 * One edit object in, two outputs: (a) text patches against the ORIGINAL files and (b) the matching
 * live-DOM operations for the preview. Both come from the same resolved edit.
 *
 * PLACEMENT RULES (HTML) - where each value is written:
 *   1. If the element has a `style` attribute, write into it (replace the declaration if present,
 *      else append, mimicking its separators).
 *   2. Else, if exactly one rule targets ONLY this element (all selectors of the rule match this
 *      element and nothing else) and that rule would still win the cascade for every property, write
 *      into that rule (replace the declaration, or append to the rule). That rule may live in a
 *      <style> block or in a companion CSS file.
 *   3. Else add a `style` attribute to this element.
 *   Never edit a rule that also matches other elements.
 *
 * PLACEMENT RULES (SVG): per property, follow what the element already uses: the declaration in its
 * `style` attribute, else its presentation attribute, else (if it has a `style` attribute) append
 * there, else add a presentation attribute (or a `style` attribute for non-presentation properties).
 *
 * TRANSFORMS: an offset is `translate(dx, dy)` PREPENDED to the effective declared transform, so
 * the shift is a pure screen translation whatever the element's own transform-origin or rotation.
 * SVG: x/y (cx/cy) are updated when numeric attributes exist, with the offset converted into the
 * element's own user space through its screen matrix; otherwise a translate is prepended to the
 * `transform` attribute using the parent's screen matrix.
 *
 * REFUSALS (detected and reported, never silently wrong): declarations inside @media and other
 * conditional rules, `!important` conflicts, shorthand/longhand mixes (padding, margin, font),
 * transformed HTML ancestors, non-transformable inline elements, SVG elements shared through
 * <defs>/<symbol>/<use>, SVG elements styled by a <style> rule, multi-value SVG x/y lists with a
 * conflicting `style` transform, reordering across parents, and elements with no source text.
 *
 * KNOWN LIMITS (labelled): scripts that change the page at run time, @media rules (never patched),
 * external fonts and stylesheets the visitor did not supply (reported as warnings), specificity is
 * approximated, individual transform properties (`translate`, `rotate`, `scale`) are not composed.
 */
export function applyEdit(model: Model, edit: Edit, probe: Probe, state: EditState = emptyState()): EditResult {
  const warnings = collectWarnings(model);
  if (edit.op === 'insert' || edit.op === 'text' || edit.op === 'remove' || edit.op === 'note') {
    try {
      const r = applyContentEdit(model, edit, state, warnings);
      return r.ok && !r.state ? { ...r, state } : r;
    } catch (e) {
      if (e instanceof Refused) return refuse(e.code, e.message, warnings);
      throw e;
    }
  }
  if (edit.op !== 'set' && edit.op !== 'offset' && edit.op !== 'reorder') return refuse('unknown-edit', `unknown edit kind "${(edit as { op: string }).op}"`, warnings);
  const el = model.primary.elements[edit.target];
  if (!el) return refuse('no-element', `no element with index ${edit.target}`, warnings);
  if (el.implied) return refuse('no-source', `<${el.tag}> is created by the parser and has no source text to edit`, warnings);
  try {
    const r = dispatch(model, edit, el, probe, state, warnings);
    return r.ok && !r.state ? { ...r, state } : r;
  } catch (e) {
    if (e instanceof Refused) return refuse(e.code, e.message, warnings);
    throw e;
  }
}

function dispatch(model: Model, edit: ElementEdit, el: ElementNode, probe: Probe, state: EditState, warnings: string[]): EditResult {
  const unlinked = edit.link === false;
  if (model.primary.kind === 'svg') {
    if (unlinked) no('svg-unlinked', 'unlinked (environment-only) edits are not supported for SVG in v1: SVG has no media-scoped attribute form');
    if (edit.op === 'reorder') return reorder(model, edit, el, warnings, state);
    return edit.op === 'set' ? svgSet(model, el, edit.properties, probe, warnings) : svgOffset(model, el, edit.dx, edit.dy, probe, warnings);
  }
  if (edit.op === 'reorder') return unlinked ? htmlUnlinkedReorder(model, edit, el, probe, state, warnings) : reorder(model, edit, el, warnings, state);
  if (edit.op === 'offset') return unlinked ? htmlUnlinkedOffset(model, edit, el, probe, state, warnings) : htmlOffset(model, el, edit.dx, edit.dy, probe, warnings);
  return htmlSetResponsive(model, edit, el, probe, state, warnings);
}

export class Refused extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export const no = (code: string, message: string): never => {
  throw new Refused(code, message);
};
export const refuse = (code: string, message: string, warnings: string[]): EditResult => ({ ok: false, refusal: { code, message }, warnings });

function collectWarnings(model: Model): string[] {
  const w: string[] = [];
  if (model.primary.elements.some((e) => e.ltag === 'script' && !e.implied)) {
    w.push('document contains <script>: the preview runs with scripts off, so changes a script makes at run time are not reflected');
  }
  for (const href of model.missingStylesheets) w.push(`stylesheet "${href}" was not supplied: rules in it are not visible to the engine and may override this edit`);
  return w;
}

export const fmt = (n: number): string => {
  const v = +n.toFixed(4);
  return String(Object.is(v, -0) ? 0 : v);
};
export const attrOf = (el: ElementNode, lname: string): Attr | undefined => el.attrs.find((a) => a.lname === lname);

// ---------------------------------------------------------------------------------------------
// HTML placement
// ---------------------------------------------------------------------------------------------

export interface Matched {
  rule: RuleNode;
  /** Highest specificity among this rule's selectors that match the target. */
  spec: number;
  /** True when every selector's matches are either empty or exactly the target. */
  single: boolean;
}

export function matchedRules(model: Model, target: ElementNode, probe: Probe): Matched[] {
  const cache = new Map<string, number[]>();
  const m = (sel: string) => {
    let r = cache.get(sel);
    if (!r) cache.set(sel, (r = probe.matches(sel)));
    return r;
  };
  const out: Matched[] = [];
  for (const sheet of model.sheets) {
    for (const rule of sheet.rules) {
      let spec = -1;
      let others = false;
      for (const sel of rule.selectors) {
        const hit = m(sel);
        if (hit.includes(target.index)) {
          spec = Math.max(spec, specificity(sel));
          if (hit.length > 1) others = true;
        } else if (hit.length > 0) {
          others = true;
        }
      }
      if (spec >= 0) out.push({ rule, spec, single: !others });
    }
  }
  return out;
}

/** Shorthands whose longhands must not be mixed with them (padding vs padding-top, font vs font-size). */
const SHORTHANDS = new Set(['padding', 'margin', 'font']);
/** True when one name is the shorthand and the other is one of its longhands. */
export function sameFamily(a: string, b: string): boolean {
  if (a === b) return false;
  return (SHORTHANDS.has(a) && b.startsWith(a + '-')) || (SHORTHANDS.has(b) && a.startsWith(b + '-'));
}

export function lastDecl(decls: Decl[], lprop: string): Decl | undefined {
  for (let i = decls.length - 1; i >= 0; i--) if (decls[i]!.lprop === lprop) return decls[i];
  return undefined;
}

export interface InlineInfo {
  attr: Attr;
  decls: Decl[];
  bodyStart: number;
  bodyEnd: number;
}
export function inlineStyle(model: Model, el: ElementNode): InlineInfo | null {
  const a = attrOf(el, 'style');
  if (!a) return null;
  if (a.value === null) no('style-valueless', 'the style attribute has no value; refusing to guess its format');
  if (a.quote === '') no('style-unquoted', 'the style attribute is unquoted; refusing to guess where it ends');
  const p = parseInline(model.primary.file, model.primary.source, a.valueStart, a.valueEnd);
  return { attr: a, ...p };
}

function checkConflicts(matched: Matched[], inline: InlineInfo | null, props: [string, string][], allowConditional = false): void {
  for (const [p] of props) {
    for (const { rule } of matched) {
      for (const d of rule.decls) {
        const touches = d.lprop === p || sameFamily(p, d.lprop);
        if (!touches) continue;
        if (rule.conditional && allowConditional) continue;
        if (rule.conditional) no('conditional-rule', `"${p}" is also set inside a conditional rule (${rule.selector}) such as @media; v1 does not patch or reason about those`);
        if (d.important) no('important-conflict', `"${p}" is set with !important in rule "${rule.selector}"; an inline or rule edit would not win`);
        if (d.lprop !== p) no('shorthand-mix', `"${p}" and "${d.lprop}" (rule "${rule.selector}") are the same property family; mixing shorthand and longhand is not supported in v1`);
      }
    }
    if (inline) {
      for (const d of inline.decls) {
        if (sameFamily(p, d.lprop)) no('shorthand-mix', `"${p}" and "${d.lprop}" (inline style) are the same property family; mixing shorthand and longhand is not supported in v1`);
      }
    }
  }
}

/** Winning declaration for a property among the inline style and matching rules. */
function effectiveDecl(matched: Matched[], inline: InlineInfo | null, lprop: string): { decl: Decl; inline: boolean } | null {
  let best: { decl: Decl; inline: boolean; key: number[] } | null = null;
  const consider = (decl: Decl, isInline: boolean, spec: number, order: number) => {
    const key = [decl.important ? 1 : 0, isInline ? 1 : 0, spec, order];
    if (!best || cmp(key, best.key) > 0) best = { decl, inline: isInline, key };
  };
  for (const { rule, spec } of matched) {
    if (rule.conditional) continue;
    const d = lastDecl(rule.decls, lprop);
    if (d) consider(d, false, spec, rule.order);
  }
  if (inline) {
    const d = lastDecl(inline.decls, lprop);
    if (d) consider(d, true, 0, 0);
  }
  const b = best as { decl: Decl; inline: boolean } | null;
  return b ? { decl: b.decl, inline: b.inline } : null;
}
function cmp(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return 0;
}

/** Would adding/changing `props` in rule `cand` still win the cascade against the other matching rules? */
function ruleWins(cand: Matched, matched: Matched[], props: [string, string][]): boolean {
  for (const [p] of props) {
    for (const o of matched) {
      if (o.rule === cand.rule || o.rule.conditional) continue;
      if (!lastDecl(o.rule.decls, p)) continue;
      if (o.spec > cand.spec || (o.spec === cand.spec && o.rule.order > cand.rule.order)) return false;
    }
  }
  return true;
}

export interface PlaceOpts {
  /** Write into the element's own style attribute even when a single-element rule exists (it must beat media rules). */
  forceInline?: boolean;
  /** Conditional (@media) rules for these properties are handled by the caller; do not refuse them. */
  allowConditional?: boolean;
}

export function placeHtml(model: Model, el: ElementNode, props: [string, string][], probe: Probe, warnings: string[], opts: PlaceOpts = {}): EditResult {
  const src = model.primary.source;
  const file = model.primary.file;
  const matched = matchedRules(model, el, probe);
  const inline = inlineStyle(model, el);
  checkConflicts(matched, inline, props, opts.allowConditional);
  const patches: Patch[] = [];
  let placement: string;

  if (inline) {
    placement = 'inline-style';
    const add: [string, string][] = [];
    for (const [p, v] of props) {
      const d = lastDecl(inline.decls, p);
      if (d) patches.push(replaceDeclValue(file, d, v, inline.attr.quote));
      else add.push([p, v]);
    }
    const ins = appendDecls(file, inline, add, 'inline', inline.attr.quote);
    if (ins) patches.push(ins);
  } else {
    const cands = opts.forceInline ? [] : matched.filter((m) => m.single && !m.rule.conditional && ruleWins(m, matched, props));
    cands.sort((a, b) => b.spec - a.spec || b.rule.order - a.rule.order);
    const pick = cands[0];
    if (pick) {
      placement = `rule ${pick.rule.selector} (${pick.rule.file})`;
      const add: [string, string][] = [];
      for (const [p, v] of props) {
        const d = lastDecl(pick.rule.decls, p);
        if (d) patches.push(replaceDeclValue(pick.rule.file, d, v));
        else add.push([p, v]);
      }
      const ins = appendDecls(pick.rule.file, pick.rule, add, 'rule');
      if (ins) patches.push(ins);
    } else {
      placement = 'new style attribute';
      patches.push(addAttribute(file, src, el, 'style', props.map(([p, v]) => `${p}: ${v}`).join('; ')));
    }
  }
  return { ok: true, patches, dom: [{ type: 'style', index: el.index, props }], warnings, placement };
}

export function htmlSet(model: Model, el: ElementNode, properties: Record<string, string>, probe: Probe, warnings: string[]): EditResult {
  const props: [string, string][] = Object.entries(properties).map(([p, v]) => [p.toLowerCase(), v]);
  // A flex item's main-size property is overridden by a non-auto flex-basis; write both.
  const parent = el.parent;
  if (parent && !parent.implied) {
    const pd = probe.computed(parent.index, 'display');
    if (pd.includes('flex')) {
      const row = probe.computed(parent.index, 'flex-direction').startsWith('row');
      for (const [p, v] of [...props]) {
        if ((p === 'width' && row) || (p === 'height' && !row)) {
          if (probe.computed(el.index, 'flex-basis') !== 'auto' && !props.some(([q]) => q === 'flex-basis')) props.push(['flex-basis', v]);
        }
      }
    }
  }
  return placeHtml(model, el, props, probe, warnings);
}

const REPLACED = new Set(['img', 'svg', 'video', 'canvas', 'input', 'button', 'select', 'textarea', 'iframe', 'object', 'embed']);

function htmlOffset(model: Model, el: ElementNode, dx: number, dy: number, probe: Probe, warnings: string[]): EditResult {
  if (probe.computed(el.index, 'display') === 'inline' && !REPLACED.has(el.ltag)) {
    no('not-transformable', `<${el.tag}> is display:inline, where CSS transforms have no effect; make it inline-block or block first`);
  }
  for (let p = el.parent; p; p = p.parent) {
    const t = probe.computed(p.index, 'transform');
    if (t && t !== 'none') no('transformed-ancestor', `an ancestor (<${p.tag}>) has a transform, so a screen-space shift cannot be written as a plain translate in v1`);
  }
  const matched = matchedRules(model, el, probe);
  const inline = inlineStyle(model, el);
  const eff = effectiveDecl(matched, inline, 'transform');
  const base = eff ? eff.decl.value.trim() : '';
  const t = `translate(${fmt(dx)}px, ${fmt(dy)}px)` + (base && base !== 'none' ? ` ${base}` : '');
  return placeHtml(model, el, [['transform', t]], probe, warnings);
}

// ---------------------------------------------------------------------------------------------
// SVG
// ---------------------------------------------------------------------------------------------

const SVG_ATTR_PROPS = new Set([
  'fill', 'stroke', 'stroke-width', 'opacity', 'fill-opacity', 'stroke-opacity', 'font-size', 'font-family',
  'font-weight', 'font-style', 'text-anchor', 'r', 'rx', 'ry', 'width', 'height', 'x', 'y', 'cx', 'cy', 'color',
  'letter-spacing', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'visibility', 'display',
]);
const SHARED_CONTAINERS = new Set(['defs', 'symbol', 'clippath', 'mask', 'marker', 'pattern', 'lineargradient', 'radialgradient', 'filter']);

function checkSvgShared(model: Model, el: ElementNode): void {
  for (let p: ElementNode | null = el; p; p = p.parent) {
    if (SHARED_CONTAINERS.has(p.ltag) && p !== el) no('shared-instance', `<${el.tag}> lives inside <${p.tag}>, which other elements reuse; editing it would change every instance`);
  }
  const ids = new Set<string>();
  for (let p: ElementNode | null = el; p; p = p.parent) {
    const id = attrOf(p, 'id')?.value;
    if (id) ids.add(id);
  }
  for (const u of model.primary.elements) {
    if (u.ltag !== 'use') continue;
    const href = (attrOf(u, 'href') ?? attrOf(u, 'xlink:href'))?.value ?? '';
    if (href.startsWith('#') && ids.has(href.slice(1))) {
      no('shared-instance', `<${el.tag}> (or an ancestor) is instantiated by <use href="${href}">; editing it would change every instance`);
    }
  }
}

function checkSvgStylesheets(model: Model, el: ElementNode, props: string[], probe: Probe): void {
  const matched = model.sheets.length ? matchedRules(model, el, probe) : [];
  for (const { rule } of matched) {
    for (const d of rule.decls) {
      if (props.includes(d.lprop)) no('svg-stylesheet', `"${d.lprop}" is set by a stylesheet rule (${rule.selector}) in the SVG; v1 only edits SVG attributes and style attributes`);
    }
  }
}

function svgSet(model: Model, el: ElementNode, properties: Record<string, string>, probe: Probe, warnings: string[]): EditResult {
  const src = model.primary.source;
  const file = model.primary.file;
  const props: [string, string][] = Object.entries(properties).map(([p, v]) => [p.toLowerCase(), v]);
  checkSvgShared(model, el);
  checkSvgStylesheets(model, el, props.map(([p]) => p), probe);
  const inline = inlineStyle(model, el);
  const patches: Patch[] = [];
  const dom: DomOp[] = [];
  const styleAdd: [string, string][] = [];
  let addAttrs = '';
  const placed: string[] = [];
  for (const [p, v] of props) {
    const sd = inline ? lastDecl(inline.decls, p) : undefined;
    const a = attrOf(el, p);
    if (inline && sd) {
      patches.push(replaceDeclValue(file, sd, v, inline.attr.quote));
      dom.push({ type: 'style', index: el.index, props: [[p, v]] });
      placed.push(`style:${p}`);
    } else if (a) {
      if (a.value === null) patches.push({ file, start: a.start, end: a.end, text: `${a.name}="${escapeForAttr(v, '"')}"` });
      else patches.push({ file, start: a.valueStart, end: a.valueEnd, text: escapeForAttr(v, a.quote) });
      dom.push({ type: 'attr', index: el.index, name: a.name, value: v });
      placed.push(`attr:${p}`);
    } else if (inline) {
      styleAdd.push([p, v]);
      dom.push({ type: 'style', index: el.index, props: [[p, v]] });
      placed.push(`style+:${p}`);
    } else if (SVG_ATTR_PROPS.has(p)) {
      addAttrs += ` ${p}="${escapeForAttr(v, '"')}"`;
      dom.push({ type: 'attr', index: el.index, name: p, value: v });
      placed.push(`attr+:${p}`);
    } else {
      addAttrs += ` ${attrNameFor(el, 'style')}="${escapeForAttr(`${p}: ${v}`, '"')}"`;
      dom.push({ type: 'style', index: el.index, props: [[p, v]] });
      placed.push(`style-attr:${p}`);
    }
  }
  if (inline) {
    const ins = appendDecls(file, inline, styleAdd, 'inline', inline.attr.quote);
    if (ins) patches.push(ins);
  }
  if (addAttrs) {
    const at = attrInsertPoint(src, el);
    patches.push({ file, start: at, end: at, text: addAttrs });
  }
  return { ok: true, patches, dom, warnings, placement: placed.join(',') };
}

type M6 = [number, number, number, number, number, number];
const NUM = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i;

function toLocal(m: M6, dx: number, dy: number): [number, number] {
  const [a, b, c, d] = m;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-9) no('singular-matrix', 'the element has a degenerate transform (zero scale); cannot convert a screen shift');
  return [(d * dx - c * dy) / det, (-b * dx + a * dy) / det];
}

const POS_ATTRS: Record<string, [string, string]> = {
  rect: ['x', 'y'], image: ['x', 'y'], foreignobject: ['x', 'y'], use: ['x', 'y'], svg: ['x', 'y'],
  text: ['x', 'y'], circle: ['cx', 'cy'], ellipse: ['cx', 'cy'],
};

function svgOffset(model: Model, el: ElementNode, dx: number, dy: number, probe: Probe, warnings: string[]): EditResult {
  const src = model.primary.source;
  const file = model.primary.file;
  checkSvgShared(model, el);
  const inline = inlineStyle(model, el);
  if (inline && lastDecl(inline.decls, 'transform')) no('transform-in-style', 'the element sets transform in its style attribute; v1 does not compose with that');
  const pos = POS_ATTRS[el.ltag];
  if (pos) {
    const ax = attrOf(el, pos[0]);
    const ay = attrOf(el, pos[1]);
    if (ax?.value != null && ay?.value != null && NUM.test(ax.value.trim()) && NUM.test(ay.value.trim())) {
      const m = probe.screenMatrix(el.index);
      if (!m) no('no-matrix', 'could not read the element\'s screen matrix from the preview');
      const [lx, ly] = toLocal(m!, dx, dy);
      const nx = fmt(parseFloat(ax.value) + lx);
      const ny = fmt(parseFloat(ay.value) + ly);
      return {
        ok: true,
        patches: [
          { file, start: ax.valueStart, end: ax.valueEnd, text: nx },
          { file, start: ay.valueStart, end: ay.valueEnd, text: ny },
        ],
        dom: [
          { type: 'attr', index: el.index, name: ax.name, value: nx },
          { type: 'attr', index: el.index, name: ay.name, value: ny },
        ],
        warnings,
        placement: `attrs ${pos[0]}/${pos[1]}`,
      };
    }
  }
  const pm = probe.parentScreenMatrix(el.index);
  if (!pm) no('no-matrix', 'could not read the parent\'s screen matrix from the preview');
  const [lx, ly] = toLocal(pm!, dx, dy);
  const t = attrOf(el, 'transform');
  const tr = `translate(${fmt(lx)} ${fmt(ly)})`;
  if (t && t.value !== null) {
    const v = `${tr} ${t.value.trim()}`.trim();
    return {
      ok: true,
      patches: [{ file, start: t.valueStart, end: t.valueEnd, text: escapeForAttr(v, t.quote) }],
      dom: [{ type: 'attr', index: el.index, name: t.name, value: v }],
      warnings,
      placement: 'transform attribute (composed)',
    };
  }
  return {
    ok: true,
    patches: [addAttribute(file, src, el, 'transform', tr)],
    dom: [{ type: 'attr', index: el.index, name: 'transform', value: tr }],
    warnings,
    placement: 'new transform attribute',
  };
}

// ---------------------------------------------------------------------------------------------
// Reorder
// ---------------------------------------------------------------------------------------------

interface Block {
  start: number;
  end: number;
  line: boolean;
}

/**
 * Source block of an element for moving. When the element owns its lines (only whitespace before
 * it on its first line and after it on its last line) the block is the whole lines, so indentation
 * and line breaks travel with it and the move is a pure permutation of lines. Otherwise it is the
 * element's own text. Elements without an end tag have their trailing whitespace trimmed first
 * (the parser includes it in the element's range).
 */
export function blockOf(src: string, el: ElementNode, startOverride?: number): Block {
  const s = startOverride ?? el.start;
  const e = contentEnd(src, el);
  const lineStart = src.lastIndexOf('\n', s - 1) + 1;
  const nl = src.indexOf('\n', e);
  const leadOk = /^[ \t]*$/.test(src.slice(lineStart, s));
  const trailOk = nl !== -1 && /^[ \t\r]*$/.test(src.slice(e, nl));
  if (leadOk && trailOk) return { start: lineStart, end: nl + 1, line: true };
  return { start: s, end: e, line: false };
}

export function reorder(model: Model, edit: Extract<Edit, { op: 'reorder' }>, el: ElementNode, warnings: string[], state: EditState = emptyState()): EditResult {
  const src = model.primary.source;
  const file = model.primary.file;
  const sib = model.primary.elements[edit.sibling];
  if (!sib || sib.implied) return refuse('no-sibling', 'the anchor element does not exist or has no source text', warnings);
  if (sib === el) return refuse('same-element', 'cannot place an element relative to itself', warnings);
  if (sib.parent !== el.parent || !el.parent) return refuse('different-parents', 'reordering is only supported between siblings of the same parent', warnings);
  const parent = el.parent;
  if (parent.implied) return refuse('implied-parent', `the parent <${parent.tag}> is created by the parser and has no source text`, warnings);
  const kids = parent.children;
  const ei = kids.indexOf(el);
  const si = kids.indexOf(sib);
  if ((edit.placement === 'before' && ei === si - 1) || (edit.placement === 'after' && ei === si + 1)) {
    return { ok: true, patches: [], dom: [], warnings, placement: 'already in place' };
  }
  const mb = blockWithNote(model, el);
  const ab = blockWithNote(model, sib);
  const at = edit.placement === 'before' ? ab.start : ab.end;
  const moved = src.slice(mb.start, mb.end);
  const patches: Patch[] = [
    { file, start: mb.start, end: mb.end, text: '' },
    { file, start: at, end: at, text: moved },
  ];
  const next = applyPatches(src, patches);
  const innerStart = parent.startTagEnd;
  const innerEnd = parent.endTagStart !== -1 ? parent.endTagStart : parent.end;
  const html = next.slice(innerStart, innerEnd + (next.length - src.length));
  return {
    ok: true,
    patches,
    dom: [{ type: 'html', index: parent.index, html }],
    warnings,
    placement: mb.line ? 'moved whole lines' : 'moved element text',
    // unlinked values are pinned by element path, and a reorder shifts paths: the pins follow their elements
    state: { pins: reorderPins(model, el, sib, edit.placement, patches, state.pins) },
  };
}
