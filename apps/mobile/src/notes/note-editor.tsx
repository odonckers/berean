import { router, Stack } from 'expo-router';
import { type ComponentRef, useRef, useState } from 'react';
import {
  Alert,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';

import { ScaledSymbol } from '@/components/scaled-symbol';
import { UIText } from '@/components/text';
import { TextButton } from '@/components/text-button';
import { useContentInsets } from '@/design/tab-chrome';
import { useBerean } from '@/design/theme';
import { hairline, readingMeasure, spacing } from '@/design/tokens';
import { useKeyboardHeight } from '@/design/use-keyboard-height';
import { userdata } from '@/ffi/core';
import { useNoteActions } from '@/notes/actions';
import { changeNotes, findNote, makeReferencer, useNotesRead } from '@/notes/data';
import { folderTrail, noteMetaLine } from '@/notes/folders';
import { ModeSwitch, type NoteMode } from '@/notes/mode-switch';
import { noteTitle, shortDate } from '@/notes/note-list';
import { NoteReadView } from '@/notes/note-reader';
import { useNoteDraft } from '@/notes/use-note-draft';
import { WriteView } from '@/notes/write-view';

function readNote(id: string) {
  const note = findNote(id);
  return { note, folders: userdata().folders(), reference: makeReferencer()(note?.location) };
}

type ScrollHandler = (e: NativeSyntheticEvent<NativeScrollEvent>) => void;

type NoteEditorProps = {
  id: string;
  initialMode: NoteMode;
  /** A note just made for the editor: removed again if left empty. */
  fresh?: boolean;
  /**
   * Started at a verse, over the tabs: a Done button (Close on the
   * Material look) leaves, back to the verse.
   */
  stay?: boolean;
  /** Beside a note list (list-detail): its own toolbar instead of the screen header. */
  embedded?: boolean;
  /** After Delete: the screen goes back; list-detail clears its selection. */
  onDeleted: () => void;
  /** The screen's top app bar fill, on a full-screen note. */
  fill?: { onScroll: ScrollHandler; onScrollEndDrag: ScrollHandler; onMomentumScrollEnd: ScrollHandler };
};

/**
 * One note, in Write or Read (guide §7.1), switched in the header. Write
 * edits the title and the Markdown source; Read is the core's rendering of
 * the same draft. The draft saves itself (useNoteDraft). Full screen on
 * phones, or the detail pane beside a note list on wide windows.
 */
export function NoteEditor({
  id,
  initialMode,
  fresh = false,
  stay = false,
  embedded = false,
  onDeleted,
  fill,
}: NoteEditorProps) {
  const { look, colors, m3 } = useBerean();
  const material = look === 'material';
  const contentInsets = useContentInsets();
  // Beside the list, the list's screen pads for the system bars.
  const insets = embedded ? { top: 0, bottom: contentInsets.bottom, left: 0, right: contentInsets.right } : contentInsets;
  const keyboard = useKeyboardHeight();
  const { fontScale } = useWindowDimensions();
  const [mode, setMode] = useState(initialMode);
  const { found, draft, setDraft, flush, forget, reload } = useNoteDraft(id, fresh);
  // The folder, date and location, and the note for More: the text is the draft's.
  const data = useNotesRead(`note/${id}`, () => readNote(id));
  const value = data.ok ? data.value : undefined;
  const note = value?.note;
  const actions = useNoteActions(value?.folders ?? [], () => {
    forget();
    onDeleted();
  });
  const moreRef = useRef<ComponentRef<typeof Pressable>>(null);

  // Read shows what was written, saved.
  const switchTo = (next: NoteMode) => {
    if (next === 'read') flush();
    setMode(next);
  };

  const onTask = (index: number, checked: boolean) => {
    flush();
    const error = changeNotes(() => userdata().setTask(id, index, checked));
    if (error !== undefined) Alert.alert('Couldn’t update the checklist', error);
    else reload();
  };

  const openMore = () => {
    if (note === undefined) return;
    // Move and Delete act on the saved note.
    flush();
    if (material) {
      moreRef.current?.measureInWindow((x, y, width, height) => actions.openMenu(note, { x, y, width, height }));
    } else {
      actions.openMenu(note);
    }
  };

  const meta = note ? noteMetaLine(folderTrail(value?.folders ?? [], note.folderId), shortDate(note.modified)) : '';

  const modeSwitch = found ? <ModeSwitch mode={mode} onChange={switchTo} /> : null;

  const more = note ? (
    <Pressable
      ref={moreRef}
      accessibilityRole="button"
      accessibilityLabel={material ? 'More actions' : `More actions for ${noteTitle(draft)}`}
      onPress={openMore}
      style={({ pressed }) => [
        styles.iconButton,
        { minWidth: material ? 48 : 44, minHeight: material ? 48 : 44, opacity: pressed ? 0.6 : 1 },
      ]}
    >
      {/* iOS look: ellipsis.circle, Material Symbols' circled dots on Android. */}
      <ScaledSymbol
        name={material ? { ios: 'ellipsis.circle', android: 'more_vert' } : { ios: 'ellipsis.circle', android: 'pending' }}
        size={22}
        tintColor={material ? m3.onSurfaceVariant : colors.accent}
      />
    </Pressable>
  ) : null;

  // Over the tabs there's no back button: Done (iOS) or Close (Material) leaves.
  const close = material ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Close"
      onPress={() => router.back()}
      style={({ pressed }) => [styles.iconButton, { minWidth: 48, minHeight: 48, opacity: pressed ? 0.6 : 1 }]}
    >
      <ScaledSymbol name={{ ios: 'xmark', android: 'close' }} size={24} tintColor={m3.onSurfaceVariant} />
    </Pressable>
  ) : (
    <TextButton title="Done" onPress={() => router.back()} />
  );

  return (
    <>
      {embedded ? (
        modeSwitch && (
          <View style={[styles.toolbar, { borderBottomColor: colors.separator }]}>
            {modeSwitch}
            {more}
          </View>
        )
      ) : (
        <Stack.Screen
          options={{
            title: '',
            headerTitle: modeSwitch ? () => modeSwitch : undefined,
            headerRight: more ? () => more : undefined,
            ...(stay ? { headerBackVisible: false, headerLeft: () => close } : null),
          }}
        />
      )}
      <ScrollView
        style={{ backgroundColor: colors.surface }}
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          paddingTop: insets.top + spacing.lg,
          paddingBottom: insets.bottom + (mode === 'write' ? keyboard + spacing.xl : spacing.xxxl),
          paddingLeft: insets.left + spacing.lg,
          paddingRight: insets.right + spacing.lg,
        }}
        scrollEventThrottle={16}
        {...fill}
      >
        <View style={[styles.column, { maxWidth: readingMeasure * fontScale }, mode === 'read' && styles.readColumn]}>
          {!found ? (
            <UIText secondary>This note is no longer here.</UIText>
          ) : mode === 'write' ? (
            <WriteView draft={draft} onChange={setDraft} autoFocus={fresh} />
          ) : (
            <NoteReadView
              title={draft.title}
              content={draft.content}
              meta={meta}
              reference={value?.reference}
              onTask={onTask}
            />
          )}
        </View>
      </ScrollView>
      {actions.sheets}
    </>
  );
}

const styles = StyleSheet.create({
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: hairline,
    paddingHorizontal: spacing.sm,
  },
  iconButton: { alignItems: 'center', justifyContent: 'center' },
  column: { width: '100%', alignSelf: 'center', gap: spacing.md },
  readColumn: { gap: spacing.lg },
});
