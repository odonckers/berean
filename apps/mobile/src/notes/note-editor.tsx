import { router, Stack, useIsFocused } from 'expo-router';
import { type ComponentRef, type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  type ColorValue,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  type ScrollViewInstance,
  type StyleProp,
  StyleSheet,
  type TextInputInstance,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaFrame, useSafeAreaInsets } from 'react-native-safe-area-context';

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
import { FORMAT_BAR_DOCK_DELAY_MS } from '@/notes/format-bar-config';
import { caretRevealOffset, formatBarBottom, formatBarPlacement, scrollFrame } from '@/notes/format-bar-placement';
import { applyFormat, type EditState, type FormatAction, insertLink, replaceRange, type Selection } from '@/notes/format-edits';
import { ModeSwitch, type NoteMode } from '@/notes/mode-switch';
import { NoteAppBar } from '@/notes/note-app-bar';
import { openingMode } from '@/notes/note-draft';
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
  /** Read from a list, Write for a new note; a note with an empty body opens in Write. */
  initialMode: NoteMode;
  /** A note just made for the editor: removed again if left empty. */
  fresh?: boolean;
  /**
   * Started at a verse, over the tabs: Done (iOS look) or X (Material)
   * leaves, back to the verse, as Back does.
   */
  stay?: boolean;
  /** Beside a note list (list-detail): its own toolbar instead of the screen header. */
  embedded?: boolean;
  /** Beside the list: this pane was touched last, not the list. */
  active?: boolean;
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
  active = false,
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
  const { found, draft, setDraft, flush, forget, reload } = useNoteDraft(id, fresh);
  // An empty body opens in Write wherever the note was opened from.
  const [mode, setMode] = useState(() => (found ? openingMode(initialMode, draft.content) : initialMode));
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
  const bodyViewRef = useRef<ComponentRef<typeof View>>(null);
  const titleRef = useRef<TextInputInstance>(null);
  // The body's selection as the field reports it, and one set by an edit
  // from the bar until the field reports it back.
  const [selection, setSelection] = useState<Selection>({ start: 0, end: 0 });
  const [pinned, setPinned] = useState<Selection>();
  const focused = useIsFocused();
  const [toolsHeight, setToolsHeight] = useState(0);
  const [bodyHeight, setBodyHeight] = useState(0);
  const writing = found && mode === 'write';
  const suggestion = useReferenceSuggestion(writing ? draft.content : '', selection);
  // The Write field holding focus. Blur comes before the next field's
  // focus, so only the field that had it clears it.
  const [focusedField, setFocusedField] = useState<'title' | 'body'>();
  const onFieldFocus = (field: 'title' | 'body', on: boolean) =>
    setFocusedField((current) => (on ? field : current === field ? undefined : current));
  const fieldFocused = writing && focusedField !== undefined;
  // The bar and the suggestion are the body's: the title keeps the soft
  // keyboard up, but not them.
  const bodyFocused = useDockedFocus(writing && focusedField === 'body', keyboard);
  const placement = formatBarPlacement({ writing, bodyFocused, keyboardHeight: keyboard });
  const showTools = placement !== 'hidden';
  const bodyGap = useGapBelow(bodyViewRef, keyboard);

  // The soft keyboard closed with a field still focused (Android's Back
  // does that): let go of the field, so the bar hides instead of docking
  // as if a hardware keyboard were typing.
  const lastKeyboard = useRef(keyboard);
  useEffect(() => {
    if (lastKeyboard.current > 0 && keyboard === 0) {
      bodyRef.current?.blur();
      titleRef.current?.blur();
    }
    lastKeyboard.current = keyboard;
  }, [keyboard]);

  // Read shows what was written, saved.
  const switchTo = (next: NoteMode) => {
    if (next === 'read') flush();
    setPinned(undefined);
    setFocusedField(undefined);
    setMode(next);
  };

  // Ctrl+1 / Ctrl+2 on a hardware keyboard, only while the editor has the
  // focus. Full screen, that's the screen being in front. Beside the list,
  // React Native can't tell which pane holds focus (a list row focused
  // from the keyboard isn't reported), so the pane counts as focused while
  // one of its fields has focus, or when it was the last pane touched
  // (`active`, kept by the list); Read has no fields, so the touch is what
  // tells there.
  const editorFocused = focused && found && (!embedded || active || fieldFocused);
  useEditorModeShortcuts(
    () => switchTo('write'),
    () => switchTo('read'),
    editorFocused,
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

  // Leaving, by any way out (the bar's back, X, Done, Android's Back and
  // predictive back alike), unmounts the editor; useNoteDraft then saves,
  // or removes a fresh note left empty. Over the tabs that returns to the
  // verse.
  const leave = () => router.back();

  // Material: the 64dp bar, back or X leading (Lumen). iOS look: the
  // native header; over the tabs, Done at the trailing edge with More
  // beside it (both fit beside the switch on a phone).
  const headerOptions = material
    ? {
        header: ({ options }: { options: { headerStyle?: StyleProp<{ backgroundColor?: ColorValue }> } }) => (
          <NoteAppBar
            leading={stay ? 'close' : 'back'}
            onLeading={leave}
            title={modeSwitch}
            trailing={more}
            backgroundColor={StyleSheet.flatten(options.headerStyle)?.backgroundColor}
          />
        ),
      }
    : {
        header: undefined,
        headerTitle: modeSwitch ? () => modeSwitch : undefined,
        headerRight: stay
          ? () => (
              <View style={styles.trailing}>
                {more}
                <TextButton title="Done" onPress={leave} />
              </View>
            )
          : more
            ? () => more
            : undefined,
        ...(stay ? { headerBackVisible: false, headerLeft: undefined, headerTitleAlign: 'center' as const } : null),
      };

  // Above the soft keyboard, else docked over the system bars. The
  // keyboard's top is measured from the window's bottom, the tools from
  // the body's, which ends above the tab bar and the navigation bar on
  // Android.
  const toolsBottom = formatBarBottom({
    placement,
    keyboardFromWindowBottom: keyboardBottom(keyboard, safe.bottom, Platform.OS === 'android'),
    bodyGapFromWindowBottom: bodyGap.gap,
    dockedInset: insets.bottom,
    bodyHeight,
    toolsHeight,
  });
  // In Write the scroll view ends at the tools' top, so scrolling to the
  // caret brings its line above the bar rather than behind it.
  const frame = scrollFrame({
    writing: mode === 'write',
    placement,
    toolsBottom,
    toolsHeight,
    bottomInset: insets.bottom,
    writeEnd: spacing.xl,
    readEnd: spacing.xxxl,
    bodyHeight,
  });
  const contentTop = insets.top + spacing.lg;

  // The platform scrolls to the caret only when the caret moves, but a tap
  // places it with the frame still full height; the keyboard and the tools
  // shrink the frame after, and Android then keeps the field in view, not
  // its caret. So when the frame shrinks, the caret's line is brought above
  // its new bottom from where WriteView last laid it out.
  const scrollRef = useRef<ScrollViewInstance>(null);
  const scrollY = useRef(0);
  const frameHeight = useRef(0);
  const bodyTop = useRef(0);
  const caret = useRef<{ top: number; bottom: number }>(undefined);
  const onFrameLayout = (height: number) => {
    const shrank = height < frameHeight.current;
    frameHeight.current = height;
    if (!shrank || !writing || focusedField !== 'body' || caret.current === undefined) return;
    requestAnimationFrame(() => {
      if (caret.current === undefined) return;
      const top = contentTop + bodyTop.current;
      const y = caretRevealOffset({
        caretTop: top + caret.current.top,
        caretBottom: top + caret.current.bottom,
        scrollY: scrollY.current,
        viewportHeight: frameHeight.current,
        margin: spacing.sm,
      });
      if (y !== undefined) scrollRef.current?.scrollTo({ y, animated: false });
    });
  };

  return (
    <>
      {embedded ? (
        modeSwitch && (
          <View style={[styles.toolbar, { minHeight: material ? 64 : 44, borderBottomColor: colors.separator }]}>
            {modeSwitch}
            {more}
          </View>
        )
      ) : (
        <Stack.Screen options={{ title: '', ...headerOptions }} />
      )}
      {/* Surface behind the tools too, where the scroll view now stops short. */}
      <View
        ref={bodyViewRef}
        onLayout={(e) => {
          bodyGap.measure();
          setBodyHeight(e.nativeEvent.layout.height);
        }}
        style={[styles.body, { backgroundColor: colors.surface }]}>
        <ScrollView
          ref={scrollRef}
          style={{ backgroundColor: colors.surface, marginBottom: frame.frameBottom }}
          keyboardShouldPersistTaps="handled"
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{
            paddingTop: contentTop,
            paddingBottom: frame.paddingBottom,
            paddingLeft: insets.left + spacing.lg,
            paddingRight: insets.right + spacing.lg,
          }}
          scrollEventThrottle={16}
          {...fill}
          onScroll={(e) => {
            scrollY.current = e.nativeEvent.contentOffset.y;
            fill?.onScroll(e);
          }}
          onLayout={(e) => onFrameLayout(e.nativeEvent.layout.height)}
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
                titleRef={titleRef}
                onFieldFocus={onFieldFocus}
                selection={pinned}
                onSelectionChange={onSelectionChange}
                onCaretLayout={(line) => (caret.current = line)}
                onBodyLayout={(y) => (bodyTop.current = y)}
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

/**
 * Whether the body holds focus, as formatBarPlacement takes it. With no
 * soft keyboard, only once it has for a moment: a hardware keyboard. The
 * soft keyboard opens a beat after the focus, so docking waits
 * FORMAT_BAR_DOCK_DELAY_MS rather than flash the bar at the bottom first;
 * the soft keyboard opening undocks at once. Either way letting go waits a
 * little, so a bar button's tap blurring the body a moment doesn't flash
 * the bar; moving to the title hides it after that.
 */
function useDockedFocus(bodyFocused: boolean, keyboard: number): boolean {
  const [docked, setDocked] = useState(false);
  const [held, setHeld] = useState(false);
  useEffect(() => {
    const next = bodyFocused && keyboard === 0;
    const delay = next ? FORMAT_BAR_DOCK_DELAY_MS : keyboard > 0 ? 0 : 150;
    const timer = setTimeout(() => setDocked(next), delay);
    return () => clearTimeout(timer);
  }, [bodyFocused, keyboard]);
  useEffect(() => {
    const timer = setTimeout(() => setHeld(bodyFocused), bodyFocused ? 0 : 150);
    return () => clearTimeout(timer);
  }, [bodyFocused]);
  return keyboard > 0 ? held : docked;
}

/**
 * How far a view's bottom edge is from the window's bottom: on Android the
 * native tab bar and the navigation bar lie below the editor's body. Taken
 * again on layout (`measure`, for onLayout) and when the keyboard opens or
 * closes.
 */
function useGapBelow(ref: RefObject<ComponentRef<typeof View> | null>, keyboard: number): { gap: number; measure: () => void } {
  const frame = useSafeAreaFrame();
  const windowBottom = frame.y + frame.height;
  const [gap, setGap] = useState(0);
  const measure = useCallback(() => {
    ref.current?.measureInWindow((_x, y, _width, height) => setGap(Math.max(0, windowBottom - (y + height))));
  }, [ref, windowBottom]);
  useEffect(() => measure(), [measure, keyboard]);
  return { gap, measure };
}

const styles = StyleSheet.create({
  trailing: { flexDirection: 'row', alignItems: 'center' },
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
