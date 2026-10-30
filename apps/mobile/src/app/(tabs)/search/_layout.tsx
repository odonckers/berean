import { Stack } from 'expo-router';

import { useStackOptions } from '@/design/use-stack-options';

// The iOS look's trailing search tab. The screen sets its search field.
export default function SearchLayout() {
  const screenOptions = useStackOptions();
  return (
    <Stack screenOptions={screenOptions}>
      <Stack.Screen name="index" options={{ title: 'Search' }} />
    </Stack>
  );
}
