import { Stack } from 'expo-router';

import { useStackOptions } from '@/design/use-stack-options';
import { UndoProvider } from '@/notes/undo-bar';

export default function NotesLayout() {
  const screenOptions = useStackOptions();
  return (
    // Undo floats over the whole stack, so it stays put while you move on.
    <UndoProvider>
      <Stack screenOptions={screenOptions}>
        <Stack.Screen name="index" options={{ title: 'Notes' }} />
        {/* Pushed screens keep the native header for back, even where the
            stack options hide it (iOS look on Android). */}
        <Stack.Screen name="list" options={{ title: '', headerShown: true }} />
        <Stack.Screen name="note" options={{ title: '', headerShown: true, headerLargeTitleEnabled: false }} />
        <Stack.Screen
          name="edit"
          options={{ title: 'Edit Note', headerShown: true, headerLargeTitleEnabled: false, gestureEnabled: false }}
        />
      </Stack>
    </UndoProvider>
  );
}
