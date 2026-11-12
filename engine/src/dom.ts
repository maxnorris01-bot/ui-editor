import { applyEdit } from './edit';
import { createModel, sources } from './model';
import { emptyState } from './responsive';
import { applyPatches, exportFiles } from './patch';
import type { DomOp, Edit, EditResult, EditState, Model, Patch, Probe } from './types';

export interface Preview {
  iframe: HTMLIFrameElement;
  doc: Document;
  /** DOM element for each model element index (pre-order). */
  elements: Element[];
  probe: Probe;
  model: Model;
  /** Resize the preview viewport (the iframe) so media queries re-evaluate at that width. */
  setWidth(width: number): void;
  dispose(): void;
}

/**
 * The text the preview renders: the original source, except that `<link rel=stylesheet>` elements
 * whose stylesheet was supplied become `<style>` elements holding that CSS (a sandboxed srcdoc
 * cannot resolve relative URLs). One element is replaced by one element, so indexes stay aligned.
 */
export function previewSource(model: Model): string {
  if (model.primary.kind !== 'html') return model.primary.source;
  const patches: Patch[] = [];
  for (const sheet of model.sheets) {
    const el = model.primary.elements[sheet.elementIndex];
    if (!el || el.ltag !== 'link') continue;
    const css = model.companions[sheet.file]?.source ?? '';
    patches.push({ file: model.primary.file, start: el.start, end: el.startTagEnd, text: `<style>${css}</style>` });
  }
  return applyPatches(model.primary.source, patches);
}

/** Pair the model's elements with the document's elements by pre-order index; throws on mismatch. */
export function tagDocument(model: Model, doc: Document): Element[] {
  const out: Element[] = [];
  const walk = (e: Element) => {
    out.push(e);
    for (const c of Array.from(e.children)) walk(c);
  };
  if (doc.documentElement) walk(doc.documentElement);
  const want = model.primary.elements;
  if (out.length !== want.length) {
    throw new Error(`preview/source element count differs: document has ${out.length}, source model has ${want.length}`);
  }
  for (let i = 0; i < want.length; i++) {
    const got = out[i]!.localName.toLowerCase();
    const src = want[i]!.ltag;
    // previewSource() deliberately swaps a supplied <link rel=stylesheet> for a <style>.
    if (got !== src && !(got === 'style' && src === 'link')) {
      throw new Error(`preview/source mismatch at element ${i}: document <${out[i]!.localName}> vs source <${want[i]!.tag}>`);
    }
  }
  return out;
}

type M6 = [number, number, number, number, number, number];
function matrixOf(e: Element | null | undefined): M6 | null {
  if (!e || typeof (e as SVGGraphicsElement).getScreenCTM !== 'function') return null;
  const m = (e as SVGGraphicsElement).getScreenCTM();
  return m ? [m.a, m.b, m.c, m.d, m.e, m.f] : null;
}

export function domProbe(doc: Document, elements: Element[]): Probe {
  const idx = new Map<Element, number>();
  elements.forEach((e, i) => idx.set(e, i));
  const view = doc.defaultView!;
  return {
    matches(selector) {
      try {
        const out: number[] = [];
        for (const e of Array.from(doc.querySelectorAll(selector))) {
          const i = idx.get(e);
          if (i !== undefined) out.push(i);
        }
        return out;
      } catch {
        return [];
      }
    },
    computed(i, prop, width) {
      const frame = view.frameElement as HTMLElement | null;
      if (width === undefined || !frame) return view.getComputedStyle(elements[i]!).getPropertyValue(prop);
      const old = frame.style.width;
      frame.style.width = `${width}px`;
      void doc.documentElement.offsetWidth; // force layout so media queries are re-evaluated
      const v = view.getComputedStyle(elements[i]!).getPropertyValue(prop);
      frame.style.width = old;
      void doc.documentElement.offsetWidth;
      return v;
    },
    screenMatrix: (i) => matrixOf(elements[i]),
    parentScreenMatrix: (i) => matrixOf(elements[i]?.parentElement),
  };
}

export interface PreviewOptions {
  width?: number;
  height?: number;
}

