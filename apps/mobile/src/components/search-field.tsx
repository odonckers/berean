import type { Ref } from 'react';
import {
  StyleSheet,
  TextInput,
  type TextInputInstance,
  type TextInputProps,
} from 'react-native';

import { useBerean } from '@/design/theme';
import { hairline } from '@/design/tokens';
import { useSearch } from '@/search/search-context';

// The query field every drawn entry uses (the M3 search view, the iOS look's
// bottom field off iOS, the palette). Bound to the shared search, so the
// query carries over between them. Heights are minimums so scaled text
// grows the field instead of clipping.
export function SearchField({ ref, ...props }: TextInputProps & { ref?: Ref<TextInputInstance> }) {
  const { look, m3, colors, type, radii, spacing } = useBerean();
  const { text, setText } = useSearch();
  const lookStyle =
    look === 'material'
      ? { backgroundColor: m3.surfaceContainerHighest, minHeight: 56, paddingHorizontal: spacing.xl }
      : {
          // Liquid Glass approximated: a raised capsule with a hairline edge.
          backgroundColor: colors.surfaceRaised,
          borderColor: colors.separator,
          borderWidth: hairline,
          minHeight: 44,
          paddingHorizontal: spacing.lg,
        };
  return (
    <TextInput
      ref={ref}
      accessibilityLabel="Search Berean"
      placeholder="Search Berean"
      placeholderTextColor={m3.onSurfaceVariant}
      returnKeyType="search"
      autoCorrect={false}
      autoCapitalize="none"
      selectionColor={colors.accent}
      cursorColor={colors.accent}
      value={text}
      onChangeText={setText}
      {...props}
      style={[
        styles.field,
        type.ui.body,
        { color: m3.onSurface, borderRadius: radii.capsule },
        lookStyle,
        props.style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  field: { flexShrink: 1 },
});
