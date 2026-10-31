import { FolderScope, type Folder, type Note, type NoteFilter, type Tag } from 'berean-ffi-rn';
import { Stack, useLocalSearchParams } from 'expo-router';
import { type ReactElement, useState } from 'react';
import { Alert, FlatList, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';

import { FilterChip } from '@/components/filter-chip';
import { ScaledSymbol } from '@/components/scaled-symbol';
import { UIText } from '@/components/text';
import { useContentInsets } from '@/design/tab-chrome';
import { useBerean } from '@/design/theme';
import { radii, spacing } from '@/design/tokens';
import { useTopAppBarFill } from '@/design/use-top-app-bar-fill';
import { userdata } from '@/ffi/core';
import { useFolderActions, useNoteActions } from '@/notes/actions';
import { allNotes, changeNotes, makeReferencer, snippetOf, useNotesRead } from '@/notes/data';
import {
  FOLDER_ACTIONS,
  type FolderAction,
  NOTE_ACTIONS,
  type NoteAction,
  childFolders,
  findFolder,
  folderAccessibilityLabel,
  folderCounts,
} from '@/notes/folders';
import { ListRow, ListSection, SwipeRow } from '@/notes/list-rows';
import { NoteEditor } from '@/notes/note-editor';
import { notesColumns } from '@/notes/verse-notes';
import {
  byModified,
  chipTags,
  countLine,
  keepIds,
  noteAccessibilityLabel,
  noteMeta,
  noteTitle,
  recentNotes,
  shortDate,
  toggleTag,
} from '@/notes/note-list';
import { type ListParams, type ListScope, bigintParam, openEditor, openList, openNote } from '@/notes/routes';
import { useUndo } from '@/notes/undo-bar';

type ListData = {
  folders: Folder[];
  tags: Tag[];
  /** The scope's notes, unfiltered: the chips and the count line's total. */
  base: Note[];
  /** What the tag chips leave of them, most recently modified first. */
  shown: Note[];
};

function readList(scope: ListScope, id: bigint | undefined, selected: readonly bigint[]): ListData {
  const ud = userdata();
  const folders = ud.folders();
  const tags = ud.tags();
  const notes = (filter: NoteFilter) => ud.notes(filter);
  let base: Note[];
  let shown: Note[];
  switch (scope) {
    case 'recents': {
      base = recentNotes(allNotes());
      shown = selected.length === 0 ? base : keepIds(base, notes({ tagIds: [...selected] }).map((n) => n.id));
      break;
    }
    case 'folder': {
      // The folder's own notes; its subfolders are listed above them.
      const folder = id === undefined ? undefined : new FolderScope.Folder({ id, includeSubfolders: false });
      base = byModified(notes({ tagIds: [], folder }));
      shown = selected.length === 0 ? base : byModified(notes({ tagIds: [...selected], folder }));
      break;
    }
    case 'tag': {
      const locked = id === undefined ? [] : [id];
      base = byModified(notes({ tagIds: locked }));
      shown = selected.length === 0 ? base : byModified(notes({ tagIds: [...locked, ...selected] }));
      break;
    }
    case 'all':
      base = byModified(allNotes());
      shown = selected.length === 0 ? base : byModified(notes({ tagIds: [...selected] }));
      break;
  }
  return { folders, tags, base, shown };
}

function listTitle(scope: ListScope, id: bigint | undefined, data: ListData | undefined): string {
  switch (scope) {
    case 'all':
      return 'All Notes';
    case 'recents':
      return 'Recents';
    case 'folder':
      return findFolder(data?.folders ?? [], id)?.name ?? 'Folder';
    case 'tag': {
      const tag = data?.tags.find((t) => t.id === id);
      return tag ? `#${tag.name}` : 'Tag';
    }
  }
}

function emptyCopy(scope: ListScope, filtered: boolean): string {
  if (filtered) return 'No notes have all of these tags.';
  switch (scope) {
    case 'folder':
      return 'No notes in this folder yet.';
    case 'recents':
    case 'all':
      return 'No notes yet.';
    case 'tag':
      return 'No notes have this tag.';
  }
}

/**
 * A list of notes: All Notes, Recents, a folder (its subfolders first) or
 * a tag. Tag chips above it combine with AND. New note: a FAB on the
 * Material look, a toolbar button on the iOS look.
 */
export default function NoteListScreen() {
  const params = useLocalSearchParams<ListParams>();
  const scope: ListScope = params.scope ?? 'all';
  const id = bigintParam(params.id);
  const { look, colors, m3 } = useBerean();
  const material = look === 'material';
  const insets = useContentInsets();
  const fill = useTopAppBarFill();
  const undo = useUndo();
  const [selected, setSelected] = useState<bigint[]>([]);
  // List-detail from 640 wide (guide §7.1 columns): the note opens beside
  // the list. The three-column layout's folders column isn't drawn yet, so
  // 1000 and wider is two columns too.
  const { width } = useWindowDimensions();
  const twoPane = notesColumns(width) >= 2;
  const [openId, setOpenId] = useState<string>();

  const key = `${scope}/${params.id ?? ''}/${selected.join(',')}`;
  const data = useNotesRead(key, () => readList(scope, id, selected));
  const value = data.ok ? data.value : undefined;
  const folders = value?.folders ?? [];
  const folderActions = useFolderActions(folders);
  const noteActions = useNoteActions(folders);

  const canAdd = scope === 'all' || scope === 'folder';
  const newNote = () => {
    let made: Note | undefined;
    const error = changeNotes(() => {
      made = userdata().addNote('', '', undefined, undefined, scope === 'folder' ? id : undefined);
    });
    if (error !== undefined) Alert.alert('Couldn’t make a note', error);
    else if (made !== undefined) openEditor(made.id, true);
  };

  const referenceOf = makeReferencer();
  const subfolders = scope === 'folder' ? childFolders(folders, id) : [];
  const chips = value ? chipTags(value.tags, value.base, selected, scope === 'tag' ? id : undefined) : [];
  const filtered = selected.length > 0;
  const title = listTitle(scope, id, value);
  // The open note beside the list: the one chosen, while it's listed, else the first.
  const detailId = twoPane
    ? (value?.shown.find((n) => n.id === openId) ?? value?.shown[0])?.id
    : undefined;

  const header = (
    <View>
      {chips.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
          accessibilityLabel="Filter by tag"
        >
          {chips.map((tag) => (
            <FilterChip
              key={String(tag.id)}
              label={`#${tag.name}`}
              accessibilityLabel={`Tag ${tag.name}`}
              selected={selected.includes(tag.id)}
              onPress={() => setSelected((s) => toggleTag(s, tag.id))}
            />
          ))}
        </ScrollView>
      )}
      {filtered && value && (
        <UIText variant="caption" secondary accessibilityLiveRegion="polite" style={styles.count}>
          {countLine(value.shown.length, value.base.length)}
        </UIText>
      )}
      {scope === 'folder' && (
        <ListSection title={subfolders.length > 0 ? 'Folders' : undefined}>
          {subfolders.map((folder, i) => (
            <SwipeRow key={String(folder.id)} actions={folderActions.swipeActions(folder)}>
              <ListRow
                separated={i > 0}
                label={folder.name}
                icon={{ ios: 'folder', android: 'folder' }}
                detail={folderCounts(folder)}
                chevron
                accessibilityLabel={folderAccessibilityLabel(folder)}
                accessibilityHint="Opens the folder. Long press for actions"
                accessibilityActions={FOLDER_ACTIONS}
                onAccessibilityAction={(e) => folderActions.run(folder, e.nativeEvent.actionName as FolderAction)}
                onPress={() => openList('folder', folder.id)}
                onLongPress={() => folderActions.openMenu(folder)}
                onMenu={material ? (anchor) => folderActions.openMenu(folder, anchor) : undefined}
              />
            </SwipeRow>
          ))}
          <ListRow
            separated={subfolders.length > 0}
            label="New Folder"
            accent
            icon={{ ios: 'folder.badge.plus', android: 'create_new_folder' }}
            onPress={() => folderActions.newFolder(id)}
          />
        </ListSection>
      )}
      {scope === 'folder' && value && value.shown.length > 0 && <View style={styles.gap} />}
    </View>
  );

  const renderNote = ({ item, index }: { item: Note; index: number }) => {
    const date = shortDate(item.modified);
    const snippet = snippetOf(item);
    const meta = noteMeta(
      referenceOf(item.location),
      scope === 'folder' ? undefined : findFolder(folders, item.folderId)?.name,
    );
    const name = noteTitle(item);
    return (
      <SwipeRow actions={noteActions.swipeActions(item)}>
        <ListRow
          separated={index > 0}
          label={name}
          detail={date}
          accessibilityLabel={noteAccessibilityLabel(name, date, snippet)}
          accessibilityHint="Opens the note. Long press for actions"
          accessibilityActions={NOTE_ACTIONS}
          onAccessibilityAction={(e) => noteActions.run(item, e.nativeEvent.actionName as NoteAction)}
          selected={item.id === detailId}
          onPress={() => (twoPane ? setOpenId(item.id) : openNote(item.id))}
          onLongPress={() => noteActions.openMenu(item)}
          onMenu={material ? (anchor) => noteActions.openMenu(item, anchor) : undefined}
        >
          {snippet !== '' && (
            <UIText secondary numberOfLines={1} style={styles.snippet}>
              {snippet}
            </UIText>
          )}
          {meta.length > 0 && (
            <UIText variant="caption" secondary numberOfLines={1}>
              {meta.join('  ·  ')}
            </UIText>
          )}
        </ListRow>
      </SwipeRow>
    );
  };

  // The iOS look's rows sit in one inset group; Material's run full width.
  const rowsGroup = (row: ReactElement, index: number, count: number) =>
    material ? (
      row
    ) : (
      <View
        style={[
          styles.iosGroup,
          { backgroundColor: colors.surfaceRaised },
          index === 0 && styles.iosFirst,
          index === count - 1 && styles.iosLast,
        ]}
      >
        {row}
      </View>
    );

  return (
    <>
      <Stack.Screen
        options={{
          title,
          headerRight:
            canAdd && !material
              ? () => (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="New note"
                    onPress={newNote}
                    style={({ pressed }) => [styles.headerButton, { opacity: pressed ? 0.6 : 1 }]}
                  >
                    <ScaledSymbol name={{ ios: 'square.and.pencil', android: 'edit_square' }} size={22} tintColor={colors.accent} />
                  </Pressable>
                )
              : undefined,
        }}
      />
      <View style={twoPane ? styles.panes : styles.single}>
        <View style={twoPane ? [styles.listPane, { width: width >= 1000 ? 400 : 360, borderEndColor: colors.separator }] : styles.single}>
          {!data.ok ? (
            <UIText style={[styles.message, { color: colors.accent }]}>{data.message}</UIText>
          ) : (
            <FlatList
              style={{ backgroundColor: colors.surface }}
              contentInsetAdjustmentBehavior="automatic"
              contentContainerStyle={{
                paddingTop: insets.top,
                // Room for the FAB and Undo over the last row.
                paddingBottom: insets.bottom + (canAdd && material ? 96 : spacing.xxl) + undo.height,
                paddingLeft: insets.left,
                paddingRight: twoPane ? 0 : insets.right,
              }}
              scrollEventThrottle={16}
              {...fill}
              data={data.value.shown}
              keyExtractor={(note) => note.id}
              ListHeaderComponent={header}
              ListEmptyComponent={
                <View style={styles.message}>
                  <UIText secondary>{emptyCopy(scope, filtered)}</UIText>
                </View>
              }
              renderItem={(info) => rowsGroup(renderNote(info), info.index, data.value.shown.length)}
            />
          )}
          {canAdd && material && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="New note"
              onPress={newNote}
              android_ripple={{ color: m3.outline, borderless: false }}
              style={({ pressed }) => [
                styles.fab,
                {
                  bottom: insets.bottom + spacing.lg + undo.height,
                  right: (twoPane ? 0 : insets.right) + spacing.lg,
                  backgroundColor: m3.secondaryContainer,
                  opacity: pressed ? 0.9 : 1,
                },
              ]}
            >
              <ScaledSymbol name={{ ios: 'square.and.pencil', android: 'edit' }} size={24} tintColor={m3.onSecondaryContainer} />
            </Pressable>
          )}
        </View>
        {twoPane && (
          <View style={styles.detailPane}>
            {detailId !== undefined ? (
              <NoteEditor
                key={detailId}
                id={detailId}
                initialMode="read"
                embedded
                onDeleted={() => setOpenId(undefined)}
              />
            ) : (
              <UIText secondary style={styles.message}>
                No note selected.
              </UIText>
            )}
          </View>
        )}
      </View>
      {folderActions.sheets}
      {noteActions.sheets}
    </>
  );
}

const styles = StyleSheet.create({
  chips: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  single: { flex: 1 },
  panes: { flex: 1, flexDirection: 'row' },
  listPane: { borderEndWidth: StyleSheet.hairlineWidth },
  detailPane: { flex: 1 },
  count: { paddingHorizontal: spacing.lg + spacing.xs, paddingTop: spacing.xs },
  gap: { height: spacing.lg },
  snippet: { fontSize: 15 },
  message: { padding: spacing.lg },
  // Each row is its own cell: the inset group is drawn per row, rounded
  // at the first and last.
  iosGroup: { marginHorizontal: spacing.lg, overflow: 'hidden' },
  iosFirst: { borderTopLeftRadius: 10, borderTopRightRadius: 10 },
  iosLast: { borderBottomLeftRadius: 10, borderBottomRightRadius: 10 },
  headerButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  // M3 FAB: 56dp, 16dp corners.
  fab: {
    position: 'absolute',
    width: 56,
    height: 56,
    borderRadius: radii.materialPane,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
  },
});