/**
 * Build the preview: a scripts-off sandboxed iframe (`sandbox="allow-same-origin"` without
 * `allow-scripts`, so the host can read it but nothing inside can run), then tag every element with
 * its source node. HTML renders through srcdoc; SVG through a blob URL so it is a real SVG
 * document, as it would be when opened as a file.
 */
export async function createPreview(model: Model, container: HTMLElement, opts: PreviewOptions = {}): Promise<Preview> {
  const iframe = container.ownerDocument.createElement('iframe');
  iframe.setAttribute('sandbox', 'allow-same-origin');
  iframe.style.border = '0';
  iframe.style.width = `${opts.width ?? 1280}px`;
  iframe.style.height = `${opts.height ?? 800}px`;
  let blobUrl: string | null = null;
  const loaded = new Promise<void>((resolve, reject) => {
    iframe.addEventListener('load', () => resolve(), { once: true });
    iframe.addEventListener('error', () => reject(new Error('preview failed to load')), { once: true });
  });
  if (model.primary.kind === 'svg') {
    blobUrl = URL.createObjectURL(new Blob([model.primary.source], { type: 'image/svg+xml' }));
    iframe.src = blobUrl;
  } else {
    iframe.srcdoc = previewSource(model);
  }
  container.appendChild(iframe);
  await loaded;
  const doc = iframe.contentDocument;
  if (!doc) throw new Error('preview document is not readable');
  const elements = tagDocument(model, doc);
  const preview: Preview = {
    iframe,
    doc,
    elements,
    probe: domProbe(doc, elements),
    model,
    setWidth(width) {
      iframe.style.width = `${width}px`;
      void doc.documentElement.offsetWidth;
    },
    dispose() {
      iframe.remove();
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    },
  };
  return preview;
}

/**
 * Apply the live-DOM half of an edit to the preview. A reorder replaces the parent's children by
 * parsing the patched source text for that parent, so the preview holds exactly the text the export
 * will contain (whitespace nodes included). After such an op the element table is stale: call
 * `retag(preview, newModel)` with the re-parsed model.
 */
export function applyDomOps(preview: Preview, ops: DomOp[]): void {
  for (const op of ops) {
    const el = preview.elements[op.index];
    if (!el) throw new Error(`no preview element ${op.index}`);
    if (op.type === 'style') {
      for (const [p, v] of op.props) (el as HTMLElement).style.setProperty(p, v);
    } else if (op.type === 'attr') {
      el.setAttribute(op.name, op.value);
    } else if (op.type === 'css') {
      el.appendChild(el.ownerDocument.createTextNode(op.text));
    } else {
      el.innerHTML = op.html;
    }
  }
}

export function retag(preview: Preview, model: Model): void {
  preview.model = model;
  preview.elements = tagDocument(model, preview.doc);
  preview.probe = domProbe(preview.doc, preview.elements);
}

/** Apply patches to every file and re-parse: the model for the next edit in a session. */
export function commit(model: Model, patches: Patch[]): { files: Record<string, string>; model: Model } {
  const files = exportFiles(sources(model), patches);
  const companions: Record<string, string> = {};
  for (const href of Object.keys(model.companions)) companions[href] = files[href] ?? '';
  const kind = model.primary.kind as 'html' | 'svg';
  return { files, model: createModel(files[model.primary.file] ?? '', kind, companions, model.primary.file) };
}

/**
 * Apply an ordered list of edits to one live preview, the way the editor would: each edit is decided
 * against the preview as it is after the earlier ones (so the scaling base is the current effective
 * value), its DOM operations are applied to the preview and its patches are committed to the source,
 * which is re-parsed for the next edit. Replaying the same list from the same start gives the same
 * export; the pinned-value record travels in `state`. Stops at the first refusal.
 */
export function applyEditSteps(
  preview: Preview,
  edits: Edit[],
  state: EditState = emptyState(),
): { results: EditResult[]; state: EditState; files: Record<string, string>; model: Model } {
  const results: EditResult[] = [];
  let st = state;
  for (const edit of edits) {
    const r = applyEdit(preview.model, edit, preview.probe, st);
    results.push(r);
    if (!r.ok) break;
    applyDomOps(preview, r.dom);
    const c = commit(preview.model, r.patches);
    retag(preview, c.model);
    st = r.state ?? st;
  }
  return { results, state: st, files: sources(preview.model), model: preview.model };
}
