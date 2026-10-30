// Folder and note actions: the context menu (long press, Material's ⋮),
// swipe actions and accessibility actions all run through here, so every
// way in does the same thing (guide §7.1, WCAG 2.5.7).
import type { Folder, Note } from 'berean-ffi-rn';
import { useState, type ReactNode } from 'react';
import { Alert } from 'react-native';

import { userdata } from '@/ffi/core';
import { coreErrorMessage } from '@/ffi/errors';
import { ActionSheet, type SheetItem } from '@/notes/action-sheet';
import { notesChanged } from '@/notes/changes';
import { changeNotes } from '@/notes/data';
import {
  type FolderAction,
  type MoveTarget,
  deleteFolderPrompt,
  folderMoveTargets,
  moveTargetLabel,
  noteMoveTargets,
  type NoteAction,
} from '@/notes/folders';
import type { Anchor, SwipeAction } from '@/notes/list-rows';
import { NameDialog } from '@/notes/name-dialog';
import { deleteNotePrompt, noteTitle } from '@/notes/note-list';
import { useUndo } from '@/notes/undo-bar';

const reportError = (message: string | undefined, title: string) => {
  if (message !== undefined) Alert.alert(title, message);
};

type Menu = { title: string; items: SheetItem[]; anchor?: Anchor };
type Dialog = { title: string; initial: string; confirmLabel: string; onSubmit: (name: string) => void };

/** The open menu or dialog, drawn by whichever screen uses the actions. */
function useSheets() {
  const [menu, setMenu] = useState<Menu | undefined>();
  const [dialog, setDialog] = useState<Dialog | undefined>();
  const sheets: ReactNode = (
    <>
      <ActionSheet
        visible={menu !== undefined}
        title={menu?.title ?? ''}
        items={menu?.items ?? []}
        anchor={menu?.anchor}
        onClose={() => setMenu(undefined)}
      />
      {dialog !== undefined && (
        <NameDialog
          title={dialog.title}
          initial={dialog.initial}
          confirmLabel={dialog.confirmLabel}
          onCancel={() => setDialog(undefined)}
          onSubmit={(name) => {
            setDialog(undefined);
            dialog.onSubmit(name);
          }}
        />
      )}
    </>
  );
  return { sheets, setMenu, setDialog };
}

const pickerItems = (
  targets: readonly MoveTarget[],
  folders: readonly Folder[],
  move: (id: bigint | undefined) => void,
): SheetItem[] =>
  targets.map((t) => ({
    key: t.id === undefined ? 'top' : String(t.id),
    label: t.name,
    depth: t.depth,
    current: t.current,
    accessibilityLabel: moveTargetLabel(t, folders),
    icon: t.id === undefined ? { ios: 'tray', android: 'inbox' } : { ios: 'folder', android: 'folder' },
    onPress: () => move(t.id),
  }));

