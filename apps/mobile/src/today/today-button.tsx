import { router } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

import { ScaledSymbol } from '@/components/scaled-symbol';
import { useBerean } from '@/design/theme';

export const TODAY_LABEL = 'Daily text and meetings';

/** Opens Today (the day's text and the week's meetings): monochrome like Aa, a 48dp / 44pt target. */
export function TodayButton() {
  const { look, colors, m3 } = useBerean();
  const material = look === 'material';
  const target = material ? 48 : 44;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={TODAY_LABEL}
      onPress={() => router.push('/today')}
      style={({ pressed }) => [styles.button, { minWidth: target, minHeight: target, opacity: pressed ? 0.6 : 1 }]}
    >
      <ScaledSymbol
        name={{ ios: 'calendar', android: 'calendar_today' }}
        size={material ? 24 : 22}
        tintColor={material ? m3.onSurfaceVariant : colors.text}
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { alignItems: 'center', justifyContent: 'center' },
});
