// Dev-only: berean://dev-ffi runs the berean-ffi smoke test and prints the
// results as plain text. A route in the root Stack (alongside (tabs) and
// search); outside __DEV__ it redirects to /.
import { Redirect, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';

import { TextButton } from '@/components/text-button';

export default function DevFfiScreen() {
  if (!__DEV__) {
    return <Redirect href="/" />;
  }
  return <DevFfiReport />;
}

type RebuildStatus = 'idle' | 'running' | 'done' | { error: string };

function rebuildLabel(status: RebuildStatus): string | undefined {
  if (status === 'running') return 'Rebuilding the search index…';
  if (status === 'done') return 'Search index rebuilt.';
  if (typeof status === 'object') return `Rebuild failed: ${status.error}`;
  return undefined;
}

function DevFfiReport() {
  const [lines, setLines] = useState<string[]>(['Running…']);
  const [rebuild, setRebuild] = useState<RebuildStatus>('idle');

  // The emulator's publications were installed before the search index
  // existed, so its index starts empty.
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

  useEffect(() => {
    // Loaded lazily so release bundles never touch the bindings from here.
    import('@/ffi/diagnostics')
      .then(({ runFfiDiagnostics }) => runFfiDiagnostics())
      .then(setLines, (e: unknown) => setLines([`FAILED: ${String(e)}`]));
  }, []);

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: 'berean-ffi' }} />
      <TextButton
        title="Rebuild search index"
        align="leading"
        onPress={rebuildIndex}
        disabled={rebuild === 'running'}
      />
      {rebuildLine !== undefined && <Text selectable>{rebuildLine}</Text>}
      {lines.map((line, i) => (
        <Text key={i} selectable>
          {line}
        </Text>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 4 },
});
