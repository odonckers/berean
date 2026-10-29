import { Pressable, StyleSheet } from 'react-native';

import { UIText } from '@/components/text';
import { useBerean } from '@/design/theme';
import { radii, spacing } from '@/design/tokens';

type TextButtonProps = {
  title: string;
  onPress: () => void;
  accessibilityLabel?: string;
  selected?: boolean;
  disabled?: boolean;
};

/**
 * A plain text button in the accent color. Its hit area is at least 48x48dp
 * on the Material look (M3 minimum touch target) and 44x44pt on the iOS look
 * (HIG minimum).
 */
export function TextButton({
  title,
  onPress,
  accessibilityLabel,
  selected,
  disabled = false,
}: TextButtonProps) {
  const { colors, look } = useBerean();
  const target = look === 'material' ? MATERIAL_TARGET : IOS_TARGET;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { minHeight: target, minWidth: target },
        selected && { backgroundColor: colors.surfaceRaised, borderColor: colors.accent },
        { opacity: disabled ? 0.4 : pressed ? 0.6 : 1 },
      ]}
    >
      <UIText style={[{ color: colors.accent }, selected && styles.selected]}>{title}</UIText>
    </Pressable>
  );
}

const MATERIAL_TARGET = 48;
const IOS_TARGET = 44;

const styles = StyleSheet.create({
  button: {
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: radii.capsule,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  selected: { fontWeight: '600' },
});
