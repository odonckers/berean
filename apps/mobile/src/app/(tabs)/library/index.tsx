import { PubKind, type PublicationSummary } from 'berean-ffi-rn';
import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { AppBarSearchBar, DockedSearchBar } from '@/components/search-bar';
import { UIText } from '@/components/text';
import { MATERIAL_TARGET, TEXT_BUTTON_LABEL_INSET, TextButton } from '@/components/text-button';
import { headerFitsActions } from '@/design/header-fit';
import { useContentInsets, useHeaderHidden } from '@/design/tab-chrome';
import { useBerean } from '@/design/theme';
import { hairline, spacing } from '@/design/tokens';
import { useWindowClass } from '@/design/use-window-class';
import { library } from '@/ffi/core';
import { coreErrorMessage } from '@/ffi/errors';
import { libraryChanged, onLibraryChanged, useInstalls } from '@/library/installs';
import { JobStatus } from '@/library/job-status';
import { displayTitle } from '@/library/labels';
import { languageNames, load, type Loaded, publicationDetail } from '@/library/load';

type LibraryData = { installed: PublicationSummary[]; names: ReadonlyMap<number, string> };

function loadLibrary(): Loaded<LibraryData> {
  return load(() => ({ installed: library().installed(), names: languageNames() }));
}

function openCatalog() {
  router.push('/library/catalog');
}

function openAppearance() {
  router.push('/appearance');
}

// Publications read in the Read tab: navigate selects it, and its stack
// either takes the new params in place (same screen on top) or pushes.
function openReader(pub: PublicationSummary) {
  const params = { pubKey: pub.pubKey, title: displayTitle(pub) };
  if (pub.kind === PubKind.Bible) {
    router.navigate({ pathname: '/', params });
  } else {
    router.navigate({ pathname: '/publication', params });
  }
}

function confirmRemove(pub: PublicationSummary) {
  const title = displayTitle(pub);
  Alert.alert(`Remove ${title}?`, undefined, [
    { text: 'Cancel', style: 'cancel' },
    {
      text: 'Remove',
      style: 'destructive',
      onPress: () => {
        try {
          library().remove(pub.pubKey);
        } catch (e) {
          Alert.alert(`Couldn't remove ${title}`, coreErrorMessage(e));
        }
        libraryChanged();
      },
    },
  ]);
}

export default function LibraryScreen() {
  const { look, colors, type } = useBerean();
  const { width, fontScale } = useWindowDimensions();
  const windowClass = useWindowClass();
  const headerHidden = useHeaderHidden();
  const insets = useContentInsets();
  const { jobs } = useInstalls();
  const [data, setData] = useState<Loaded<LibraryData>>(loadLibrary);

  useFocusEffect(useCallback(() => setData(loadLibrary()), []));
  useEffect(() => onLibraryChanged(() => setData(loadLibrary())), []);

  const jobList = [...jobs.values()];

  // Search as Screen shows it (a FlatList can't sit in Screen's ScrollView):
  // material look only, docked on phones, in the top app bar on tablets.
  const material = look === 'material';
  const docked = material && windowClass === 'compact';
  const appBarSearch = material && windowClass !== 'compact';

  // Settings › Appearance has no Settings screen to live in yet, so the
  // Library header carries it beside Catalog.
  const headerButtons = (
    <>
      <TextButton title="Appearance" accessibilityLabel="Appearance settings" onPress={openAppearance} />
      <TextButton title="Catalog" accessibilityLabel="Open catalog" onPress={openCatalog} />
    </>
  );

  // On a Material phone, large text can leave the native header's title no
  // room beside the buttons; then they move to a row at the top of the list.
  const buttonsBelowHeader =
    docked &&
    !headerFitsActions({
      windowWidth: width,
      fontScale,
      title: 'Library',
      titleFontSize: type.ui.title.fontSize ?? 0,
      actions: ['Appearance', 'Catalog'],
      labelFontSize: type.ui.body.fontSize ?? 0,
      labelInset: TEXT_BUTTON_LABEL_INSET,
      minTarget: MATERIAL_TARGET,
      actionGap: spacing.sm,
      edgeInset: spacing.lg,
    });

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: buttonsBelowHeader
            ? undefined
            : () => (
                <View style={styles.headerRight}>
                  {appBarSearch && <AppBarSearchBar />}
                  {headerButtons}
                </View>
              ),
        }}
      />
      {data.ok ? (
        <FlatList
          style={styles.list}
          contentInsetAdjustmentBehavior="automatic"
          // The side insets keep rows under the header's leading edge; the
          // rows add the spacing.lg content inset inside them.
          contentContainerStyle={{
            paddingTop: insets.top,
            paddingBottom: insets.bottom,
            paddingLeft: insets.left,
            paddingRight: insets.right,
          }}
          data={data.value.installed}
          keyExtractor={(pub) => pub.pubKey}
          ListHeaderComponent={
            headerHidden || buttonsBelowHeader || jobList.length > 0 ? (
              <View>
                {/* With the native header hidden, its title and button are drawn here. */}
                {headerHidden && (
                  <View style={styles.inlineHeader}>
                    <UIText variant="largeTitle" style={styles.inlineTitle}>
                      Library
                    </UIText>
                    {headerButtons}
                  </View>
                )}
                {buttonsBelowHeader && <View style={styles.buttonsRow}>{headerButtons}</View>}
                {jobList.map((job) => (
                  <View
                    key={job.pub.pubKey}
                    style={[styles.row, { borderColor: colors.separator }]}
                  >
                    <UIText numberOfLines={2} style={styles.title}>
                      {displayTitle(job.pub)}
                    </UIText>
                    <JobStatus job={job} />
                  </View>
                ))}
              </View>
            ) : undefined
          }
          ListEmptyComponent={
            jobList.length === 0 ? (
              <View style={styles.empty}>
                <UIText>No publications yet.</UIText>
                <TextButton title="Browse catalog" align="leading" onPress={openCatalog} />
              </View>
            ) : undefined
          }
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${displayTitle(item)}, ${publicationDetail(item, data.value.names)}`}
              accessibilityHint="Opens the publication. Long press to remove"
              accessibilityActions={[{ name: 'remove', label: 'Remove' }]}
              onAccessibilityAction={() => confirmRemove(item)}
              onPress={() => openReader(item)}
              onLongPress={() => confirmRemove(item)}
              style={[styles.row, { borderColor: colors.separator }]}
            >
              <UIText numberOfLines={2} style={styles.title}>
                {displayTitle(item)}
              </UIText>
              <UIText secondary style={styles.detail}>
                {publicationDetail(item, data.value.names)}
              </UIText>
            </Pressable>
          )}
        />
      ) : (
        <View
          style={[
            styles.empty,
            {
              paddingTop: insets.top + spacing.lg,
              paddingLeft: insets.left + spacing.lg,
              paddingRight: insets.right + spacing.lg,
            },
          ]}
        >
          <UIText style={{ color: colors.accent }}>{data.message}</UIText>
        </View>
      )}
      {docked && <DockedSearchBar />}
    </>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  // Wraps the buttons under the title when large text leaves no room.
  inlineHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  inlineTitle: { flexGrow: 1 },
  // Wraps when one row can't hold both; the labels, not the hit areas, line
  // up with the rows' text.
  buttonsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg - TEXT_BUTTON_LABEL_INSET,
    paddingTop: spacing.sm,
  },
  row: {
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.xs,
    borderBottomWidth: hairline,
  },
  title: { fontWeight: '500' },
  detail: { fontSize: 15 },
  empty: { flex: 1, padding: spacing.lg, gap: spacing.md, alignItems: 'flex-start' },
});
