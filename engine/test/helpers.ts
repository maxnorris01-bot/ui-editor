import { JSDOM } from 'jsdom';
import { applyEdit, createModel, domProbe, exportFiles, previewSource, sources, tagDocument } from '../src';
import type { Edit, EditResult, Model, Probe } from '../src';

export interface Env {
  model: Model;
  doc: Document;
  elements: Element[];
  probe: Probe;
  /** Index of the element matching a selector (must be unique). */
  at(selector: string): number;
  run(edit: Edit): EditResult;
  /** Apply an ok result and return the exported primary file text. */
  out(result: EditResult): string;
  files(result: EditResult): Record<string, string>;
}

export function env(source: string, kind: 'html' | 'svg' = 'html', companions: Record<string, string> = {}, tweak?: (p: Probe) => Probe): Env {
  const model = createModel(source, kind, companions);
  const dom =
    kind === 'svg'
      ? new JSDOM(model.primary.source, { contentType: 'image/svg+xml' })
      : new JSDOM(previewSource(model));
  const doc = dom.window.document;
  const elements = tagDocument(model, doc);
  let probe = domProbe(doc, elements);
  if (tweak) probe = tweak(probe);
  const at = (sel: string) => {
    const hits = probe.matches(sel);
    if (hits.length !== 1) throw new Error(`selector ${sel} matched ${hits.length}`);
    return hits[0]!;
  };
  const files = (r: EditResult) => {
    if (!r.ok) throw new Error(`refused: ${r.refusal.message}`);
    return exportFiles(sources(model), r.patches);
  };
  return {
    model, doc, elements, probe, at,
    run: (e) => applyEdit(model, e, probe),
    files,
    out: (r) => files(r)[model.primary.file]!,
  };
}
