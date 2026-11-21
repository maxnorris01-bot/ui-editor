import { createModel, sources } from './model';
import { no } from './edit';
import { contentEnd } from './markup';
import { exportFiles } from './patch';
import type { ContentEdit, DomOp, EditResult, EditState, ElementNode, Model, Patch } from './types';

/**
 * Content edits: `insert` (a new element in document order), `text` (an element's text), `remove` (delete an element) and
 * `note` (a comment for an AI). They apply at every screen width, ignore `environment` and `link`, and make no pins.
 *
 * Every edit is a text patch against the current model (the file is never re-printed). Before a result is returned the
 * patched text is parsed again and checked: the structure must be exactly what was asked for, otherwise the edit is refused
 * with the true reason and nothing changes. Rules and limits: docs/adr/0004-insert-text-remove-note.md.
 */
export function applyContentEdit(model: Model, edit: ContentEdit, state: EditState, warnings: string[]): EditResult {
  switch (edit.op) {
    case 'text':
      return textEdit(model, edit.target, edit.text, warnings);
    default:
      return no('not-implemented', `edit kind "${edit.op}" is not available yet`) as never;
  }
}

// ---------------------------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------------------------

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
/** Elements whose content the parser reads as raw text (or text with entities only): typed text cannot simply be escaped there. */
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'plaintext', 'noscript', 'noembed', 'noframes', 'iframe', 'pre', 'listing']);

/** `&`, `<` and `>` become entities; nothing else changes. */
export const escapeText = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Typed text as it will be written: carriage returns become line feeds; NUL cannot be represented. */
function cleanText(text: string): string {
  if (text.includes('\u0000')) no('invalid-character', 'the text contains a NUL character, which HTML and XML cannot hold');
  return text.replace(/\r\n?/g, '\n');
}

export function elementAt(model: Model, index: number): ElementNode {
  const el = model.primary.elements[index];
  if (!el) return no('no-element', `no element with index ${index}`);
  if (el.implied) return no('implied', `<${el.tag}> is created by the parser and has no source text`);
  return el;
}

/** The model of the patched text (every file), for the structural checks done before a result is returned. */
export function patchedModel(model: Model, patches: Patch[]): { files: Record<string, string>; model: Model } {
  const files = exportFiles(sources(model), patches);
  const companions: Record<string, string> = {};
  for (const href of Object.keys(model.companions)) companions[href] = files[href] ?? '';
  const kind = model.primary.kind as 'html' | 'svg';
  return { files, model: createModel(files[model.primary.file] ?? '', kind, companions, model.primary.file) };
}

export const tagSequence = (m: Model): string[] => m.primary.elements.map((e) => e.ltag);
export const sameList = (a: string[], b: string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

/** Content range of an element (between its start tag and its end tag, or the end of its content when it has no end tag). */
function innerRange(src: string, el: ElementNode): [number, number] {
  return [el.startTagEnd, el.endTagStart !== -1 ? el.endTagStart : contentEnd(src, el)];
}

// ---------------------------------------------------------------------------------------------
// text
// ---------------------------------------------------------------------------------------------

function textEdit(model: Model, target: number, typedRaw: string, warnings: string[]): EditResult {
  const el = elementAt(model, target);
  const src = model.primary.source;
  const file = model.primary.file;
  const typed = cleanText(typedRaw);
  if (VOID.has(el.ltag) && el.namespace === 'html') no('void-element', `<${el.tag}> is a void element: it has no text`);
  if (el.selfClosing || (el.endTagStart === -1 && el.namespace !== 'html')) no('self-closing', `<${el.tag}> is written self-closing, so there is no text range to replace`);
  if (RAW_TEXT.has(el.ltag) && el.namespace === 'html') no('raw-text-element', `<${el.tag}> holds raw text: the text is not read the way other elements' text is, so it cannot be edited safely`);
  if (el.children.length > 0) no('mixed-content', `<${el.tag}> has child elements: replacing its text would delete them`);
  const [a, b] = innerRange(src, el);
  if (model.primary.comments.some((c) => c.start >= a && c.end <= b)) no('has-comment', `<${el.tag}> contains a comment: replacing its text would delete it`);
  const inner = src.slice(a, b);
  const lead = /^\s*/.exec(inner)![0];
  const trail = lead.length === inner.length ? '' : /\s*$/.exec(inner)![0];
  const core = inner.slice(lead.length, inner.length - trail.length);
  const written = escapeText(typed);
  if (core === written) return { ok: true, patches: [], dom: [], warnings, placement: 'text unchanged' };
  const patches: Patch[] = [{ file, start: a + lead.length, end: b - trail.length, text: written }];
  const after = patchedModel(model, patches).model;
  if (!sameList(tagSequence(model), tagSequence(after)) || after.primary.parseErrors > model.primary.parseErrors) {
    no('parser-reinterprets', `the HTML parser would read the new text of <${el.tag}> differently from how it was typed`);
  }
  const dom: DomOp[] = [{ type: 'html', index: el.index, html: lead + written + trail }];
  return { ok: true, patches, dom, warnings, placement: `text of <${el.tag}> replaced` };
}

