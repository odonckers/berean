import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { SearchShortcut } from '@/components/search-shortcut';
import { LookProvider } from '@/design/look';
import { focusRing } from '@/design/focus-ring';
import { BereanThemeProvider, systemBarStyle, useBerean } from '@/design/theme';
import { SearchProvider } from '@/search/search-context';
import { useKeyboardFocusRing } from '../../modules/berean-shortcuts';
import { useNavigationBarStyle } from '../../modules/berean-system-bars';

function RootStack() {
  const { scheme, colors } = useBerean();
  const barStyle = systemBarStyle(scheme);
  useNavigationBarStyle(barStyle);
  const ring = focusRing(colors.accent);
  useKeyboardFocusRing(ring.color, ring.width);
  return (
    // One search for every entry, so the query carries over between them.
    <SearchProvider>
      <Stack screenOptions={{ contentStyle: { backgroundColor: colors.surface } }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="search-view"
          options={{ presentation: 'modal', title: 'Search', headerShown: true }}
        />
        <Stack.Screen
          name="note-editor"
          options={{ presentation: 'modal', title: 'New Note', headerShown: true, gestureEnabled: false }}
        />
      </Stack>
      <SearchShortcut />
      <StatusBar style={barStyle} />
    </SearchProvider>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <LookProvider>
        <BereanThemeProvider>
          <RootStack />
        </BereanThemeProvider>
      </LookProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
