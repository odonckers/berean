import type { TocEntry } from 'berean-ffi-rn';
import * as Haptics from 'expo-haptics';
import {
  router,
  Stack,
  useFocusEffect,
  useLocalSearchParams,
  usePreventRemove,
} from 'expo-router';
import { type ReactNode, useCallback, useMemo, useState } from 'react';
import {
  BackHandler,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, { LinearTransition, useReducedMotion } from 'react-native-reanimated';

import { ScriptureText, UIText } from '@/components/text';
import { TextButton } from '@/components/text-button';
import { useContentInsets } from '@/design/tab-chrome';
import { useBerean } from '@/design/theme';
import { hairline, readingMeasure, spacing } from '@/design/tokens';
import { reader } from '@/ffi/core';
import { load } from '@/library/load';
import { OPEN_SPRING, StudyPane } from '@/reader/study-pane';

type ReaderParams = {
  pubKey: string;
  kind: string;
  title?: string;
  book?: string;
  chapter?: string;
  docId?: string;
};

export default function ReaderScreen() {
  const params = useLocalSearchParams<ReaderParams>();
  return (
    <>
      <Stack.Screen options={{ title: params.title ?? '' }} />
      {params.kind === 'Bible' ? (
        <BibleChapterView
          pubKey={params.pubKey}
          title={params.title ?? ''}
          book={Number(params.book ?? 1)}
          chapter={Number(params.chapter ?? 1)}
        />
      ) : params.docId === undefined ? (
        <TocView params={params} />
      ) : (
        <DocumentView pubKey={params.pubKey} docId={params.docId} />
      )}
    </>
  );
}

/** A scrolling surface with the reading column: capped at the measure, centered. */
function ReadingColumn({ children }: { children: ReactNode }) {
  const { colors } = useBerean();
  const { fontScale } = useWindowDimensions();
  const insets = useContentInsets();
  const measure = readingMeasure * fontScale;
  return (
    <ScrollView
      style={{ backgroundColor: colors.surface }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{
        paddingTop: spacing.lg,
        paddingBottom: insets.bottom + spacing.lg,
        paddingLeft: insets.left + spacing.lg,
        paddingRight: insets.right + spacing.lg,
      }}
    >
      <View style={[styles.column, { maxWidth: measure }]}>{children}</View>
    </ScrollView>
  );
}

// Verses after the study pane slide with the pane's open spring.
const verseShift = LinearTransition.springify(OPEN_SPRING.duration).dampingRatio(
  OPEN_SPRING.dampingRatio,
);

function BibleChapterView({
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
  const { look, colors, m3, type, radii } = useBerean();
  const reducedMotion = useReducedMotion();
  // A synchronous FFI call on the JS thread; agreed for now.
  const loaded = useMemo(
    () => load(() => reader().bibleChapter(pubKey, book, chapter)),
    [pubKey, book, chapter],
  );

  // The selection belongs to one chapter, so changing publication, book or
  // chapter (Previous/Next included) closes the pane without an effect.
  const chapterKey = `${pubKey}/${book}/${chapter}`;
  const [selection, setSelection] = useState<{ chapterKey: string; verse: number }>();
  const selected = selection?.chapterKey === chapterKey ? selection.verse : undefined;

  const close = useCallback(() => setSelection(undefined), []);
  const toggle = (verse: number) => {
    if (selected === verse) {
      close();
      return;
    }
    setSelection({ chapterKey, verse });
    void Haptics.selectionAsync().catch(() => {});
  };

  // While the pane is open, back closes it first: the Android back button
  // here, and the header back button, the iOS swipe and predictive back
  // through usePreventRemove (beforeRemove under the hood).
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
        onPress={() => router.setParams({ chapter: String(chapter - 1) })}
      />
    ) : null;

  if (!loaded.ok) {
    return (
      <ReadingColumn>
        <UIText secondary>{loaded.message}</UIText>
        <View style={styles.navRow}>{previous}</View>
      </ReadingColumn>
    );
  }

  const layout = reducedMotion ? undefined : verseShift;
  const selectedFill = look === 'material' ? m3.secondaryContainer : colors.separator;
  const reference = `${title} ${chapter}:${selected ?? ''}`.trim();

  return (
    <ReadingColumn>
      <ScriptureText variant="chapterHeading">Chapter {chapter}</ScriptureText>
      <View>
        {loaded.value.verses.map((verse) => {
          const isSelected = verse.verse === selected;
          // Each verse is its own animated row so only the ones after the
          // pane slide; verses above it never move.
          return [
            <Animated.View
              key={verse.verse}
              layout={layout}
              style={[
                styles.verse,
                isSelected && { backgroundColor: selectedFill, borderRadius: radii.chip },
              ]}
            >
              <ScriptureText
                accessibilityLabel={`Verse ${verse.verse}. ${verse.text}`}
                accessibilityHint="Double tap the verse number to study"
                accessibilityState={{ selected: isSelected }}
                accessibilityActions={[{ name: 'activate', label: `Study verse ${verse.verse}` }]}
                onAccessibilityAction={(e) => {
                  if (e.nativeEvent.actionName === 'activate') toggle(verse.verse);
                }}
              >
                <Text
                  accessibilityRole="button"
                  accessibilityLabel={`Study verse ${verse.verse}`}
                  onPress={() => toggle(verse.verse)}
                  suppressHighlighting
                  style={[type.verseNumber, { color: colors.textSecondary }]}
                >
                  {verse.label === '' ? verse.verse : verse.label}{' '}
                </Text>
                {verse.text}
              </ScriptureText>
            </Animated.View>,
            isSelected && <StudyPane key="pane" reference={reference} onClose={close} />,
          ];
        })}
      </View>
      <Animated.View layout={layout} style={styles.navRow}>
        {previous}
        <View style={styles.navSpacer} />
        <TextButton
          title="Next chapter"
          onPress={() => router.setParams({ chapter: String(chapter + 1) })}
        />
      </Animated.View>
    </ReadingColumn>
  );
}

function TocView({ params }: { params: ReaderParams }) {
  const { colors, look } = useBerean();
  const insets = useContentInsets();
  const loaded = useMemo(() => load(() => reader().toc(params.pubKey)), [params.pubKey]);
  const rowStyle = [
    styles.row,
    { minHeight: look === 'material' ? 48 : 44, borderColor: colors.separator },
  ];

  if (!loaded.ok) {
    return (
      <ReadingColumn>
        <UIText secondary>{loaded.message}</UIText>
      </ReadingColumn>
    );
  }

  return (
    <FlatList
      style={[styles.list, { backgroundColor: colors.surface }]}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{
        paddingBottom: insets.bottom,
        paddingLeft: insets.left,
        paddingRight: insets.right,
      }}
      data={loaded.value}
      keyExtractor={(entry, index) => `${index}:${entry.docId ?? ''}`}
      renderItem={({ item }: { item: TocEntry }) => {
        const indent = { paddingStart: spacing.lg + item.depth * spacing.lg };
        const docId = item.docId;
        if (docId === undefined) {
          return (
            <View style={[rowStyle, indent]}>
              <UIText variant="label" secondary accessibilityRole="header">
                {item.title}
              </UIText>
            </View>
          );
        }
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={item.title}
            onPress={() =>
              router.push({
                pathname: '/library/reader',
                params: {
                  pubKey: params.pubKey,
                  kind: params.kind,
                  title: params.title ?? '',
                  docId: String(docId),
                },
              })
            }
            style={({ pressed }) => [rowStyle, indent, pressed && { opacity: 0.6 }]}
          >
            <UIText numberOfLines={2}>{item.title}</UIText>
          </Pressable>
        );
      }}
    />
  );
}

function DocumentView({ pubKey, docId }: { pubKey: string; docId: string }) {
  // BigInt throws on a malformed id; load() turns that into a message too.
  const loaded = useMemo(
    () => load(() => reader().document(pubKey, BigInt(docId))),
    [pubKey, docId],
  );
  return (
    <ReadingColumn>
      {loaded.ok ? (
        <>
          <ScriptureText variant="chapterHeading">{loaded.value.title}</ScriptureText>
          <UIText secondary>
            Document text rendering needs structured blocks from the core (pending).
          </UIText>
        </>
      ) : (
        <UIText secondary>{loaded.message}</UIText>
      )}
    </ReadingColumn>
  );
}

const styles = StyleSheet.create({
  column: { width: '100%', alignSelf: 'center', gap: spacing.md },
  // The fill of a selected verse extends a little past the text.
  verse: { marginHorizontal: -spacing.xs, paddingHorizontal: spacing.xs },
  navRow: { flexDirection: 'row', alignItems: 'center' },
  navSpacer: { flex: 1 },
  list: { flex: 1 },
  row: {
    justifyContent: 'center',
    paddingEnd: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: hairline,
  },
});
