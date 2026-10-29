import { Stack } from 'expo-router';
import { Platform } from 'react-native';

import { useStackOptions } from '@/design/use-stack-options';

// The iOS look's trailing search tab. On iOS the native header search field
// is the control (the search role activates it); elsewhere SearchPlaceholder
// draws its own field.
export default function SearchLayout() {
  const screenOptions = useStackOptions();
  return (
    <Stack screenOptions={screenOptions}>
      <Stack.Screen
        name="index"
        options={{
          title: 'Search',
          headerSearchBarOptions:
            Platform.OS === 'ios' ? { placeholder: 'Search Berean' } : undefined,
        }}
      />
    </Stack>
  );
}
