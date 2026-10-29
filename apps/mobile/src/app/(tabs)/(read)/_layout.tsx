import { Stack } from 'expo-router';

import { useStackOptions } from '@/design/use-stack-options';

export default function ReadLayout() {
  const screenOptions = useStackOptions();
  return (
    <Stack screenOptions={screenOptions}>
      {/* The reader keeps the native header for its title (and back, when
          pushed), even where the stack options hide it (iOS look on Android). */}
      <Stack.Screen name="index" options={{ title: 'Read', headerShown: true }} />
      {/* One entry per publication and document, so opening another
          publication from Library pushes instead of replacing the top one. */}
      <Stack.Screen
        name="publication"
        options={{ title: '', headerShown: true }}
        getId={({ params }) => `${params?.pubKey ?? ''}/${params?.docId ?? ''}`}
      />
    </Stack>
  );
}
