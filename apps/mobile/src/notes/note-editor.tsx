import { router, Stack, useIsFocused } from 'expo-router';
import { type ComponentRef, useRef, useState } from 'react';
import {
  Alert,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  type TextInputInstance,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useEditorModeShortcuts } from '../../modules/berean-shortcuts';
import { keyboardBottom } from '@/components/palette-frame';
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
import { FormatBar } from '@/notes/format-bar';
import { FORMAT_BAR_WHEN_KEYBOARD_CLOSED } from '@/notes/format-bar-config';
import { applyFormat, type EditState, type FormatAction, insertLink, replaceRange, type Selection } from '@/notes/format-edits';
import { ModeSwitch, type NoteMode } from '@/notes/mode-switch';
import { noteTitle, shortDate } from '@/notes/note-list';
import { NoteReadView } from '@/notes/note-reader';
import { ReferenceSuggestionChip } from '@/notes/reference-suggestion';
import { useNoteDraft } from '@/notes/use-note-draft';
import { passageLink, useReferenceSuggestion } from '@/notes/use-reference-suggestion';
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
  const safe = useSafeAreaInsets();
  const bodyRef = useRef<TextInputInstance>(null);
  // The body's selection as the field reports it, and one set by an edit
  // from the bar until the field reports it back.
  const [selection, setSelection] = useState<Selection>({ start: 0, end: 0 });
  const [pinned, setPinned] = useState<Selection>();
  const focused = useIsFocused();
  const [toolsHeight, setToolsHeight] = useState(0);
  const writing = found && mode === 'write';
  const suggestion = useReferenceSuggestion(writing ? draft.content : '', selection);
  const showTools = writing && (keyboard > 0 || FORMAT_BAR_WHEN_KEYBOARD_CLOSED === 'show');

  // Read shows what was written, saved.
  const switchTo = (next: NoteMode) => {
    if (next === 'read') flush();
    setPinned(undefined);
    setMode(next);
  };

  // Ctrl+1 / Ctrl+2 on a hardware keyboard, while this screen is in front.
  useEditorModeShortcuts(
    () => switchTo('write'),
    () => switchTo('read'),
    focused && found,
  );

  const onSelectionChange = (next: Selection) => {
    setSelection(next);
    if (pinned?.start === next.start && pinned.end === next.end) setPinned(undefined);
  };

  const onDraftChange = (next: typeof draft) => {
    // Typing takes the selection back from the bar's edit.
    if (next.content !== draft.content) setPinned(undefined);
    setDraft(next);
  };

  // An edit from the bar or the suggestion: the new text and selection,
  // and the keyboard kept on the body.
  const applyEdit = (edit: EditState) => {
    setDraft({ ...draft, content: edit.text });
    setSelection(edit.selection);
    setPinned(edit.selection);
    bodyRef.current?.focus();
  };

  const onFormat = (action: FormatAction) => {
    const state = { text: draft.content, selection };
    if (action !== 'link') {
      applyEdit(applyFormat(state, action));
      return;
    }
    // A selected reference links to its passage; anything else gets an
    // empty target to type. The spec's Omnisearch picker for the target
    // comes in a later slice.
    const selected = draft.content.slice(Math.min(selection.start, selection.end), Math.max(selection.start, selection.end));
    const url = selected === '' ? undefined : passageLink(selected);
    applyEdit(insertLink(state, url === undefined ? undefined : { text: selected, url }));
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

  // Above the keyboard, or the system bars while it's closed.
  const toolsBottom = keyboard > 0 ? keyboardBottom(keyboard, safe.bottom, Platform.OS === 'android') : insets.bottom;

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
      <View style={styles.body}>
        <ScrollView
          style={{ backgroundColor: colors.surface }}
          keyboardShouldPersistTaps="handled"
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{
            paddingTop: insets.top + spacing.lg,
            paddingBottom:
              insets.bottom + (mode === 'write' ? keyboard + (showTools ? toolsHeight : 0) + spacing.xl : spacing.xxxl),
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
              <WriteView
                draft={draft}
                onChange={onDraftChange}
                autoFocus={fresh}
                bodyRef={bodyRef}
                selection={pinned}
                onSelectionChange={onSelectionChange}
              />
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
        {showTools && (
          <View
            pointerEvents="box-none"
            onLayout={(e) => setToolsHeight(e.nativeEvent.layout.height)}
            style={[styles.tools, { bottom: toolsBottom }]}
          >
            {suggestion && (
              <View style={{ paddingLeft: insets.left + spacing.lg, paddingRight: insets.right + spacing.lg }}>
                <ReferenceSuggestionChip
                  label={suggestion.label}
                  onPress={() =>
                    applyEdit(replaceRange({ text: draft.content, selection }, suggestion.range, suggestion.markdown))
                  }
                />
              </View>
            )}
            <FormatBar onAction={onFormat} />
          </View>
        )}
      </View>
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
  body: { flex: 1 },
  // The suggestion and the formatting bar, over the bottom of the note.
  tools: { position: 'absolute', left: 0, right: 0, gap: spacing.xs },
  column: { width: '100%', alignSelf: 'center', gap: spacing.md },
  readColumn: { gap: spacing.lg },
});
