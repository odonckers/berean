import * as Haptics from 'expo-haptics';
import { router, Stack, useFocusEffect, usePreventRemove } from 'expo-router';
import {
  type ComponentRef,
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  BackHandler,
  type LayoutChangeEvent,
  Pressable,
  type ScrollView,
  StyleSheet,
  Text,
  type TextLayoutEvent,
  View,
  useWindowDimensions,
} from 'react-native';
import type { NativeGesture } from 'react-native-gesture-handler';
import { useReducedMotion, useSharedValue } from 'react-native-reanimated';

import { ScriptureText, UIText } from '@/components/text';
import { TextButton } from '@/components/text-button';
import { useContentInsets } from '@/design/tab-chrome';
import { useBerean } from '@/design/theme';
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
import {
  type Run,
  blockSegments,
  chapterBlocks,
  lineAt,
  numberBlock,
  numberOffset,
  numberSpan,
  numberedVerses,
  paneSplit,
  withoutBookTitle,
} from '@/reader/chapter-blocks';
import { MAX_HEIGHT, MIN_HEIGHT, openFit, paneMaxFraction } from '@/reader/pane-snap';
import { ReadingColumn, useColumnPaddingTop } from '@/reader/reading-column';
import {
  forgetVerse,
  rememberPaneFraction,
  rememberVerse,
  restoredPane,
} from '@/reader/session';
import { StudyPane, moveAccessibilityFocus } from '@/reader/study-pane';
import { markersByVerse, paneStudy, studyActionLabel } from '@/reader/verse-study';

// Study guide installation isn't modelled yet, so the guide is treated as
// not installed (the pane offers a Research tab when there is content).
const GUIDE_INSTALLED = false;

// Per-verse accessibility actions on a paragraph block, named by verse.
const VERSE_ACTION = 'verse-';

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
}: {
  pubKey: string;
  title: string;
  book: number;
  chapter: number;
}) {
  const { look, colors, m3, type } = useBerean();
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
  // only while a pane is mounted. Any error, NotFound included (no Study
  // Edition for the Bible's language, no catalog), is the Empty state.
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
  // Screen readers reach the verses through the block's actions, one per
  // numbered verse, which TalkBack and VoiceOver list as the element's
  // actions.
  // RN Text has no first-line indent yet, so a continuation block (the rest
  // of a paragraph after the pane) has the same style as its first block;
  // once paragraphs carry an indent, the continuation leaves it off.
  const renderBlock = (key: string, runs: readonly Run[], blockIndex?: number) => (
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
          : (e) => blockTops.current.set(blockIndex, e.nativeEvent.layout.y)
      }
      onTextLayout={
        blockIndex === undefined
          ? undefined
          : (e) => blockLines.current.set(blockIndex, e.nativeEvent.lines)
      }
      style={[type.reading.scripture, { color: colors.text }]}
      accessibilityActions={numberedVerses(runs).map((verse) => ({
        name: `${VERSE_ACTION}${verse}`,
        label: studyActionLabel(verse, markers.get(verse), verse === open),
      }))}
      onAccessibilityAction={(e) => {
        const { actionName } = e.nativeEvent;
        if (!actionName.startsWith(VERSE_ACTION)) return;
        const verse = Number(actionName.slice(VERSE_ACTION.length));
        if (numberedVerses(runs).includes(verse)) toggle(verse);
      }}
    >
      {blockSegments(runs).map((segment, index) => {
        switch (segment.kind) {
          case 'space':
            return <Fragment key={index}> </Fragment>;
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
                    segment.verse === open
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
          case 'text':
            return <Fragment key={index}>{segment.text}</Fragment>;
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
