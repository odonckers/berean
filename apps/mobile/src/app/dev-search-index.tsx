// Dev-only: berean://dev-search-index rebuilds the search index. Apart from
// dev-ffi, whose synchronous diagnostics block the JS thread for minutes on a
// slow emulator. Outside __DEV__ it redirects to /.
import { Redirect, Stack } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';

import { TextButton } from '@/components/text-button';

export default function DevSearchIndexScreen() {
  if (!__DEV__) {
    return <Redirect href="/" />;
  }
  return <DevSearchIndex />;
}

type RebuildStatus = 'idle' | 'running' | 'done' | { error: string };

function rebuildLabel(status: RebuildStatus): string | undefined {
  if (status === 'running') return 'Rebuilding the search index…';
  if (status === 'done') return 'Search index rebuilt.';
  if (typeof status === 'object') return `Rebuild failed: ${status.error}`;
  return undefined;
}

function DevSearchIndex() {
  const [rebuild, setRebuild] = useState<RebuildStatus>('idle');

  // The emulator's publications were installed before the search index
  // existed, so its index starts empty. Loaded lazily so release bundles
  // never touch the bindings from here.
  const rebuildIndex = () => {
    setRebuild('running');
    Promise.all([import('@/ffi/diagnostics'), import('@/ffi/errors')]).then(
      ([{ rebuildSearchIndex }, { coreErrorMessage }]) =>
        rebuildSearchIndex().then(
          () => setRebuild('done'),
          (e: unknown) => setRebuild({ error: coreErrorMessage(e) }),
        ),
      (e: unknown) => setRebuild({ error: String(e) }),
    );
  };
  const rebuildLine = rebuildLabel(rebuild);

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: 'Search index' }} />
      <TextButton
        title="Rebuild search index"
        align="leading"
        onPress={rebuildIndex}
        disabled={rebuild === 'running'}
      />
      {rebuildLine !== undefined && <Text selectable>{rebuildLine}</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 4 },
});
