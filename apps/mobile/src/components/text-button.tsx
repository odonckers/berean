import { useTheme } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';

type TextButtonProps = {
  title: string;
  onPress: () => void;
  accessibilityLabel?: string;
  selected?: boolean;
  disabled?: boolean;
};

/** A plain text button in the theme's primary color, at least 44pt tall. */
export function TextButton({
  title,
  onPress,
  accessibilityLabel,
  selected,
  disabled = false,
}: TextButtonProps) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        selected && { backgroundColor: colors.card, borderColor: colors.primary },
        { opacity: disabled ? 0.4 : pressed ? 0.6 : 1 },
      ]}
    >
      <Text style={[styles.label, { color: colors.primary }, selected && styles.selected]}>
        {title}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 12,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  label: { fontSize: 17 },
  selected: { fontWeight: '600' },
});
