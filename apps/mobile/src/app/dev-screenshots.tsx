// Screenshot setup: berean://dev-screenshots installs what the key screens
// need and seeds sample notes (src/screenshots/setup.ts), then shows
// "Screenshot setup: done" for the emulator workflow to wait on
// (.github/workflows/screenshots.yml). Built in only in development or with
// EXPO_PUBLIC_SCREENSHOTS=1; otherwise it redirects to /.
import { Redirect, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';

const ENABLED = __DEV__ || process.env.EXPO_PUBLIC_SCREENSHOTS === '1';

export default function DevScreenshotsScreen() {
  if (!ENABLED) {
    return <Redirect href="/" />;
  }
  return <SetupReport />;
}

function SetupReport() {
  const [lines, setLines] = useState<string[]>(['Screenshot setup: running']);

  useEffect(() => {
    const log = (line: string) => setLines((all) => [...all, line]);
    // Loaded lazily: builds without ENABLED drop it.
    if (ENABLED) {
      import('@/screenshots/setup')
        .then(({ runScreenshotSetup }) => runScreenshotSetup(log))
        .then(
          () => log('Screenshot setup: done'),
          (e: unknown) => log(`Screenshot setup: failed: ${e instanceof Error ? e.message : String(e)}`),
        );
    }
  }, []);

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: 'Screenshot setup' }} />
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
