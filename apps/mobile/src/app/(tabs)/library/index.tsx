import type { PublicationSummary } from 'berean-ffi-rn';
import { router, Stack, useFocusEffect, useTheme } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { DockedSearchBar } from '@/components/docked-search-bar';
import { TextButton } from '@/components/text-button';
import { library } from '@/ffi/core';
import { coreErrorMessage } from '@/ffi/errors';
import { libraryChanged, onLibraryChanged, useInstalls } from '@/library/installs';
import { JobStatus } from '@/library/job-status';
import { languageNames, load, type Loaded, publicationDetail } from '@/library/load';

type LibraryData = { installed: PublicationSummary[]; names: ReadonlyMap<number, string> };

function loadLibrary(): Loaded<LibraryData> {
  return load(() => ({ installed: library().installed(), names: languageNames() }));
}

function openCatalog() {
  router.push('/library/catalog');
}

function confirmRemove(pub: PublicationSummary) {
  Alert.alert(`Remove ${pub.title}?`, undefined, [
    { text: 'Cancel', style: 'cancel' },
    {
      text: 'Remove',
      style: 'destructive',
      onPress: () => {
        try {
          library().remove(pub.pubKey);
        } catch (e) {
          Alert.alert(`Couldn't remove ${pub.title}`, coreErrorMessage(e));
        }
        libraryChanged();
      },
    },
  ]);
}

export default function LibraryScreen() {
  const { colors } = useTheme();
  const { jobs } = useInstalls();
  const [data, setData] = useState<Loaded<LibraryData>>(loadLibrary);

  useFocusEffect(useCallback(() => setData(loadLibrary()), []));
  useEffect(() => onLibraryChanged(() => setData(loadLibrary())), []);

  const jobList = [...jobs.values()];

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => (
            <TextButton title="Catalog" accessibilityLabel="Open catalog" onPress={openCatalog} />
          ),
        }}
      />
      {data.ok ? (
        <FlatList
          style={styles.list}
          contentInsetAdjustmentBehavior="automatic"
          data={data.value.installed}
          keyExtractor={(pub) => pub.pubKey}
          ListHeaderComponent={
            jobList.length > 0 ? (
              <View>
                {jobList.map((job) => (
                  <View key={job.pub.pubKey} style={[styles.row, { borderColor: colors.border }]}>
                    <Text numberOfLines={2} style={[styles.title, { color: colors.text }]}>
                      {job.pub.title}
                    </Text>
                    <JobStatus job={job} />
                  </View>
                ))}
              </View>
            ) : undefined
          }
          ListEmptyComponent={
            jobList.length === 0 ? (
              <View style={styles.empty}>
                <Text style={[styles.body, { color: colors.text }]}>No publications yet.</Text>
                <TextButton title="Browse catalog" onPress={openCatalog} />
              </View>
            ) : undefined
          }
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${item.title}, ${publicationDetail(item, data.value.names)}`}
              accessibilityHint="Long press to remove"
              accessibilityActions={[{ name: 'remove', label: 'Remove' }]}
              onAccessibilityAction={() => confirmRemove(item)}
              onLongPress={() => confirmRemove(item)}
              style={[styles.row, { borderColor: colors.border }]}
            >
              <Text numberOfLines={2} style={[styles.title, { color: colors.text }]}>
                {item.title}
              </Text>
              <Text style={[styles.detail, { color: colors.text }]}>
                {publicationDetail(item, data.value.names)}
              </Text>
            </Pressable>
          )}
        />
      ) : (
        <View style={styles.empty}>
          <Text style={[styles.body, { color: colors.notification }]}>{data.message}</Text>
        </View>
      )}
      <DockedSearchBar />
    </>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1 },
  row: {
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 17, fontWeight: '500' },
  detail: { fontSize: 15, opacity: 0.7 },
  empty: { flex: 1, padding: 16, gap: 12, alignItems: 'flex-start' },
  body: { fontSize: 17 },
});
