import { Stack } from 'expo-router';

import { useStackOptions } from '@/design/use-stack-options';
import { SelectedLanguageProvider } from '@/library/selected-language';

export default function LibraryLayout() {
  const screenOptions = useStackOptions();
  return (
    <SelectedLanguageProvider>
      <Stack screenOptions={screenOptions}>
        <Stack.Screen name="index" options={{ title: 'Library' }} />
        {/* Pushed screens keep the native header for back and the search field,
            even where the stack options hide it (iOS look on Android). */}
        <Stack.Screen name="catalog" options={{ title: 'Catalog', headerShown: true }} />
        <Stack.Screen name="languages" options={{ title: 'Language', headerShown: true }} />
        <Stack.Screen name="reader" options={{ title: '', headerShown: true }} />
      </Stack>
    </SelectedLanguageProvider>
  );
}
