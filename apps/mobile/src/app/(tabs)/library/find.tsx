import type { PublicationSummary } from 'berean-ffi-rn';
import { router, Stack } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, SectionList, StyleSheet, View } from 'react-native';
import type { SearchBarCommands } from 'react-native-screens';

import { UIText } from '@/components/text';
import { TextButton } from '@/components/text-button';
import { useContentInsets } from '@/design/tab-chrome';
import { useBerean } from '@/design/theme';
import { hairline, spacing } from '@/design/tokens';
import { library } from '@/ffi/core';
import { CatalogRow } from '@/library/catalog-row';
import { useCatalogUpdate } from '@/library/catalog-update';
import { onLibraryChanged, useInstalls } from '@/library/installs';
import { displayTitle, KIND_LABELS } from '@/library/labels';
import { languageNames, load, publicationDetail } from '@/library/load';
import { openPublication } from '@/library/open';
import { useSelectedLanguage } from '@/library/selected-language';
import { titleSections } from '@/library/title-matches';
import { useDebounced } from '@/library/use-debounced';

/** At most this many catalog matches; installed matches are all shown. */
const CATALOG_LIMIT = 50;

/**
 * Find in the Library: publications by title, issue title or symbol, those
 * on this device first, then the catalog's in the browsed language (JW
 * Library's Library search, 15.6).
 */
export default function FindScreen() {
  const { colors } = useBerean();
  const insets = useContentInsets();
  const { mepsLanguage } = useSelectedLanguage();
  const { catalogVersion } = useCatalogUpdate();
  const { jobs, installedVersion } = useInstalls();
  const [query, setQuery] = useState('');
  const text = useDebounced(query.trim(), 200);
  const [libraryVersion, setLibraryVersion] = useState(0);
  const searchBar = useRef<SearchBarCommands>(null);

  useEffect(() => onLibraryChanged(() => setLibraryVersion((v) => v + 1)), []);
  // The field is why the screen was opened: focus it (iOS ignores autoFocus).
  useEffect(() => {
    const timer = setTimeout(() => searchBar.current?.focus(), 350);
    return () => clearTimeout(timer);
  }, []);

  // catalogVersion: a newly installed catalog may name more languages.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const names = useMemo(() => languageNames(), [catalogVersion]);
  const languageName = names.get(mepsLanguage);

  // A synchronous FFI call on the JS thread, like the catalog list, after the
  // typing settles.
  const matches = useMemo(
    () => (text === '' ? undefined : load(() => library().findTitles(text, mepsLanguage, CATALOG_LIMIT))),
    // The versions: an install, removal or new catalog changes the results.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [text, mepsLanguage, catalogVersion, installedVersion, libraryVersion],
  );

  const screen = (
    <Stack.Screen
      options={{
        headerSearchBarOptions: {
          ref: searchBar,
          placeholder: 'Titles, issues or symbols',
          autoFocus: true,
          hideWhenScrolling: false,
          autoCapitalize: 'none',
          onChangeText: (e) => setQuery(e.nativeEvent.text),
        },
      }}
    />
  );

  const messageStyle = [
    styles.message,
    { paddingLeft: insets.left + spacing.lg, paddingRight: insets.right + spacing.lg },
  ];
  const languageButton = (
    <TextButton
      title={`Catalog language: ${languageName ?? 'English'}`}
      align="leading"
      accessibilityLabel={`Catalog language: ${languageName ?? 'English'}. Change language`}
      onPress={() => router.push('/library/languages')}
    />
  );

  if (matches === undefined || !matches.ok) {
    return (
      <View style={messageStyle}>
        {screen}
        {matches === undefined ? (
          <UIText secondary>Find a publication by its title, an issue such as “August 2026”, or its symbol.</UIText>
        ) : (
          <UIText style={{ color: colors.accent }}>{matches.message}</UIText>
        )}
        {languageButton}
      </View>
    );
  }

  const sections = titleSections(matches.value, languageName);
  return (
    <>
      {screen}
      <SectionList
        style={styles.list}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingLeft: insets.left, paddingRight: insets.right, paddingBottom: insets.bottom }}
        sections={sections}
        keyExtractor={(pub) => pub.pubKey}
        extraData={jobs}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={<View style={styles.inset}>{languageButton}</View>}
        ListEmptyComponent={
          <UIText style={styles.empty} accessibilityLiveRegion="polite">
            No publications match “{text}”.
          </UIText>
        }
        renderSectionHeader={({ section }) => (
          <UIText
            variant="caption"
            secondary
            accessibilityRole="header"
            style={[styles.sectionHeader, { borderColor: colors.separator }]}
          >
            {section.title.toUpperCase()}
          </UIText>
        )}
        renderItem={({ item, section }) =>
          section.key === 'installed' ? (
            <InstalledRow pub={item} names={names} />
          ) : (
            <CatalogRow pub={item} installed={false} job={jobs.get(item.pubKey)} detail={catalogDetail(item)} />
          )
        }
      />
    </>
  );
}

/** Kind and year, like the rows above it; the language is in the section heading. */
function catalogDetail(pub: PublicationSummary): string {
  const kind = KIND_LABELS[pub.kind];
  return pub.year > 0 ? `${kind} · ${pub.year}` : kind;
}

function InstalledRow({ pub, names }: { pub: PublicationSummary; names: ReadonlyMap<number, string> }) {
  const { colors } = useBerean();
  const detail = publicationDetail(pub, names);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${displayTitle(pub)}, ${detail}`}
      accessibilityHint="Opens the publication"
      onPress={() => openPublication(pub)}
      android_ripple={{ color: colors.separator }}
      style={({ pressed }) => [styles.row, { borderColor: colors.separator }, pressed && { opacity: 0.6 }]}
    >
      <UIText numberOfLines={2} style={styles.title}>
        {displayTitle(pub)}
      </UIText>
      <UIText secondary style={styles.detail}>
        {detail}
      </UIText>
    </Pressable>
  );
}


const styles = StyleSheet.create({
  list: { flex: 1 },
  message: { flex: 1, padding: spacing.lg, gap: spacing.md, alignItems: 'flex-start' },
  inset: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, alignItems: 'flex-start' },
  sectionHeader: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xs,
    borderBottomWidth: hairline,
    letterSpacing: 0.4,
  },
  empty: { padding: spacing.lg },
  row: {
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.xs,
    borderBottomWidth: hairline,
  },
  title: { fontWeight: '500' },
  detail: { fontSize: 15 },
});
