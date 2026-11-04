import { router } from 'expo-router';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { SearchIcon } from '@/components/search-icon';
import { UIText } from '@/components/text';
import { useBerean } from '@/design/theme';

// M3 search bar (material look). It only opens the search screen.
function SearchBar({ style }: { style: StyleProp<ViewStyle> }) {
  const { colors, m3, radii, spacing } = useBerean();
  return (
    <Pressable
      accessibilityRole="search"
      accessibilityLabel="Search Berean"
      onPress={() => router.push('/search-view')}
      android_ripple={{ color: colors.separator }}
      style={[
        styles.bar,
        {
          backgroundColor: m3.surfaceContainerHigh,
          borderRadius: radii.capsule,
          paddingHorizontal: spacing.lg,
          gap: spacing.lg,
        },
        style,
      ]}
    >
      <SearchIcon color={m3.onSurfaceVariant} />
      <UIText style={[styles.label, { color: m3.onSurfaceVariant }]} numberOfLines={1}>
        Search Berean
      </UIText>
    </Pressable>
  );
}

// Docked above the navigation bar on compact windows. The native tab bar
// already reserves the bottom system inset, so no safe-area padding here.
export function DockedSearchBar() {
  const { spacing } = useBerean();
  return (
    <SearchBar
      style={{ minHeight: 56, marginHorizontal: spacing.lg, marginVertical: spacing.sm }}
    />
  );
}

// The app-bar field's full width, and the least it shrinks to where a
// header needs the room for its title: the icon and its padding.
export const APP_BAR_SEARCH_WIDTH = 360;
export const APP_BAR_SEARCH_MIN_WIDTH = 72;

// In the top app bar on windows >= 600dp. `width` narrows it below its full
// width (header-fit.ts headerSearchWidth); the label ellipsizes.
export function AppBarSearchBar({ width }: { width?: number } = {}) {
  return <SearchBar style={[styles.appBar, width !== undefined && { width }]} />;
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
  },
  label: { flexShrink: 1 },
  appBar: { minHeight: 48, width: APP_BAR_SEARCH_WIDTH, maxWidth: '100%' },
});
