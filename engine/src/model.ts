import { parseCssFile, parseRules } from './css';
import { parseMarkup } from './markup';
import type { ElementNode, Kind, Model, ParsedFile, Sheet } from './types';

/**
 * parse(source, kind): a tree with source offsets for every element, attribute value and CSS
 * declaration, for HTML, SVG and CSS.
 */
export function parse(source: string, kind: Kind, file = kind === 'css' ? 'style.css' : `document.${kind}`): ParsedFile {
  return kind === 'css' ? parseCssFile(file, source) : parseMarkup(file, source, kind);
}

const attr = (el: ElementNode, name: string) => el.attrs.find((a) => a.lname === name);

/**
 * Build the full model: the primary document plus companion CSS files keyed by the href the
 * document uses. Stylesheets are ordered the way the cascade sees them (document order of
 * <style> and <link rel=stylesheet>); a referenced but unsupplied stylesheet is recorded in
 * `missingStylesheets` (detected, never guessed).
 */
export function createModel(
  source: string,
  kind: Exclude<Kind, 'css'>,
  companions: Record<string, string> = {},
  file = `document.${kind}`,
): Model {
  const primary = parse(source, kind, file);
  const parsedCompanions: Record<string, ParsedFile> = {};
  for (const [href, text] of Object.entries(companions)) parsedCompanions[href] = parseCssFile(href, text);

  const sheets: Sheet[] = [];
  const missing: string[] = [];
  let order = 0;
  for (const el of primary.elements) {
    if (el.implied) continue;
    if (el.ltag === 'style') {
      const a = el.startTagEnd;
      const b = el.endTagStart === -1 ? el.end : el.endTagStart;
      const { rules, next } = parseRules(file, source, a, order, b);
      order = next;
      sheets.push({ file, elementIndex: el.index, rules });
    } else if (el.ltag === 'link') {
      const rel = attr(el, 'rel')?.value?.toLowerCase() ?? '';
      const href = attr(el, 'href')?.value;
      if (rel.split(/\s+/).includes('stylesheet') && href) {
        const comp = parsedCompanions[href];
        if (!comp) {
          missing.push(href);
          continue;
        }
        const rules = comp.rules.map((r) => ({ ...r, order: order++ }));
        sheets.push({ file: href, elementIndex: el.index, rules });
      }
    }
  }
  return { primary, companions: parsedCompanions, sheets, missingStylesheets: missing };
}

/** Source text of every file in the model by file key. */
export function sources(model: Model): Record<string, string> {
  const out: Record<string, string> = { [model.primary.file]: model.primary.source };
  for (const [href, f] of Object.entries(model.companions)) out[href] = f.source;
  return out;
}

/** A stable, human-readable path for an element: /html[1]/body[1]/div[2]/h1[1]. */
export function describe(model: Model, index: number): string {
  const el = model.primary.elements[index];
  if (!el) throw new Error(`no element ${index}`);
  const parts: string[] = [];
  for (let n: ElementNode | null = el; n; n = n.parent) {
    const sibs = n.parent ? n.parent.children : [n];
    const same = sibs.filter((s) => s.ltag === n!.ltag);
    parts.unshift(`${n.ltag}[${same.indexOf(n) + 1}]`);
  }
  return '/' + parts.join('/');
}

/** Inverse of `describe`: path to element index, or -1 when it does not resolve. */
export function select(model: Model, path: string): number {
  const segs = path.split('/').filter(Boolean);
  let level: ElementNode[] = model.primary.elements.filter((e) => e.parent === null);
  let found: ElementNode | undefined;
  for (const seg of segs) {
    const m = /^([^[]+)\[(\d+)\]$/.exec(seg);
    if (!m) return -1;
    const same = level.filter((e) => e.ltag === m[1]);
    found = same[Number(m[2]) - 1];
    if (!found) return -1;
    level = found.children;
  }
  return found ? found.index : -1;
}
