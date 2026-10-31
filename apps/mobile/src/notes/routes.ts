import { router } from 'expo-router';

/** Which notes a list shows. */
export type ListScope = 'all' | 'recents' | 'folder' | 'tag';

export type ListParams = { scope?: ListScope; id?: string };

export function openList(scope: ListScope, id?: bigint) {
  router.push({ pathname: '/notes/list', params: id === undefined ? { scope } : { scope, id: String(id) } });
}

export function openNote(id: string) {
  router.push({ pathname: '/notes/note', params: { id } });
}

/** The editor, in Write; `fresh` for a note just made, removed again if left empty. */
export function openEditor(id: string, fresh = false) {
  router.push({ pathname: '/notes/edit', params: fresh ? { id, fresh: '1' } : { id } });
}

/** A bigint route param, or none. */
export function bigintParam(value: string | undefined): bigint | undefined {
  if (value === undefined || !/^-?\d+$/.test(value)) return undefined;
  return BigInt(value);
}

/** The editor over the tabs, for a note just made at a verse: leaving returns to the reader. */
export function openVerseEditor(id: string) {
  router.push({ pathname: '/note-editor', params: { id, fresh: '1', stay: '1' } });
}
