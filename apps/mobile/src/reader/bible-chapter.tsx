import * as Haptics from 'expo-haptics';
import { router, Stack, useFocusEffect, usePreventRemove } from 'expo-router';
import { type ComponentRef, Fragment, useCallback, useMemo, useRef, useState } from 'react';
import {
  BackHandler,
  type LayoutChangeEvent,
  Pressable,
  type ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { NativeGesture } from 'react-native-gesture-handler';
import { useReducedMotion } from 'react-native-reanimated';

import { ScriptureText, UIText } from '@/components/text';
import { TextButton } from '@/components/text-button';
import { useBerean } from '@/design/theme';
import { useTopAppBarFill } from '@/design/use-top-app-bar-fill';
import { reader } from '@/ffi/core';
import { load } from '@/library/load';
import {
  type ChapterLocation,
  chapterHeading,
  nextChapter,
  previousChapter,
  verseReference,
} from '@/reader/bible-nav';
import { BiblePicker } from '@/reader/bible-picker';
import { type Run, paragraphsFromVerses } from '@/reader/chapter-blocks';
import { ReadingColumn, useColumnPaddingTop } from '@/reader/reading-column';
import {
  forgetVerse,
  rememberPaneFraction,
  rememberVerse,
  restoredPane,
} from '@/reader/session';
import { StudyPane, moveAccessibilityFocus, type PaneTab } from '@/reader/study-pane';

// The core does not yet report study content per verse (pending Echo's
// verseStudy / studyReferences / markers), so every verse is Empty.
const NO_STUDY_CONTENT: readonly PaneTab[] = [];

// Study guide installation isn't modelled yet, so the guide is treated as
// not installed (the pane offers a Research tab when there is content).
const GUIDE_INSTALLED = false;

// Spec §5: opening a verse in the bottom 35% of the viewport scrolls it to
// about 20% from the top so the pane fits.
const SCROLL_ZONE = 0.65;
const SCROLL_TARGET = 0.2;

// The verse number's pill is an inline View, so its touch target can reach
// past it with hitSlop: 48dp in the Material look, 44pt in the iOS look.
// The slop is fixed, sized for the smallest pill (one digit at the base text
// size, about 14 across with its padding); larger text and longer numbers
// only make the target bigger.
const PILL_MIN_SIZE = 14;
const VERSE_HIT_SLOP = {
  material: Math.ceil((48 - PILL_MIN_SIZE) / 2),
  ios: Math.ceil((44 - PILL_MIN_SIZE) / 2),
} as const;

// U+00A0 keeps a verse number on the same line as its verse's first word.
const NO_BREAK_SPACE = String.fromCharCode(0xa0);

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
  const chapterKey = `${pubKey}/${book}/${chapter}`;
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

  const paragraphs = useMemo(
    () => (loaded.ok ? paragraphsFromVerses(loaded.value.verses) : []),
    [loaded],
  );

  // Where accessibility focus returns on close. Each verse number's
  // Pressable, by verse: the selected verse ends the block before the pane,
  // which is the same element as the rejoined paragraph, so its Pressable
  // survives the close. Each paragraph's first block, by paragraph index,
  // for a pane opened from the paragraph's accessibility actions.
  const verseRefs = useRef(new Map<number, ComponentRef<typeof Pressable>>());
  const blockRefs = useRef(new Map<number, ComponentRef<typeof Text>>());
  const openedFromParagraph = useRef(false);
  // The chapter scroll and its viewport, for the open auto-scroll.
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const viewport = useRef({ offset: 0, insetTop: 0, height: 0 });
  // Set on a tap open, so the new pane's first layout runs the auto-scroll;
  // a restored pane never scrolls.
  const scrollOnPaneLayout = useRef(false);
  // The chapter scroll's gesture, which the pane's resize drag blocks.
  const [chapterScroll, setChapterScroll] = useState<NativeGesture>();

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
    // Focus goes back where the pane was opened from: the verse number's
    // button, or its paragraph when opened from the paragraph's actions
    // (where the screen reader can't reach the button, see renderBlock).
    const target = openedFromParagraph.current
      ? blockRefs.current.get(
          paragraphs.findIndex((p) => p.runs.some((run) => run.verse === selected)),
        )
      : verseRefs.current.get(selected);
    requestAnimationFrame(() => moveAccessibilityFocus(target));
  }, [chapterKey, selected, closing, paragraphs]);

  const openVerse = (verse: number, fromParagraph: boolean) => {
    openedFromParagraph.current = fromParagraph;
    rememberVerse(chapterKey, verse);
    setSelection({ chapterKey, verse, restored: false, closing: false });
    void Haptics.selectionAsync().catch(() => {});
    scrollOnPaneLayout.current = true;
  };

  // Spec §5 exception: a verse in the bottom 35% scrolls to about 20% from
  // the top, alongside the pane's open animation. This measures the split
  // point: the pane's top is the bottom of the block ending with the
  // selected verse. The split point lands at 20%, so the verse's last line
  // sits just above it.
  const onPaneLayout = (e: LayoutChangeEvent) => {
    if (!scrollOnPaneLayout.current) return;
    scrollOnPaneLayout.current = false;
    const { offset, insetTop, height } = viewport.current;
    if (height === 0) return;
    const splitTop = columnTop + e.nativeEvent.layout.y;
    const visible = height - insetTop;
    if (splitTop - offset - insetTop > visible * SCROLL_ZONE) {
      scrollRef.current?.scrollTo({
        y: splitTop - insetTop - visible * SCROLL_TARGET,
        animated: !reducedMotion,
      });
    }
  };

  // Tapping the verse again while its pane collapses reopens it where it
  // was (the pane springs back to its height); another verse opens its own
  // pane straight away, replacing the collapsing one.
  const toggle = (verse: number, fromParagraph: boolean) => {
    if (current?.verse !== verse) openVerse(verse, fromParagraph);
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
  // on. Each verse number is a pill: an inline View in the Text holding a
  // Pressable, a button that opens its study pane. Inline views sit with
  // their bottom edge on the line's baseline (Android TextLayoutManager,
  // iOS RCTTextLayoutManager), so the number reads raised, like a
  // superscript label. The pill keeps its padding whether selected or not,
  // so selecting never reflows the paragraph.
  // VoiceOver only sees a paragraph's text and its link spans, never views
  // inline in it, so the block also carries one action per verse, which
  // TalkBack and VoiceOver list as the element's actions.
  // RN Text has no first-line indent yet, so a continuation block (the rest
  // of a paragraph after the pane) has the same style as its first block;
  // once paragraphs carry an indent, the continuation leaves it off.
  const renderBlock = (key: string, runs: readonly Run[], paragraph?: number) => (
    <Text
      key={key}
      ref={
        paragraph === undefined
          ? undefined
          : (node) => {
              if (node) blockRefs.current.set(paragraph, node);
              else blockRefs.current.delete(paragraph);
            }
      }
      style={[type.reading.scripture, { color: colors.text }]}
      accessibilityActions={runs.map((run) => ({
        name: `${VERSE_ACTION}${run.verse}`,
        label: run.verse === open ? `Close study for verse ${run.verse}` : `Study verse ${run.verse}`,
      }))}
      onAccessibilityAction={(e) => {
        const { actionName } = e.nativeEvent;
        if (!actionName.startsWith(VERSE_ACTION)) return;
        const verse = Number(actionName.slice(VERSE_ACTION.length));
        if (runs.some((run) => run.verse === verse)) toggle(verse, true);
      }}
    >
      {runs.map((run, index) => {
        const isSelected = run.verse === open;
        return (
          <Fragment key={run.verse}>
            {index > 0 && ' '}
            {/* A note-count badge will sit beside the number later. */}
            <View>
              <Pressable
                ref={(node) => {
                  if (!node) return;
                  verseRefs.current.set(run.verse, node);
                  return () => {
                    if (verseRefs.current.get(run.verse) === node) {
                      verseRefs.current.delete(run.verse);
                    }
                  };
                }}
                onPress={() => toggle(run.verse, false)}
                hitSlop={VERSE_HIT_SLOP[look]}
                accessibilityRole="button"
                accessibilityLabel={`Verse ${run.verse}, ${isSelected ? 'study open' : 'opens study'}.`}
                accessibilityHint={
                  isSelected ? 'Double tap to close the study pane' : 'Double tap to open the study pane'
                }
                accessibilityState={{ selected: isSelected }}
                style={[
                  styles.versePill,
                  { backgroundColor: isSelected ? colors.accent : 'transparent' },
                ]}
              >
                <Text
                  style={[
                    type.verseNumber,
                    { color: isSelected ? colors.surfaceRaised : colors.textSecondary },
                  ]}
                >
                  {run.label === '' ? run.verse : run.label}
                </Text>
              </Pressable>
            </View>
            {NO_BREAK_SPACE}
            {run.text}
          </Fragment>
        );
      })}
    </Text>
  );

  // Each paragraph is one block. The selected verse's paragraph splits
  // after that verse: the runs up to it, the study pane, then the rest as a
  // continuation. Only the pane animates; text below it moves with layout.
  const blocks = paragraphs.flatMap((paragraph, index) => {
    const split = paragraph.runs.findIndex((run) => run.verse === selected);
    if (split === -1) return [renderBlock(`p${index}`, paragraph.runs, index)];
    const before = paragraph.runs.slice(0, split + 1);
    const after = paragraph.runs.slice(split + 1);
    return [
      renderBlock(`p${index}`, before, index),
      <StudyPane
        key={`pane-${selected}`}
        reference={reference}
        subtitle={title}
        pubKey={pubKey}
        available={NO_STUDY_CONTENT}
        guideInstalled={GUIDE_INSTALLED}
        restored={current?.restored ?? false}
        initialFraction={current?.fraction}
        closing={closing}
        chapterScroll={chapterScroll}
        onClose={close}
        onClosed={finishClose}
        onResize={(fraction) => rememberPaneFraction(chapterKey, fraction)}
        onLayout={onPaneLayout}
      />,
      after.length > 0 && renderBlock(`p${index}-continued`, after),
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
        }}
        onLayout={(e) => {
          viewport.current.height = e.nativeEvent.layout.height;
        }}
      >
        {!material && bookList !== undefined ? (
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
        {blocks}
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
  versePill: { borderRadius: 6, paddingVertical: 1, paddingHorizontal: 4 },
});
