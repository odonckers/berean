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

/** A plain text button in the accent color, at least 44pt tall. */
export function TextButton({
  title,
  onPress,
  accessibilityLabel,
  selected,
  disabled = false,
}: TextButtonProps) {
  const { colors } = useBerean();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        selected && { backgroundColor: colors.surfaceRaised, borderColor: colors.accent },
        { opacity: disabled ? 0.4 : pressed ? 0.6 : 1 },
      ]}
    >
      <UIText style={[{ color: colors.accent }, selected && styles.selected]}>{title}</UIText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: radii.capsule,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  selected: { fontWeight: '600' },
});
