// Dev-only: berean://dev-ffi runs the berean-ffi smoke test and prints the
// results as plain text. A route in the root Stack (alongside (tabs) and
// search); outside __DEV__ it redirects to /.
import { Redirect, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';

export default function DevFfiScreen() {
  if (!__DEV__) {
    return <Redirect href="/" />;
  }
  return <DevFfiReport />;
}

function DevFfiReport() {
  const [lines, setLines] = useState<string[]>(['Running…']);

  useEffect(() => {
    // Loaded lazily so release bundles never touch the bindings from here.
    import('@/ffi/diagnostics')
      .then(({ runFfiDiagnostics }) => runFfiDiagnostics())
      .then(setLines, (e: unknown) => setLines([`FAILED: ${String(e)}`]));
  }, []);

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: 'berean-ffi' }} />
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
