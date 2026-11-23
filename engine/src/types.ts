/**
 * Shared types for the edit engine.
 *
 * Everything here is plain data so the engine stays a set of pure functions that run in a browser.
 * Offsets are UTF-16 code unit indexes into the ORIGINAL source string of the file they belong to.
 */

export type Kind = 'html' | 'svg' | 'css';

/** A text patch against the original text of one file: replace [start, end) with `text`. */
export interface Patch {
  file: string;
  start: number;
  end: number;
  text: string;
}

export interface Attr {
  /** Name exactly as written in the source (case preserved). */
  name: string;
  /** Lower-case name, for lookups. */
  lname: string;
  /** Whole attribute, name through end of value. */
  start: number;
  end: number;
  /** null when the attribute has no `=value` part. */
  value: string | null;
  /** Value range excluding quotes (equal to each other and positioned after the name when no value). */
  valueStart: number;
  valueEnd: number;
  quote: '"' | "'" | '';
}

export interface ElementNode {
  /** Pre-order index among all elements of the document (implied elements included for HTML). */
  index: number;
  /** Tag name as written in the source; for implied elements, the parser's lower-case name. */
  tag: string;
  ltag: string;
  namespace: 'html' | 'svg' | 'other';
  /** True for html/head/body/tbody etc. that the parser created without source text. */
  implied: boolean;
  /** Start of `<`; -1 when implied. */
  start: number;
  /** End of the element's source range; may include trailing whitespace when there is no end tag. */
  end: number;
  startTagEnd: number;
  /** Start of the end tag, or -1 when there is none (void, self-closing, or implied end). */
  endTagStart: number;
  selfClosing: boolean;
  attrs: Attr[];
  parent: ElementNode | null;
  children: ElementNode[];
}

export interface Decl {
  prop: string;
  lprop: string;
  value: string;
  important: boolean;
  /** Start of the property name. */
  start: number;
  /** End of the value (and of `!important` if present), excluding any `;`. */
  contentEnd: number;
  /** End of the declaration including a trailing `;` when there is one. */
  end: number;
  valueStart: number;
  valueEnd: number;
  hasSemicolon: boolean;
  /** Whitespace before the property and the text between name and value (e.g. ": "), for mimicry. */
  before: string;
  between: string;
}

export interface Container {
  decls: Decl[];
  /** Offset just after `{` (or the start of inline style text). */
  bodyStart: number;
  /** Offset of the closing `}` (or the end of inline style text). */
  bodyEnd: number;
}

export interface RuleNode extends Container {
  file: string;
  selector: string;
  selectors: string[];
  start: number;
  end: number;
  /** Inside a conditional at-rule (@media, @supports, @container...). Detected, never patched. */
  conditional: boolean;
  /** The at-rule preludes wrapping this rule, outermost first, e.g. ["@media (max-width: 640px)"]. */
  conditions: string[];
  /** Cascade order across all stylesheets of the model. */
  order: number;
}

export interface Sheet {
  /** File key the rules belong to. */
  file: string;
  /** Element in the primary document that carries this sheet (<style> or <link>), or -1. */
  elementIndex: number;
  /** Offset of the CSS text inside `file` (0 for a stand-alone CSS file). */
  rules: RuleNode[];
}

export interface ParsedFile {
  file: string;
  kind: Kind;
  source: string;
  /** All elements in pre-order (HTML/SVG); empty for CSS. */
  elements: ElementNode[];
  /** Rules (CSS files only). */
  rules: RuleNode[];
  /** Number of parse errors the parser reported. */
  parseErrors: number;
  /** Every comment node of an HTML/SVG file in source order (empty for CSS). */
  comments: CommentInfo[];
}

/** One comment node: its source range, its text between `<!--` and `-->`, and the element it directly precedes. */
export interface CommentInfo {
  start: number;
  end: number;
  /** The comment's data (the text between `<!--` and `-->`). */
  data: string;
  /** Index of the element the comment sits in, or -1 at document level. */
  parent: number;
  /** Index of the element that follows with only whitespace between, or -1 (another comment, text or nothing follows). */
  precedes: number;
}

export interface Model {
  primary: ParsedFile;
  /** Companion CSS files by the href used in the document. */
  companions: Record<string, ParsedFile>;
  /** Stylesheets in cascade (document) order. */
  sheets: Sheet[];
  /** Companion hrefs that were referenced but not supplied. */
  missingStylesheets: string[];
}

/** The view an edit was made in. Tablet is view-only and not an environment. */
export type Environment = 'desktop' | 'phone';

