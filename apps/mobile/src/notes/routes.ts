import { router } from 'expo-router';

/** Which notes a list shows. */
export type ListScope = 'all' | 'recents' | 'folder' | 'tag';

export type ListParams = { scope?: ListScope; id?: string };

// One screen per list or note in the stack: a second tap on a row before
// the first push shows (slow devices) would otherwise stack a copy over the
// first, and taps on the first (a tag chip) vanish under it. Another
// folder, tag or note still pushes.
export function openList(scope: ListScope, id?: bigint) {
  router.push(
    { pathname: '/notes/list', params: id === undefined ? { scope } : { scope, id: String(id) } },
    { dangerouslySingular: (name, params) => `${name}/${String(params.scope)}/${String(params.id ?? '')}` },
  );
}

export function openNote(id: string) {
  router.push(
    { pathname: '/notes/note', params: { id } },
    { dangerouslySingular: (name, params) => `${name}/${String(params.id)}` },
  );
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
