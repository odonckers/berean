import { router, useTheme } from 'expo-router';
import { Platform, Pressable, StyleSheet, Text } from 'react-native';

// Android only for now; the iOS search tab comes in a later PR. The native tab
// bar already reserves the bottom system inset, so no safe-area padding here.
export function DockedSearchBar() {
  const { colors } = useTheme();
  if (Platform.OS !== 'android') {
    return null;
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Search"
      onPress={() => router.push('/search')}
      style={[styles.bar, { backgroundColor: colors.card, borderColor: colors.border }]}
    >
      <Text style={[styles.label, { color: colors.text }]}>Search Berean</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: 56,
    borderRadius: 28,
    borderWidth: 1,
    marginHorizontal: 16,
    marginVertical: 8,
    paddingHorizontal: 20,
    justifyContent: 'center',
  },
  label: { fontSize: 16, opacity: 0.6 },
});
