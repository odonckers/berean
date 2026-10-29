import { Stack } from 'expo-router';

export default function ReadLayout() {
  return (
    <Stack screenOptions={{ headerLargeTitleEnabled: true }}>
      <Stack.Screen name="index" options={{ title: 'Read' }} />
    </Stack>
  );
}
