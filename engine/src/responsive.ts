import { describe } from './model';
import { addAttribute, replaceDeclValue } from './patch';
import { specificity } from './specificity';
import { eolAt } from './structure';
import {
  attrOf,
  fmt,
  htmlSet,
  inlineStyle,
  lastDecl,
  matchedRules,
  no,
  placeHtml,
  sameFamily,
} from './edit';
import type { InlineInfo, Matched } from './edit';
import type { Decl, DomOp, Edit, EditResult, EditState, ElementNode, Environment, Model, Patch, Pin, Probe, RuleNode, ScaleNote } from './types';

/**
 * RESPONSIVE EDITS (docs/responsive-rules.md, docs/adr/0003-responsive-edits.md)
 *
 * An edit is a ratio. When a size is changed while viewing one environment, the page's own
 * screen-specific values for the same element and property (every matching @media rule) are scaled
 * by the same ratio, using element-scoped override rules appended to the page's last stylesheet.
 * Non-ratio properties apply at every width. An unlinked edit applies only inside its environment
 * (inside `@media (max-width: Bpx)` or `@media (min-width: (B+1)px)`) and pins that property there.
 *
 * LIMITS (labelled): only the media features `max-width`/`min-width` (px, em, rem) are evaluated;
 * other conditions are treated as not matching at the test widths but are still scaled when they
 * wrap a matching rule. font-size, padding(-*) and margin(-*) are plain ratios; width and height are
 * ratios where the other environment declares a fixed length (see linkedSize), and are otherwise
 * kept inside the edited environment. Linked offsets and reorders keep the
 * pre-existing behaviour (and still refuse when a media rule sets `transform`). A page rule whose
 * selector has an id cannot be out-specified for an element without an id (refused). The pinned
 * record only covers (element, property, environment); media rules whose condition spans both
 * environments are scaled normally.
 */

export const DESKTOP_WIDTH = 1280;
export const PHONE_WIDTH = 390;
export const DEFAULT_BREAKPOINT = 767;
export const TABLET_WIDTH = 768;
export const DEFAULT_TABLET_MAX = 1024;

export const emptyState = (): EditState => ({ pins: [] });

const SIDES = ['top', 'right', 'bottom', 'left'] as const;
const RATIO_PROPS = new Set(['font-size', 'padding', 'margin', ...SIDES.map((s) => `padding-${s}`), ...SIDES.map((s) => `margin-${s}`)]);
const SHORTHAND_SIDES = new Set(['padding', 'margin']);
const envWidth = (e: Environment) => (e === 'phone' ? PHONE_WIDTH : e === 'tablet' ? TABLET_WIDTH : DESKTOP_WIDTH);
const other = (e: Environment): Environment => (e === 'phone' ? 'desktop' : 'phone');

// ---------------------------------------------------------------------------------------------
// Media conditions
// ---------------------------------------------------------------------------------------------

const toPx = (n: number, unit: string | undefined): number => (unit === 'em' || unit === 'rem' ? n * 16 : n);

function partMatches(part: string, width: number): boolean {
  let q = part.trim().toLowerCase();
  if (q.startsWith('not ')) return false; // cannot evaluate a negation
  q = q.replace(/^only\s+/, '');
  for (const piece of q.split(/\s+and\s+/)) {
    const p = piece.trim();
    if (p === '' || p === 'all' || p === 'screen') continue;
    const m = /^\(\s*(max|min)-width\s*:\s*(\d+(?:\.\d+)?)\s*(px|em|rem)?\s*\)$/.exec(p);
    if (!m) return false; // unknown feature or media type: treated as not matching
    const v = toPx(parseFloat(m[2]!), m[3]);
    if (m[1] === 'max' ? width > v : width < v) return false;
  }
  return true;
}

/** True when every at-rule in the chain applies at `width`. Only width media queries are evaluated. */
export function chainMatches(chain: string[], width: number): boolean {
  for (const c of chain) {
    const m = /^@(\w+)\s*([\s\S]*)$/.exec(c);
    if (!m) return false;
    const name = m[1]!.toLowerCase();
    if (name === 'supports') continue;
    if (name !== 'media') return false;
    if (!m[2]!.split(',').some((part) => partMatches(part, width))) return false;
  }
  return true;
}

/** The page's own phone breakpoint: the largest max-width (px) at or below 768, else 767. */
export function breakpointOf(model: Model): number {
  let best = -1;
  for (const sheet of model.sheets) {
    for (const rule of sheet.rules) {
      for (const c of rule.conditions) {
        for (const m of c.matchAll(/max-width\s*:\s*(\d+(?:\.\d+)?)\s*(px|em|rem)?/gi)) {
          const v = toPx(parseFloat(m[1]!), m[2]?.toLowerCase());
          if (v <= 768 && v > best) best = v;
        }
      }
    }
  }
  return best < 0 ? DEFAULT_BREAKPOINT : best;
}

/** The first whole width above the phone breakpoint: where the Tablet range starts. */
export const tabletMin = (b: number): number => Math.floor(b) + 1;

/**
 * The page's own tablet top T: the largest `max-width` condition above 768 px and at most 1100 px, else 1024. The Tablet range is the widths from
 * `tabletMin(B)` to T; widths above T are Desktop for the purpose of custom ranges (docs/small-views-rules.md section 2).
 */
export function tabletMax(model: Model): number {
  let best = -1;
  for (const sheet of model.sheets) {
    for (const rule of sheet.rules) {
      for (const c of rule.conditions) {
        for (const m of c.matchAll(/max-width\s*:\s*(\d+(?:\.\d+)?)\s*(px|em|rem)?/gi)) {
          const v = toPx(parseFloat(m[1]!), m[2]?.toLowerCase());
          if (v > 768 && v <= 1100 && v > best) best = v;
        }
      }
    }
  }
  return best < 0 ? DEFAULT_TABLET_MAX : best;
}

export const envCondition = (env: Environment, b: number, t: number = DEFAULT_TABLET_MAX): string =>
  env === 'phone' ? `@media (max-width: ${fmt(b)}px)` : env === 'tablet' ? `@media (min-width: ${fmt(tabletMin(b))}px) and (max-width: ${fmt(t)}px)` : `@media (min-width: ${fmt(b + 1)}px)`;

