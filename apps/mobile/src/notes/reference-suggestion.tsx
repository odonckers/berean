import { Pressable, StyleSheet, View } from 'react-native';

import { ScaledSymbol } from '@/components/scaled-symbol';
import { UIText } from '@/components/text';
import { useBerean } from '@/design/theme';
import { radii, spacing } from '@/design/tokens';

type ReferenceSuggestionChipProps = {
  label: string;
  onPress: () => void;
};

/**
 * The Write view's "Link John 1:14" suggestion, one chip. iOS look: an
 * accent-tinted capsule at least 44pt tall. Material look: an M3 assist
 * chip, 32dp outlined with a leading link icon, in a 48dp touch target.
 */
export function ReferenceSuggestionChip({ label, onPress }: ReferenceSuggestionChipProps) {
  const { look, colors, m3 } = useBerean();
  const a11y = { accessibilityRole: 'button', accessibilityLabel: label } as const;

  if (look === 'material') {
    return (
      <View style={styles.row}>
        <Pressable {...a11y} onPress={onPress} style={({ pressed }) => [styles.materialTarget, { opacity: pressed ? 0.6 : 1 }]}>
          <View style={[styles.materialChip, { borderColor: m3.outlineVariant, backgroundColor: m3.surface }]}>
            <ScaledSymbol
              name={{ ios: 'link', android: 'link' }}
              size={18}
              tintColor={m3.primary}
              accessible={false}
              importantForAccessibility="no-hide-descendants"
              accessibilityElementsHidden
            />
            <UIText style={[styles.materialLabel, { color: m3.onSurface }]}>{label}</UIText>
          </View>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.row}>
      <Pressable
        {...a11y}
        onPress={onPress}
        style={({ pressed }) => [styles.iosChip, { backgroundColor: colors.surfaceRaised, opacity: pressed ? 0.6 : 1 }]}
      >
        {/* The tint: the accent, faint, over the raised surface. */}
        <View style={[StyleSheet.absoluteFill, styles.iosTint, { backgroundColor: colors.accent }]} />
        <UIText style={[styles.iosLabel, { color: colors.accent }]}>{label}</UIText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  // As wide as the chip, from the leading edge.
  row: { flexDirection: 'row' },
  materialTarget: { minHeight: 48, justifyContent: 'center' },
  materialChip: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingLeft: spacing.sm,
    paddingRight: spacing.lg,
    borderRadius: radii.materialChip,
    borderWidth: 1,
  },
  // M3 label large.
  materialLabel: { flexShrink: 1, fontSize: 14, lineHeight: 20, fontWeight: '500' },
  iosChip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: radii.capsule,
    overflow: 'hidden',
  },
  iosTint: { opacity: 0.14 },
  iosLabel: { flexShrink: 1, fontWeight: '600' },
});
