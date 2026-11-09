import type { Document, TocEntry } from 'berean-ffi-rn';
import { router, Stack } from 'expo-router';
import { type ComponentRef, type ReactNode, useEffect, useEffectEvent, useMemo, useRef } from 'react';
import { FlatList, Pressable, type ScrollView, StyleSheet, type Text, View } from 'react-native';

import { ScriptureText, UIText } from '@/components/text';
import { useContentInsets } from '@/design/tab-chrome';
import { useBerean } from '@/design/theme';
import { hairline, spacing } from '@/design/tokens';
import { reader } from '@/ffi/core';
import { load } from '@/library/load';
import { barContentInset } from '@/reader/bookmark-undo';
import {
  type DocumentSlotPlace,
  documentJump,
  documentSaveTarget,
  documentSlotPlace,
  documentSnippet,
  notFoundMessage,
} from '@/reader/bookmarks';
import { DocBlocksView } from '@/reader/doc-blocks-view';
import { withoutTitle } from '@/reader/doc-title';
import { AaButton, ReadingAppearanceHost, useReadingAppearance } from '@/reader/reading-appearance';
import { ReadingColumn } from '@/reader/reading-column';
import { moveAccessibilityFocus } from '@/reader/study-pane';
import { type FilledRow, NoticeBar, locateNow, useBookmarkBar, useBookmarkHost } from '@/reader/use-bookmark-host';

/**
 * A bookmark jump that couldn't find its exact place arrives with this
 * param set; the screen it opened shows the not-found toast (bookmarks
 * spec §7) once, then clears it.
 */
export const NOT_FOUND_PARAM = 'notFound';

/**
 * Shows the not-found toast for `opened` once, when the screen arrived with
 * the param: the jump that opened it couldn't find the exact place.
 */
function useNotFoundArrival(notFound: boolean, opened: string, notice: (message: string) => void) {
  const arrive = useEffectEvent(() => {
    notice(notFoundMessage(opened));
    router.setParams({ [NOT_FOUND_PARAM]: undefined });
  });
  useEffect(() => {
    if (notFound) arrive();
  }, [notFound]);
}

export function TocView({ pubKey, title, notFound = false }: { pubKey: string; title: string; notFound?: boolean }) {
  const { colors, look } = useBerean();
  const insets = useContentInsets();
  const loaded = useMemo(() => load(() => reader().toc(pubKey)), [pubKey]);
  // A bookmark jump that couldn't locate its place opened the contents.
  const bar = useBookmarkBar(pubKey);
  useNotFoundArrival(notFound, title, bar.notice);
  const rowStyle = [
    styles.row,
    { minHeight: look === 'material' ? 48 : 44, borderColor: colors.separator },
  ];

  if (!loaded.ok) {
    return (
      <View style={styles.list}>
        <ReadingColumn>
          <UIText secondary>{loaded.message}</UIText>
        </ReadingColumn>
        <NoticeBar bar={bar} />
      </View>
    );
  }

  return (
    <View style={styles.list}>
      <FlatList
        style={[styles.list, { backgroundColor: colors.surface }]}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          paddingBottom: insets.bottom + barContentInset(bar.bar !== undefined, bar.barHeight, spacing.lg),
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
      <NoticeBar bar={bar} />
    </View>
  );
}

export function DocumentView({
  pubKey,
  title,
  docId,
  notFound = false,
}: {
  pubKey: string;
  /** The publication's title: the picker's header, and the title of the documents a jump opens. */
  title: string;
  docId: string;
  notFound?: boolean;
}) {
  // BigInt throws on a malformed id; load() turns that into a message too.
  const loaded = useMemo(
    () => load(() => reader().document(pubKey, BigInt(docId))),
    [pubKey, docId],
  );
  // Pushed documents keep the native header in both looks, so Aa is its action.
  const appearance = useReadingAppearance();
  const aa = <AaButton buttonRef={appearance.buttonRef} onPress={appearance.toggle} />;
  return (
    <ReadingAppearanceHost open={appearance.open} onClose={appearance.close} buttonRef={appearance.buttonRef}>
      {loaded.ok ? (
        <DocumentReader key={docId} pubKey={pubKey} title={title} document={loaded.value} notFound={notFound} aa={aa} />
      ) : (
        <>
          {/* Bookmarks need the document: where it couldn't be read, only Aa. */}
          <Stack.Screen options={{ headerRight: () => aa }} />
          <ReadingColumn>
            <UIText secondary>{loaded.message}</UIText>
          </ReadingColumn>
        </>
      )}
    </ReadingAppearanceHost>
  );
}

/**
 * A read document, with its bookmarks (bookmarks spec §3–§7): the button
 * beside Aa saves the document as a whole into one of the publication's 10
 * slots (each Watchtower issue is a publication of its own), and the
 * picker jumps to a slot's document, at its top with no marker.
 */
function DocumentReader({
  pubKey,
  title,
  document,
  notFound,
  aa,
}: {
  pubKey: string;
  title: string;
  document: Document;
  notFound: boolean;
  aa: ReactNode;
}) {
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const headingRef = useRef<ComponentRef<typeof Text>>(null);
  const { docId } = document;

  // A slot's jump (spec §3.3): this document again goes back to its top; another
  // opens in the Read stack, at its top; where the core couldn't locate it,
  // the publication's contents. Focus goes to the document's title.
  const jumpTo = (row: FilledRow, place: DocumentSlotPlace) => {
    const to = documentJump(place.opens, docId);
    if (to.kind === 'top') {
      scrollRef.current?.scrollTo({ y: 0, animated: false });
      requestAnimationFrame(() => moveAccessibilityFocus(headingRef.current));
      return { notice: place.missing ? notFoundMessage(document.title) : undefined };
    }
    // The screen it opens shows the not-found toast, with its own title.
    const missing = place.missing ? { [NOT_FOUND_PARAM]: '1' } : {};
    router.push({
      pathname: '/publication',
      params: to.kind === 'document' ? { pubKey, title, docId: String(to.docId), ...missing } : { pubKey, title, ...missing },
    });
    return { notice: undefined };
  };

  const host = useBookmarkHost({
    pubKey,
    title,
    target: documentSaveTarget(pubKey, docId, document.title),
    scope: String(docId),
    locate: (location) => documentSlotPlace(locateNow(location)),
    snippet: () => documentSnippet(document.blocks, document.paragraphs),
    onJump: jumpTo,
    ready: true,
  });
  useNotFoundArrival(notFound, document.title, host.bar.notice);

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => (
            <View style={styles.toolbar}>
              {aa}
              {host.button}
            </View>
          ),
        }}
      />
      <ReadingColumn ref={scrollRef} extraBottom={host.contentInset}>
        <ScriptureText ref={headingRef} variant="chapterHeading">
          {document.title}
        </ScriptureText>
        <DocBlocksView blocks={withoutTitle(document.blocks, document.title)} onNotice={host.bar.notice} />
      </ReadingColumn>
      {host.overlay}
    </>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1 },
  toolbar: { flexDirection: 'row', alignItems: 'center' },
  row: {
    justifyContent: 'center',
    paddingEnd: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: hairline,
  },
});
