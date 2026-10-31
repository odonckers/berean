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
import { useContentInsets } from '@/design/tab-chrome';
import { useBerean } from '@/design/theme';
import { highlightSpokenNames } from '@/design/tokens';
import { useTopAppBarFill } from '@/design/use-top-app-bar-fill';
import { reader } from '@/ffi/core';
import { load } from '@/library/load';
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
import { copiedVerse, copyConfirmation, verseText } from '@/reader/copy-verse';
import { HighlightSheet } from '@/reader/highlight-sheet';
import { highlightActionLabel, segmentHighlight, verseSubject } from '@/reader/highlights';
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
  MAX_HEIGHT,
  MIN_HEIGHT,
  openFit,
  paneMaxFraction,
  verseScrollOffset,
} from '@/reader/pane-snap';
import { ReadingColumn, useColumnPaddingTop } from '@/reader/reading-column';
import {
  forgetVerse,
  rememberPaneFraction,
  rememberVerse,
  restoredPane,
} from '@/reader/session';
import { StudyPane, moveAccessibilityFocus } from '@/reader/study-pane';
import { useChapterHighlights } from '@/reader/use-chapter-highlights';
import { markersByVerse, paneStudy, studyActionLabel } from '@/reader/verse-study';

// Study guide installation isn't modelled yet, so the guide is treated as
// not installed (the pane offers a Research tab when there is content).
const GUIDE_INSTALLED = false;

// Per-verse accessibility actions on a paragraph block, named by verse:
// study, highlight, and copy.
const VERSE_ACTION = 'verse-';
const HIGHLIGHT_ACTION = 'highlight-';
const COPY_ACTION = 'copy-';

type Selection = {
  chapterKey: string;
  verse: number;
  restored: boolean;
  /** A restored pane's height, as a window fraction. */
  fraction?: number;
  /** The pane is collapsing; it unmounts when its animation finishes. */
  closing: boolean;
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
  const { height: windowHeight } = useWindowDimensions();
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
  const spokenHighlight = (verse: number) => {
    const color = highlights.byVerse.get(verse)?.color;
    return color === undefined ? undefined : highlightSpokenNames[color];
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

  const openVerse = (verse: number) => {
    rememberVerse(chapterKey, verse);
    setSelection({ chapterKey, verse, restored: false, closing: false });
    void Haptics.selectionAsync().catch(() => {});
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
    const offset = numberOffset(block.runs, verse);
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
  // Pending, as their features don't exist yet: Aa, bookmark, menu, overflow.
  const screenOptions = (
    <Stack.Screen
      options={{
        title: material ? heading : '',
        headerLargeTitleEnabled: false,
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
      <>
        {screenOptions}
        <ReadingColumn tabRoot>
          <UIText secondary>{loaded.message}</UIText>
          <View style={styles.navRow}>{previous}</View>
        </ReadingColumn>
        {picker}
      </>
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
  const renderBlock = (key: string, runs: readonly Run[], blockIndex?: number) => {
    const segments = blockSegments(runs);
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
        onLayout={
          blockIndex === undefined
            ? undefined
            : (e) => {
                blockTops.current.set(blockIndex, e.nativeEvent.layout.y);
                scrollToPending();
              }
        }
        onTextLayout={
          blockIndex === undefined
            ? undefined
            : (e) => {
                blockLines.current.set(blockIndex, e.nativeEvent.lines);
                scrollToPending();
              }
        }
        style={[type.reading.scripture, { color: colors.text }]}
        accessibilityActions={numberedVerses(runs).flatMap((verse) => [
          {
            name: `${VERSE_ACTION}${verse}`,
            label: landedLabel(
              studyActionLabel(
                verse,
                markers.get(verse),
                verse === open,
                verseSubject(verse, spokenHighlight(verse)),
              ),
              verse === landedHere,
            ),
          },
          {
            name: `${HIGHLIGHT_ACTION}${verse}`,
            label: highlightActionLabel(verse, spokenHighlight(verse)),
          },
          { name: `${COPY_ACTION}${verse}`, label: `Copy verse ${verse}` },
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
          }
        }}
      >
        {segments.map((segment, index) => {
          switch (segment.kind) {
            // Between two parts of a highlighted verse, the space is filled too.
            case 'space': {
              const fill = segmentHighlight(segments, index, highlights.byVerse);
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
            case 'number': {
              const span = numberSpan(segment.label, segment.separated);
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
                  {span.trailing}
                </Text>
              );
            }
            // Verse text: a long press opens the verse's actions; a tap does
            // nothing (and shows no press highlight on iOS). A highlight
            // fills the text only, never the number.
            case 'text': {
              const fill = segmentHighlight(segments, index, highlights.byVerse);
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
      />,
      after.length > 0 && renderBlock(`b${index}-continued`, after),
    ];
  });

  return (
    <>
      {screenOptions}
      <ReadingColumn
        tabRoot
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
      >
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
        <Fragment key={chapterKey}>{blocks}</Fragment>
        <View style={styles.navRow}>
          {previous}
          <View style={styles.navSpacer} />
          {nextLocation !== undefined && (
            <TextButton title="Next chapter" onPress={() => goToChapter(nextLocation)} />
          )}
        </View>
      </ReadingColumn>
      {picker}
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
          onClose={closeActions}
        />
      )}
    </>
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
  navSpacer: { flex: 1 },
});
