import { useTheme } from 'expo-router';
import { ScrollView, StyleSheet, Text } from 'react-native';

import { DockedSearchBar } from '@/components/docked-search-bar';

type PlaceholderProps = {
  title: string;
  body: string;
  showSearchBar?: boolean;
};

export function Placeholder({ title, body, showSearchBar = false }: PlaceholderProps) {
  const { colors } = useTheme();
  return (
    <>
      <ScrollView
        style={styles.scroll}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}
      >
        <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>
          {title}
        </Text>
        <Text style={[styles.body, { color: colors.text }]}>{body}</Text>
      </ScrollView>
      {showSearchBar && <DockedSearchBar />}
    </>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { padding: 16, gap: 8 },
  title: { fontSize: 22, fontWeight: '600' },
  body: { fontSize: 17 },
});
