import { router } from 'expo-router';
import { TabList, TabSlot, TabTrigger, Tabs, useTabTrigger } from 'expo-router/ui';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SearchIcon } from '@/components/search-icon';
import { UIText } from '@/components/text';
import { TabChromeContext, destinations } from '@/design/tab-chrome';
import { useBerean } from '@/design/theme';
import { hairline } from '@/design/tokens';

// The top bar pads for the status bar itself; nothing covers the bottom or
// the sides of the content below it.
const topBarChrome = { coversTop: true, coversBottom: false, coversLeft: false };

// Preview approximation of the iPad tab bar for the iOS look on Android
// windows >= 600dp: a floating capsule at the top with a toolbar search field
// at the trailing end (so the search route has no trigger). It does not
// expand into the sidebar.
export function FloatingTabBarLayout() {
  const { colors, radii, spacing } = useBerean();
  const insets = useSafeAreaInsets();
  return (
    <TabChromeContext.Provider value={topBarChrome}>
      <Tabs style={[styles.root, { backgroundColor: colors.surface }]}>
        {/* Route definitions only; the capsule below draws the tabs, since
            TabList must be a direct child of Tabs. */}
        <TabList style={styles.hidden}>
          {destinations.map(({ name, href }) => (
            <TabTrigger key={name} name={name} href={href} />
          ))}
        </TabList>
        <View
          style={[
            styles.row,
            {
              paddingTop: insets.top + spacing.sm,
              paddingBottom: spacing.sm,
              paddingLeft: insets.left + spacing.lg,
              paddingRight: insets.right + spacing.lg,
              gap: spacing.md,
            },
          ]}
        >
          <View style={styles.side} />
          <View
            style={[
              styles.capsule,
              {
                backgroundColor: colors.surfaceRaised,
                borderColor: colors.separator,
                borderRadius: radii.capsule,
                padding: spacing.xs,
              },
            ]}
          >
            {destinations.map(({ name, label }) => (
              <FloatingTab key={name} name={name} label={label} />
            ))}
          </View>
          <View style={[styles.side, styles.trailing]}>
            <ToolbarSearchField />
          </View>
        </View>
        <TabSlot />
      </Tabs>
    </TabChromeContext.Provider>
  );
}

function FloatingTab({ name, label }: { name: string; label: string }) {
  const { colors, spacing } = useBerean();
  const { triggerProps } = useTabTrigger({ name });
  const { isFocused, onPress, onLongPress } = triggerProps;
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: isFocused }}
      onPress={onPress}
      onLongPress={onLongPress}
      style={[styles.tab, { paddingHorizontal: spacing.lg }]}
    >
      <UIText
        numberOfLines={1}
        style={isFocused ? { color: colors.accent, fontWeight: '600' } : undefined}
      >
        {label}
      </UIText>
    </Pressable>
  );
}

function ToolbarSearchField() {
  const { colors, radii, spacing } = useBerean();
  return (
    <Pressable
      accessibilityRole="search"
      accessibilityLabel="Search Berean"
      onPress={() => router.push('/search')}
      style={[
        styles.search,
        {
          backgroundColor: colors.surfaceRaised,
          borderColor: colors.separator,
          borderRadius: radii.capsule,
          paddingHorizontal: spacing.md,
          gap: spacing.sm,
        },
      ]}
    >
      <SearchIcon color={colors.textSecondary} size={17} />
      <UIText secondary numberOfLines={1} style={styles.searchLabel}>
        Search
      </UIText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  hidden: { display: 'none' },
  row: { flexDirection: 'row', alignItems: 'center' },
  side: { flex: 1, minWidth: 0 },
  trailing: { alignItems: 'flex-end' },
  capsule: { flexDirection: 'row', borderWidth: hairline },
  tab: { minHeight: 44, justifyContent: 'center' },
  search: {
    minHeight: 44,
    width: '100%',
    maxWidth: 240,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: hairline,
  },
  searchLabel: { flexShrink: 1 },
});