/** Actions on note folders: New Folder (inside one, or at the top level), Rename, Move to…, Delete Folder…. */
export function useFolderActions(folders: readonly Folder[]) {
  const { sheets, setMenu, setDialog } = useSheets();
  const undo = useUndo();

  const newFolder = (parentId?: bigint) =>
    setDialog({
      title: 'New Folder',
      initial: '',
      confirmLabel: 'Create',
      onSubmit: (name) =>
        reportError(
          changeNotes(() => userdata().createFolder(name, parentId)),
          'Couldn’t create the folder',
        ),
    });

  const rename = (folder: Folder) =>
    setDialog({
      title: 'Rename Folder',
      initial: folder.name,
      confirmLabel: 'Rename',
      onSubmit: (name) =>
        reportError(changeNotes(() => userdata().renameFolder(folder.id, name)), 'Couldn’t rename the folder'),
    });

  const move = (folder: Folder) =>
    setMenu({
      title: `Move “${folder.name}” to…`,
      items: pickerItems(folderMoveTargets(folders, folder.id), folders, (parentId) => {
        if (parentId === folder.parentId) return;
        // Last among its new siblings: the core clamps the position to the end.
        reportError(
          changeNotes(() => userdata().moveFolder(folder.id, parentId, Number.MAX_SAFE_INTEGER)),
          'Couldn’t move the folder',
        );
      }),
    });

  const remove = (folder: Folder) => {
    const { title, message } = deleteFolderPrompt(folder);
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          try {
            const deleted = userdata().deleteFolder(folder.id);
            undo.show('Folder', () =>
              reportError(changeNotes(() => userdata().restoreFolder(deleted)), 'Couldn’t restore the folder'),
            );
          } catch (e) {
            Alert.alert('Couldn’t delete the folder', coreErrorMessage(e));
          }
          notesChanged();
        },
      },
    ]);
  };

  const run = (folder: Folder, action: FolderAction) => {
    switch (action) {
      case 'newFolder':
        return newFolder(folder.id);
      case 'rename':
        return rename(folder);
      case 'move':
        return move(folder);
      case 'delete':
        return remove(folder);
    }
  };

  const menuItems = (folder: Folder): SheetItem[] => [
    { key: 'new', label: 'New Folder', icon: { ios: 'folder.badge.plus', android: 'create_new_folder' }, onPress: () => run(folder, 'newFolder') },
    { key: 'rename', label: 'Rename', icon: { ios: 'pencil', android: 'edit' }, onPress: () => run(folder, 'rename') },
    { key: 'move', label: 'Move to…', icon: { ios: 'folder', android: 'drive_file_move' }, onPress: () => run(folder, 'move') },
    { key: 'delete', label: 'Delete Folder…', destructive: true, icon: { ios: 'trash', android: 'delete' }, onPress: () => run(folder, 'delete') },
  ];

  const openMenu = (folder: Folder, anchor?: Anchor) =>
    setMenu({ title: folder.name, items: menuItems(folder), anchor });

  // Swipe shows the two most used; More opens the full menu.
  const swipeActions = (folder: Folder): SwipeAction[] => [
    { key: 'more', label: 'More', icon: { ios: 'ellipsis.circle', android: 'more_horiz' }, onPress: () => openMenu(folder) },
    { key: 'move', label: 'Move', icon: { ios: 'folder', android: 'drive_file_move' }, onPress: () => run(folder, 'move') },
    { key: 'delete', label: 'Delete', destructive: true, icon: { ios: 'trash', android: 'delete' }, onPress: () => run(folder, 'delete') },
  ];

  return { sheets, newFolder, run, openMenu, swipeActions };
}

/** Actions on notes: Move to… (a folder or none) and Delete. */
export function useNoteActions(folders: readonly Folder[], onDeleted?: () => void) {
  const { sheets, setMenu } = useSheets();

  const move = (note: Note) =>
    setMenu({
      title: `Move “${noteTitle(note)}” to…`,
      items: pickerItems(noteMoveTargets(folders, note.folderId), folders, (folderId) => {
        if (folderId === note.folderId) return;
        reportError(changeNotes(() => userdata().setNoteFolder(note.id, folderId)), 'Couldn’t move the note');
      }),
    });

  // No undo for notes yet: confirm first.
  const remove = (note: Note) => {
    const { title, message } = deleteNotePrompt(noteTitle(note));
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          const error = changeNotes(() => userdata().removeNote(note.id));
          reportError(error, 'Couldn’t delete the note');
          if (error === undefined) onDeleted?.();
        },
      },
    ]);
  };

  const run = (note: Note, action: NoteAction) => (action === 'move' ? move(note) : remove(note));

  const openMenu = (note: Note, anchor?: Anchor) =>
    setMenu({
      title: noteTitle(note),
      anchor,
      items: [
        { key: 'move', label: 'Move to…', icon: { ios: 'folder', android: 'drive_file_move' }, onPress: () => move(note) },
        { key: 'delete', label: 'Delete', destructive: true, icon: { ios: 'trash', android: 'delete' }, onPress: () => remove(note) },
      ],
    });

  const swipeActions = (note: Note): SwipeAction[] => [
    { key: 'move', label: 'Move', icon: { ios: 'folder', android: 'drive_file_move' }, onPress: () => move(note) },
    { key: 'delete', label: 'Delete', destructive: true, icon: { ios: 'trash', android: 'delete' }, onPress: () => remove(note) },
  ];

  return { sheets, run, openMenu, swipeActions };
}
