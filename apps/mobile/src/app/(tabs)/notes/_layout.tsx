import { Stack } from 'expo-router';
import { Platform } from 'react-native';

import { useBerean } from '@/design/theme';
import { useStackOptions } from '@/design/use-stack-options';
import { IosBackButton } from '@/notes/back-button';
import { UndoProvider } from '@/notes/undo-bar';

export default function NotesLayout() {
  const screenOptions = useStackOptions();
  const { look } = useBerean();
  // The iOS look on Android draws its own back button: the native one there
  // is Android's arrow. Real iOS keeps the native one and its long-press menu.
  const back =
    look === 'ios' && Platform.OS === 'android'
      ? { headerBackVisible: false, headerLeft: ({ label }: { label?: string }) => <IosBackButton label={label} /> }
      : null;
  return (
    // Undo floats over the whole stack, so it stays put while you move on.
    <UndoProvider>
      <Stack screenOptions={screenOptions}>
        <Stack.Screen name="index" options={{ title: 'Notes' }} />
        {/* Pushed screens keep the native header for back, even where the
            stack options hide it (iOS look on Android). */}
        <Stack.Screen name="list" options={{ title: '', headerShown: true, ...back }} />
        <Stack.Screen name="note" options={{ title: '', headerShown: true, headerLargeTitleEnabled: false, ...back }} />
        <Stack.Screen
          name="edit"
          options={{ title: 'Edit Note', headerShown: true, headerLargeTitleEnabled: false, gestureEnabled: false }}
        />
      </Stack>
    </UndoProvider>
  );
}
