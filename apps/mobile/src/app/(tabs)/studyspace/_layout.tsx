import { Stack } from 'expo-router';

import { useStackOptions } from '@/design/use-stack-options';

export default function StudyspaceLayout() {
  const screenOptions = useStackOptions();
  return (
    <Stack screenOptions={screenOptions}>
      <Stack.Screen name="index" options={{ title: 'Studyspace' }} />
      {/* The phone's full-screen reader (§8); read.tsx sets its title and back. */}
      <Stack.Screen name="read" options={{ title: '', headerShown: true, headerLargeTitleEnabled: false }} />
    </Stack>
  );
}
