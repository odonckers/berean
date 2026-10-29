import { Stack } from 'expo-router';

export default function StudyspaceLayout() {
  return (
    <Stack screenOptions={{ headerLargeTitleEnabled: true }}>
      <Stack.Screen name="index" options={{ title: 'Studyspace' }} />
    </Stack>
  );
}
