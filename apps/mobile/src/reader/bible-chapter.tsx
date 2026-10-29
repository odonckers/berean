import * as Haptics from 'expo-haptics';
import { router, useFocusEffect, usePreventRemove } from 'expo-router';
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
import { type Run, paragraphsFromVerses } from '@/reader/chapter-blocks';
import { ReadingColumn, useColumnPaddingTop } from '@/reader/reading-column';
import { forgetVerse, rememberVerse, restoredVerse } from '@/reader/session';
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
  const { look, colors, type } = useBerean();
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

  // The selection belongs to one chapter, so changing publication, book or
  // chapter (Previous/Next included) closes the pane without an effect.
  // A remount (switching the dev Look) restores the open verse from the
  // session, and the pane re-opens without animation or announcement.
  const chapterKey = `${pubKey}/${book}/${chapter}`;
  const [selection, setSelection] = useState<
    { chapterKey: string; verse: number; restored: boolean } | undefined
  >(() => {
    const verse = restoredVerse(chapterKey);
    return verse === undefined ? undefined : { chapterKey, verse, restored: true };
  });
  const selected = selection?.chapterKey === chapterKey ? selection.verse : undefined;

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

  const close = useCallback(() => {
    if (selected === undefined) return;
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
  }, [chapterKey, selected, paragraphs]);

  const open = (verse: number, fromParagraph: boolean) => {
    openedFromParagraph.current = fromParagraph;
    rememberVerse(chapterKey, verse);
    setSelection({ chapterKey, verse, restored: false });
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

  const toggle = (verse: number, fromParagraph: boolean) => {
    if (selected === verse) close();
    else open(verse, fromParagraph);
  };

  // Moving to another chapter closes the pane (spec §8) without returning focus.
  // The params change in place on the Read route; the whole location is set
  // since the route may have opened without params (the session's Bible).
  const goToChapter = (next: number) => {
    forgetVerse(chapterKey);
    setSelection(undefined);
    router.setParams({ pubKey, title, book: String(book), chapter: String(next) });
  };

  // While the pane is open, back closes it first: the Android back button
  // here (also on the Read tab's root, where nothing is removed), and the
  // header back button, the iOS swipe and predictive back through
  // usePreventRemove (beforeRemove under the hood).
  useFocusEffect(
    useCallback(() => {
      if (selected === undefined) return;
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        close();
        return true;
      });
      return () => subscription.remove();
    }, [selected, close]),
  );
  usePreventRemove(selected !== undefined, close);

  const previous =
    chapter > 1 ? (
      <TextButton
        title="Previous chapter"
        onPress={() => goToChapter(chapter - 1)}
      />
    ) : null;

  if (!loaded.ok) {
    return (
      <ReadingColumn tabRoot>
        <UIText secondary>{loaded.message}</UIText>
        <View style={styles.navRow}>{previous}</View>
      </ReadingColumn>
    );
  }

  const reference = `${title} ${chapter}:${selected ?? ''}`.trim();

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
        label: run.verse === selected ? `Close study for verse ${run.verse}` : `Study verse ${run.verse}`,
      }))}
      onAccessibilityAction={(e) => {
        const { actionName } = e.nativeEvent;
        if (!actionName.startsWith(VERSE_ACTION)) return;
        const verse = Number(actionName.slice(VERSE_ACTION.length));
        if (runs.some((run) => run.verse === verse)) toggle(verse, true);
      }}
    >
      {runs.map((run, index) => {
        const isSelected = run.verse === selected;
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
        restored={selection?.restored ?? false}
        chapterScroll={chapterScroll}
        onClose={close}
        onLayout={onPaneLayout}
      />,
      after.length > 0 && renderBlock(`p${index}-continued`, after),
    ];
  });

  return (
    <ReadingColumn
      tabRoot
      ref={scrollRef}
      scrollEventThrottle={16}
      onScrollGesture={(gesture) =>
        setChapterScroll((current) =>
          current?.handlerTag === gesture.handlerTag ? current : gesture,
        )
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
      <ScriptureText variant="chapterHeading">Chapter {chapter}</ScriptureText>
      {blocks}
      <View style={styles.navRow}>
        {previous}
        <View style={styles.navSpacer} />
        <TextButton title="Next chapter" onPress={() => goToChapter(chapter + 1)} />
      </View>
    </ReadingColumn>
  );
}

const styles = StyleSheet.create({
  navRow: { flexDirection: 'row', alignItems: 'center' },
  navSpacer: { flex: 1 },
  versePill: { borderRadius: 6, paddingVertical: 1, paddingHorizontal: 4 },
});
