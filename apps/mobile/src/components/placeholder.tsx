import { useTheme } from 'expo-router';
import { ScrollView, StyleSheet, Text } from 'react-native';

type PlaceholderProps = {
  title: string;
  body: string;
};

export function Placeholder({ title, body }: PlaceholderProps) {
  const { colors } = useTheme();
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>
        {title}
      </Text>
      <Text style={[styles.body, { color: colors.text }]}>{body}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 8 },
  title: { fontSize: 22, fontWeight: '600' },
  body: { fontSize: 17 },
});
