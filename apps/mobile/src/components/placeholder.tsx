import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import * as Haptics from 'expo-haptics';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors } from './colors';

type PlaceholderProps = {
  heading: string;
  body: string;
  action?: string;
};

export function Placeholder({ heading, body, action }: PlaceholderProps) {
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={styles.scroll}
      contentContainerStyle={styles.content}
    >
      <Card>
        <Text accessibilityRole="header" style={styles.heading}>
          {heading}
        </Text>
        <Text style={styles.body}>{body}</Text>
      </Card>
      {action ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={action}
          accessibilityHint="Placeholder. Not available yet."
          onPress={() => Haptics.selectionAsync()}
          style={({ pressed }) => [styles.button, pressed && styles.pressed]}
        >
          <Text style={styles.buttonLabel}>{action}</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

// Liquid Glass on iOS 26+, a plain grouped card everywhere else.
function Card({ children }: { children: ReactNode }) {
  if (isLiquidGlassAvailable()) {
    return <GlassView style={styles.card}>{children}</GlassView>;
  }
  return <View style={[styles.card, styles.cardFallback]}>{children}</View>;
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, gap: 16 },
  card: { borderRadius: 24, padding: 20, gap: 8 },
  cardFallback: { backgroundColor: colors.card },
  heading: { fontSize: 22, fontWeight: '600', color: colors.label },
  body: { fontSize: 17, lineHeight: 24, color: colors.secondaryLabel },
  button: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  pressed: { opacity: 0.5 },
  buttonLabel: { fontSize: 17, color: colors.tint },
});
