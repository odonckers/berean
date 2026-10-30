import type { Folder, Tag } from 'berean-ffi-rn';
import { ScrollView, StyleSheet, View } from 'react-native';

import { UIText } from '@/components/text';
import { useContentInsets, useHeaderHidden } from '@/design/tab-chrome';
import { useBerean } from '@/design/theme';
import { spacing } from '@/design/tokens';
import { useTopAppBarFill } from '@/design/use-top-app-bar-fill';
import { userdata } from '@/ffi/core';
import { useFolderActions } from '@/notes/actions';
import { allNotes, useNotesRead } from '@/notes/data';
import {
  FOLDER_ACTIONS,
  type FolderAction,
  childFolders,
  folderAccessibilityLabel,
  folderCounts,
} from '@/notes/folders';
import { ListRow, ListSection, SwipeRow } from '@/notes/list-rows';
import { RECENTS_LIMIT, noteCount } from '@/notes/note-list';
import { openList } from '@/notes/routes';

type FoldersData = {
  allCount: number;
  folders: Folder[];
  tags: { tag: Tag; count: number }[];
};

function readFolders(): FoldersData {
  const ud = userdata();
  return {
    allCount: allNotes().length,
    folders: ud.folders(),
    // Tag has no count: each is the length of the core's own tag filter.
    tags: ud.tags().map((tag) => ({ tag, count: ud.notes({ tagIds: [tag.id] }).length })),
  };
}

/**
 * The Notes tab root (guide §7.1, phones): All Notes, Recents, the
 * top-level folders with their subfolder and note counts, New Folder, then
 * Tags. Tapping a folder drills into its subfolders and notes.
 */
export default function FoldersScreen() {
  const { look, colors } = useBerean();
  const material = look === 'material';
  const insets = useContentInsets();
  const headerHidden = useHeaderHidden();
  const fill = useTopAppBarFill();
  const data = useNotesRead('folders', readFolders);
  const folders = data.ok ? data.value.folders : [];
  const actions = useFolderActions(folders);

  const folderIcon = { ios: 'folder', android: 'folder' } as const;

  return (
    <>
      <ScrollView
        style={[styles.scroll, { backgroundColor: colors.surface }]}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          paddingTop: insets.top,
          paddingBottom: insets.bottom + spacing.xxl,
          paddingLeft: insets.left,
          paddingRight: insets.right,
        }}
        scrollEventThrottle={16}
        {...fill}
      >
        {headerHidden && (
          <UIText variant="largeTitle" style={styles.inlineTitle}>
            Notes
          </UIText>
        )}
        {!data.ok ? (
          <UIText style={[styles.message, { color: colors.accent }]}>{data.message}</UIText>
        ) : (
          <>
            <ListSection>
              <ListRow
                label="All Notes"
                icon={{ ios: 'tray.full', android: 'notes' }}
                detail={String(data.value.allCount)}
                accessibilityLabel={`All Notes, ${noteCount(data.value.allCount)}`}
                chevron
                onPress={() => openList('all')}
              />
              <ListRow
                separated
                label="Recents"
                icon={{ ios: 'clock', android: 'schedule' }}
                detail={String(Math.min(RECENTS_LIMIT, data.value.allCount))}
                accessibilityLabel={`Recents, ${noteCount(Math.min(RECENTS_LIMIT, data.value.allCount))}`}
                chevron
                onPress={() => openList('recents')}
              />
            </ListSection>

            <ListSection title="Folders">
              {childFolders(folders).map((folder, i) => (
                <SwipeRow key={String(folder.id)} actions={actions.swipeActions(folder)}>
                  <ListRow
                    separated={i > 0}
                    label={folder.name}
                    icon={folderIcon}
                    detail={folderCounts(folder)}
                    chevron
                    accessibilityLabel={folderAccessibilityLabel(folder)}
                    accessibilityHint="Opens the folder. Long press for actions"
                    accessibilityActions={FOLDER_ACTIONS}
                    onAccessibilityAction={(e) => actions.run(folder, e.nativeEvent.actionName as FolderAction)}
                    onPress={() => openList('folder', folder.id)}
                    onLongPress={() => actions.openMenu(folder)}
                    onMenu={material ? (anchor) => actions.openMenu(folder, anchor) : undefined}
                  />
                </SwipeRow>
              ))}
              <ListRow
                separated={childFolders(folders).length > 0}
                label="New Folder"
                accent
                icon={{ ios: 'folder.badge.plus', android: 'create_new_folder' }}
                onPress={() => actions.newFolder()}
              />
            </ListSection>

            {data.value.tags.length > 0 && (
              <ListSection title="Tags">
                {data.value.tags.map(({ tag, count }, i) => (
                  <ListRow
                    key={String(tag.id)}
                    separated={i > 0}
                    label={tag.name}
                    icon={{ ios: 'number', android: 'tag' }}
                    detail={String(count)}
                    accessibilityLabel={`Tag ${tag.name}, ${noteCount(count)}`}
                    chevron
                    onPress={() => openList('tag', tag.id)}
                  />
                ))}
              </ListSection>
            )}
            {folders.length === 0 && data.value.allCount === 0 && (
              <View style={styles.message}>
                <UIText secondary>No notes yet. Make a folder, or start a note from All Notes.</UIText>
              </View>
            )}
          </>
        )}
      </ScrollView>
      {actions.sheets}
    </>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  inlineTitle: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  message: { padding: spacing.lg },
});
