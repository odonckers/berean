import { StyleSheet, TextInput, type TextInputProps } from 'react-native';

import { useBerean } from '@/design/theme';

// The query field shared by the search screen and the palette. Placeholder
// only: no search logic until Expo 5.
export function SearchField(props: TextInputProps) {
  const { m3, colors, type, radii, spacing } = useBerean();
  return (
    <TextInput
      accessibilityLabel="Search Berean"
      placeholder="Search Berean"
      placeholderTextColor={m3.onSurfaceVariant}
      returnKeyType="search"
      autoCorrect={false}
      selectionColor={colors.accent}
      cursorColor={colors.accent}
      {...props}
      style={[
        styles.field,
        type.ui.body,
        {
          color: m3.onSurface,
          backgroundColor: m3.surfaceContainerHighest,
          borderRadius: radii.capsule,
          paddingHorizontal: spacing.xl,
        },
        props.style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  field: { minHeight: 56 },
});
