import { Stack } from 'expo-router';

import { SelectedLanguageProvider } from '@/library/selected-language';

export default function LibraryLayout() {
  return (
    <SelectedLanguageProvider>
      <Stack>
        <Stack.Screen name="index" options={{ title: 'Library', headerLargeTitleEnabled: true }} />
        <Stack.Screen name="catalog" options={{ title: 'Catalog' }} />
        <Stack.Screen name="languages" options={{ title: 'Language' }} />
      </Stack>
    </SelectedLanguageProvider>
  );
}