/** Fields every edit may carry. `environment` defaults to 'desktop', `link` to true. */
export interface EditScope {
  environment?: Environment;
  /** true: scale/apply across environments; false: apply only inside `environment` and pin it. */
  link?: boolean;
}

/** The kinds of element `insert` can add (HTML only). */
export type InsertKind = 'text' | 'rect' | 'rounded' | 'ellipse' | 'button';

/** Edits that change how an existing element looks or where it sits. */
export type ElementEdit =
  | ({ op: 'set'; target: number; properties: Record<string, string> } & EditScope)
  | ({ op: 'offset'; target: number; dx: number; dy: number } & EditScope)
  | ({ op: 'reorder'; target: number; placement: 'before' | 'after'; sibling: number } & EditScope);

/**
 * Edits that change the content of the file: add an element, change an element's text, delete an element, attach a note for an
 * AI. They apply at every screen width (`environment` and `link` are accepted and ignored) and never create pins.
 */
export type ContentEdit =
  | ({ op: 'insert'; kind: InsertKind; anchor: number; placement: 'before' | 'after' | 'first-child' | 'last-child' } & EditScope)
  | ({ op: 'text'; target: number; text: string } & EditScope)
  | ({ op: 'remove'; target: number } & EditScope)
  /** `target` is an element index, or `'page'` for the whole-page note; empty text deletes the note. */
  | ({ op: 'note'; target: number | 'page'; text: string } & EditScope);

export type Edit = ElementEdit | ContentEdit;

/** An unlinked value pinned in one environment (pure data; the review list is built from it). */
export interface Pin {
  /** Stable element path (see `describe`). */
  selector: string;
  property: string;
  environment: Environment;
  value: string;
}

/** Edit-list state: replaying the same ordered list from an empty state always gives the same export. */
export interface EditState {
  pins: Pin[];
}

/** A value the engine would not scale and left as the page wrote it (never guessed). */
export interface ScaleNote {
  property: string;
  /** The media condition chain the value sits in, or "(base)" / "(all widths)". */
  condition: string;
  value: string;
  reason: string;
}

export type DomOp =
  | { type: 'style'; index: number; props: [string, string][] }
  | { type: 'attr'; index: number; name: string; value: string }
  /** Replace the children of element `index` by parsing `html` (used for reorders). */
  | { type: 'html'; index: number; html: string }
  /** Append CSS text to the <style> element `index` (the preview's copy of a stylesheet). */
  | { type: 'css'; index: number; text: string }
  /** Remove the first occurrence of CSS text from the <style> element `index` (undoes an appended rule). */
  | { type: 'css-remove'; index: number; text: string }
  /** Parse `html` and insert it next to element `index` (`insertAdjacentHTML`), used by `insert`. */
  | { type: 'insert'; index: number; position: 'beforebegin' | 'afterbegin' | 'beforeend' | 'afterend'; html: string }
  /** Remove element `index` from the preview (its children go with it). */
  | { type: 'remove'; index: number };

export interface Refusal {
  code: string;
  message: string;
}

export type EditResult =
  | {
      ok: true;
      patches: Patch[];
      dom: DomOp[];
      warnings: string[];
      placement: string;
      notes?: ScaleNote[];
      state?: EditState;
      /** `insert`: index of the new element in the model of the PATCHED text (so the editor can select it), and its class name. */
      selected?: number;
      className?: string;
    }
  | { ok: false; refusal: Refusal; warnings: string[] };

/** What the engine needs to know from a live document. Implemented over the preview iframe. */
export interface Probe {
  /** Indexes of elements matching a CSS selector (empty on invalid/unsupported selectors). */
  matches(selector: string): number[];
  /** Computed value; with `width` (px) it is read as the page renders at that viewport width. */
  computed(index: number, prop: string, width?: number): string;
  /** Screen matrix [a,b,c,d,e,f] of an SVG element's own user space, or null. */
  screenMatrix(index: number): [number, number, number, number, number, number] | null;
  /** Screen matrix of the element's parent user space, or null. */
  parentScreenMatrix(index: number): [number, number, number, number, number, number] | null;
}

/** A note for an AI found in a file (see `listNotes`). */
export interface NoteInfo {
  /** Index of the element the note belongs to. */
  index: number;
  /** Stable element path (see `describe`). */
  path: string;
  /** The note text, without the leading `NOTE FOR AI: `. */
  text: string;
}

export interface NoteList {
  /** The whole-page note, or null. */
  page: { text: string } | null;
  notes: NoteInfo[];
}
