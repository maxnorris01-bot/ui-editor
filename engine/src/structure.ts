import { createModel, describe, select, sources } from './model';
import { blockOf, no } from './edit';
import { contentEnd } from './markup';
import { exportFiles } from './patch';
import type { CommentInfo, ContentEdit, DomOp, EditResult, EditState, ElementNode, Model, NoteList, Patch, Pin } from './types';

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
    case 'remove':
      return removeEdit(model, edit.target, state, warnings);
    case 'note':
      return noteEdit(model, edit.target, edit.text, warnings);
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


// ---------------------------------------------------------------------------------------------
// Notes (the part remove and reorder need: which comment belongs to which element)
// ---------------------------------------------------------------------------------------------

export const NOTE_PREFIX = ' NOTE FOR AI: ';
export const PAGE_NOTE_PREFIX = ' NOTE FOR AI (whole page): ';

/** The note comment directly before an element, if there is one. */
export function noteOf(model: Model, el: ElementNode): CommentInfo | undefined {
  return model.primary.comments.find((c) => c.precedes === el.index && c.data.startsWith(NOTE_PREFIX));
}

/** Source block of an element for moving or deleting: the element (see `blockOf`) together with its note, when it has one. */
export function blockWithNote(model: Model, el: ElementNode): { start: number; end: number; line: boolean } {
  const note = noteOf(model, el);
  return blockOf(model.primary.source, el, note ? note.start : undefined);
}

// ---------------------------------------------------------------------------------------------
// remove
// ---------------------------------------------------------------------------------------------

/**
 * Range to delete for something that was written on its own line(s) or inline: a thing that is alone on its line goes with its
 * line break (and the newline before it when it was the last line of a file with no final newline); otherwise only itself.
 */
export function removalRange(src: string, start: number, end: number): [number, number] {
  const ls = src.lastIndexOf('\n', start - 1) + 1;
  const lead = src.slice(ls, start);
  const m = /^[ \t]*(\r?\n|$)/.exec(src.slice(end));
  if (/^[ \t]*$/.test(lead) && m) {
    if (m[1] === '' && ls > 0) return [src[ls - 2] === '\r' ? ls - 2 : ls - 1, src.length];
    return [ls, end + m[0].length];
  }
  return [start, end];
}

const subtreeOf = (el: ElementNode): ElementNode[] => [el, ...el.children.flatMap(subtreeOf)];
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Move the pins of an edit-list state through a structural edit: `map` gives an element's new index, or null when it is gone. */
export function remapPins(oldModel: Model, newModel: Model, pins: Pin[], map: (i: number) => number | null): Pin[] {
  const out: Pin[] = [];
  for (const p of pins) {
    const i = select(oldModel, p.selector);
    if (i < 0) { out.push(p); continue; }
    const j = map(i);
    if (j === null) continue;
    out.push({ ...p, selector: describe(newModel, j) });
  }
  return out;
}

const MANAGED_CLASS = /^new-(box|text|button)-\d+$/;