/**
 * Which environment a condition chain belongs to: only phone widths, only desktop widths, both, or neither. With `t` (the tablet top) three views are told apart and a
 * chain that matches only the tablet range is `'tablet'`; without it the old two-view answer is given (a tablet-only chain is then `'desktop'`).
 */
export function chainEnv(chain: string[], b: number, t?: number): Environment | 'both' | 'none' {
  if (t === undefined) {
    const phone = [b, PHONE_WIDTH, Math.min(320, b)].some((w) => chainMatches(chain, w));
    const desk = [b + 1, 1024, DESKTOP_WIDTH].some((w) => chainMatches(chain, w));
    return phone && desk ? 'both' : phone ? 'phone' : desk ? 'desktop' : 'none';
  }
  const phone = [b, PHONE_WIDTH, Math.min(320, b)].some((w) => chainMatches(chain, w));
  const tablet = tabletMin(b) <= t && [tabletMin(b), TABLET_WIDTH, t].some((w) => chainMatches(chain, w));
  const desk = [t + 1, DESKTOP_WIDTH].some((w) => chainMatches(chain, w));
  if (phone && (tablet || desk)) return 'both';
  if (phone) return 'phone';
  if (tablet && desk) return 'desktop';
  if (tablet) return 'tablet';
  return desk ? 'desktop' : 'none';
}

// ---------------------------------------------------------------------------------------------
// Values: tokens and scaling
// ---------------------------------------------------------------------------------------------

