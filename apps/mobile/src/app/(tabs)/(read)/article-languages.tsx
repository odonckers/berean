import type { DocumentLanguage } from 'berean-ffi-rn';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { type ReactNode, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { Pressable, SectionList, StyleSheet, View } from 'react-native';

import { ScaledSymbol } from '@/components/scaled-symbol';
import { UIText } from '@/components/text';
import { useContentInsets } from '@/design/tab-chrome';
import { useBerean } from '@/design/theme';
import { hairline, spacing } from '@/design/tokens';
import { reader } from '@/ffi/core';
import { onLibraryChanged, startInstall, useInstalls } from '@/library/installs';
import { JobStatus } from '@/library/job-status';
import { displayTitle } from '@/library/labels';
import { load } from '@/library/load';
import {
  languageRowLabel,
  languageSections,
  SEARCH_THRESHOLD,
  vernacularLine,
} from '@/reader/article-languages';

type Params = { pubKey: string; docId: string };

/**
 * The article in another language (JW Library's Languages for the page
 * being read): the languages it's on this device in, then those to
 * download. Picking one opens the same article in that language, on top of
 * the one being read, so Back returns to it; a download opens it once it's
 * in.
 */
export default function ArticleLanguagesScreen() {
  const { colors } = useBerean();
  const insets = useContentInsets();
  const { pubKey, docId } = useLocalSearchParams<Params>();
  const { jobs, installedVersion } = useInstalls();
  const [libraryVersion, setLibraryVersion] = useState(0);
  const [query, setQuery] = useState('');
  // The edition whose download was started here, to open once it's in.
  const pending = useRef<string | undefined>(undefined);

  useEffect(() => onLibraryChanged(() => setLibraryVersion((v) => v + 1)), []);

  // A synchronous FFI call: an indexed catalog lookup and a check of the
  // installed editions.
  const languages = useMemo(
    () => load(() => reader().documentLanguages(pubKey, BigInt(docId))),
    // The versions: an install or removal changes which are on the device.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pubKey, docId, installedVersion, libraryVersion],
  );

  const open = (entry: DocumentLanguage) => {
    if (entry.publication.pubKey === pubKey) {
      router.back();
      return;
    }
    // Replaces this list with the article in that language, above the one
    // being read.
    router.dismissTo({
      pathname: '/publication',
      params: { pubKey: entry.publication.pubKey, title: displayTitle(entry.publication), docId },
    });
  };

  const openPending = useEffectEvent((list: readonly DocumentLanguage[]) => {
    const done = list.find((l) => l.publication.pubKey === pending.current && l.installed);
    if (done !== undefined) {
      pending.current = undefined;
      open(done);
    }
  });
  // A finished install lists the edition as installed: open it.
  useEffect(() => {
    if (languages.ok) openPending(languages.value);
  }, [languages]);

  const many = languages.ok && languages.value.length > SEARCH_THRESHOLD;
  const screen = (
    <Stack.Screen
      options={{
        headerSearchBarOptions: many
          ? {
              placeholder: 'Search languages',
              hideWhenScrolling: false,
              autoCapitalize: 'none',
              onChangeText: (e) => setQuery(e.nativeEvent.text),
            }
          : undefined,
      }}
    />
  );

  if (!languages.ok) {
    return (
      <View style={[styles.message, { paddingLeft: insets.left + spacing.lg, paddingRight: insets.right + spacing.lg }]}>
        {screen}
        <UIText style={{ color: colors.accent }}>{languages.message}</UIText>
      </View>
    );
  }

  const sections = languageSections(languages.value, pubKey, query);
  const onlyThis = languages.value.length <= 1;
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
        keyExtractor={(l) => String(l.language.mepsId)}
        extraData={jobs}
        stickySectionHeadersEnabled={false}
        ListEmptyComponent={
          <UIText style={styles.empty} accessibilityLiveRegion="polite">
            No languages match “{query.trim()}”.
          </UIText>
        }
        ListFooterComponent={
          onlyThis ? (
            <UIText secondary style={styles.empty}>
              This article isn’t in another language on this device, and the catalog lists no other. Updating the
              catalog in Library may add some.
            </UIText>
          ) : undefined
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
        renderItem={({ item }) => {
          const job = jobs.get(item.publication.pubKey);
          return (
            <LanguageRow
              entry={item}
              reading={item.publication.pubKey === pubKey}
              downloading={job !== undefined && job.state !== 'failed'}
              onPress={() => {
                if (item.installed) {
                  open(item);
                } else if (job === undefined || job.state === 'failed') {
                  pending.current = item.publication.pubKey;
                  startInstall(item.publication);
                }
              }}
            >
              {job !== undefined && <JobStatus job={job} />}
            </LanguageRow>
          );
        }}
      />
    </>
  );
}

function LanguageRow({
  entry,
  reading,
  downloading,
  onPress,
  children,
}: {
  entry: DocumentLanguage;
  reading: boolean;
  downloading: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  const { colors, look, m3 } = useBerean();
  const material = look === 'material';
  const { language, installed } = entry;
  const vernacular = vernacularLine(language);
  const state = reading ? 'reading' : installed ? 'installed' : downloading ? 'downloading' : 'download';
  const ink = material ? m3.onSurfaceVariant : colors.textSecondary;
  return (
    <View style={[styles.row, { borderColor: colors.separator }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={languageRowLabel(language, state)}
        accessibilityHint={
          reading
            ? undefined
            : installed
              ? 'Opens the article in this language'
              : downloading
                ? undefined
                : 'Downloads the issue, then opens the article'
        }
        accessibilityState={{ selected: reading, disabled: downloading }}
        disabled={downloading}
        onPress={onPress}
        android_ripple={{ color: colors.separator }}
        style={({ pressed }) => [
          styles.main,
          { minHeight: material ? 56 : 44 },
          pressed && !material && { opacity: 0.6 },
        ]}
      >
        <View style={styles.text}>
          <UIText style={reading && styles.reading}>{language.name}</UIText>
          {vernacular !== undefined && (
            <UIText secondary style={styles.detail}>
              {vernacular}
            </UIText>
          )}
        </View>
        {reading ? (
          <ScaledSymbol
            name={{ ios: 'checkmark', android: 'check' }}
            size={material ? 24 : 20}
            tintColor={colors.accent}
            accessible={false}
          />
        ) : (
          !installed &&
          !downloading && (
            <ScaledSymbol
              name={{ ios: 'icloud.and.arrow.down', android: 'download' }}
              size={material ? 24 : 22}
              tintColor={ink}
              accessible={false}
            />
          )
        )}
      </Pressable>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1 },
  message: { flex: 1, padding: spacing.lg },
  sectionHeader: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xs,
    borderBottomWidth: hairline,
    letterSpacing: 0.4,
  },
  empty: { padding: spacing.lg },
  row: { borderBottomWidth: hairline, paddingHorizontal: spacing.lg },
  main: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  text: { flex: 1, gap: 2 },
  reading: { fontWeight: '600' },
  detail: { fontSize: 15 },
});
