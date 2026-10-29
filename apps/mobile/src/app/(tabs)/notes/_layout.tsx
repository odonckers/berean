import { Stack } from 'expo-router';

export default function NotesLayout() {
  return (
    <Stack screenOptions={{ headerLargeTitleEnabled: true }}>
      <Stack.Screen name="index" options={{ title: 'Notes' }} />
    </Stack>
  );
}
