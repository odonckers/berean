import type { TocEntry } from 'berean-ffi-rn';
import { router } from 'expo-router';
import { useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { ScriptureText, UIText } from '@/components/text';
import { useContentInsets } from '@/design/tab-chrome';
import { useBerean } from '@/design/theme';
import { hairline, spacing } from '@/design/tokens';
import { reader } from '@/ffi/core';
import { load } from '@/library/load';
import { ReadingColumn } from '@/reader/reading-column';

export function TocView({ pubKey, title }: { pubKey: string; title: string }) {
  const { colors, look } = useBerean();
  const insets = useContentInsets();
  const loaded = useMemo(() => load(() => reader().toc(pubKey)), [pubKey]);
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
            // Pushed within the Read stack, so back returns to this TOC.
            onPress={() =>
              router.push({
                pathname: '/publication',
                params: { pubKey, title, docId: String(docId) },
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

export function DocumentView({ pubKey, docId }: { pubKey: string; docId: string }) {
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
  list: { flex: 1 },
  row: {
    justifyContent: 'center',
    paddingEnd: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: hairline,
  },
});
