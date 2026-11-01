import { type NativeSyntheticEvent, Pressable, StyleSheet, type TargetedEvent } from 'react-native';

import { UIText } from '@/components/text';
import { useBerean } from '@/design/theme';
import { radii, spacing } from '@/design/tokens';

type TextButtonProps = {
  title: string;
  onPress: () => void;
  accessibilityLabel?: string;
  selected?: boolean;
  disabled?: boolean;
  /**
   * 'leading' when the button starts a column of content (text, rows): it
   * pulls back by TEXT_BUTTON_LABEL_INSET so its label, not its hit area,
   * starts at the content's leading edge. Default 'center'.
   */
  align?: 'center' | 'leading';
  /** Keyboard or accessibility focus; a Modal's buttons pass on the focus ring here. */
  onFocus?: (e: NativeSyntheticEvent<TargetedEvent>) => void;
  /** The label's colour; default the accent. */
  color?: string;
  bold?: boolean;
};

const BORDER_WIDTH = 1;

/**
 * How far the label sits inside the button's edge: the horizontal padding
 * plus the border (transparent unless selected).
 */
export const TEXT_BUTTON_LABEL_INSET = spacing.md + BORDER_WIDTH;

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
  align = 'center',
  onFocus,
  color,
  bold = false,
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
      onFocus={onFocus}
      style={({ pressed }) => [
        styles.button,
        { minHeight: target, minWidth: target },
        align === 'leading' && styles.leading,
        selected && { backgroundColor: colors.surfaceRaised, borderColor: colors.accent },
        { opacity: disabled ? 0.4 : pressed ? 0.6 : 1 },
      ]}
    >
      <UIText style={[{ color: color ?? colors.accent }, (selected || bold) && styles.selected]}>{title}</UIText>
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
    borderWidth: BORDER_WIDTH,
    borderColor: 'transparent',
  },
  // The hit area keeps its full size and reaches into the content inset; a
  // label narrower than the minimum target starts at the edge, not centered.
  leading: { marginStart: -TEXT_BUTTON_LABEL_INSET, alignItems: 'flex-start' },
  selected: { fontWeight: '600' },
});
