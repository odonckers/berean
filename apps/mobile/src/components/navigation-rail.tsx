import { TabList, TabSlot, TabTrigger, Tabs, type TabTriggerSlotProps } from 'expo-router/ui';
import { SymbolView, type AndroidSymbol } from 'expo-symbols';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { UIText } from '@/components/text';
import { TabChromeContext, destinations } from '@/design/tab-chrome';
import { useBerean } from '@/design/theme';

// The rail covers neither system bar inset for the content beside it.
const railChrome = { coversTop: false, coversBottom: false };

// M3 navigation rail: material look, Android windows >= 600dp. NativeTabs
// has no rail on Android, so this is expo-router's headless tabs. Search
// lives in the top app bar here, so the search route has no trigger.
export function NavigationRailLayout() {
  const { m3, spacing } = useBerean();
  const insets = useSafeAreaInsets();
  return (
    <TabChromeContext.Provider value={railChrome}>
      <Tabs style={styles.root}>
        <TabList asChild>
          {/* Solid surfaceContainer, never translucent. The menu button and
              FAB arrive with the Notes and Reader rows. */}
          <View
            style={{
              ...styles.rail,
              backgroundColor: m3.surfaceContainer,
              width: RAIL_WIDTH + insets.left,
              paddingLeft: insets.left,
              paddingTop: insets.top + spacing.md,
              paddingBottom: insets.bottom,
              gap: spacing.md,
            }}
          >
            {destinations.map(({ name, href, label, md }) => (
              <TabTrigger key={name} name={name} href={href} asChild>
                <RailItem label={label} icon={md} />
              </TabTrigger>
            ))}
          </View>
        </TabList>
        <TabSlot />
      </Tabs>
    </TabChromeContext.Provider>
  );
}

type RailItemProps = Pick<TabTriggerSlotProps, 'isFocused' | 'onPress' | 'onLongPress'> & {
  label: string;
  icon: AndroidSymbol;
};

// TabTrigger (asChild) passes isFocused and the press handlers.
function RailItem({ label, icon, isFocused = false, onPress, onLongPress }: RailItemProps) {
  const { m3, radii, spacing } = useBerean();
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: isFocused }}
      onPress={onPress}
      onLongPress={onLongPress}
      style={[styles.item, { gap: spacing.xs }]}
    >
      <View
        style={[
          styles.indicator,
          {
            borderRadius: radii.capsule,
            backgroundColor: isFocused ? m3.secondaryContainer : undefined,
          },
        ]}
      >
        <SymbolView
          name={{ android: icon }}
          size={24}
          tintColor={isFocused ? m3.onSecondaryContainer : m3.onSurfaceVariant}
          accessible={false}
          importantForAccessibility="no-hide-descendants"
        />
      </View>
      <UIText
        variant="label"
        numberOfLines={1}
        style={
          isFocused ? { color: m3.onSurface, fontWeight: '700' } : { color: m3.onSurfaceVariant }
        }
      >
        {label}
      </UIText>
    </Pressable>
  );
}

const RAIL_WIDTH = 80;

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row' },
  rail: { flexDirection: 'column', justifyContent: 'flex-start', alignItems: 'center' },
  item: { width: RAIL_WIDTH, minHeight: 56, alignItems: 'center' },
  indicator: { width: 56, height: 32, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
