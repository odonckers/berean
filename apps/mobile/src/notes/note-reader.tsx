import { Stack } from 'expo-router';
import { type ComponentRef, useRef } from 'react';
import {
  Alert,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { ScaledSymbol } from '@/components/scaled-symbol';
import { UIText } from '@/components/text';
import { TextButton } from '@/components/text-button';
import { useContentInsets } from '@/design/tab-chrome';
import { useBerean } from '@/design/theme';
import { hairline, readingMeasure, spacing } from '@/design/tokens';
import { userdata } from '@/ffi/core';
import { useNoteActions } from '@/notes/actions';
import { changeNotes, findNote, makeReferencer, useNotesRead } from '@/notes/data';
import { folderTrail, noteMetaLine } from '@/notes/folders';
import { NoteBody } from '@/notes/note-body';
import { noteTitle, shortDate } from '@/notes/note-list';
import { withoutTitleHeading } from '@/notes/note-text';
import { openEditor } from '@/notes/routes';

function readNote(id: string) {
  const note = findNote(id);
  const folders = userdata().folders();
  return {
    note,
    folders,
    blocks: note === undefined ? [] : withoutTitleHeading(userdata().renderMarkdown(note.content), note.title),
    reference: makeReferencer()(note?.location),
  };
}

type ScrollHandler = (e: NativeSyntheticEvent<NativeScrollEvent>) => void;

type NoteReaderProps = {
  id: string;
  /** Beside a note list (list-detail): its own toolbar instead of the screen header. */
  embedded?: boolean;
  /** After Delete: the screen goes back; list-detail clears its selection. */
  onDeleted: () => void;
  /** The screen's top app bar fill, on a full-screen note. */
  fill?: { onScroll: ScrollHandler; onScrollEndDrag: ScrollHandler; onMomentumScrollEnd: ScrollHandler };
};

/**
 * A note in Read (guide §7.1): its title, "Folder › Subfolder · Oct 28",
 * then the core's rendering of the body in the reading serif. Edit opens
 * the plain editor until Write mode (6c). Full screen on phones (the note
 * route), or the detail pane beside a note list on wide windows.
 */
export function NoteReader({ id, embedded = false, onDeleted, fill }: NoteReaderProps) {
  const { look, colors, m3, type } = useBerean();
  const material = look === 'material';
  const contentInsets = useContentInsets();
  // Beside the list, the list's screen pads for the system bars.
  const insets = embedded ? { top: 0, bottom: contentInsets.bottom, left: 0, right: contentInsets.right } : contentInsets;
  const { fontScale } = useWindowDimensions();
  const data = useNotesRead(`note/${id}`, () => readNote(id));
  const value = data.ok ? data.value : undefined;
  const note = value?.note;
  const actions = useNoteActions(value?.folders ?? [], onDeleted);
  const moreRef = useRef<ComponentRef<typeof Pressable>>(null);

  const onTask = (index: number, checked: boolean) => {
    const error = changeNotes(() => userdata().setTask(id, index, checked));
    if (error !== undefined) Alert.alert('Couldn’t update the checklist', error);
  };

  const openMore = () => {
    if (note === undefined) return;
    if (material) {
      moreRef.current?.measureInWindow((x, y, width, height) => actions.openMenu(note, { x, y, width, height }));
    } else {
      actions.openMenu(note);
    }
  };

  const meta = note
    ? noteMetaLine(folderTrail(value?.folders ?? [], note.folderId), shortDate(note.modified))
    : '';

  const toolbar = note ? (
    <View style={styles.headerRight}>
      <TextButton title="Edit" accessibilityLabel="Edit note" onPress={() => openEditor(note.id)} />
      <Pressable
        ref={moreRef}
        accessibilityRole="button"
        accessibilityLabel="More actions"
        onPress={openMore}
        style={({ pressed }) => [
          styles.iconButton,
          { minWidth: material ? 48 : 44, minHeight: material ? 48 : 44, opacity: pressed ? 0.6 : 1 },
        ]}
      >
        <ScaledSymbol
          name={{ ios: 'ellipsis.circle', android: 'more_vert' }}
          size={22}
          tintColor={material ? m3.onSurfaceVariant : colors.accent}
        />
      </Pressable>
    </View>
  ) : null;

  return (
    <>
      {embedded ? (
        toolbar && <View style={[styles.toolbar, { borderBottomColor: colors.separator }]}>{toolbar}</View>
      ) : (
        <Stack.Screen options={{ title: note ? noteTitle(note) : '', headerRight: toolbar ? () => toolbar : undefined }} />
      )}
      <ScrollView
        style={{ backgroundColor: colors.surface }}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          paddingTop: insets.top + spacing.lg,
          paddingBottom: insets.bottom + spacing.xxxl,
          paddingLeft: insets.left + spacing.lg,
          paddingRight: insets.right + spacing.lg,
        }}
        scrollEventThrottle={16}
        {...fill}
      >
        <View style={[styles.column, { maxWidth: readingMeasure * fontScale }]}>
          {!data.ok ? (
            <UIText style={{ color: colors.accent }}>{data.message}</UIText>
          ) : note === undefined ? (
            <UIText secondary>This note is no longer here.</UIText>
          ) : (
            <>
              <View style={styles.titleBlock}>
                <Text accessibilityRole="header" style={[type.reading.chapterHeading, { color: colors.text }]}>
                  {noteTitle(note)}
                </Text>
                {meta !== '' && <UIText variant="caption" secondary>{meta}</UIText>}
                {value?.reference !== undefined && (
                  <UIText variant="caption" secondary>
                    {value.reference}
                  </UIText>
                )}
              </View>
              {value && value.blocks.length > 0 ? (
                <NoteBody blocks={value.blocks} onTask={onTask} />
              ) : (
                <UIText secondary>Empty note. Tap Edit to write.</UIText>
              )}
            </>
          )}
        </View>
      </ScrollView>
      {actions.sheets}
    </>
  );
}

const styles = StyleSheet.create({
  headerRight: { flexDirection: 'row', alignItems: 'center' },
  toolbar: { flexDirection: 'row', justifyContent: 'flex-end', borderBottomWidth: hairline, paddingHorizontal: spacing.sm },
  iconButton: { alignItems: 'center', justifyContent: 'center' },
  column: { width: '100%', alignSelf: 'center', gap: spacing.lg },
  titleBlock: { gap: spacing.xs },
});
