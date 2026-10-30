// The palette's keyboard selection (Up/Down move it, Enter opens it), kept
// free of React Native so Node can test it. The selection is an index into
// the visible rows in display order, tied to the results it was made in:
// once the query, scope or rows change it starts on the first row again.

import type { Group } from './results.ts';

export type Selection = { results: string; index: number };

/** The visible rows in display order: each group's hits, group by group. */
export function flattenGroups<H>(groups: readonly Group<H>[]): H[] {
  return groups.flatMap((g) => g.hits);
}

/** Identifies one set of results: the query, the scope and the rows' keys. */
export function resultsId(text: string, scope: string, keys: readonly string[]): string {
  return JSON.stringify([text, scope, keys]);
}

/** The selected index for these results: the first row unless moved in them. */
export function selectedIndex(selection: Selection, results: string, count: number): number {
  if (count === 0 || selection.results !== results) return 0;
  return clamp(selection.index, count);
}

/** Moves the selection by `delta` rows, stopping at the first and last. */
export function moveSelection(
  selection: Selection,
  results: string,
  count: number,
  delta: number,
): Selection {
  return { results, index: clamp(selectedIndex(selection, results, count) + delta, count) };
}

export const NO_SELECTION: Selection = { results: '', index: 0 };

function clamp(index: number, count: number): number {
  return Math.max(0, Math.min(index, count - 1));
}
