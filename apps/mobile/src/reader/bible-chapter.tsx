import * as Haptics from 'expo-haptics';
import { router, useFocusEffect, usePreventRemove } from 'expo-router';
import { type ComponentRef, useCallback, useMemo, useRef, useState } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { LinearTransition, useReducedMotion } from 'react-native-reanimated';

import { ScriptureText, UIText } from '@/components/text';
import { TextButton } from '@/components/text-button';
import { useBerean } from '@/design/theme';
import { radii, spacing } from '@/design/tokens';
import { useTopAppBarFill } from '@/design/use-top-app-bar-fill';
import { reader } from '@/ffi/core';
import { load } from '@/library/load';
import { ReadingColumn, useColumnPaddingTop } from '@/reader/reading-column';
import { forgetVerse, rememberVerse, restoredVerse } from '@/reader/session';
import {
  OPEN_SPRING,
  StudyPane,
  moveAccessibilityFocus,
  type PaneTab,
} from '@/reader/study-pane';

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

// Verses after the study pane slide with the pane's open spring.
const verseShift = LinearTransition.springify(OPEN_SPRING.duration).dampingRatio(
  OPEN_SPRING.dampingRatio,
);

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
  const { colors, type } = useBerean();
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

  // Verse elements, for returning accessibility focus on close.
  const verseRefs = useRef(new Map<number, ComponentRef<typeof Text>>());
  // Layout for the open auto-scroll: each row's y within the verse list,
  // the list's y within the column, and the chapter ScrollView's viewport.
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const rowTops = useRef(new Map<number, number>());
  const listTop = useRef(0);
  const viewport = useRef({ offset: 0, insetTop: 0, height: 0 });

  const close = useCallback(() => {
    if (selected === undefined) return;
    forgetVerse(chapterKey);
    setSelection(undefined);
    // The verse number is inline in the verse's Text and not an
    // accessibility element of its own, so focus returns to the verse.
    const verseNode = verseRefs.current.get(selected);
    requestAnimationFrame(() => moveAccessibilityFocus(verseNode));
  }, [chapterKey, selected]);

  const open = (verse: number) => {
    rememberVerse(chapterKey, verse);
    setSelection({ chapterKey, verse, restored: false });
    void Haptics.selectionAsync().catch(() => {});

    // Spec §5 exception: a verse in the bottom 35% scrolls to about 20%
    // from the top, alongside the pane's open animation.
    const rowTop = rowTops.current.get(verse);
    const { offset, insetTop, height } = viewport.current;
    if (rowTop === undefined || height === 0) return;
    const verseTop = columnTop + listTop.current + rowTop;
    const visible = height - insetTop;
    if (verseTop - offset - insetTop > visible * SCROLL_ZONE) {
      scrollRef.current?.scrollTo({
        y: verseTop - insetTop - visible * SCROLL_TARGET,
        animated: !reducedMotion,
      });
    }
  };

  const toggle = (verse: number) => {
    if (selected === verse) close();
    else open(verse);
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

  const layout = reducedMotion ? undefined : verseShift;
  const reference = `${title} ${chapter}:${selected ?? ''}`.trim();

  return (
    <ReadingColumn
      tabRoot
      ref={scrollRef}
      scrollEventThrottle={16}
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
      <View
        onLayout={(e) => {
          listTop.current = e.nativeEvent.layout.y;
        }}
      >
        {loaded.value.verses.map((verse) => {
          const isSelected = verse.verse === selected;
          // Each verse is its own animated row so only the ones after the
          // pane slide; verses above it never move.
          return [
            <Animated.View
              key={verse.verse}
              layout={layout}
              onLayout={(e) => {
                rowTops.current.set(verse.verse, e.nativeEvent.layout.y);
              }}
            >
              {/* A plain Text (styled as ScriptureText) so it can take a ref. */}
              <Text
                ref={(node) => {
                  if (node) verseRefs.current.set(verse.verse, node);
                  else verseRefs.current.delete(verse.verse);
                }}
                style={[type.reading.scripture, { color: colors.text }]}
                accessibilityLabel={`Verse ${verse.verse}, ${
                  isSelected ? 'study open' : 'opens study'
                }. ${verse.text}`}
                accessibilityHint={
                  isSelected
                    ? 'Double tap to close the study pane'
                    : 'Double tap to open the study pane'
                }
                accessibilityState={{ selected: isSelected }}
                accessibilityActions={[{ name: 'activate', label: `Study verse ${verse.verse}` }]}
                onAccessibilityAction={(e) => {
                  if (e.nativeEvent.actionName === 'activate') toggle(verse.verse);
                }}
              >
                {/* An inline view so the selected number can be a pill. Its
                    padding is the same selected or not, so selecting never
                    reflows the verse; hitSlop pads the target without layout.
                    A note-count badge will sit beside the number later. */}
                <Pressable
                  accessible={false}
                  importantForAccessibility="no-hide-descendants"
                  onPress={() => toggle(verse.verse)}
                  hitSlop={spacing.sm}
                  style={[styles.verseNumber, isSelected && { backgroundColor: colors.accent }]}
                >
                  <Text
                    style={[
                      type.verseNumber,
                      { color: isSelected ? colors.surfaceRaised : colors.textSecondary },
                    ]}
                  >
                    {verse.label === '' ? verse.verse : verse.label}
                  </Text>
                </Pressable>{' '}
                {verse.text}
              </Text>
            </Animated.View>,
            isSelected && (
              <StudyPane
                key="pane"
                reference={reference}
                subtitle={title}
                pubKey={pubKey}
                available={NO_STUDY_CONTENT}
                guideInstalled={GUIDE_INSTALLED}
                restored={selection?.restored ?? false}
                onClose={close}
              />
            ),
          ];
        })}
      </View>
      <Animated.View layout={layout} style={styles.navRow}>
        {previous}
        <View style={styles.navSpacer} />
        <TextButton title="Next chapter" onPress={() => goToChapter(chapter + 1)} />
      </Animated.View>
    </ReadingColumn>
  );
}

const styles = StyleSheet.create({
  // The selected number's accent pill: radii.chip, 1 x 4 padding.
  verseNumber: { borderRadius: radii.chip, paddingVertical: 1, paddingHorizontal: spacing.xs },
  navRow: { flexDirection: 'row', alignItems: 'center' },
  navSpacer: { flex: 1 },
});
