import { Stack } from 'expo-router';

import { useStackOptions } from '@/design/use-stack-options';

export default function ReadLayout() {
  const screenOptions = useStackOptions();
  return (
    <Stack screenOptions={screenOptions}>
      {/* The root follows the look's stack options like other tab roots;
          the screen sets its title per look. */}
      <Stack.Screen name="index" options={{ title: 'Read' }} />
      {/* Pushed publications keep the native header for back and the title,
          even where the stack options hide it (iOS look on Android).
          One entry per publication and document, so opening another
          publication from Library pushes instead of replacing the top one.
          The function form of dangerouslySingular is getId under a new name:
          expo-router calls it as getId({ params }) => fn(name, params). */}
      <Stack.Screen
        name="publication"
        options={{ title: '', headerShown: true }}
        dangerouslySingular={(_name, params) => `${params.pubKey ?? ''}/${params.docId ?? ''}`}
      />
      {/* The day's text and the week's meetings (JW Library's Daily Text and
          Meetings tabs), pushed from the reader's toolbar. Like a
          publication, it keeps the native header for back and the title. */}
      <Stack.Screen name="today" options={{ title: 'Today', headerShown: true }} />
      {/* The article being read in another language, pushed from the
          document's toolbar; picking one replaces it with that article. */}
      <Stack.Screen name="article-languages" options={{ title: 'Languages', headerShown: true }} />
      {/* The Bible map and timeline, pushed from the reader's toolbar in a
          chapter it covers. A map fills the screen, so no large title. */}
      <Stack.Screen
        name="atlas"
        options={{ title: 'Map and timeline', headerShown: true, headerLargeTitleEnabled: false }}
      />
    </Stack>
  );
}