function removeEdit(model: Model, target: number, state: EditState, warnings: string[]): EditResult {
  const el = elementAt(model, target);
  const src = model.primary.source;
  const file = model.primary.file;
  if (!el.parent || (el.namespace === 'html' && ['html', 'head', 'body'].includes(el.ltag))) {
    no('protected-element', `<${el.tag}> is the document root (or <head>/<body>): removing it would remove the page itself`);
  }
  const sub = subtreeOf(el);
  const inSub = new Set(sub.map((x) => x.index));
  if (el.namespace === 'svg') {
    for (const x of sub) {
      const id = x.attrs.find((a) => a.lname === 'id')?.value;
      if (!id) continue;
      const re = new RegExp(`#${escRe(id)}(?![\\w-])`);
      for (const o of model.primary.elements) {
        if (inSub.has(o.index) || o.implied) continue;
        const hit = o.attrs.find((a) => a.value !== null && re.test(a.value));
        if (hit) no('referenced', `the element with id "${id}" is used by <${o.tag} ${hit.name}="${hit.value}">: removing it would leave that reference pointing at nothing`);
      }
    }
  }
  const blk = blockWithNote(model, el);
  const patches: Patch[] = [{ file, start: blk.start, end: blk.end, text: '' }];
  const dom: DomOp[] = [{ type: 'remove', index: el.index }];

  // The rule the engine appended for an inserted element goes with it (only a rule that is exactly `.new-...-N` and unused elsewhere).
  const used = new Map<string, number>();
  for (const o of model.primary.elements) if (!inSub.has(o.index)) for (const t of (o.attrs.find((a) => a.lname === 'class')?.value ?? '').split(/\s+/)) if (t) used.set(t, (used.get(t) ?? 0) + 1);
  for (const x of sub) {
    for (const tok of (x.attrs.find((a) => a.lname === 'class')?.value ?? '').split(/\s+/)) {
      if (!MANAGED_CLASS.test(tok) || used.has(tok)) continue;
      for (const sheet of model.sheets) {
        for (const rule of sheet.rules) {
          if (rule.conditional || rule.selector.trim() !== `.${tok}`) continue;
          const text = sheet.file === file ? src : model.companions[sheet.file]!.source;
          let [s, e] = removalRange(text, rule.start, rule.end);
          if (s === rule.start && text[s - 1] === '\n' && text.startsWith('</', e)) s -= 1; // the newline the engine added before a rule written right before </style>
          patches.push({ file: sheet.file, start: s, end: e, text: '' });
          dom.push({ type: 'css-remove', index: sheet.elementIndex, text: text.slice(rule.start, rule.end) });
        }
      }
    }
  }
  // The header exists only while a note does: if this was the last one, it goes too.
  const gone = (c: CommentInfo) => c.start >= blk.start && c.end <= blk.end;
  const remaining = model.primary.comments.filter((c) => !gone(c) && (c.data.startsWith(NOTE_PREFIX) || c.data.startsWith(PAGE_NOTE_PREFIX)));
  const header = model.primary.comments.find((c) => c.data === HEADER_DATA);
  if (header && !gone(header) && remaining.length === 0) {
    const [s, e] = removalRange(src, header.start, header.end);
    patches.push({ file, start: s, end: e, text: '' });
  }

  const after = patchedModel(model, patches).model;
  const n = sub.length;
  const want = tagSequence(model).filter((_, i) => i < el.index || i >= el.index + n);
  const map = (i: number): number | null => (i >= el.index && i < el.index + n ? null : i >= el.index + n ? i - n : i);
  const okParents = after.primary.elements.length === model.primary.elements.length - n && after.primary.elements.every((x, j) => {
    const old = j < el.index ? j : j + n;
    const op = model.primary.elements[old]!.parent;
    return (op ? map(op.index) : -1) === (x.parent ? x.parent.index : -1);
  });
  if (!sameList(want, tagSequence(after)) || !okParents) no('parser-reinterprets', `the HTML parser would read the file differently once <${el.tag}> is removed`);
  const pins = remapPins(model, after, state.pins, map);
  return { ok: true, patches, dom, warnings, placement: blk.line ? 'removed whole lines' : 'removed element text', state: { pins } };
}

// ---------------------------------------------------------------------------------------------
// note
// ---------------------------------------------------------------------------------------------

/**
 * One stated rule makes any text safe inside a comment: every run of two or more hyphens gets a space between each pair
 * (`--` becomes `- -`, `-->` becomes `- ->`, `<!--` becomes `<!- -`, `--!>` becomes `- -!>`); NUL is removed and carriage returns
 * become line feeds; the ends are trimmed. Because the comment is written `<!-- NOTE FOR AI: TEXT -->`, a leading `>` or `->` and a
 * trailing `-` cannot close or break it, and XML comments (SVG), which forbid `--`, stay well-formed.
 */
export const neutralise = (text: string): string => text.replace(/\u0000/g, '').replace(/\r\n?/g, '\n').replace(/-{2,}/g, (m) => m.split('').join(' ')).trim();

const eolOf = (src: string): string => (src.includes('\r\n') ? '\r\n' : '\n');

/**
 * Where the header goes: right after the DOCTYPE or XML declaration (skipping blanks and comments before them), on its own line when
 * the declaration is followed by a line break, else directly after it; with neither, the very start of the file.
 */
