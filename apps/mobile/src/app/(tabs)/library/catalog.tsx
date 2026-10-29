import type { Language, PubKind } from 'berean-ffi-rn';
import { router, Stack, useTheme } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, ScrollView, StyleSheet, Text, View } from 'react-native';

import { TextButton } from '@/components/text-button';
import { catalog, library } from '@/ffi/core';
import { CatalogRow } from '@/library/catalog-row';
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
  const { colors } = useTheme();
  const { jobs } = useInstalls();
  const { mepsLanguage } = useSelectedLanguage();
  const [meta, setMeta] = useState(loadMeta);
  const [installed, setInstalled] = useState(loadInstalledKeys);
  const [kind, setKind] = useState<PubKind | undefined>(undefined);
  const [query, setQuery] = useState('');
  const text = useDebounced(query.trim(), 250);

  useEffect(() => onLibraryChanged(() => setInstalled(loadInstalledKeys())), []);

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
      <View style={styles.message}>
        {screen}
        <Text style={[styles.body, { color: colors.notification }]}>{error}</Text>
      </View>
    );
  }

  if (meta.ok && meta.value.empty) {
    return (
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.message}>
        <Text style={[styles.body, { color: colors.text }]}>
          The publication catalog hasn&apos;t been downloaded yet.
        </Text>
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
        data={publications?.ok ? publications.value : []}
        keyExtractor={(pub) => pub.pubKey}
        extraData={jobs}
        ListHeaderComponent={
          <View style={styles.filters}>
            <TextButton
              title={language?.name ?? 'All languages'}
              accessibilityLabel={`Language: ${language?.name ?? 'All languages'}. Change language`}
              onPress={() => router.push('/library/languages')}
            />
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {KIND_FILTERS.map((filter) => (
                <TextButton
                  key={filter.label}
                  title={filter.label}
                  accessibilityLabel={`Show ${filter.label}`}
                  selected={filter.kind === kind}
                  onPress={() => setKind(filter.kind)}
                />
              ))}
            </ScrollView>
            {!installed.ok && (
              <Text style={[styles.body, { color: colors.notification }]}>{installed.message}</Text>
            )}
          </View>
        }
        ListEmptyComponent={
          <Text style={[styles.body, styles.empty, { color: colors.text }]}>
            No publications match.
          </Text>
        }
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
  filters: { paddingVertical: 8, gap: 8, alignItems: 'flex-start' },
  message: { padding: 16, gap: 12, alignItems: 'flex-start' },
  body: { fontSize: 17 },
  empty: { padding: 16 },
});
