import { Text, type TextProps } from 'react-native';

import { useBerean } from '@/design/theme';
import type { ReadingVariant, UIVariant } from '@/design/tokens';

type UITextProps = TextProps & {
  variant?: UIVariant;
  secondary?: boolean;
};

export function UIText({ variant = 'body', secondary = false, style, ...props }: UITextProps) {
  const { colors, type } = useBerean();
  const isHeading = variant === 'largeTitle' || variant === 'title';
  return (
    <Text
      accessibilityRole={isHeading ? 'header' : undefined}
      {...props}
      style={[type.ui[variant], { color: secondary ? colors.textSecondary : colors.text }, style]}
    />
  );
}

type ScriptureTextProps = TextProps & {
  variant?: ReadingVariant;
};

export function ScriptureText({ variant = 'scripture', style, ...props }: ScriptureTextProps) {
  const { colors, type } = useBerean();
  const isHeading = variant === 'chapterHeading' || variant === 'sectionHeading';
  return (
    <Text
      accessibilityRole={isHeading ? 'header' : undefined}
      {...props}
      style={[type.reading[variant], { color: colors.text }, style]}
    />
  );
}