function headerPoint(src: string): { at: number; line: boolean } {
  let p = src.charCodeAt(0) === 0xfeff ? 1 : 0;
  let end = -1;
  for (;;) {
    const rest = src.slice(p);
    const ws = /^\s+/.exec(rest);
    if (ws) { p += ws[0].length; continue; }
    const x = /^<\?xml[\s\S]*?\?>/i.exec(rest);
    if (x) { p += x[0].length; end = p; continue; }
    const c = /^<!--[\s\S]*?-->/.exec(rest);
    if (c) { p += c[0].length; continue; }
    const d = /^<!DOCTYPE\b[^>[]*(?:\[[\s\S]*?\])?[^>]*>/i.exec(rest);
    if (d) { p += d[0].length; end = p; continue; }
    break;
  }
  if (end < 0) return { at: 0, line: true };
  const nl = /^[ \t]*\r?\n/.exec(src.slice(end));
  return nl ? { at: end + nl[0].length, line: true } : { at: end, line: false };
}

const isNote = (c: CommentInfo): boolean => c.data.startsWith(NOTE_PREFIX) || c.data.startsWith(PAGE_NOTE_PREFIX);

function noteEdit(model: Model, targetArg: number | 'page', textRaw: string, warnings: string[]): EditResult {
  const src = model.primary.source;
  const file = model.primary.file;
  const comments = model.primary.comments;
  const page = targetArg === 'page';
  const el = page ? null : elementAt(model, targetArg);
  const header = comments.find((c) => c.data === HEADER_DATA);
  const existing = page ? comments.find((c) => c.data.startsWith(PAGE_NOTE_PREFIX)) : noteOf(model, el!);
  const eol = eolOf(src);
  const patches: Patch[] = [];
  const del = textRaw.trim() === '';
  const body = neutralise(textRaw);
  const prefix = page ? PAGE_NOTE_PREFIX : NOTE_PREFIX;
  const comment = `<!--${prefix}${body} -->`;
  let placement: string;

  if (del) {
    if (!existing) return { ok: true, patches: [], dom: [], warnings, placement: 'no note to delete' };
    const [s, e] = removalRange(src, existing.start, existing.end);
    patches.push({ file, start: s, end: e, text: '' });
    if (header && comments.filter((c) => c !== existing && isNote(c)).length === 0) {
      const [hs, he] = removalRange(src, header.start, header.end);
      patches.push({ file, start: hs, end: he, text: '' });
    }
    placement = 'note deleted';
  } else if (existing) {
    if (src.slice(existing.start, existing.end) === comment) return { ok: true, patches: [], dom: [], warnings, placement: 'note unchanged' };
    patches.push({ file, start: existing.start, end: existing.end, text: comment });
    placement = 'note replaced';
  } else {
    let pageAt = -1;
    if (!page) {
      const blk = blockOf(src, el!);
      if (blk.line) patches.push({ file, start: blk.start, end: blk.start, text: `${src.slice(blk.start, el!.start)}${comment}${eol}` });
      else patches.push({ file, start: el!.start, end: el!.start, text: comment });
    } else if (header) {
      const [hs, he] = removalRange(src, header.start, header.end);
      const whole = he !== header.end || hs !== header.start;
      pageAt = whole ? he : header.end;
      patches.push({ file, start: pageAt, end: pageAt, text: whole ? `${src.slice(src.lastIndexOf('\n', header.start - 1) + 1, header.start)}${comment}${eol}` : comment });
    }
    if (!header) {
      const hp = headerPoint(src);
      const head = `<!-- ${HEADER_TEXT} -->`;
      const text = (hp.line ? `${head}${eol}` : head) + (page ? (hp.line ? `${comment}${eol}` : comment) : '');
      patches.push({ file, start: hp.at, end: hp.at, text });
    }
    placement = page ? 'page note added' : 'note added before the element';
  }

  const after = patchedModel(model, patches).model;
  const ac = after.primary.comments;
  const fail = (why: string): never => no('note-misplaced', `the note would not sit where it should after parsing the patched text: ${why}`);
  if (!sameList(tagSequence(model), tagSequence(after))) fail('the element structure changed');
  const stillNotes = ac.filter(isNote).length;
  const hdrCount = ac.filter((c) => c.data === HEADER_DATA).length;
  if (stillNotes > 0 && hdrCount < 1) fail('the header is missing');
  if (stillNotes === 0 && hdrCount > 0) fail('a header is left with no note');
  if (!del) {
    const want = `${prefix}${body} `;
    if (page) {
      const got = ac.filter((c) => c.data.startsWith(PAGE_NOTE_PREFIX));
      const h = ac.find((c) => c.data === HEADER_DATA);
      if (got.length !== 1 || got[0]!.data !== want) fail('the page note is not exactly one comment');
      if (!h || after.primary.source.slice(h.end, got[0]!.start).trim() !== '') fail('the page note does not sit right after the header');
    } else {
      const n = noteOf(after, after.primary.elements[el!.index]!);
      if (!n || n.data !== want) fail('the comment does not sit directly before its element');
    }
  } else if (!page && noteOf(after, after.primary.elements[el!.index]!)) fail('the note is still there');
  return { ok: true, patches, dom: [], warnings, placement };
}

/** Every note in a loaded file: the element each belongs to, its text, and the whole-page note. */
export function listNotes(model: Model): NoteList {
  const comments = model.primary.comments;
  const text = (c: CommentInfo, prefix: string) => c.data.slice(prefix.length).replace(/ $/, '');
  const page = comments.find((c) => c.data.startsWith(PAGE_NOTE_PREFIX));
  return {
    page: page ? { text: text(page, PAGE_NOTE_PREFIX) } : null,
    notes: comments.filter((c) => c.precedes >= 0 && c.data.startsWith(NOTE_PREFIX)).map((c) => ({ index: c.precedes, path: describe(model, c.precedes), text: text(c, NOTE_PREFIX) })),
  };
}

export const HEADER_TEXT = 'Exported from UI Editor. Comments starting "NOTE FOR AI:" are the designer\'s instructions for the element that follows. Implement them.';
export const HEADER_DATA = ` ${HEADER_TEXT} `;
