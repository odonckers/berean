import { router } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

import { ScaledSymbol } from '@/components/scaled-symbol';
import { UIText } from '@/components/text';
import { useBerean } from '@/design/theme';
import { backAccessibilityLabel, backTitle } from '@/notes/back-label';

/**
 * The iOS look's back button on a pushed Notes screen: a chevron and the
 * previous screen's title in the accent color, a 44pt target. It stands in
 * for the native one, which is Android's arrow on Android.
 */
export function IosBackButton({ label }: { label?: string }) {
  const { colors } = useBerean();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={backAccessibilityLabel(label)}
      onPress={() => router.back()}
      style={({ pressed }) => [styles.button, { opacity: pressed ? 0.6 : 1 }]}
    >
      <ScaledSymbol
        name={{ ios: 'chevron.left', android: 'arrow_back_ios' }}
        size={20}
        tintColor={colors.accent}
        accessible={false}
      />
      <UIText numberOfLines={1} style={[styles.title, { color: colors.accent }]}>
        {backTitle(label)}
      </UIText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { minWidth: 44, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 2 },
  title: { flexShrink: 1, maxWidth: 160 },
});
