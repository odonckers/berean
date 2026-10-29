import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { SearchShortcut } from '@/components/search-shortcut';
import { LookProvider } from '@/design/look';
import { BereanThemeProvider, useBerean } from '@/design/theme';
import { useNavigationBarStyle } from '../../modules/berean-system-bars';

function RootStack() {
  const { scheme, colors } = useBerean();
  const barStyle = scheme === 'dark' ? 'light' : 'dark';
  useNavigationBarStyle(barStyle);
  return (
    <>
      <Stack screenOptions={{ contentStyle: { backgroundColor: colors.surface } }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="search"
          options={{ presentation: 'modal', title: 'Search', headerShown: true }}
        />
      </Stack>
      <SearchShortcut />
      <StatusBar style={barStyle} />
    </>
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
