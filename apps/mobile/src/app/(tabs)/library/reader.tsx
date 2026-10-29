import type { TocEntry } from 'berean-ffi-rn';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { type ReactNode, useMemo } from 'react';
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import { ScriptureText, UIText } from '@/components/text';
import { TextButton } from '@/components/text-button';
import { useContentInsets } from '@/design/tab-chrome';
import { useBerean } from '@/design/theme';
import { hairline, readingMeasure, spacing } from '@/design/tokens';
import { reader } from '@/ffi/core';
import { load } from '@/library/load';

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

function BibleChapterView({
  pubKey,
  book,
  chapter,
}: {
  pubKey: string;
  book: number;
  chapter: number;
}) {
  const { colors, type } = useBerean();
  // A synchronous FFI call on the JS thread; agreed for now.
  const loaded = useMemo(
    () => load(() => reader().bibleChapter(pubKey, book, chapter)),
    [pubKey, book, chapter],
  );

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

  return (
    <ReadingColumn>
      <ScriptureText variant="chapterHeading">Chapter {chapter}</ScriptureText>
      <View>
        {loaded.value.verses.map((verse) => (
          <ScriptureText key={verse.verse} accessibilityLabel={`Verse ${verse.verse}. ${verse.text}`}>
            {verse.label !== '' && (
              <Text style={[type.verseNumber, { color: colors.textSecondary }]}>{verse.label} </Text>
            )}
            {verse.text}
          </ScriptureText>
        ))}
      </View>
      <View style={styles.navRow}>
        {previous}
        <View style={styles.navSpacer} />
        <TextButton
          title="Next chapter"
          onPress={() => router.setParams({ chapter: String(chapter + 1) })}
        />
      </View>
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
