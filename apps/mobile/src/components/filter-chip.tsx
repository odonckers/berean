import { Pressable, StyleSheet, View } from 'react-native';

import { ScaledSymbol } from '@/components/scaled-symbol';
import { UIText } from '@/components/text';
import { useBerean } from '@/design/theme';
import { radii, spacing } from '@/design/tokens';

type FilterChipProps = {
  label: string;
  selected: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
};

/**
 * A filter chip. Material look: an M3 filter chip, a 32dp visual inside a
 * 48dp touch target, outlined when off and filled with a leading check when
 * on. iOS look: a filled capsule at least 44pt tall, accent-filled when on.
 * Heights are minimums so scaled text grows the chip instead of clipping;
 * the check scales with the text too and never shrinks for a long label.
 */
export function FilterChip({ label, selected, onPress, accessibilityLabel }: FilterChipProps) {
  const { look, colors, m3 } = useBerean();
  const a11y = {
    accessibilityRole: 'button',
    accessibilityLabel: accessibilityLabel ?? label,
    accessibilityState: { selected },
  } as const;

  if (look === 'material') {
    return (
      <Pressable
        {...a11y}
        onPress={onPress}
        style={({ pressed }) => [styles.materialTarget, { opacity: pressed ? 0.6 : 1 }]}
      >
        <View
          style={[
            styles.materialChip,
            selected
              ? {
                  backgroundColor: m3.secondaryContainer,
                  borderColor: m3.secondaryContainer,
                  paddingLeft: spacing.sm,
                }
              : { borderColor: m3.outlineVariant },
          ]}
        >
          {selected && (
            <ScaledSymbol
              name={{ ios: 'checkmark', android: 'check' }}
              size={CHECK_SIZE}
              style={styles.check}
              tintColor={m3.onSecondaryContainer}
              accessible={false}
              importantForAccessibility="no-hide-descendants"
              accessibilityElementsHidden
            />
          )}
          <UIText
            style={[
              styles.materialLabel,
              { color: selected ? m3.onSecondaryContainer : m3.onSurfaceVariant },
            ]}
          >
            {label}
          </UIText>
        </View>
      </Pressable>
    );
  }

  return (
    <Pressable
      {...a11y}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iosChip,
        { backgroundColor: selected ? colors.accent : m3.surfaceContainer },
        { opacity: pressed ? 0.6 : 1 },
      ]}
    >
      <UIText style={selected ? { color: m3.onPrimary, fontWeight: '600' } : { color: colors.text }}>
        {label}
      </UIText>
    </Pressable>
  );
}

const MATERIAL_TARGET = 48;
const MATERIAL_CHIP = 32;
const IOS_TARGET = 44;
const CHECK_SIZE = 18;

const styles = StyleSheet.create({
  materialTarget: {
    minHeight: MATERIAL_TARGET,
    minWidth: MATERIAL_TARGET,
    justifyContent: 'center',
  },
  materialChip: {
    minHeight: MATERIAL_CHIP,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingLeft: spacing.lg,
    paddingRight: spacing.lg,
    borderRadius: radii.materialChip,
    borderWidth: 1,
  },
  check: { flexShrink: 0 },
  // M3 label large.
  materialLabel: { flexShrink: 1, fontSize: 14, lineHeight: 20, fontWeight: '500' },
  iosChip: {
    minHeight: IOS_TARGET,
    minWidth: IOS_TARGET,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: radii.capsule,
  },
});
