import { Stack } from 'expo-router';

import { useStackOptions } from '@/design/use-stack-options';

export default function LibraryLayout() {
  const screenOptions = useStackOptions();
  return (
    <Stack screenOptions={screenOptions}>
      <Stack.Screen name="index" options={{ title: 'Library' }} />
    </Stack>
  );
}
