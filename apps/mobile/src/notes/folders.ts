// Note folders as the Notes screens show them, kept free of React Native so
// Node can test it. The core keeps the tree (folders() lists it flat, in
// tree order, with each folder's counts); this only picks rows out of that
// list and words them. The shape is structural: the generated Folder is
// assignable to it.

export type FolderLike = {
  id: bigint;
  parentId?: bigint;
  name: string;
  depth: number;
  /** Notes in the folder and all its subfolders. */
  noteCount: number;
  /** Direct children. */
  subfolderCount: number;
};

/** The folders directly under `parentId` (none = top level), in the core's order. */
export function childFolders<F extends FolderLike>(folders: readonly F[], parentId?: bigint): F[] {
  return folders.filter((f) => f.parentId === parentId);
}

export function findFolder<F extends FolderLike>(folders: readonly F[], id: bigint | undefined): F | undefined {
  return id === undefined ? undefined : folders.find((f) => f.id === id);
}

/** The folder `id` and its ancestors, top level first. Empty if it isn't listed. */
export function folderPath<F extends FolderLike>(folders: readonly F[], id: bigint | undefined): F[] {
  const path: F[] = [];
  let at = findFolder(folders, id);
  // The folder's depth bounds the walk, so a malformed list can't loop.
  const steps = (at?.depth ?? 0) + 1;
  while (at !== undefined && path.length < steps) {
    path.unshift(at);
    at = findFolder(folders, at.parentId);
  }
  return path;
}

/** "Gospel of John › Prologue"; empty for an unfiled note. */
export function folderTrail(folders: readonly FolderLike[], id: bigint | undefined): string {
  return folderPath(folders, id)
    .map((f) => f.name)
    .join(' › ');
}

/** The Read view's metadata line: "Gospel of John › Prologue · Oct 28", or just the date. */
export function noteMetaLine(trail: string, date: string): string {
  return [trail, date].filter((part) => part !== '').join(' · ');
}

/** A folder row's counts: "3 · 14" (subfolders · notes) with subfolders, else "14". */
export function folderCounts(folder: FolderLike): string {
  return folder.subfolderCount > 0
    ? `${folder.subfolderCount} · ${folder.noteCount}`
    : String(folder.noteCount);
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "Gospel of John, 3 subfolders, 14 notes"; "Psalms, 4 notes" without subfolders. */
export function folderAccessibilityLabel(folder: FolderLike): string {
  const parts = [folder.name];
  if (folder.subfolderCount > 0) parts.push(plural(folder.subfolderCount, 'subfolder', 'subfolders'));
  parts.push(plural(folder.noteCount, 'note', 'notes'));
  return parts.join(', ');
}

/**
 * Delete Folder's confirmation. The core deletes the subfolders with it and
 * unfiles every note in them; noteCount already counts the subfolders' notes.
 */
export function deleteFolderPrompt(folder: FolderLike): { title: string; message: string } {
  const title = `Delete “${folder.name}”?`;
  const notes =
    folder.noteCount === 0
      ? undefined
      : folder.noteCount === 1
        ? 'Its note becomes unfiled.'
        : `Its ${folder.noteCount} notes become unfiled.`;
  const subfolders =
    folder.subfolderCount === 0
      ? undefined
      : folder.subfolderCount === 1
        ? 'Its subfolder is deleted too.'
        : `Its ${folder.subfolderCount} subfolders are deleted too.`;
  const message = [subfolders, notes].filter((s) => s !== undefined).join(' ');
  return { title, message: message === '' ? 'It has no notes.' : message };
}

/** A row of the Move to… picker. `id` none = the top level (or, for a note, no folder). */
export type MoveTarget = { id?: bigint; name: string; depth: number; current: boolean };

/**
 * Where folder `movingId` can move: the top level, then every folder in
 * tree order except itself and its subfolders (a folder can't go inside
 * itself). The one it's in now is marked `current`.
 */
export function folderMoveTargets(folders: readonly FolderLike[], movingId: bigint): MoveTarget[] {
  const index = folders.findIndex((f) => f.id === movingId);
  const moving = folders[index];
  const parentId = moving?.parentId;
  const excluded = new Set<bigint>();
  if (moving !== undefined) {
    excluded.add(moving.id);
    // Tree order: its subfolders follow it, deeper than it, until the next
    // folder at its depth or above.
    for (let i = index + 1; i < folders.length && folders[i].depth > moving.depth; i++) {
      excluded.add(folders[i].id);
    }
  }
  return [
    { name: 'Top level', depth: 0, current: parentId === undefined },
    ...folders
      .filter((f) => !excluded.has(f.id))
      .map((f) => ({ id: f.id, name: f.name, depth: f.depth + 1, current: f.id === parentId })),
  ];
}

/** Where a note can be filed: no folder, then every folder in tree order. */
export function noteMoveTargets(folders: readonly FolderLike[], folderId: bigint | undefined): MoveTarget[] {
  return [
    { name: 'No folder', depth: 0, current: folderId === undefined },
    ...folders.map((f) => ({ id: f.id, name: f.name, depth: f.depth + 1, current: f.id === folderId })),
  ];
}

/** A Move to… row's accessibility label: "Signs, in Gospel of John" for a nested one. */
export function moveTargetLabel(target: MoveTarget, folders: readonly FolderLike[]): string {
  const parents = folderPath(folders, target.id).slice(0, -1);
  const inside = parents.length > 0 ? `, in ${parents.map((f) => f.name).join(', ')}` : '';
  return `${target.name}${inside}${target.current ? ', current' : ''}`;
}

/** A folder name as typed, ready for the core: trimmed, none if empty. */
export function folderName(typed: string): string | undefined {
  const name = typed.trim();
  return name === '' ? undefined : name;
}

/** The accessibility actions of a folder row (guide WCAG 2.5.7 table), in menu order. */
export const FOLDER_ACTIONS = [
  { name: 'newFolder', label: 'New folder' },
  { name: 'rename', label: 'Rename' },
  { name: 'move', label: 'Move folder' },
  { name: 'delete', label: 'Delete folder' },
] as const;

export type FolderAction = (typeof FOLDER_ACTIONS)[number]['name'];

/** The accessibility actions of a note row, in menu order. */
export const NOTE_ACTIONS = [
  { name: 'move', label: 'Move to folder' },
  { name: 'delete', label: 'Delete' },
] as const;

export type NoteAction = (typeof NOTE_ACTIONS)[number]['name'];
