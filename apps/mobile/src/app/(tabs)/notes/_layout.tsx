import { Stack } from 'expo-router';

import { useStackOptions } from '@/design/use-stack-options';

export default function NotesLayout() {
  const screenOptions = useStackOptions();
  return (
    <Stack screenOptions={screenOptions}>
      <Stack.Screen name="index" options={{ title: 'Notes' }} />
    </Stack>
  );
}
