import type { Edit, Environment } from './types';

/**
 * RESET OF A VIEW (docs/small-views-rules.md section 1, item 4).
 *
 * A Phone or Tablet edit is custom to that view. `customEdits(edits, env)` is the list of those edits (the page uses it to tell whether a view has custom changes);
 * `resetView(edits, env)` is the list without them. The result is replayed from the original document, so the pins and every rule the dropped edits appended are gone
 * and the export equals a list that never contained them. Content edits (insert, text, remove, note) are never dropped, whatever environment they carry. Desktop is not
 * offered: both functions treat `'desktop'` as "nothing is custom" (the list is returned unchanged, `customEdits` is empty).
 */
const isElementEdit = (e: Edit): boolean => e.op === 'set' || e.op === 'offset' || e.op === 'reorder';

export const customEdits = (edits: Edit[], env: Environment): Edit[] => (env === 'desktop' ? [] : edits.filter((e) => isElementEdit(e) && (e.environment ?? 'desktop') === env));

export const resetView = (edits: Edit[], env: Environment): Edit[] => (env === 'desktop' ? edits : edits.filter((e) => !(isElementEdit(e) && (e.environment ?? 'desktop') === env)));
