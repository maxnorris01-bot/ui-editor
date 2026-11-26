export { applyEdit, blockOf } from './edit';
export { listNotes, neutralise } from './structure';
export { customEdits, resetView } from './views';
export { applyDomOps, applyEditSteps, commit, createPreview, domProbe, previewSource, retag, tagDocument } from './dom';
export { breakpointOf, chainEnv, chainMatches, emptyState, envCondition, listUnlinked, scaleValue, tabletMax, tabletMin } from './responsive';
export type { UnlinkedItem } from './responsive';
export type { Preview, PreviewOptions } from './dom';
export { createModel, describe, parse, select, sources } from './model';
export { applyPatches, exportFiles } from './patch';
export { specificity } from './specificity';
export * from './types';

import { exportFiles } from './patch';
import type { Patch } from './types';

/** export(source, patches): the edited text; every byte outside a patched range is unchanged. */
export function exportText(source: string, patches: Patch[], file = 'document'): string {
  return exportFiles({ [file]: source }, patches.map((p) => ({ ...p, file })))[file] ?? source;
}
