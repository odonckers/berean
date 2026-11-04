import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { router, Stack, useFocusEffect, usePreventRemove } from 'expo-router';
import {
  type ComponentRef,
  Fragment,
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import {
  AccessibilityInfo,
  BackHandler,
  type LayoutChangeEvent,
  Platform,
  Pressable,
  type ScrollView,
  StyleSheet,
  Text,
  type TextLayoutEvent,
  ToastAndroid,
  View,
  useWindowDimensions,
} from 'react-native';
import type { NativeGesture } from 'react-native-gesture-handler';
import { useReducedMotion, useSharedValue } from 'react-native-reanimated';

import { ScriptureText, UIText } from '@/components/text';
import { TextButton } from '@/components/text-button';
import { useContentInsets, useHeaderHidden } from '@/design/tab-chrome';
import { useBerean } from '@/design/theme';
import { spacing } from '@/design/tokens';
import { useTopAppBarFill } from '@/design/use-top-app-bar-fill';
import { reader } from '@/ffi/core';
import { load } from '@/library/load';
import { addNoteAt, snippetOf } from '@/notes/data';
import { noteTitle, shortDate } from '@/notes/note-list';
import { openNote } from '@/notes/routes';
import { UndoBar, useUndoBarBottom } from '@/notes/undo-bar';
import {
  addNoteLabel,
  mergeMarkers,
  noteMarkerMode,
  showNotesLabel,
  verseNotesSubject,
} from '@/notes/verse-notes';
import {
  type ChapterLocation,
  chapterHeading,
  keyForChapter,
  nextChapter,
  previousChapter,
  shouldResetScroll,
  spanReference,
  verseReference,
} from '@/reader/bible-nav';
import { BiblePicker } from '@/reader/bible-picker';
import { BookmarkButton, BookmarkPicker, useBookmarkPicker } from '@/reader/bookmark-picker';
import {
  type BiblePlace,
  type BookmarkRow,
  type SlotPlace,
  bookmarkJump,
  bookmarkRows,
  bookmarkSnippet,
  jumpAnnouncement,
  locationKey,
  notFoundMessage,
  saveTarget,
  shortcutOpensBookmarks,
  slotPlace,
  startPlace,
  toolbarBookmark,
} from '@/reader/bookmarks';
import {
  type BookmarkChange,
  barDuration,
  bookmarkBar,
  bookmarkUndoMessages,
  restoredAnnouncement,
} from '@/reader/bookmark-undo';
import { type Wash, landingWash } from '@/reader/landing-wash';
import { WashText } from '@/reader/wash-text';
import { copiedVerse, copyConfirmation, verseText } from '@/reader/copy-verse';
import { HighlightSheet } from '@/reader/highlight-sheet';
import { highlightActionLabel, highlightSpokenName, segmentHighlight, segmentVerse } from '@/reader/highlights';
import { type LandedVerse, landedLabel, landedVerse } from '@/reader/landed-verse';
import {
  type Run,
  blockSegments,
  chapterBlocks,
  isVerseRun,
  lineAt,
  numberBlock,
  numberOffset,
  numberSpan,
  numberedVerses,
  paneSplit,
  withoutBookTitle,
} from '@/reader/chapter-blocks';
import {
  LARGE_TEXT_SCALE,
  MAX_HEIGHT,
  MIN_HEIGHT,
  openFit,
  paneMaxFraction,
  verseScrollOffset,
} from '@/reader/pane-snap';
import { AaButton, ReadingAppearanceHost, useReadingAppearance } from '@/reader/reading-appearance';
import { ReadingColumn, useColumnPaddingTop } from '@/reader/reading-column';
import {
  forgetVerse,
  rememberPaneFraction,
  rememberVerse,
  restoredPane,
} from '@/reader/session';
import { MARKER_GUTTER, NoteBadge, NoteMarker } from '@/reader/note-marker';
import { type PaneNote, StudyPane, moveAccessibilityFocus } from '@/reader/study-pane';
import { useChapterHighlights } from '@/reader/use-chapter-highlights';
import { useBookmarks } from '@/reader/use-bookmarks';
import { useChapterNotes } from '@/reader/use-chapter-notes';
import { markersByVerse, paneStudy, studyActionLabel } from '@/reader/verse-study';
import { useBookmarkShortcut } from '../../modules/berean-shortcuts';

// Study guide installation isn't modelled yet, so the guide is treated as
// not installed (the pane offers a Research tab when there is content).
const GUIDE_INSTALLED = false;

// Per-verse accessibility actions on a paragraph block, named by verse:
// study, highlight, and copy.
const VERSE_ACTION = 'verse-';
const HIGHLIGHT_ACTION = 'highlight-';
const COPY_ACTION = 'copy-';
// And, per verse: Show notes (with notes) and Add note.
const NOTES_ACTION = 'notes-';
const ADD_NOTE_ACTION = 'addnote-';

type FilledRow = Extract<BookmarkRow, { kind: 'filled' }>;
type BookmarkLocationOf = FilledRow['location'];

/** A filled slot as the core holds it, for Undo to put back. */
const heldOf = (pubKey: string, row: FilledRow) => ({
  pubKey,
  slot: row.slot,
  location: row.location,
  title: row.title,
  snippet: row.snippet,
});

type LineBox = { y: number; height: number; text: string };
type BlockBox = { top?: number; lines?: readonly LineBox[] };

type Selection = {
  chapterKey: string;
  verse: number;
  restored: boolean;
  /** A restored pane's height, as a window fraction. */
  fraction?: number;
  /** The pane is collapsing; it unmounts when its animation finishes. */
  closing: boolean;
  /** Opened at My notes (a margin marker, Show notes), focus on the first note. */
  atNotes?: boolean;
  /** Bumped to show My notes again in the open pane. */
  notesAsk?: number;
};

export function BibleChapterView({
  pubKey,
  title,
  book,
  chapter,
  verse: arrivalVerse,
}: {
  pubKey: string;
  title: string;
  book: number;
  chapter: number;
  /** A verse to open the chapter at (a search hit), scrolled to once. */
  verse?: number;
}) {
  const { look, colors, m3, type, highlights: fills } = useBerean();
  const material = look === 'material';
  const reducedMotion = useReducedMotion();
  // The Read tab's root: the material top app bar's tonal fill, and the
  // status bar padding where the look hides the native header.
  const fill = useTopAppBarFill();
  const columnTop = useColumnPaddingTop(true);
  const contentInsets = useContentInsets();
  const { height: windowHeight, width: windowWidth, fontScale } = useWindowDimensions();
  // A synchronous FFI call on the JS thread; agreed for now.
  const loaded = useMemo(
    () => load(() => reader().bibleChapter(pubKey, book, chapter)),
    [pubKey, book, chapter],
  );
  // The Bible's books, in the core's order, for the headings, the picker
  // and Previous/Next across books. Without them the heading falls back to
  // "Chapter N", there is no picker, and Previous/Next stay in the book.
  const books = useMemo(() => load(() => reader().bibleBooks(pubKey)), [pubKey]);
  const bookList = books.ok && books.value.length > 0 ? books.value : undefined;
  const bookInfo = bookList?.find((b) => b.book === book);
  const heading = chapterHeading(bookInfo, chapter);
  const [picking, setPicking] = useState(false);
  // The Aa quick picker: in the header, or beside the in-content heading
  // where the look hides the native header.
  const appearance = useReadingAppearance();
  const headerHidden = useHeaderHidden();
  const aa = <AaButton buttonRef={appearance.buttonRef} onPress={appearance.toggle} />;
  const pickLabel = `${heading}, choose book and chapter`;

  // The selection belongs to one chapter, so changing publication, book or
  // chapter (Previous/Next included) closes the pane without an effect.
  // A remount (switching the dev Look) restores the open verse and its
  // height from the session, and the pane re-opens without animation or
  // announcement.
  const chapterKey = keyForChapter(pubKey, { book, chapter });
  const [selection, setSelection] = useState<Selection | undefined>(() => {
    const pane = restoredPane(chapterKey);
    return pane === undefined
      ? undefined
      : { chapterKey, verse: pane.verse, restored: true, fraction: pane.fraction, closing: false };
  });
  const current = selection?.chapterKey === chapterKey ? selection : undefined;
  // The verse the pane is under, while it is mounted (closing included).
  const selected = current?.verse;
  const closing = current?.closing ?? false;
  // The verse whose study is open: not once its close is asked for.
  const open = closing ? undefined : selected;

  // Bookmarks (spec §3): the button beside Aa saves the selected verse while
  // the study pane is open, else the chapter, and is filled while that is
  // in one of the publication's 10 slots.
  const bookmarks = useBookmarks(pubKey);
  const bookmarkPicker = useBookmarkPicker();
  const target = saveTarget(heading, { book, chapter }, open);
  const toolbarRows: readonly BookmarkRow[] | { message: string } = bookmarks.list.ok
    ? bookmarkRows(bookmarks.list.value, target.place)
    : { message: bookmarks.list.message };
  const toolbarState =
    'message' in toolbarRows ? { filled: false, value: undefined } : toolbarBookmark(toolbarRows, target.reference);
  // A verse's Bookmark… opens the picker in save mode for that verse (spec
  // §3.1); the button and Ctrl+D save what the button would. Set as the
  // picker opens, for that opening.
  const [pickerVerse, setPickerVerse] = useState<{ chapterKey: string; verse: number }>();
  const pickerTarget =
    pickerVerse?.chapterKey === keyForChapter(pubKey, { book, chapter })
      ? saveTarget(heading, { book, chapter }, pickerVerse.verse)
      : target;
  const slotRows: readonly BookmarkRow[] | { message: string } =
    'message' in toolbarRows || pickerTarget === target
      ? toolbarRows
      : bookmarkRows(bookmarks.list.ok ? bookmarks.list.value : [], pickerTarget.place);
  // Each opening reads the list again and locates its places afresh.
  const [pickerOpenings, setPickerOpenings] = useState(0);
  const openBookmarks = () => {
    if (!bookmarkPicker.open) {
      bookmarks.refresh();
      setPickerVerse(undefined);
      setPickerOpenings((n) => n + 1);
    }
    bookmarkPicker.toggle();
  };
  const openBookmarksFor = (verse: number) => {
    bookmarks.refresh();
    setPickerVerse({ chapterKey: keyForChapter(pubKey, { book, chapter }), verse });
    setPickerOpenings((n) => n + 1);
    bookmarkPicker.show();
  };

  // Where each filled slot is now in this edition (spec §7), from the
  // core's Reader.locate: a sync call that reads at most one chapter, so
  // each place is located once per opening (and Bible), only while the
  // picker is open. Kept as state, added to as the rows render.
  const locateNow = (location: BookmarkLocationOf): SlotPlace => {
    const read = load(() => reader().locate(location));
    return slotPlace(read.ok ? { ok: true, value: read.value } : { ok: false });
  };
  const [located, setLocated] = useState<{ opening: number; pubKey: string; places: ReadonlyMap<string, SlotPlace> }>(
    () => ({ opening: pickerOpenings, pubKey, places: new Map() }),
  );
  let locatedNow =
    located.opening === pickerOpenings && located.pubKey === pubKey
      ? located
      : { opening: pickerOpenings, pubKey, places: new Map<string, SlotPlace>() };
  const unlocated =
    bookmarkPicker.open && !('message' in slotRows)
      ? slotRows.flatMap((row) =>
          row.kind === 'filled' && !locatedNow.places.has(locationKey(row.location)) ? [row.location] : [],
        )
      : [];
  if (unlocated.length > 0) {
    const places = new Map(locatedNow.places);
    for (const location of unlocated) places.set(locationKey(location), locateNow(location));
    locatedNow = { ...locatedNow, places };
  }
  if (locatedNow !== located) setLocated(locatedNow);
  const placeOf = (location: BookmarkLocationOf): SlotPlace =>
    locatedNow.places.get(locationKey(location)) ?? locateNow(location);
  const slotPlaces = new Map<number, SlotPlace>(
    bookmarkPicker.open && !('message' in slotRows)
      ? slotRows.flatMap((row) => (row.kind === 'filled' ? [[row.slot, placeOf(row.location)] as const] : []))
      : [],
  );

  // The bar over the picker, or over the reader once it closes: Undo for
  // the last Delete or Replace (6 s), or where a not-found jump went. It
  // goes with the reader (spec §7): when it loses focus or the Bible
  // changes.
  const [bar, dispatchBar] = useReducer(bookmarkBar, undefined);
  const [barPubKey, setBarPubKey] = useState(pubKey);
  if (barPubKey !== pubKey) {
    setBarPubKey(pubKey);
    dispatchBar({ kind: 'left' });
  }
  useEffect(() => {
    if (bar === undefined) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    AccessibilityInfo.isScreenReaderEnabled()
      .catch(() => false)
      .then((on) => {
        if (!cancelled) timer = setTimeout(() => dispatchBar({ kind: 'expired', id: bar.id }), barDuration(bar, on));
      });
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [bar]);
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => {
        setFocused(false);
        dispatchBar({ kind: 'left' });
      };
    }, []),
  );
  const barBottom = useUndoBarBottom();
  const offerUndo = (change: BookmarkChange) => {
    dispatchBar({ kind: 'changed', change });
    AccessibilityInfo.announceForAccessibilityWithOptions(bookmarkUndoMessages(look, change).announcement, {
      queue: true,
    });
  };
  const undoBookmark = () => {
    if (bar?.kind !== 'undo') return;
    const { previous } = bar.change;
    dispatchBar({ kind: 'undone' });
    const message = bookmarks.restore(previous);
    AccessibilityInfo.announceForAccessibility(message ?? restoredAnnouncement(previous));
  };
  const barShown =
    bar === undefined
      ? undefined
      : bar.kind === 'undo'
        ? { label: bookmarkUndoMessages(look, bar.change).label, onUndo: undoBookmark }
        : { label: bar.message };
  const toolbar = (
    <View style={styles.toolbar}>
      {aa}
      <BookmarkButton
        buttonRef={bookmarkPicker.buttonRef}
        filled={toolbarState.filled}
        value={toolbarState.value}
        onPress={openBookmarks}
      />
    </View>
  );

  // The reader titles the book itself, so the core's book title block goes.
  const chapterContent = useMemo(() => {
    if (!loaded.ok) return [];
    const bookName = books.ok ? books.value.find((b) => b.book === book)?.name : undefined;
    return withoutBookTitle(chapterBlocks(loaded.value.blocks), chapter, bookName);
  }, [loaded, books, book, chapter]);

  // The study content of the verse under the pane, read (synchronously)
  // only while a pane is mounted. No Study Edition (NotInstalled or
  // Unavailable) still gives the verse's footnotes and cross refs; an
  // error (NotFound for a missing Bible, chapter or verse) is the Empty
  // state.
  const study = useMemo(() => {
    if (selected === undefined) return undefined;
    const read = load(() => reader().verseStudy({ pubKey, book, chapter, verse: selected }));
    return paneStudy(read.ok ? read.value : undefined, (span) => spanReference(bookList, span));
  }, [pubKey, book, chapter, selected, bookList]);
  // How much study each verse has, once per chapter; on any error, none.
  const markers = useMemo(() => {
    const read = load(() => reader().chapterStudyMarkers(pubKey, book, chapter));
    return markersByVerse(read.ok ? read.value : undefined);
  }, [pubKey, book, chapter]);

  // The chapter's highlights, as the core last returned them.
  const verses = useMemo(
    () =>
      chapterContent.flatMap((block) =>
        block.kind === 'paragraph' ? block.runs.filter(isVerseRun).map((run) => run.verse) : [],
      ),
    [chapterContent],
  );
  const highlights = useChapterHighlights(pubKey, book, chapter, verses);
  // The chapter's notes by verse (guide §7.2): margin markers where the
  // reader has a margin, else a count badge on the verse number.
  const chapterNotes = useChapterNotes(pubKey, book, chapter);
  const noteMode = noteMarkerMode(windowWidth, fontScale, LARGE_TEXT_SCALE);
  const notesOn = (verse: number) => chapterNotes.get(verse)?.length ?? 0;
  const badges = useMemo(
    () =>
      noteMode === 'badge'
        ? new Map([...chapterNotes].map(([verse, list]) => [verse, String(list.length)]))
        : undefined,
    [noteMode, chapterNotes],
  );
  const addNote = (verse: number) => addNoteAt({ pubKey, book, chapter, verse });
  const spokenHighlight = (verse: number) => {
    const color = highlights.byVerse.get(verse)?.color;
    return color === undefined ? undefined : highlightSpokenName(color);
  };
  // The verse whose actions are open (a long press on its text, or its
  // Highlight action), with the last change's error. It belongs to one
  // chapter, as the selection does.
  const [actions, setActions] = useState<{ chapterKey: string; verse: number; error?: string }>();
  const actionsHere = actions?.chapterKey === chapterKey ? actions : undefined;
  const openActions = (verse: number) => {
    setActions({ chapterKey, verse });
    void Haptics.selectionAsync().catch(() => {});
  };
  // Focus goes back to the paragraph the verse's number is in.
  const closeActions = () => {
    if (actionsHere === undefined) return;
    setActions(undefined);
    const target = blockRefs.current.get(numberBlock(chapterContent, actionsHere.verse));
    requestAnimationFrame(() => moveAccessibilityFocus(target));
  };
  // A change the core refuses keeps the sheet open with its message.
  const settle = (verse: number, error: string | undefined) => {
    if (error === undefined) {
      closeActions();
      return;
    }
    setActions({ chapterKey, verse, error });
    AccessibilityInfo.announceForAccessibility(error);
  };
  // Copy verse: the reference as the sheet titles it, then the verse's text
  // from the chapter's runs, confirmed as copyConfirmation says (Android 13
  // and later confirm it themselves).
  const copyVerse = (verse: number) => {
    closeActions();
    const copied = copiedVerse(verseReference(heading, verse), verseText(chapterContent, verse));
    Clipboard.setStringAsync(copied).then(
      () => {
        switch (copyConfirmation(Platform.OS, Platform.Version, material)) {
          case 'toast':
            ToastAndroid.show('Verse copied', ToastAndroid.SHORT);
            break;
          case 'announce':
            AccessibilityInfo.announceForAccessibility('Verse copied');
            break;
          case 'none':
            break;
        }
      },
      () => AccessibilityInfo.announceForAccessibility("Couldn't copy the verse"),
    );
  };

  // Where accessibility focus returns on close: the first block of the
  // paragraph holding the verse's number, by its index in the chapter's
  // blocks. It is the same element before and after the close, so it
  // survives it.
  const blockRefs = useRef(new Map<number, ComponentRef<typeof Text>>());
  // The chapter scroll and its viewport, for the open auto-scroll.
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const viewport = useRef({ offset: 0, insetTop: 0, insetBottom: 0, height: 0 });
  // Each paragraph block's top in the column and its laid-out lines, by its
  // index in the chapter's blocks: where a verse's first line is, for the
  // open auto-scroll.
  const blockTops = useRef(new Map<number, number>());
  const blockLines = useRef(new Map<number, TextLayoutEvent['nativeEvent']['lines']>());
  // Margin layouts: every drawn block's top and lines, continuations
  // included, by its key, for the note markers. Collected as blocks lay
  // out and handed to render once a frame.
  const markerBoxesRef = useRef(new Map<string, BlockBox>());
  const [markerBoxes, setMarkerBoxes] = useState<ReadonlyMap<string, BlockBox>>(new Map());
  const markerFrame = useRef<number | undefined>(undefined);
  const recordBox = (key: string, part: BlockBox) => {
    if (noteMode !== 'margin') return;
    markerBoxesRef.current.set(key, { ...markerBoxesRef.current.get(key), ...part });
    if (markerFrame.current !== undefined) return;
    markerFrame.current = requestAnimationFrame(() => {
      markerFrame.current = undefined;
      setMarkerBoxes(new Map(markerBoxesRef.current));
    });
  };
  useEffect(
    () => () => {
      if (markerFrame.current !== undefined) cancelAnimationFrame(markerFrame.current);
    },
    [],
  );
  // A verse the chapter opened at, until it has been scrolled to.
  const pendingVerse = useRef<number | undefined>(undefined);
  // The verse a search hit opened the chapter at, marked like the selected
  // verse (without study) until a verse number is pressed or the chapter
  // changes. State, so it outlives the cleared route param. Kept in step
  // with the chapter and the arrival param as they render (a new chapter
  // first, so an arrival in it isn't cleared), not in an effect.
  const [landed, setLanded] = useState<LandedVerse>(undefined);
  const [landedFrom, setLandedFrom] = useState({ chapterKey, arrivalVerse: undefined as number | undefined });
  if (landedFrom.chapterKey !== chapterKey || landedFrom.arrivalVerse !== arrivalVerse) {
    setLandedFrom({ chapterKey, arrivalVerse });
    let next = landedVerse(landed, { kind: 'chapter', chapterKey });
    if (arrivalVerse !== undefined) next = landedVerse(next, { kind: 'arrive', chapterKey, verse: arrivalVerse });
    setLanded(next);
  }
  const landedHere = landed?.chapterKey === chapterKey ? landed.verse : undefined;
  // The chapter scroll's gesture, which the pane's resize drag blocks.
  const [chapterScroll, setChapterScroll] = useState<NativeGesture>();

  // The params change in place on the Read route, so a new chapter keeps
  // this view and its ScrollView, offset included. Each chapter change
  // starts the new chapter at its top. A mount never scrolls: a remount
  // restoring the session (switching the dev Look) keeps its place.
  const shownChapter = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (shouldResetScroll(shownChapter.current, chapterKey)) {
      viewport.current.offset = 0;
      scrollRef.current?.scrollTo({ y: 0, animated: false });
    }
    shownChapter.current = chapterKey;
  }, [chapterKey]);

  // The blocks are keyed by chapter, so a new chapter's blocks measure
  // afresh: the last chapter's measurements (by block index) go before
  // theirs come in, and so does a verse still waiting to be scrolled to.
  useLayoutEffect(() => {
    blockTops.current.clear();
    blockLines.current.clear();
    markerBoxesRef.current.clear();
    pendingVerse.current = undefined;
  }, [chapterKey]);

  // The pane's tallest height: from its top to the bottom of the visible
  // area, above the tab bar (the scroll's bottom content inset where the
  // bar overlaps it) and any system bar the content pads for. Kept current
  // as the chapter scrolls and the pane lays out; the drag reads it on the
  // UI thread.
  const paneTop = useRef<number | undefined>(undefined);
  const paneMax = useSharedValue(MAX_HEIGHT);
  const updatePaneMax = () => {
    if (paneTop.current === undefined) return;
    const { offset, insetTop, insetBottom, height } = viewport.current;
    paneMax.set(
      paneMaxFraction({
        paneTop: columnTop + paneTop.current - offset - insetTop,
        visibleHeight: height - insetTop - insetBottom - contentInsets.bottom,
        windowHeight,
        min: MIN_HEIGHT,
        max: MAX_HEIGHT,
      }),
    );
  };

  // Closing is two steps: asking (close button, Back, a dismissing drag,
  // the verse tapped again) starts the pane's collapse, and the pane calls
  // finishClose when it is done, which unmounts it. A second ask while it
  // collapses does nothing; Back is no longer held, so it leaves as usual.
  const close = useCallback(() => {
    if (current === undefined || current.closing) return;
    setSelection({ ...current, closing: true });
  }, [current]);

  const finishClose = useCallback(() => {
    if (selected === undefined || !closing) return;
    forgetVerse(chapterKey);
    setSelection(undefined);
    // Focus goes back to the paragraph the verse's number is in.
    const target = blockRefs.current.get(numberBlock(chapterContent, selected));
    requestAnimationFrame(() => moveAccessibilityFocus(target));
  }, [chapterKey, selected, closing, chapterContent]);

  const openVerse = (verse: number, atNotes = false) => {
    rememberVerse(chapterKey, verse);
    setSelection({ chapterKey, verse, restored: false, closing: false, atNotes });
    void Haptics.selectionAsync().catch(() => {});
  };

  // A margin marker or Show notes: the verse's pane at My notes, no tab
  // selected, focus on its first note. An open pane on the verse switches
  // to My notes in place.
  const showNotes = (verse: number) => {
    setLanded((prev) => landedVerse(prev, { kind: 'press', verse }));
    if (current?.verse === verse) {
      setSelection({ ...current, closing: false, atNotes: true, notesAsk: (current.notesAsk ?? 0) + 1 });
    } else {
      openVerse(verse, true);
    }
  };

  const onPaneLayout = (e: LayoutChangeEvent) => {
    paneTop.current = e.nativeEvent.layout.y;
    updatePaneMax();
  };

  // The top of a verse's first line in the column: the line of its block
  // holding the start of its number. Unmeasured, none.
  const verseTop = (verse: number) => {
    const index = numberBlock(chapterContent, verse);
    const block = chapterContent[index];
    const top = blockTops.current.get(index);
    if (block?.kind !== 'paragraph' || top === undefined) return undefined;
    const lines = blockLines.current.get(index) ?? [];
    const offset = numberOffset(block.runs, verse, badges);
    const line = offset === undefined ? undefined : lines[lineAt(lines, offset)];
    return top + (line?.y ?? 0);
  };

  // Opening at a verse (a search hit): once its block and the viewport
  // have laid out, the verse's first line goes about 20% from the top,
  // without animation, and screen reader focus to its paragraph. Tried as
  // each of them lays out; it scrolls once per arrival, so later layouts
  // and the reader's own scrolling are left alone. A verse the chapter
  // doesn't number is dropped.
  const scrollToPending = () => {
    const verse = pendingVerse.current;
    if (verse === undefined) return;
    const index = numberBlock(chapterContent, verse);
    if (index < 0) {
      pendingVerse.current = undefined;
      return;
    }
    const { insetTop, insetBottom, height } = viewport.current;
    const top = verseTop(verse);
    if (height === 0 || !blockLines.current.has(index) || top === undefined) return;
    pendingVerse.current = undefined;
    const y = verseScrollOffset({
      verseTop: top,
      columnTop,
      insetTop,
      insetBottom,
      barBottom: contentInsets.bottom,
      height,
    });
    viewport.current.offset = y;
    scrollRef.current?.scrollTo({ y, animated: false });
    // The block is looked up in the frame, not before it: by then a render
    // may have unmounted the node it had (its ref is gone with it).
    requestAnimationFrame(() => moveAccessibilityFocus(blockRefs.current.get(index)));
  };

  // Each arrival with a verse (the route's verse param) asks once. The
  // param is then cleared, so a remount (switching the dev Look) keeps its
  // place and the same verse opened again from search is a new arrival.
  const arrive = useEffectEvent((verse: number) => {
    pendingVerse.current = verse;
    router.setParams({ verse: undefined });
    scrollToPending();
  });
  useEffect(() => {
    if (arrivalVerse !== undefined) arrive(arrivalVerse);
  }, [arrivalVerse]);

  // A bookmark jump (spec §3.3), by its arrival: each jump is a new one,
  // even to the verse already landed, and lands once, in its chapter (after
  // the chapter change it may have asked for, which clears a verse waiting
  // from before). A verse lands as a search hit does; a chapter at its top,
  // focus on its first paragraph.
  const [jump, setJump] = useState<{ chapterKey: string; verse: number | undefined; arrival: number }>();
  const arrivals = useRef(0);
  const landedJump = useRef<number | undefined>(undefined);
  const land = useEffectEvent((verse: number | undefined) => {
    if (verse !== undefined) {
      pendingVerse.current = verse;
      scrollToPending();
      return;
    }
    viewport.current.offset = 0;
    scrollRef.current?.scrollTo({ y: 0, animated: false });
    const first = chapterContent.findIndex((block) => block.kind === 'paragraph');
    requestAnimationFrame(() => moveAccessibilityFocus(blockRefs.current.get(first)));
  });
  useEffect(() => {
    if (jump === undefined || jump.chapterKey !== chapterKey || landedJump.current === jump.arrival) return;
    landedJump.current = jump.arrival;
    land(jump.verse);
  }, [jump, chapterKey]);

  // Spec §5, as the opening pane lays out: a verse in the bottom 35%
  // scrolls so its first line lands about 20% from the top, alongside the
  // open animation, and the reader scrolls (or the pane opens shorter) so
  // the whole pane, My notes included, fits above the tab bar. Only a tap
  // open asks; a restored pane never scrolls.
  const fitOpen = (wanted: number, lowest: number) => {
    const { offset, insetTop, insetBottom, height } = viewport.current;
    if (height === 0 || paneTop.current === undefined || selected === undefined) return wanted;
    const inView = (y: number) => columnTop + y - offset - insetTop;
    const pane = inView(paneTop.current);
    const verse = verseTop(selected);
    const fit = openFit({
      verseTop: verse === undefined ? pane : inView(verse),
      paneTop: pane,
      visibleHeight: height - insetTop - insetBottom - contentInsets.bottom,
      windowHeight,
      wanted,
      lowest,
    });
    if (fit.scrollBy > 0) {
      scrollRef.current?.scrollTo({ y: offset + fit.scrollBy, animated: !reducedMotion });
    }
    return fit.fraction;
  };

  // Tapping the verse again while its pane collapses reopens it where it
  // was (the pane springs back to its height); another verse opens its own
  // pane straight away, replacing the collapsing one.
  const toggle = (verse: number) => {
    setLanded((prev) => landedVerse(prev, { kind: 'press', verse }));
    if (current?.verse !== verse) openVerse(verse);
    else if (current.closing) {
      setSelection({ ...current, closing: false });
      void Haptics.selectionAsync().catch(() => {});
    } else close();
  };

  // Moving to another chapter closes the pane (spec §8) without returning focus.
  // The params change in place on the Read route; the whole location is set
  // since the route may have opened without params (the session's Bible).
  const goToChapter = (to: ChapterLocation) => {
    forgetVerse(chapterKey);
    setSelection(undefined);
    router.setParams({ pubKey, title, book: String(to.book), chapter: String(to.chapter) });
  };

  const pick = (to: ChapterLocation) => {
    setPicking(false);
    if (to.book !== book || to.chapter !== chapter) goToChapter(to);
  };

  // Saving the picker's target into a slot (an empty one, or a Replace):
  // its reference as the title, and the first line of its text as the core
  // gives it (a chapter's is its first verse's).
  const saveBookmark = (slot: number) => {
    const verse = pickerTarget.place.verse ?? verses.find((v) => v > 0);
    const text = loaded.ok ? (loaded.value.verses.find((v) => v.verse === verse)?.text ?? '') : '';
    const message = bookmarks.save(slot, pickerTarget.place, pickerTarget.reference, bookmarkSnippet(text));
    if (message === undefined) dispatchBar({ kind: 'saved', pubKey, slot });
    return message;
  };
  // Replace and Delete take effect at once, then offer Undo (Decision 4).
  const replaceBookmark = (row: FilledRow) => {
    const message = saveBookmark(row.slot);
    if (message === undefined) {
      offerUndo({ kind: 'replace', previous: heldOf(pubKey, row), reference: pickerTarget.reference });
    }
    return message;
  };
  const deleteBookmark = (row: FilledRow) => {
    const message = bookmarks.remove(row.slot);
    if (message === undefined) offerUndo({ kind: 'delete', previous: heldOf(pubKey, row) });
    return message;
  };

  // The landing wash (spec §3.3): a jumped-to verse's text, fading after
  // 2 s, static under Reduce Motion; the next scroll or tap clears it.
  const [wash, dispatchWash] = useReducer(landingWash, undefined);
  const [washFrom, setWashFrom] = useState(chapterKey);
  if (washFrom !== chapterKey) {
    setWashFrom(chapterKey);
    dispatchWash({ kind: 'chapter', chapterKey });
  }
  const washHere: Wash = wash?.chapterKey === chapterKey ? wash : undefined;

  // Jumping to a filled slot, in this publication: its chapter if it is
  // another (no animated travel), its verse marked as landed. The study
  // pane doesn't open.
  // A slot whose place this edition no longer has opens the nearest place
  // the core found (or the Bible's start), and a toast says where (spec §7).
  // The slot stays.
  const jumpTo = (row: FilledRow) => {
    bookmarkPicker.close();
    const place = placeOf(row.location);
    const opens: BiblePlace | undefined = place.opens === 'start' ? startPlace(bookList) : place.opens;
    const to = opens === undefined ? undefined : bookmarkJump({ pubKey, ...opens }, { book, chapter });
    if (to === undefined) return;
    arrivals.current += 1;
    const arrival = arrivals.current;
    const key = keyForChapter(pubKey, to);
    setJump({ chapterKey: key, verse: to.verse, arrival });
    const verse = to.verse;
    setLanded((prev) =>
      verse === undefined
        ? undefined
        : landedVerse(prev, { kind: 'arrive', chapterKey: key, verse, arrival, source: 'bookmark' }),
    );
    dispatchWash(
      verse === undefined
        ? { kind: 'tap' }
        : { kind: 'land', chapterKey: key, verse, arrival, reducedMotion: reducedMotion ?? false },
    );
    AccessibilityInfo.announceForAccessibilityWithOptions(jumpAnnouncement(row.number, row.title), { queue: true });
    if (place.missing) {
      const toHeading = chapterHeading(bookList?.find((b) => b.book === to.book), to.chapter);
      const message = notFoundMessage(verse === undefined ? toHeading : verseReference(toHeading, verse));
      dispatchBar({ kind: 'notice', message });
      AccessibilityInfo.announceForAccessibilityWithOptions(message, { queue: true });
    }
    if (!to.sameChapter) goToChapter(to);
  };

  // Ctrl+D (or Meta+D) in the focused reader opens the picker in save mode (spec §4).
  useBookmarkShortcut((key) => {
    if (shortcutOpensBookmarks(key, { focused, chapterRead: loaded.ok }) && !bookmarkPicker.open) openBookmarks();
  }, focused);

  // While the pane is open, back closes it first: the Android back button
  // here (also on the Read tab's root, where nothing is removed), and the
  // header back button, the iOS swipe and predictive back through
  // usePreventRemove (beforeRemove under the hood).
  // A pane that is already collapsing doesn't hold Back.
  useFocusEffect(
    useCallback(() => {
      if (open === undefined) return;
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        close();
        return true;
      });
      return () => subscription.remove();
    }, [open, close]),
  );
  usePreventRemove(open !== undefined, close);

  // Previous and Next cross into the neighbouring books, in the core's
  // order; there is no Previous at the very first chapter, no Next at the
  // very last.
  const previousLocation = previousChapter(bookList, { book, chapter });
  const nextLocation = nextChapter(bookList, { book, chapter });
  const previous =
    previousLocation === undefined ? null : (
      <TextButton title="Previous chapter" onPress={() => goToChapter(previousLocation)} />
    );

  // Per the reader frames: the material top app bar is titled with the
  // chapter heading; the iOS look has no navigation title, the chapter
  // heading in the content is the title. The title (material) and the
  // in-content heading (iOS) open the book and chapter picker.
  // Aa opens the reading appearance picker, and the bookmark button beside
  // it the publication's bookmarks. Pending, as their features don't exist
  // yet: menu, overflow.
  const screenOptions = (
    <Stack.Screen
      options={{
        title: material ? heading : '',
        headerLargeTitleEnabled: false,
        // Bookmarks need the chapter: where it couldn't be read, only Aa.
        headerRight: headerHidden ? undefined : () => (loaded.ok ? toolbar : aa),
        headerTitle:
          material && bookList !== undefined
            ? () => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={pickLabel}
                  onPress={() => setPicking(true)}
                  style={({ pressed }) => [styles.titleButton, { opacity: pressed ? 0.6 : 1 }]}
                >
                  <Text
                    numberOfLines={1}
                    style={[type.ui.title, styles.appBarTitle, { color: m3.onSurface }]}
                  >
                    {heading}
                  </Text>
                </Pressable>
              )
            : undefined,
      }}
    />
  );
  const picker = bookList !== undefined && (
    <BiblePicker
      visible={picking}
      books={bookList}
      at={{ book, chapter }}
      onPick={pick}
      onClose={() => setPicking(false)}
    />
  );

  if (!loaded.ok) {
    return (
      <ReadingAppearanceHost open={appearance.open} onClose={appearance.close} buttonRef={appearance.buttonRef}>
        {screenOptions}
        <ReadingColumn tabRoot>
          {headerHidden && <View style={styles.aaRow}>{aa}</View>}
          <UIText secondary>{loaded.message}</UIText>
          <View style={styles.navRow}>{previous}</View>
        </ReadingColumn>
        {picker}
      </ReadingAppearanceHost>
    );
  }

  const reference = selected === undefined ? heading : verseReference(heading, selected);

  // One block of a paragraph: its runs as a single Text, so the verses flow
  // on. Each verse number is a nested Text span that opens its study pane.
  // Spans are laid out and drawn with the paragraph's own text, so they
  // can't drift from it. (Inline Views in the Text did on Android: their
  // positions come from a separate layout of the paragraph, measured in
  // TextLayoutManager, while the TextView draws its own; where the two
  // break a line differently, every number after it lands a word off.)
  // A span can't be raised off the baseline or take padding or hitSlop, so
  // the number sits on the baseline, its selection background is padded
  // with narrow no-break spaces, and its touch target is the space before
  // it, the number with its pads and the no-break space after it, a line
  // tall. Only the number opens study; verse text never does. The
  // background is the only thing selection changes, so selecting never
  // reflows the paragraph.
  // Runs without a label (a verse's later parts, a superscription, a note)
  // have no number and no study.
  // Screen readers reach the verses through the block's actions, two per
  // numbered verse (its study, and Highlight, which opens the same sheet as
  // a long press), which TalkBack and VoiceOver list as the element's
  // actions.
  // RN Text has no first-line indent yet, so a continuation block (the rest
  // of a paragraph after the pane) has the same style as its first block;
  // once paragraphs carry an indent, the continuation leaves it off.
  const drawnBlocks: { key: string; runs: readonly Run[] }[] = [];
  const washAccent = material ? m3.primary : colors.accent;
  const renderBlock = (key: string, runs: readonly Run[], blockIndex?: number) => {
    const segments = blockSegments(runs);
    drawnBlocks.push({ key, runs });
    return (
      <Text
        key={key}
        ref={
          blockIndex === undefined
            ? undefined
            : (node) => {
                if (node) blockRefs.current.set(blockIndex, node);
                else blockRefs.current.delete(blockIndex);
              }
        }
        onLayout={(e) => {
          recordBox(key, { top: e.nativeEvent.layout.y });
          if (blockIndex === undefined) return;
          blockTops.current.set(blockIndex, e.nativeEvent.layout.y);
          scrollToPending();
        }}
        onTextLayout={(e) => {
          recordBox(key, { lines: e.nativeEvent.lines });
          if (blockIndex === undefined) return;
          blockLines.current.set(blockIndex, e.nativeEvent.lines);
          scrollToPending();
        }}
        style={[type.reading.scripture, { color: colors.text }]}
        accessibilityActions={numberedVerses(runs).flatMap((verse) => [
          {
            name: `${VERSE_ACTION}${verse}`,
            label: landedLabel(
              studyActionLabel(
                verse,
                markers.get(verse),
                verse === open,
                verseNotesSubject(verse, notesOn(verse), spokenHighlight(verse)),
              ),
              verse === landedHere,
              landed?.source,
            ),
          },
          ...(notesOn(verse) > 0 ? [{ name: `${NOTES_ACTION}${verse}`, label: showNotesLabel(verse) }] : []),
          {
            name: `${HIGHLIGHT_ACTION}${verse}`,
            label: highlightActionLabel(verse, spokenHighlight(verse)),
          },
          { name: `${COPY_ACTION}${verse}`, label: `Copy verse ${verse}` },
          { name: `${ADD_NOTE_ACTION}${verse}`, label: addNoteLabel(verse) },
        ])}
        onAccessibilityAction={(e) => {
          const { actionName } = e.nativeEvent;
          const numbered = (prefix: string) => {
            const verse = Number(actionName.slice(prefix.length));
            return numberedVerses(runs).includes(verse) ? verse : undefined;
          };
          if (actionName.startsWith(VERSE_ACTION)) {
            const verse = numbered(VERSE_ACTION);
            if (verse !== undefined) toggle(verse);
          } else if (actionName.startsWith(HIGHLIGHT_ACTION)) {
            const verse = numbered(HIGHLIGHT_ACTION);
            if (verse !== undefined) openActions(verse);
          } else if (actionName.startsWith(COPY_ACTION)) {
            const verse = numbered(COPY_ACTION);
            if (verse !== undefined) copyVerse(verse);
          } else if (actionName.startsWith(NOTES_ACTION)) {
            const verse = numbered(NOTES_ACTION);
            if (verse !== undefined) showNotes(verse);
          } else if (actionName.startsWith(ADD_NOTE_ACTION)) {
            const verse = numbered(ADD_NOTE_ACTION);
            if (verse !== undefined) addNote(verse);
          }
        }}
      >
        {segments.map((segment, index) => {
          switch (segment.kind) {
            // Between two parts of a highlighted verse, the space is filled too.
            case 'space': {
              const fill = segmentHighlight(segments, index, highlights.byVerse);
              if (washHere !== undefined && segmentVerse(segments, index) === washHere.verse) {
                return (
                  <WashText
                    key={`${index}-${washHere.arrival}`}
                    base={fill === undefined ? colors.surface : fills[fill]}
                    accent={washAccent}
                    fades={washHere.fades}
                    onFaded={() => dispatchWash({ kind: 'faded', arrival: washHere.arrival })}
                  >
                    {' '}
                  </WashText>
                );
              }
              return fill === undefined ? (
                <Fragment key={index}> </Fragment>
              ) : (
                <Text key={index} style={{ backgroundColor: fills[fill] }}>
                  {' '}
                </Text>
              );
            }
            // The design gives the closed state's study marker no style yet,
            // so the markers' counts are only in the verse's action label.
            // On compact layouts a verse with notes carries their count
            // after its number, inside the number's target.
            case 'number': {
              const span = numberSpan(segment.label, segment.separated, badges?.get(segment.verse));
              return (
                <Text key={index} onPress={() => toggle(segment.verse)}>
                  {span.separator}
                  <Text
                    style={[
                      type.verseNumber,
                      segment.verse === open || segment.verse === landedHere
                        ? { color: colors.surfaceRaised, backgroundColor: colors.accent }
                        : { color: colors.textSecondary },
                    ]}
                  >
                    {span.pad}
                    {span.label}
                    {span.pad}
                  </Text>
                  {span.badge !== '' && <NoteBadge count={span.badge} />}
                  {span.trailing}
                </Text>
              );
            }
            // Verse text: a long press opens the verse's actions; a tap does
            // nothing (and shows no press highlight on iOS). A highlight
            // fills the text only, never the number.
            case 'text': {
              const fill = segmentHighlight(segments, index, highlights.byVerse);
              if (washHere !== undefined && segment.verse === washHere.verse) {
                return (
                  <WashText
                    key={`${index}-${washHere.arrival}`}
                    base={fill === undefined ? colors.surface : fills[fill]}
                    accent={washAccent}
                    fades={washHere.fades}
                    onFaded={() => dispatchWash({ kind: 'faded', arrival: washHere.arrival })}
                    onLongPress={() => openActions(segment.verse)}
                  >
                    {segment.text}
                  </WashText>
                );
              }
              return (
                <Text
                  key={index}
                  suppressHighlighting
                  onLongPress={() => openActions(segment.verse)}
                  style={fill === undefined ? undefined : { backgroundColor: fills[fill] }}
                >
                  {segment.text}
                </Text>
              );
            }
            // A note isn't verse text: secondary, with no number or study.
            case 'note':
              return (
                <Text key={index} style={{ color: colors.textSecondary }}>
                  {segment.text}
                </Text>
              );
          }
        })}
      </Text>
    );
  };

  // The study pane goes after the selected verse's last part, so the whole
  // verse is above it, even when it runs on over lines of poetry.
  const split = paneSplit(chapterContent, selected);
  const paneNotes: PaneNote[] = (selected === undefined ? [] : (chapterNotes.get(selected) ?? [])).map((n) => ({
    id: n.id,
    title: noteTitle(n),
    date: shortDate(n.modified),
    snippet: snippetOf(n),
  }));

  // Each paragraph is one block; a heading is its own block. The paragraph
  // ending the selected verse splits after it: the runs up to it, the study
  // pane, then the rest as a continuation. Only the pane animates; text
  // below it moves with layout.
  const blocks = chapterContent.flatMap((block, index) => {
    if (block.kind === 'heading') {
      return [
        <ScriptureText key={`b${index}`} variant="sectionHeading">
          {block.text}
        </ScriptureText>,
      ];
    }
    if (split === undefined || index !== split.block || study === undefined) {
      return [renderBlock(`b${index}`, block.runs, index)];
    }
    const before = block.runs.slice(0, split.run + 1);
    const after = block.runs.slice(split.run + 1);
    return [
      renderBlock(`b${index}`, before, index),
      <StudyPane
        key={`pane-${selected}`}
        reference={reference}
        subtitle={title}
        pubKey={pubKey}
        study={study}
        guideInstalled={GUIDE_INSTALLED}
        restored={current?.restored ?? false}
        initialFraction={current?.fraction}
        closing={closing}
        chapterScroll={chapterScroll}
        maxFraction={paneMax}
        onClose={close}
        onClosed={finishClose}
        onResize={(fraction) => rememberPaneFraction(chapterKey, fraction)}
        onLayout={onPaneLayout}
        fitOpen={fitOpen}
        notes={paneNotes}
        atNotes={current?.atNotes ?? false}
        focusNotes={current?.atNotes ?? false}
        notesAsk={current?.notesAsk ?? 0}
        onNewNote={() => selected !== undefined && addNote(selected)}
        onOpenNote={openNote}
      />,
      after.length > 0 && renderBlock(`b${index}-continued`, after),
    ];
  });

  // Margin markers beside each noted verse's first line, one per line
  // (verses starting on the same line merge), from the drawn blocks' last
  // layout. They sit in the gutter, outside the text flow.
  const markerLines = new Map<string, LineBox & { top: number }>();
  const markerEntries =
    noteMode !== 'margin'
      ? []
      : drawnBlocks.flatMap(({ key, runs }) => {
          const box = markerBoxes.get(key);
          if (box?.top === undefined || box.lines === undefined || box.lines.length === 0) return [];
          const { top, lines } = box;
          return numberedVerses(runs).flatMap((verse) => {
            const count = notesOn(verse);
            const offset = count > 0 ? numberOffset(runs, verse) : undefined;
            if (offset === undefined) return [];
            const index = lineAt(lines, offset);
            const line = `${key}:${index}`;
            markerLines.set(line, { ...lines[index], top: top + lines[index].y });
            return [{ verse, line, count }];
          });
        });
  const noteMarkers = mergeMarkers(markerEntries).map((group) => {
    const line = markerLines.get(group.line)!;
    return (
      <NoteMarker
        key={group.line}
        heading={heading}
        verses={group.verses}
        count={group.count}
        lineTop={line.top}
        lineHeight={line.height}
        onPress={() => showNotes(group.verses[0])}
      />
    );
  });

  return (
    <ReadingAppearanceHost open={appearance.open} onClose={appearance.close} buttonRef={appearance.buttonRef}>
      {screenOptions}
      <ReadingColumn
        tabRoot
        leadingGutter={noteMode === 'margin' ? MARKER_GUTTER : 0}
        ref={scrollRef}
        scrollEventThrottle={16}
        onScrollGesture={(gesture) =>
          setChapterScroll((known) => (known?.handlerTag === gesture.handlerTag ? known : gesture))
        }
        {...fill}
        onScroll={(e) => {
          fill.onScroll(e);
          const { contentOffset, contentInset } = e.nativeEvent;
          viewport.current.offset = contentOffset.y;
          viewport.current.insetTop = contentInset.top;
          viewport.current.insetBottom = contentInset.bottom;
          updatePaneMax();
        }}
        onLayout={(e) => {
          viewport.current.height = e.nativeEvent.layout.height;
          updatePaneMax();
          scrollToPending();
        }}
        // The reader's own scroll or tap clears the landing wash; the jump's
        // own scroll is no drag.
        onTouchStart={washHere === undefined ? undefined : () => dispatchWash({ kind: 'tap' })}
        onScrollBeginDrag={washHere === undefined ? undefined : () => dispatchWash({ kind: 'scroll' })}
      >
        {/* With no native header, Aa and the bookmark button sit at the
            column's trailing edge, above the heading. */}
        {headerHidden && <View style={styles.aaRow}>{toolbar}</View>}
        {/* Per the reader frames: the iOS look titles the chapter in the
            content; the material look's title is the top app bar's only. */}
        {material ? null : bookList !== undefined ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={bookInfo === undefined ? pickLabel : `${bookInfo.longTitle}, ${pickLabel}`}
            onPress={() => setPicking(true)}
            style={({ pressed }) => [styles.headingButton, { opacity: pressed ? 0.6 : 1 }]}
          >
            {/* Per the iOS frame: the book's long title, as the core gives
                it, as a caption above the heading. */}
            {bookInfo !== undefined && (
              <UIText variant="caption" secondary>
                {bookInfo.longTitle}
              </UIText>
            )}
            <ScriptureText variant="chapterHeading">{heading}</ScriptureText>
          </Pressable>
        ) : (
          <ScriptureText variant="chapterHeading">{heading}</ScriptureText>
        )}
        {/* Keyed by chapter: a new chapter mounts fresh paragraphs and
            verse pills rather than reusing the last chapter's. Reused, the
            paragraph keeps its Fabric shadow family and the pills keep
            their tags, and Android drew the pills at stale positions over
            the new text. */}
        <Fragment key={chapterKey}>
          {blocks}
          {noteMarkers}
        </Fragment>
        <View style={styles.navRow}>
          {previous}
          <View style={styles.navSpacer} />
          {nextLocation !== undefined && (
            <TextButton title="Next chapter" onPress={() => goToChapter(nextLocation)} />
          )}
        </View>
      </ReadingColumn>
      {picker}
      <BookmarkPicker
        open={bookmarkPicker.open}
        onClose={bookmarkPicker.close}
        buttonRef={bookmarkPicker.buttonRef}
        title={title}
        target={pickerTarget}
        rows={slotRows}
        onSave={saveBookmark}
        onJump={jumpTo}
        places={slotPlaces}
        onReplace={replaceBookmark}
        onDelete={deleteBookmark}
        bar={bookmarkPicker.open ? barShown : undefined}
      />
      {/* Over the reader once the picker has closed; above the tab bar. */}
      {!bookmarkPicker.open && barShown !== undefined && (
        <UndoBar
          key={bar?.id}
          label={barShown.label}
          onUndo={barShown.onUndo}
          bottom={barBottom}
        />
      )}
      {actionsHere !== undefined && (
        <HighlightSheet
          visible
          reference={verseReference(heading, actionsHere.verse)}
          current={highlights.byVerse.get(actionsHere.verse)?.color}
          error={actionsHere.error}
          onChoose={(color) =>
            settle(actionsHere.verse, highlights.highlight(actionsHere.verse, color))
          }
          onRemove={() => settle(actionsHere.verse, highlights.remove(actionsHere.verse))}
          onCopy={() => copyVerse(actionsHere.verse)}
          onAddNote={() => {
            const verse = actionsHere.verse;
            closeActions();
            // iOS can't present the editor while the sheet's Modal is still
            // dismissing; it waits out the sheet's fade there.
            if (Platform.OS === 'ios') setTimeout(() => addNote(verse), 350);
            else addNote(verse);
          }}
          onBookmark={() => {
            const verse = actionsHere.verse;
            closeActions();
            // As Add note: iOS waits out the sheet's fade before the picker's Modal.
            if (Platform.OS === 'ios') setTimeout(() => openBookmarksFor(verse), 350);
            else openBookmarksFor(verse);
          }}
          onClose={closeActions}
        />
      )}
    </ReadingAppearanceHost>
  );
}

const styles = StyleSheet.create({
  // The iOS look's in-content heading as a button: at least the 44pt target.
  headingButton: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
  // The material top app bar's title as a button: the 48dp target; the
  // text is M3 title large (the material look's ui title: 22/28, regular).
  titleButton: { minHeight: 48, justifyContent: 'center' },
  appBarTitle: { letterSpacing: 0 },
  navRow: { flexDirection: 'row', alignItems: 'center' },
  toolbar: { flexDirection: 'row', alignItems: 'center' },
  // The column's gap would push the heading down; the button's own height is enough.
  aaRow: { alignItems: 'flex-end', marginBottom: -spacing.md },
  navSpacer: { flex: 1 },
});
