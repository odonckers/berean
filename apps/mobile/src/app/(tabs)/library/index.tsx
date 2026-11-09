import type { PublicationSummary } from 'berean-ffi-rn';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { RAIL_WIDTH } from '@/components/navigation-rail';
import {
  APP_BAR_SEARCH_MIN_WIDTH,
  APP_BAR_SEARCH_WIDTH,
  AppBarSearchBar,
  DockedSearchBar,
} from '@/components/search-bar';
import { UIText } from '@/components/text';
import { MATERIAL_TARGET, TEXT_BUTTON_LABEL_INSET, TextButton } from '@/components/text-button';
import { headerFitsActions, headerSearchWidth } from '@/design/header-fit';
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
import { openPublication } from '@/library/open';
import { ImportStatus } from '@/library/import-status';
import { useSelectedLanguage } from '@/library/selected-language';
import { pickAndImport, showImportDemo, useImports } from '@/library/side-load';
import { WhatsNewShelf } from '@/library/whats-new-shelf';

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

function openFind() {
  router.push('/library/find');
}

function importFile() {
  void pickAndImport();
}

/** Sample import rows for the screenshot workflow; only in builds that have its setup. */
const IMPORT_DEMO = __DEV__ || process.env.EXPO_PUBLIC_SCREENSHOTS === '1';

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
  const safeArea = useSafeAreaInsets();
  const { jobs } = useInstalls();
  const { mepsLanguage } = useSelectedLanguage();
  const [data, setData] = useState<Loaded<LibraryData>>(loadLibrary);
  const imports = useImports();
  const { importDemo } = useLocalSearchParams<{ importDemo?: string }>();

  useFocusEffect(useCallback(() => setData(loadLibrary()), []));
  useEffect(() => onLibraryChanged(() => setData(loadLibrary())), []);
  const demoPub = data.ok ? data.value.installed[0] : undefined;
  useEffect(() => {
    if (IMPORT_DEMO && importDemo === '1') {
      showImportDemo(demoPub);
    }
  }, [importDemo, demoPub]);

  const jobList = [...jobs.values()];
  const installedKeys = new Set(data.ok ? data.value.installed.map((pub) => pub.pubKey) : []);

  // Search as Screen shows it (a FlatList can't sit in Screen's ScrollView):
  // material look only, docked on phones, in the top app bar on tablets.
  const material = look === 'material';
  const docked = material && windowClass === 'compact';
  const appBarSearch = material && windowClass !== 'compact';

  // Find is the Library's title search (JW Library's Library search); the
  // search bar is Search Berean, the full-text search.
  // Settings › Appearance has no Settings screen to live in yet, so the
  // Library header carries it beside Catalog.
  const headerButtons = (
    <>
      <TextButton title="Find" accessibilityLabel="Find publications by title" onPress={openFind} />
      <TextButton title="Import" accessibilityLabel="Import a publication file" onPress={importFile} />
      <TextButton title="Appearance" accessibilityLabel="Appearance settings" onPress={openAppearance} />
      <TextButton title="Catalog" accessibilityLabel="Open catalog" onPress={openCatalog} />
    </>
  );

  // The native header's title can be left no room beside the buttons: on a
  // phone with large text, or on a tablet where the header (the window less
  // the rail, as the tabs layout shows it) also holds the app-bar search.
  // Then the buttons move to a row at the top of the list; the search stays
  // and, if the title still lacks room beside it, shrinks.
  const rail = material && Platform.OS === 'android' && windowClass !== 'compact';
  const headerFit = {
    windowWidth: width,
    fontScale,
    railWidth: rail ? RAIL_WIDTH + safeArea.left : 0,
    search: appBarSearch ? { width: APP_BAR_SEARCH_WIDTH, minWidth: APP_BAR_SEARCH_MIN_WIDTH } : undefined,
    title: 'Library',
    titleFontSize: type.ui.title.fontSize ?? 0,
    actions: ['Find', 'Import', 'Appearance', 'Catalog'],
    labelFontSize: type.ui.body.fontSize ?? 0,
    labelInset: TEXT_BUTTON_LABEL_INSET,
    minTarget: MATERIAL_TARGET,
    actionGap: spacing.sm,
    edgeInset: spacing.lg,
  };
  const buttonsBelowHeader = material && !headerFitsActions(headerFit);
  const searchWidth =
    buttonsBelowHeader && headerFit.search
      ? headerSearchWidth({ ...headerFit, search: headerFit.search, actions: [] })
      : undefined;

  return (
    <>
      <Stack.Screen
        options={{
          headerRight:
            buttonsBelowHeader && !appBarSearch
              ? undefined
              : () => (
                  <View style={styles.headerRight}>
                    {appBarSearch && <AppBarSearchBar width={searchWidth} />}
                    {!buttonsBelowHeader && headerButtons}
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
              {/* The list's side insets are on the rows' container, so the
                  shelf pulls back over them to scroll edge to edge. */}
              <View style={{ marginLeft: -insets.left, marginRight: -insets.right }}>
                <WhatsNewShelf
                  mepsLanguage={mepsLanguage}
                  installed={installedKeys}
                  insetLeft={insets.left}
                  insetRight={insets.right}
                />
              </View>
              {imports.map((job) => (
                <ImportStatus key={job.id} job={job} />
              ))}
              {(data.value.installed.length > 0 || jobList.length > 0) && (
                <UIText variant="title" style={styles.sectionTitle}>
                  Downloaded
                </UIText>
              )}
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
          }
          ListEmptyComponent={
            jobList.length === 0 && imports.length === 0 ? (
              <View style={styles.empty}>
                <UIText>No publications yet.</UIText>
                <TextButton title="Browse catalog" align="leading" onPress={openCatalog} />
                <TextButton
                  title="Import a .jwpub file"
                  align="leading"
                  accessibilityLabel="Import a publication file from this device"
                  onPress={importFile}
                />
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
              onPress={() => openPublication(item)}
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
  sectionTitle: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.sm },
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
