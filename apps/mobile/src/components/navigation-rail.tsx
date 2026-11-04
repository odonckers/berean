import { TabList, TabSlot, TabTrigger, Tabs, type TabTriggerSlotProps } from 'expo-router/ui';
import { SymbolView, type AndroidSymbol } from 'expo-symbols';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { UIText } from '@/components/text';
import { TabChromeContext, destinations } from '@/design/tab-chrome';
import { TAB_LABEL_MAX_SCALE } from '@/design/tab-label';
import { useBerean } from '@/design/theme';

// The rail covers neither system bar inset for the content beside it, but
// takes the left inset into its own width.
const railChrome = { coversTop: false, coversBottom: false, coversLeft: true };

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
  const { fontScale } = useWindowDimensions();
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
        {/* M3 rail icons stay 24dp. expo-symbols draws Android glyphs as
            Text at `size`, which the font scale enlarges, so ask for 24 / fontScale
            inside a fixed 24dp box. */}
        <SymbolView
          name={{ android: icon }}
          size={24 / fontScale}
          style={styles.icon}
          tintColor={isFocused ? m3.onSecondaryContainer : m3.onSurfaceVariant}
          accessible={false}
          importantForAccessibility="no-hide-descendants"
        />
      </View>
      {/* Capped like the bar's labels (tab-label.ts); where 1.3× still
          overflows the 80dp rail, the label shrinks to fit rather than truncate. */}
      <UIText
        variant="label"
        numberOfLines={1}
        maxFontSizeMultiplier={TAB_LABEL_MAX_SCALE}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
        style={
          isFocused ? { color: m3.onSurface, fontWeight: '700' } : { color: m3.onSurfaceVariant }
        }
      >
        {label}
      </UIText>
    </Pressable>
  );
}

// The rail's width before the left inset; headers beside it are this much
// narrower than the window (the Library header's fit check).
export const RAIL_WIDTH = 80;

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row' },
  rail: { flexDirection: 'column', justifyContent: 'flex-start', alignItems: 'center' },
  item: { width: RAIL_WIDTH, minHeight: 56, alignItems: 'center' },
  indicator: { width: 56, height: 32, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  icon: { width: 24, height: 24 },
});
