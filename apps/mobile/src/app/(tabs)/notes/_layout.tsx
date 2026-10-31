import { Stack } from 'expo-router';

import { useBerean } from '@/design/theme';
import { useStackOptions } from '@/design/use-stack-options';
import { IosBackButton } from '@/notes/back-button';
import { UndoProvider } from '@/notes/undo-bar';

export default function NotesLayout() {
  const screenOptions = useStackOptions();
  const { look } = useBerean();
  // The iOS look draws its own back button: the native one is Android's
  // arrow on Android.
  const back =
    look === 'material'
      ? null
      : { headerBackVisible: false, headerLeft: ({ label }: { label?: string }) => <IosBackButton label={label} /> };
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