function splitTokens(v: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of v.trim()) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (/\s/.test(ch) && depth === 0) {
      if (cur) out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

const LEN = /^([-+]?(?:\d+\.?\d*|\.\d+))(px|rem|em|%|pt|pc|cm|mm|in|vw|vh|vmin|vmax|ch|ex)$/i;
const ZERO = /^[-+]?0*\.?0+$/;
const FN = /\b(calc|clamp|min|max|var|env|attr)\(/i;

const expandSides = (t: string[]): string[] => (t.length === 1 ? [t[0]!, t[0]!, t[0]!, t[0]!] : t.length === 2 ? [t[0]!, t[1]!, t[0]!, t[1]!] : t.length === 3 ? [t[0]!, t[1]!, t[2]!, t[1]!] : t.slice(0, 4));

export interface Scaled {
  value: string;
  /** Reasons a part of the value was not scaled (calc, clamp, var, keywords). Empty when fully handled. */
  reasons: string[];
}

/** Multiply each length in `value` by its ratio, keeping units; `ratios` has 1 entry, or 4 (top, right, bottom, left). */
export function scaleValue(value: string, ratios: number[]): Scaled {
  const toks = splitTokens(value);
  const reasons: string[] = [];
  const scaleTok = (t: string, r: number): string => {
    const m = LEN.exec(t);
    if (m) return `${fmt(parseFloat(m[1]!) * r)}${m[2]}`;
    if (ZERO.test(t)) return t;
    if (FN.test(t)) reasons.push(`${t} is not a plain length`);
    else if (t.toLowerCase() !== 'auto') reasons.push(`"${t}" is a keyword, not a length`);
    return t;
  };
  if (ratios.length === 1) {
    if (toks.length !== 1) return { value, reasons: [`"${value}" has several parts but one ratio was given`] };
    return { value: scaleTok(toks[0]!, ratios[0]!), reasons };
  }
  const uniform = ratios.every((r) => Math.abs(r - ratios[0]!) < 1e-9);
  if (uniform) return { value: toks.map((t) => scaleTok(t, ratios[0]!)).join(' '), reasons };
  return { value: expandSides(toks).map((t, i) => scaleTok(t, ratios[i]!)).join(' '), reasons };
}

const PXNUM = /^([-+]?(?:\d+\.?\d*|\.\d+))px$/i;
const asPx = (t: string): number | null => (ZERO.test(t) ? 0 : PXNUM.test(t) ? parseFloat(PXNUM.exec(t)![1]!) : null);

/** Ratios (one, or four sides) from the old computed value at the environment's width and the edit's new value. */
function ratiosFor(prop: string, newValue: string, probe: Probe, idx: number, width: number): number[] {
  const read = (p: string) => parseFloat(probe.computed(idx, p, width));
  if (SHORTHAND_SIDES.has(prop)) {
    const toks = splitTokens(newValue);
    if (toks.length < 1 || toks.length > 4) no('ratio-unit', `"${newValue}" is not a valid ${prop} value`);
    const sides = expandSides(toks);
    return SIDES.map((side, i) => {
      const t = sides[i]!;
      if (t.toLowerCase() === 'auto') return 1;
      const n = asPx(t);
      if (n === null) no('ratio-unit', `the new ${prop} value "${t}" must be in px (or auto) so a ratio can be derived`);
      const old = read(`${prop}-${side}`);
      if (old > 0) return n! / old;
      if (n === 0) return 1;
      return no('ratio-base', `${prop}-${side} is 0 at ${width}px, so no ratio can be derived from the new value ${t}`);
    });
  }
  const n = asPx(newValue.trim());
  if (n === null) no('ratio-unit', `the new ${prop} value "${newValue}" must be in px so a ratio can be derived`);
  const old = read(prop);
  if (!(old > 0)) no('ratio-base', `${prop} is ${probe.computed(idx, prop, width) || 'unknown'} at ${width}px, so no ratio can be derived`);
  return [n! / old];
}

// ---------------------------------------------------------------------------------------------
// Declarations and the cascade
// ---------------------------------------------------------------------------------------------

interface D2 {
  rule: RuleNode;
  d: Decl;
  spec: number;
  order: number;
  chain: string[];
}

function collect(matched: Matched[], p: string): D2[] {
  const out: D2[] = [];
  for (const m of matched) {
    for (const d of m.rule.decls) {
      if (sameFamily(p, d.lprop)) no('shorthand-mix', `"${p}" and "${d.lprop}" (rule "${m.rule.selector}") are the same property family; mixing shorthand and longhand is not supported in v1`);
    }
    const d = lastDecl(m.rule.decls, p);
    if (d) out.push({ rule: m.rule, d, spec: m.spec, order: m.rule.order, chain: m.rule.conditions });
  }
  return out;
}

const key = (x: D2) => [x.d.important ? 1 : 0, x.spec, x.order];
function better(a: D2, b: D2): boolean {
  const ka = key(a);
  const kb = key(b);
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i]! > kb[i]!;
  return false;
}
function best(list: D2[]): D2 | undefined {
  let b: D2 | undefined;
  for (const x of list) if (!b || better(x, b)) b = x;
  return b;
}

/** Groups of conditional declarations by identical condition chain, each represented by its cascade winner. */
function chainGroups(all: D2[]): { chain: string[]; win: D2; first: number }[] {
  const by = new Map<string, D2[]>();
  for (const x of all) if (x.chain.length) (by.get(JSON.stringify(x.chain)) ?? by.set(JSON.stringify(x.chain), []).get(JSON.stringify(x.chain))!).push(x);
  return [...by.values()].map((l) => ({ chain: l[0]!.chain, win: best(l)!, first: Math.min(...l.map((x) => x.order)) })).sort((a, b) => a.first - b.first);
}

// ---------------------------------------------------------------------------------------------
// Emission: scoped selector, hook attribute, appended rules
// ---------------------------------------------------------------------------------------------

interface RuleLine {
  chain: string[];
  prop: string;
  value: string;
  important: boolean;
  /** Further declarations written in the same rule (the width overflow guard). */
  extra?: { prop: string; value: string; important: boolean }[];
}

interface Ctx {
  model: Model;
  el: ElementNode;
  probe: Probe;
  state: EditState;
  env: Environment;
  b: number;
  matched: Matched[];
  inline: InlineInfo | null;
  maxSpec: number;
  notes: ScaleNote[];
  patches: Patch[];
  dom: DomOp[];
  lines: RuleLine[];
  placements: string[];
  pins: Pin[];
  path: string;
  /** The page's tablet top T (see `tabletMax`). */
  t: number;
  /** True for a Desktop (linked) edit: pins of the small views are then kept in force after the new rules. */
  linked: boolean;
}

/** A Phone or Tablet edit is always custom (the `link` flag is ignored there); a Desktop edit is custom only when it says `link: false`. */
export const isCustomEdit = (edit: { environment?: Environment; link?: boolean }): boolean => edit.link === false || (edit.environment ?? 'desktop') !== 'desktop';

function makeCtx(model: Model, el: ElementNode, edit: Edit, probe: Probe, state: EditState): Ctx {
  const env = edit.environment ?? 'desktop';
  const b = breakpointOf(model);
  if (env === 'tablet' && tabletMin(b) > TABLET_WIDTH) {
    no('tablet-covered-by-phone', `this page's own phone breakpoint is ${fmt(b)}px, so the Tablet width (${TABLET_WIDTH}px) is already a phone width and there is no Tablet range; make the edit in Phone instead`);
  }
  return {
    model, el, probe, state, t: tabletMax(model), linked: false,
    env,
    b,
    matched: matchedRules(model, el, probe),
    inline: inlineStyle(model, el),
    maxSpec: 0, notes: [], patches: [], dom: [], lines: [], placements: [], pins: [...state.pins],
    path: describe(model, el.index),
  };
}

function addPin(ctx: Ctx, property: string, environment: Environment, value: string): void {
  ctx.pins = ctx.pins.filter((p) => !(p.selector === ctx.path && p.property === property && p.environment === environment));
  ctx.pins.push({ selector: ctx.path, property, environment, value });
}

function scopedSelector(ctx: Ctx): string {
  const { el, model } = ctx;
  const id = attrOf(el, 'id')?.value;
  const need = ctx.maxSpec;
  if (id && /^[A-Za-z_][\w-]*$/.test(id)) {
    for (let k = 1; k <= 3; k++) {
      const sel = `#${id}`.repeat(k);
      if (specificity(sel) >= need) return sel;
    }
    return no('specificity', `a page rule for this element is more specific than the element's id selector can beat`);
  }
  let n: string;
  const have = attrOf(el, 'data-ue')?.value;
  if (have && /^\d+$/.test(have)) n = have;
  else {
    let max = 0;
    for (const e of model.primary.elements) {
      const a = attrOf(e, 'data-ue')?.value;
      if (a && /^\d+$/.test(a)) max = Math.max(max, parseInt(a, 10));
    }
    n = String(max + 1);
  }
  for (let k = 1; k <= 6; k++) {
    const sel = `[data-ue="${n}"]`.repeat(k);
    if (specificity(sel) >= need) {
      if (!have && !ctx.dom.some((o) => o.type === 'attr' && o.name === 'data-ue')) {
        ctx.patches.push(addAttribute(model.primary.file, model.primary.source, el, 'data-ue', n));
        ctx.dom.push({ type: 'attr', index: el.index, name: 'data-ue', value: n });
      }
      return sel;
    }
  }
  return no('specificity', 'a page rule with an id selector applies to this element and the element has no id, so an attribute hook cannot out-specify it');
}

const lineText = (sel: string, l: RuleLine): string => {
  const more = (l.extra ?? []).map((x) => ` ${x.prop}: ${x.value}${x.important ? ' !important' : ''};`).join('');
  const rule = `${sel} { ${l.prop}: ${l.value}${l.important ? ' !important' : ''};${more} }`;
  return l.chain.length ? `${l.chain.join(' { ')} { ${rule} }${' }'.repeat(l.chain.length - 1)}` : rule;
};

/** Where the appended lines go: the page's last stylesheet (cascade order), before its closing tag. */
/** Offset of a trailing `/*# sourceMappingURL=... *\/` comment (followed only by whitespace) in a stylesheet text, or -1. */
export function sourceMapStart(text: string): number {
  const m = /\/\*[#@]\s*sourceMappingURL=[^*]*\*\/\s*$/.exec(text);
  return m ? m.index : -1;
}

/** Appends rule lines like `appendCssLF`, with every line break the engine adds in the file's own line ending (CRLF files stay CRLF). */
export function appendCss(model: Model, lines: string[]): { patch: Patch; dom: DomOp } {
  const r = appendCssLF(model, lines);
  const host = r.patch.file === model.primary.file ? model.primary.source : model.companions[r.patch.file]!.source;
  const eol = eolAt(host, r.patch.start);
  return eol === '\n' ? r : { ...r, patch: { ...r.patch, text: r.patch.text.replace(/\n/g, eol) } };
}

export function appendCssLF(model: Model, lines: string[]): { patch: Patch; dom: DomOp } {
  const sheet = model.sheets[model.sheets.length - 1];
  if (!sheet) return no('no-stylesheet', 'the page has no <style> block or supplied stylesheet to add the override rules to');
  if (sheet.file === model.primary.file) {
    const src = model.primary.source;
    const el = model.primary.elements[sheet.elementIndex]!;
    if (el.ltag !== 'style' || el.endTagStart === -1) return no('no-stylesheet', 'the last stylesheet is not a closed <style> block');
    const content = src.slice(el.startTagEnd, el.endTagStart);
    const lastLine = content.split('\n').filter((l) => l.trim()).pop() ?? '';
    const indent = /^[ \t]*/.exec(lastLine)![0];
    const lineStart = src.lastIndexOf('\n', el.endTagStart - 1) + 1;
    const own = /^[ \t]*$/.test(src.slice(lineStart, el.endTagStart)) && lineStart > el.startTagEnd - 1;
    const smap = sourceMapStart(content);
    if (smap >= 0) {
      const mapAt = el.startTagEnd + smap;
      const mapLine = src.lastIndexOf('\n', mapAt - 1) + 1;
      const alone = mapLine > el.startTagEnd - 1 && /^[ \t]*$/.test(src.slice(mapLine, mapAt));
      const text = alone ? lines.map((l) => `${indent}${l}\n`).join('') : `${lines.map((l) => l).join('\n')}\n`;
      const at = alone ? mapLine : mapAt;
      return { patch: { file: model.primary.file, start: at, end: at, text }, dom: { type: 'css', index: sheet.elementIndex, text: `${lines.join('\n')}\n` } };
    }
    const at = own ? lineStart : el.endTagStart;
    const text = own ? lines.map((l) => `${indent}${l}\n`).join('') : `\n${lines.map((l) => `${indent}${l}`).join('\n')}\n`;
    return { patch: { file: model.primary.file, start: at, end: at, text }, dom: { type: 'css', index: sheet.elementIndex, text: `${lines.join('\n')}\n` } };
  }
  const src = model.companions[sheet.file]!.source;
  const smap = sourceMapStart(src);
  if (smap >= 0) {
    const mapLine = src.lastIndexOf('\n', smap - 1) + 1;
    const alone = /^[ \t]*$/.test(src.slice(mapLine, smap));
    const at = alone ? mapLine : smap;
    return { patch: { file: sheet.file, start: at, end: at, text: `${lines.join('\n')}\n` }, dom: { type: 'css', index: sheet.elementIndex, text: `${lines.join('\n')}\n` } };
  }
  const text = `${src === '' || src.endsWith('\n') ? '' : '\n'}${lines.join('\n')}\n`;
  return { patch: { file: sheet.file, start: src.length, end: src.length, text }, dom: { type: 'css', index: sheet.elementIndex, text: `${lines.join('\n')}\n` } };
}

/**
 * A Desktop edit after a Phone or Tablet custom value for the same element and property must not override it. Where the lines this edit writes would
 * win over a view's pinned value (a later rule of the same specificity matching a width inside that view), the view's own rule, as the engine wrote it, is
 * written again after them. Nothing is added when the lines already keep the pinned value in force.
 */
function restatePins(ctx: Ctx): void {
  if (!ctx.linked) return;
  const written = new Set(ctx.lines.map((l) => l.prop));
  const id = attrOf(ctx.el, 'id')?.value;
  const hook = attrOf(ctx.el, 'data-ue')?.value;
  const hookRe = [id && /^[A-Za-z_][\w-]*$/.test(id) ? new RegExp(`^(#${id})+$`) : null, hook && /^\d+$/.test(hook) ? new RegExp(`^(\\[data-ue="${hook}"\\])+$`) : null].filter((x): x is RegExp => !!x);
  for (const pin of ctx.pins) {
    if (pin.selector !== ctx.path || pin.environment === 'desktop' || !written.has(pin.property)) continue;
    const wE = envWidth(pin.environment);
    let last: RuleLine | undefined;
    for (const l of ctx.lines) if (l.prop === pin.property && chainMatches(l.chain, wE)) last = l;
    if (!last || last.value === pin.value) continue;
    const cond = envCondition(pin.environment, ctx.b, ctx.t);
    // the view's own earlier rule (it may carry more than one declaration, for example a flex-basis or the max-width guard)
    let decls: Decl[] | null = null;
    for (const sheet of ctx.model.sheets) for (const r of sheet.rules) {
      if (r.conditions.length === 1 && r.conditions[0] === cond && r.selectors.every((x) => hookRe.some((re) => re.test(x.trim()))) && lastDecl(r.decls, pin.property)) decls = r.decls;
    }
    if (decls && decls.length) {
      const [first, ...rest] = decls;
      ctx.lines.push({ chain: [cond], prop: first!.lprop, value: first!.value, important: first!.important, extra: rest.length ? rest.map((d) => ({ prop: d.lprop, value: d.value, important: d.important })) : undefined });
    } else ctx.lines.push({ chain: [cond], prop: pin.property, value: pin.value, important: last.important });
  }
}

function flush(ctx: Ctx): void {
  restatePins(ctx);
  if (ctx.lines.length === 0) return;
  const sel = scopedSelector(ctx);
  const text = ctx.lines.map((l) => lineText(sel, l));
  const { patch, dom } = appendCss(ctx.model, text);
  ctx.patches.push(patch);
  ctx.dom.push(dom);
}

function finish(ctx: Ctx, base: EditResult | null, warnings: string[]): EditResult {
  const baseOk = base && base.ok ? base : null;
  flush(ctx);
  return {
    ok: true,
    patches: [...(baseOk?.patches ?? []), ...ctx.patches],
    dom: [...(baseOk?.dom ?? []), ...ctx.dom],
    warnings,
    placement: [...(baseOk ? [baseOk.placement] : []), ...ctx.placements].join('; '),
    notes: [...(baseOk?.notes ?? []), ...ctx.notes],
    state: { pins: ctx.pins },
  };
}

// ---------------------------------------------------------------------------------------------
// Linked set
// ---------------------------------------------------------------------------------------------

const condText = (chain: string[]) => (chain.length ? chain.join(' ') : '(base)');

/** Linked ratio edit of one property when the page has media rules for it. Returns false if there are none. */
function linkedRatio(ctx: Ctx, p: string, V: string): boolean {
  const all = collect(ctx.matched, p);
  if (!all.some((x) => x.chain.length)) return false;
  for (const x of all) ctx.maxSpec = Math.max(ctx.maxSpec, x.spec);
  const w = envWidth(ctx.env);
  const ratios = ratiosFor(p, V, ctx.probe, ctx.el.index, w);
  const baseDecls = all.filter((x) => !x.chain.length);
  const baseWin = best(baseDecls);
  if (baseWin?.d.important) no('important-conflict', `"${p}" is set with !important in rule "${baseWin.rule.selector}"; an override would not win`);
  const groups = chainGroups(all);
  const active = all.filter((x) => chainMatches(x.chain, w));
  const win = best(active);
  const inl = ctx.inline ? lastDecl(ctx.inline.decls, p) : undefined;
  if (inl?.important) no('important-conflict', `"${p}" is set with !important in the element's style attribute`);
  const winImportant = win?.d.important === true;
  const pinnedOther = (env: Environment | 'both' | 'none') => env !== 'both' && env !== 'none' && env !== ctx.env && ctx.pins.some((q) => q.selector === ctx.path && q.property === p && q.environment === env);
  const noteFor = (value: string, chain: string[], reasons: string[]) => { for (const reason of reasons) ctx.notes.push({ property: p, condition: condText(chain), value, reason }); };

  const valueFor = (x: D2, isWin: boolean): string => {
    if (isWin) return V;
    const s = scaleValue(x.d.value, ratios);
    noteFor(x.d.value, x.chain, s.reasons);
    return s.value;
  };

  let baseEmitted = false;
  if (inl && ctx.inline) {
    // The element's own inline declaration is the base: replace it in place. Non-important media rules are
    // already beaten by it; important ones need an !important override below.
    const inlineWins = !winImportant;
    const v = inlineWins ? V : (() => { const s = scaleValue(inl.value, ratios); noteFor(inl.value, [], s.reasons); return s.value; })();
    ctx.patches.push(replaceDeclValue(ctx.model.primary.file, inl, v, ctx.inline.attr.quote));
    ctx.dom.push({ type: 'style', index: ctx.el.index, props: [[p, v]] });
    ctx.placements.push(`inline ${p} (scaled)`);
    for (const g of groups) {
      if (!g.win.d.important) continue;
      const pinned = pinnedOther(chainEnv(g.chain, ctx.b, ctx.t));
      ctx.lines.push({ chain: g.chain, prop: p, value: pinned ? g.win.d.value : valueFor(g.win, g.win === win), important: true });
    }
  } else {
    if (baseWin || !win) {
      const v = !baseWin ? V : baseWin === win ? V : (() => { const s = scaleValue(baseWin.d.value, ratios); noteFor(baseWin.d.value, [], s.reasons); return s.value; })();
      if (!baseWin || v !== baseWin.d.value) {
        ctx.lines.push({ chain: [], prop: p, value: v, important: false });
        baseEmitted = true;
      }
    }
    for (const g of groups) {
      const pinned = pinnedOther(chainEnv(g.chain, ctx.b, ctx.t));
      const value = pinned ? g.win.d.value : valueFor(g.win, g.win === win);
      if (baseEmitted || (!pinned && value !== g.win.d.value)) ctx.lines.push({ chain: g.chain, prop: p, value, important: g.win.d.important });
    }
    ctx.placements.push(`scoped rules for ${p}`);
  }
  // A linked edit made in a pinned environment keeps the pin but updates its value.
  const pin = ctx.pins.find((q) => q.selector === ctx.path && q.property === p && q.environment === ctx.env);
  if (pin) addPin(ctx, p, ctx.env, V);
  return true;
}

// ---------------------------------------------------------------------------------------------
// Linked width and height (docs/size-scaling-rules.md)
// ---------------------------------------------------------------------------------------------

const SIZE_PROPS = new Set(['width', 'height']);
const FIXED_LEN = /^([-+]?(?:\d+\.?\d*|\.\d+))(px|rem|em)$/i;
const ATTR_LEN = /^\s*(\d+(?:\.\d+)?)\s*(?:px)?\s*$/i;

// A flex item's main-size property is overridden by a non-auto flex-basis, so the basis must move with the size.

/** True when `prop` is the main-size property of a flex item whose computed flex-basis is not auto at width `w`. */
function flexMain(ctx: Ctx, prop: string, w: number): boolean {
  const parent = ctx.el.parent;
  if (!parent || parent.implied) return false;
  if (!ctx.probe.computed(parent.index, 'display', w).includes('flex')) return false;
  const row = ctx.probe.computed(parent.index, 'flex-direction', w).startsWith('row');
  if (!((prop === 'width' && row) || (prop === 'height' && !row))) return false;
  const basis = ctx.probe.computed(ctx.el.index, 'flex-basis', w).trim();
  return basis !== '' && basis !== 'auto';
}

/** Refuses a flex item that can grow: the container, not the size, would decide how large it is. */
function checkGrow(ctx: Ctx, p: string, w: number): void {
  if (parseFloat(ctx.probe.computed(ctx.el.index, 'flex-grow', w)) > 0) {
    no('flex-grow', `the ${p} of this flex item cannot be set exactly: its flex-grow is above 0, so the container decides how large it is (setting flex-grow: 0 would also change how its siblings share the space)`);
  }
}

/** The basis in a `flex` shorthand value: a length, percentage or `content` token; `0%` when only numbers are given. */
export function basisOfFlex(value: string): string {
  const toks = splitTokens(value.trim().toLowerCase());
  if (toks.length === 1 && ['none', 'auto', 'initial'].includes(toks[0]!)) return 'auto';
  const nums = toks.filter((t) => /^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(t));
  const other = toks.find((t) => !/^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(t));
  if (other) return other;
  if (nums.length === 3) return `${nums[2]}px`;
  return nums.length ? '0%' : 'auto';
}

/** The declared flex-basis that wins at width `w` (from `flex` or `flex-basis`), or null. */
function declaredBasis(ctx: Ctx, w: number): string | null {
  const cands: D2[] = [];
  for (const m of ctx.matched) {
    if (!chainMatches(m.rule.conditions, w)) continue;
    const ds = m.rule.decls.filter((d) => d.lprop === 'flex' || d.lprop === 'flex-basis');
    const d = ds[ds.length - 1];
    if (d) cands.push({ rule: m.rule, d, spec: m.spec, order: m.rule.order, chain: m.rule.conditions });
  }
  const win = best(cands);
  const ins = ctx.inline ? ctx.inline.decls.filter((d) => d.lprop === 'flex' || d.lprop === 'flex-basis') : [];
  const inl = ins[ins.length - 1];
  const d = inl && !win?.d.important ? inl : win?.d;
  if (!d) return null;
  return d.lprop === 'flex' ? basisOfFlex(d.value) : d.value.trim();
}

/** The flex-basis written with a size needs !important only to beat an inline or important page declaration. */
function basisImportant(ctx: Ctx): boolean {
  if (ctx.inline && ctx.inline.decls.some((d) => d.lprop === 'flex' || d.lprop === 'flex-basis')) return true;
  return ctx.matched.some((m) => m.rule.decls.some((d) => (d.lprop === 'flex' || d.lprop === 'flex-basis') && d.important));
}

type Pair = [string, string];

/**
 * Linked width or height edit made in environment E. The other environment O keeps the page's own value
 * unless the winning declaration there is a fixed length (px, rem, em, or a numeric HTML attribute), which
 * is multiplied by the same ratio. Flexible or undeclared values are left alone and the new value applies
 * only inside E's condition. Every px width gets `max-width: 100%` when the element's own max-width is
 * `none` there. A flex item with a non-auto flex-basis gets its basis written with the size, and where O is
 * also such an item, O's basis is the declaration that is scaled. Returns false (nothing written) when the
 * old behaviour should be used instead.
 */
function linkedSize(ctx: Ctx, p: string, V: string): boolean {
  const E = ctx.env;
  const O = other(E);
  const wE = envWidth(E);
  const wO = envWidth(O);
  const newPx = asPx(V.trim());
  const v0 = parseFloat(ctx.probe.computed(ctx.el.index, p, wE));
  if (newPx === null || !(v0 > 0) || ctx.model.sheets.length === 0) return false;
  const r = newPx / v0;
  const Vt = V.trim();

  const all = collect(ctx.matched, p);
  for (const x of all) ctx.maxSpec = Math.max(ctx.maxSpec, x.spec);
  for (const x of all) if (x.d.important) no('important-conflict', `"${p}" is set with !important in rule "${x.rule.selector}"; an override would not win`);
  const inl = ctx.inline ? lastDecl(ctx.inline.decls, p) : undefined;
  if (inl?.important) no('important-conflict', `"${p}" is set with !important in the element's style attribute`);
  const flexE = flexMain(ctx, p, wE);
  const flexO = flexMain(ctx, p, wO);
  if (flexE) checkGrow(ctx, p, wE);
  if (flexO) checkGrow(ctx, p, wO);
  for (const m of ctx.matched) for (const d of m.rule.decls) if ((flexE || flexO) && d.important && (d.lprop === 'flex' || d.lprop === 'flex-basis')) no('important-conflict', `"${d.lprop}" is set with !important in rule "${m.rule.selector}"; an override would not win`);

  // The declaration that wins at O's reference width: inline style, else the cascade winner, else the HTML attribute.
  const win = best(all.filter((x) => chainMatches(x.chain, wO)));
  const attrVal = attrOf(ctx.el, p)?.value ?? null;
  let declared: string | null = inl ? inl.value : win ? win.d.value : null;
  let fromAttr = false;
  if (declared === null && attrVal !== null) {
    const m = ATTR_LEN.exec(attrVal);
    if (m) { declared = `${m[1]}px`; fromAttr = true; } else declared = attrVal;
  }
  const fixed = declared !== null && FIXED_LEN.test(declared.trim());
  const pinnedO = ctx.pins.some((q) => q.selector === ctx.path && q.property === p && q.environment === O);
  const important = !!(ctx.inline && inl); // an inline declaration beats rules, so the override must be !important
  const bImportant = basisImportant(ctx);
  const maxAt = (w: number) => ctx.probe.computed(ctx.el.index, 'max-width', w).trim();
  const guardOn = (w: number) => p === 'width' && (maxAt(w) === 'none' || maxAt(w) === '');
  const guardIm = !!(ctx.inline && lastDecl(ctx.inline.decls, 'max-width'));
  const mk = (chain: string[], decls: Pair[], guard: boolean): RuleLine => {
    const [first, ...rest] = decls as [Pair, ...Pair[]];
    const extra = rest.map(([prop, value]) => ({ prop, value, important: prop === 'flex-basis' ? bImportant : important }));
    if (guard) extra.push({ prop: 'max-width', value: '100%', important: guardIm });
    return { chain, prop: first[0], value: first[1], important: first[0] === 'flex-basis' ? bImportant : important, extra: extra.length ? extra : undefined };
  };
  const chainE = [envCondition(E, ctx.b, ctx.t)];
  const chainO = [envCondition(O, ctx.b, ctx.t)];
  const declsE: Pair[] = flexE ? [[p, Vt], ['flex-basis', Vt]] : [[p, Vt]];
  const same = (a: Pair[], b: Pair[]) => a.length === b.length && a.every((x, i) => x[0] === b[i]![0] && x[1] === b[i]![1]);

  let declsO: Pair[] | null = null;
  let alone = '';
  let aloneValue: string | null = declared;
  if (flexO) {
    const basis = declaredBasis(ctx, wO);
    if (pinnedO) { alone = `"${p}" is pinned in the ${O} environment`; aloneValue = basis; }
    else if (basis !== null && FIXED_LEN.test(basis)) {
      declsO = [['flex-basis', scaleValue(basis, [r]).value]];
      if (fixed) declsO.push([p, scaleValue(declared!.trim(), [r]).value]);
    } else { alone = `flex-basis ${basis ?? '(not declared)'} is not a fixed px, rem or em length`; aloneValue = basis; }
  } else if (fixed && !pinnedO) {
    declsO = [[p, scaleValue(declared!.trim(), [r]).value]];
  } else {
    alone = pinnedO ? `"${p}" is pinned in the ${O} environment` : declared === null ? `${p} is not declared for the ${O} environment` : `${declared.trim()} is not a fixed px, rem or em length`;
  }

  if (declsO) {
    if (same(declsE, declsO) && guardOn(wE) === guardOn(wO)) {
      ctx.lines.push(mk([], declsE, guardOn(wE)));
      ctx.placements.push(`${p} (same value at every width)`);
    } else {
      ctx.lines.push(mk(chainE, declsE, guardOn(wE)));
      ctx.lines.push(mk(chainO, declsO, guardOn(wO)));
      ctx.placements.push(`${p} inside ${chainE[0]} and scaled inside ${chainO[0]}${fromAttr ? ' (from the HTML attribute)' : ''}${flexE || flexO ? ' (with flex-basis)' : ''}`);
    }
  } else {
    ctx.lines.push(mk(chainE, declsE, guardOn(wE)));
    ctx.notes.push({ property: p, condition: chainO[0]!, value: aloneValue ?? '(not declared)', reason: `left alone: ${alone}; the new ${p} applies only inside ${chainE[0]}` });
    ctx.placements.push(`${p} inside ${chainE[0]} only`);
  }
  const pin = ctx.pins.find((q) => q.selector === ctx.path && q.property === p && q.environment === E);
  if (pin) addPin(ctx, p, E, Vt);
  return true;
}

/** Linked non-ratio edit (colour, width, height ...) when the page has media rules for the property. */
function linkedPlain(ctx: Ctx, p: string, V: string, warnings: string[]): { handled: boolean; base?: EditResult } {
  const all = collect(ctx.matched, p);
  if (!all.some((x) => x.chain.length)) return { handled: false };
  for (const x of all) ctx.maxSpec = Math.max(ctx.maxSpec, x.spec);
  const b = ctx.pins.find((q) => q.selector === ctx.path && q.property === p && q.environment !== ctx.env);
  if (b) no('pinned-conflict', `"${p}" is pinned in the ${b.environment} environment; a linked edit written as an inline style would override that pinned value`);
  const base = placeHtml(ctx.model, ctx.el, [[p, V]], ctx.probe, warnings, { forceInline: true, allowConditional: true });
  for (const g of chainGroups(all)) {
    if (g.win.d.important) ctx.lines.push({ chain: g.chain, prop: p, value: V, important: true });
  }
  if (p === 'width' || p === 'height') {
    ctx.notes.push({ property: p, condition: '(all widths)', value: V, reason: `${p} could not be scaled (the new value is not in px, or there is no usable old value): it applies at every width` });
  }
  return { handled: true, base };
}

export function htmlSetResponsive(model: Model, edit: Extract<Edit, { op: 'set' }>, el: ElementNode, probe: Probe, state: EditState, warnings: string[]): EditResult {
  const props: [string, string][] = Object.entries(edit.properties).map(([p, v]) => [p.toLowerCase(), v]);
  const ctx = makeCtx(model, el, edit, probe, state);
  if (isCustomEdit(edit)) return unlinkedSet(ctx, props, warnings);
  ctx.linked = true;
  const rest: Record<string, string> = {};
  let base: EditResult | null = null;
  let any = false;
  for (const [p, v] of props) {
    if (RATIO_PROPS.has(p)) {
      if (linkedRatio(ctx, p, v)) any = true;
      else rest[p] = v;
    } else if (SIZE_PROPS.has(p) && linkedSize(ctx, p, v)) {
      any = true;
    } else {
      const r = linkedPlain(ctx, p, v, warnings);
      if (r.handled) {
        any = true;
        if (r.base) base = mergeBase(base, r.base);
      } else rest[p] = v;
    }
  }
  if (!any) return htmlSet(model, el, edit.properties, probe, warnings);
  if (Object.keys(rest).length) {
    const r = htmlSet(model, el, rest, probe, warnings);
    if (!r.ok) return r;
    base = mergeBase(base, r);
  }
  return finish(ctx, base, warnings);
}

function mergeBase(a: EditResult | null, b: EditResult): EditResult {
  if (!a || !a.ok || !b.ok) return b;
  return { ok: true, patches: [...a.patches, ...b.patches], dom: [...a.dom, ...b.dom], warnings: b.warnings, placement: `${a.placement}; ${b.placement}` };
}

// ---------------------------------------------------------------------------------------------
// Unlinked edits: written inside the environment's own media condition
// ---------------------------------------------------------------------------------------------

function importantNeeded(ctx: Ctx, all: D2[], p: string): boolean {
  if (ctx.inline && lastDecl(ctx.inline.decls, p)) return true; // must beat the element's own inline declaration
  if (ctx.env !== 'tablet') return all.some((x) => x.d.important && (!x.chain.length || chainEnv(x.chain, ctx.b) === ctx.env || chainEnv(x.chain, ctx.b) === 'both'));
  return all.some((x) => x.d.important && (!x.chain.length || ['tablet', 'desktop', 'both'].includes(chainEnv(x.chain, ctx.b, ctx.t))));
}

function unlinkedSet(ctx: Ctx, props: [string, string][], warnings: string[]): EditResult {
  const chain = [envCondition(ctx.env, ctx.b, ctx.t)];
  for (const [p, v] of props) {
    const all = collect(ctx.matched, p);
    for (const x of all) ctx.maxSpec = Math.max(ctx.maxSpec, x.spec);
    const w = envWidth(ctx.env);
    const flex = SIZE_PROPS.has(p) && flexMain(ctx, p, w);
    if (flex) checkGrow(ctx, p, w);
    ctx.lines.push({ chain, prop: p, value: v, important: importantNeeded(ctx, all, p), extra: flex ? [{ prop: 'flex-basis', value: v, important: basisImportant(ctx) }] : undefined });
    addPin(ctx, p, ctx.env, v);
    ctx.placements.push(`${p} inside ${chain[0]}`);
  }
  return finish(ctx, null, warnings);
}

function guardTransformable(ctx: Ctx, el: ElementNode): void {
  const w = envWidth(ctx.env);
  if (ctx.probe.computed(el.index, 'display', w) === 'inline') no('not-transformable', `<${el.tag}> is display:inline, where CSS transforms have no effect; make it inline-block or block first`);
  for (let q = el.parent; q; q = q.parent) {
    const t = ctx.probe.computed(q.index, 'transform', w);
    if (t && t !== 'none') no('transformed-ancestor', `an ancestor (<${q.tag}>) has a transform, so a screen-space shift cannot be written as a plain translate in v1`);
  }
}

export function htmlUnlinkedOffset(model: Model, edit: Extract<Edit, { op: 'offset' }>, el: ElementNode, probe: Probe, state: EditState, warnings: string[]): EditResult {
  const ctx = makeCtx(model, el, edit, probe, state);
  guardTransformable(ctx, el);
  if (ctx.inline && lastDecl(ctx.inline.decls, 'transform')) no('inline-conflict', 'the element sets transform in its style attribute; an environment-only offset cannot be written without overriding it everywhere');
  const all = collect(ctx.matched, 'transform');
  for (const x of all) ctx.maxSpec = Math.max(ctx.maxSpec, x.spec);
  const w = envWidth(ctx.env);
  const win = best(all.filter((x) => chainMatches(x.chain, w)));
  const baseT = win ? win.d.value.trim() : '';
  const t = `translate(${fmt(edit.dx)}px, ${fmt(edit.dy)}px)` + (baseT && baseT !== 'none' ? ` ${baseT}` : '');
  const chain = [envCondition(ctx.env, ctx.b, ctx.t)];
  ctx.lines.push({ chain, prop: 'transform', value: t, important: importantNeeded(ctx, all, 'transform') });
  addPin(ctx, 'transform', ctx.env, t);
  ctx.placements.push(`transform inside ${chain[0]}`);
  return finish(ctx, null, warnings);
}

export function htmlUnlinkedReorder(model: Model, edit: Extract<Edit, { op: 'reorder' }>, el: ElementNode, probe: Probe, state: EditState, warnings: string[]): EditResult {
  const ctx = makeCtx(model, el, edit, probe, state);
  const w = envWidth(ctx.env);
  const sib = model.primary.elements[edit.sibling];
  if (!sib || sib.implied) no('no-sibling', 'the anchor element does not exist or has no source text');
  if (sib === el) no('same-element', 'cannot place an element relative to itself');
  const parent = el.parent;
  if (!parent || sib!.parent !== parent) no('different-parents', 'reordering is only supported between siblings of the same parent');
  if (parent!.implied) no('implied-parent', `the parent <${parent!.tag}> is created by the parser and has no source text`);
  const display = probe.computed(parent!.index, 'display', w);
  if (!/flex|grid/.test(display)) {
    no('order-needs-flex-or-grid', `the parent <${parent!.tag}> is display: ${display || 'block'} at this width; the CSS order property only works inside a flex or grid container, so a ${ctx.env}-only reorder cannot be written without moving the element in the page for every width`);
  }
  const kids = parent!.children.filter((k) => !k.implied);
  const orders = kids.map((k) => probe.computed(k.index, 'order', w));
  if (new Set(orders).size !== 1) no('order-values-differ', 'the siblings already have different order values; adding one more cannot place the element reliably');
  const o = parseInt(orders[0]!, 10);
  const ei = kids.indexOf(el);
  const si = kids.indexOf(sib!);
  const first = edit.placement === 'before' && si === 0;
  const last = edit.placement === 'after' && si === kids.length - 1;
  if (!first && !last) no('order-position', 'changing only this element\'s order can place it first or last among its siblings, not between them');
  if ((first && ei === 0) || (last && ei === kids.length - 1)) return { ok: true, patches: [], dom: [], warnings, placement: 'already in place', state };
  const all = collect(ctx.matched, 'order');
  for (const x of all) ctx.maxSpec = Math.max(ctx.maxSpec, x.spec);
  const chain = [envCondition(ctx.env, ctx.b, ctx.t)];
  const value = String(first ? o - 1 : o + 1);
  ctx.lines.push({ chain, prop: 'order', value, important: importantNeeded(ctx, all, 'order') });
  addPin(ctx, 'order', ctx.env, value);
  ctx.placements.push(`order inside ${chain[0]}`);
  return finish(ctx, null, warnings);
}

// ---------------------------------------------------------------------------------------------
// Review list
// ---------------------------------------------------------------------------------------------

export interface UnlinkedItem {
  selector: string;
  property: string;
  environment: Environment;
  value: string;
}

/** Every unlinked or pinned override recorded in an edit-list state, for a "review custom items" view. */
export function listUnlinked(state: EditState): UnlinkedItem[] {
  return state.pins
    .map((p) => ({ selector: p.selector, property: p.property, environment: p.environment, value: p.value }))
    .sort((a, b) => a.selector.localeCompare(b.selector) || a.property.localeCompare(b.property) || a.environment.localeCompare(b.environment));
}

export { other as otherEnvironment };
