import type { Language, PubKind } from 'berean-ffi-rn';
import { router, Stack } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, ScrollView, StyleSheet, View } from 'react-native';

import { FilterChip } from '@/components/filter-chip';
import { UIText } from '@/components/text';
import { TextButton } from '@/components/text-button';
import { useContentInsets } from '@/design/tab-chrome';
import { useBerean } from '@/design/theme';
import { spacing } from '@/design/tokens';
import { catalog, library } from '@/ffi/core';
import { CatalogRow } from '@/library/catalog-row';
import { checkForUpdate, getCatalogUpdate, useCatalogUpdate } from '@/library/catalog-update';
import { CatalogUpdatePanel } from '@/library/catalog-update-panel';
import { DevCatalogIngest } from '@/library/dev-catalog-ingest';
import { onLibraryChanged, useInstalls } from '@/library/installs';
import { KIND_FILTERS } from '@/library/labels';
import { load, type Loaded } from '@/library/load';
import { useSelectedLanguage } from '@/library/selected-language';
import { useDebounced } from '@/library/use-debounced';

type CatalogMeta = { languages: Language[]; empty: boolean };

/** The catalog's languages, and whether it was never ingested. */
function loadMeta(): Loaded<CatalogMeta> {
  return load(() => {
    const languages = catalog().languages();
    const all = { mepsLanguage: undefined, kind: undefined, keySymbol: undefined, text: undefined };
    const empty = languages.length === 0 && catalog().publications({ ...all, limit: 1 }).length === 0;
    return { languages, empty };
  });
}

function loadInstalledKeys(): Loaded<ReadonlySet<string>> {
  return load(() => new Set(library().installed().map((pub) => pub.pubKey)));
}

export default function CatalogScreen() {
  const { colors } = useBerean();
  const insets = useContentInsets();
  // The side insets the native header pads for; rows and the list header add
  // the spacing.lg content inset inside them.
  const sides = { paddingLeft: insets.left, paddingRight: insets.right };
  const messageSides = {
    paddingLeft: insets.left + spacing.lg,
    paddingRight: insets.right + spacing.lg,
  };
  const { jobs } = useInstalls();
  const { mepsLanguage } = useSelectedLanguage();
  const { catalogVersion } = useCatalogUpdate();
  const [meta, setMeta] = useState(loadMeta);
  const [metaVersion, setMetaVersion] = useState(catalogVersion);
  const [installed, setInstalled] = useState(loadInstalledKeys);
  const [kind, setKind] = useState<PubKind | undefined>(undefined);
  const [query, setQuery] = useState('');
  const text = useDebounced(query.trim(), 250);

  useEffect(() => onLibraryChanged(() => setInstalled(loadInstalledKeys())), []);

  // A new catalog was installed: reload, and the publications follow meta.
  if (metaVersion !== catalogVersion) {
    setMetaVersion(catalogVersion);
    setMeta(loadMeta());
  }

  // Offer the download unasked, once, when there is no catalog at all.
  const empty = meta.ok && meta.value.empty;
  const autoChecked = useRef(false);
  useEffect(() => {
    if (empty && !autoChecked.current && getCatalogUpdate().status.state === 'idle') {
      autoChecked.current = true;
      checkForUpdate();
    }
  }, [empty]);

  const languages = meta.ok ? meta.value.languages : [];
  const language = languages.find((l) => l.mepsId === mepsLanguage);
  const filterLanguage = language?.mepsId;

  // A synchronous FFI call on the JS thread; agreed for now.
  const publications = useMemo(
    () =>
      meta.ok && !meta.value.empty
        ? load(() =>
            catalog().publications({
              mepsLanguage: filterLanguage,
              kind,
              keySymbol: undefined,
              text: text || undefined,
              limit: 200,
            }),
          )
        : undefined,
    [meta, filterLanguage, kind, text],
  );

  const screen = (
    <Stack.Screen
      options={{
        headerSearchBarOptions: {
          placeholder: 'Search catalog',
          onChangeText: (e) => setQuery(e.nativeEvent.text),
        },
      }}
    />
  );

  const error = !meta.ok ? meta.message : publications?.ok === false ? publications.message : undefined;
  if (error !== undefined) {
    return (
      <View style={[styles.message, messageSides]}>
        {screen}
        <UIText style={{ color: colors.accent }}>{error}</UIText>
      </View>
    );
  }

  if (empty) {
    return (
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[styles.message, messageSides]}
      >
        <UIText>The publication catalog hasn&apos;t been downloaded yet.</UIText>
        <CatalogUpdatePanel />
        {__DEV__ && <DevCatalogIngest onIngested={() => setMeta(loadMeta())} />}
      </ScrollView>
    );
  }

  const installedKeys = installed.ok ? installed.value : new Set<string>();
  return (
    <>
      {screen}
      <FlatList
        style={styles.list}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={sides}
        data={publications?.ok ? publications.value : []}
        keyExtractor={(pub) => pub.pubKey}
        extraData={jobs}
        ListHeaderComponent={
          <View style={styles.filters}>
            {/* Inset like the rows; the chips scroll edge to edge instead. */}
            <View style={styles.inset}>
              <CatalogUpdatePanel compact />
              <TextButton
                title={language?.name ?? 'All languages'}
                accessibilityLabel={`Language: ${language?.name ?? 'All languages'}. Change language`}
                onPress={() => router.push('/library/languages')}
              />
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chips}
            >
              {KIND_FILTERS.map((filter) => (
                <FilterChip
                  key={filter.label}
                  label={filter.label}
                  accessibilityLabel={`Show ${filter.label}`}
                  selected={filter.kind === kind}
                  onPress={() => setKind(filter.kind)}
                />
              ))}
            </ScrollView>
            {!installed.ok && (
              <UIText style={[styles.inset, { color: colors.accent }]}>{installed.message}</UIText>
            )}
          </View>
        }
        ListEmptyComponent={<UIText style={styles.empty}>No publications match.</UIText>}
        renderItem={({ item }) => (
          <CatalogRow
            pub={item}
            installed={installedKeys.has(item.pubKey)}
            job={jobs.get(item.pubKey)}
          />
        )}
      />
    </>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1 },
  filters: { paddingVertical: spacing.sm, gap: spacing.sm },
  inset: { paddingHorizontal: spacing.lg, gap: spacing.sm, alignItems: 'flex-start' },
  chips: { paddingHorizontal: spacing.lg, gap: spacing.sm, alignItems: 'center' },
  message: { padding: spacing.lg, gap: spacing.md, alignItems: 'flex-start' },
  empty: { padding: spacing.lg },
});
