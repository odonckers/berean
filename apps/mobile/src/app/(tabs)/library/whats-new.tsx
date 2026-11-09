import { useEffect, useMemo, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';

import { UIText } from '@/components/text';
import { useContentInsets } from '@/design/tab-chrome';
import { useBerean } from '@/design/theme';
import { spacing } from '@/design/tokens';
import { catalog, library } from '@/ffi/core';
import { CatalogRow } from '@/library/catalog-row';
import { useCatalogUpdate } from '@/library/catalog-update';
import { onLibraryChanged, useInstalls } from '@/library/installs';
import { KIND_LABELS } from '@/library/labels';
import { load, type Loaded } from '@/library/load';
import { openPublication } from '@/library/open';
import { releaseLabel, releaseSpoken } from '@/library/release';
import { useSelectedLanguage } from '@/library/selected-language';

/** How many of the newest publications the full list shows. */
const LIST_COUNT = 60;

function loadInstalledKeys(): Loaded<ReadonlySet<string>> {
  return load(() => new Set(library().installed().map((pub) => pub.pubKey)));
}

/** See All from the Library's What's New: the newest releases, one per row. */
export default function WhatsNewScreen() {
  const { colors } = useBerean();
  const insets = useContentInsets();
  const { mepsLanguage } = useSelectedLanguage();
  const { catalogVersion } = useCatalogUpdate();
  const { jobs } = useInstalls();
  const [installed, setInstalled] = useState(loadInstalledKeys);

  useEffect(() => onLibraryChanged(() => setInstalled(loadInstalledKeys())), []);

  const items = useMemo(
    () => load(() => catalog().whatsNew(mepsLanguage, LIST_COUNT)),
    // catalogVersion: a newly installed catalog changes the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mepsLanguage, catalogVersion],
  );

  const sides = { paddingLeft: insets.left, paddingRight: insets.right };
  if (!items.ok) {
    return (
      <View style={[styles.message, { paddingLeft: insets.left + spacing.lg, paddingRight: insets.right + spacing.lg }]}>
        <UIText style={{ color: colors.accent }}>{items.message}</UIText>
      </View>
    );
  }
  const installedKeys = installed.ok ? installed.value : new Set<string>();
  return (
    <FlatList
      style={styles.list}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={sides}
      data={items.value}
      keyExtractor={(item) => item.publication.pubKey}
      extraData={[jobs, installedKeys]}
      ListEmptyComponent={
        <UIText style={styles.message}>
          Nothing new yet. Download the publication catalog from Catalog in the Library.
        </UIText>
      }
      renderItem={({ item }) => {
        const pub = item.publication;
        const kind = KIND_LABELS[pub.kind];
        return (
          <CatalogRow
            pub={pub}
            installed={installedKeys.has(pub.pubKey)}
            job={jobs.get(pub.pubKey)}
            detail={`${kind} · ${releaseLabel(item.released)}`}
            detailSpoken={`${kind}, released ${releaseSpoken(item.released)}`}
            onOpen={() => openPublication(pub)}
          />
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  list: { flex: 1 },
  message: { padding: spacing.lg },
});
