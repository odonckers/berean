import { useNavigation } from 'expo-router';
import { useLayoutEffect, useState, type ReactNode } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import { AppBarSearchBar, DockedSearchBar } from '@/components/search-bar';
import { UIText } from '@/components/text';
import { useContentInsets, useHeaderHidden } from '@/design/tab-chrome';
import { useBerean } from '@/design/theme';
import { useWindowClass } from '@/design/use-window-class';

type ScreenProps = {
  title: string;
  children: ReactNode;
  // Material look only: a docked search bar on phones, a search bar in the
  // top app bar on tablets.
  search?: boolean;
  // Max width of a centered content column; the inline large title is
  // capped and centered to match it.
  measure?: number;
};

// Scroll content on a solid surface.
export function Screen({ title, children, search = false, measure }: ScreenProps) {
  const { look, colors, m3, spacing } = useBerean();
  const windowClass = useWindowClass();
  const navigation = useNavigation();
  const [scrolled, setScrolled] = useState(false);
  const insets = useContentInsets();

  const material = look === 'material';
  const docked = material && search && windowClass === 'compact';
  const appBarSearch = material && search && windowClass !== 'compact';
  // With the native header hidden, the large title is drawn in the content.
  const inlineLargeTitle = useHeaderHidden();

  useLayoutEffect(() => {
    // M3: the top app bar picks up a tonal fill once content scrolls under it.
    // Cleared again in the iOS look so a runtime Look switch leaves nothing behind.
    navigation.setOptions({
      headerStyle: material
        ? { backgroundColor: scrolled ? m3.surfaceContainer : m3.surface }
        : undefined,
      headerRight: appBarSearch ? () => <AppBarSearchBar /> : undefined,
    });
  }, [navigation, material, scrolled, appBarSearch, m3]);

  const updateScrolled = (e: NativeSyntheticEvent<NativeScrollEvent>) =>
    setScrolled(e.nativeEvent.contentOffset.y > 0);

  return (
    <>
      <ScrollView
        style={[styles.scroll, { backgroundColor: colors.surface }]}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          padding: spacing.lg,
          paddingTop: insets.top + spacing.lg,
          paddingBottom: insets.bottom + spacing.lg,
          gap: spacing.md,
        }}
        scrollEventThrottle={16}
        // Tracked in both looks so the fill is right after a Look switch.
        // Also re-checked when a drag or fling ends: the last throttled
        // onScroll of a fast fling to the top can still report y > 0.
        onScroll={updateScrolled}
        onScrollEndDrag={updateScrolled}
        onMomentumScrollEnd={updateScrolled}
      >
        {inlineLargeTitle &&
          (measure ? (
            <View style={[styles.measure, { maxWidth: measure }]}>
              <UIText variant="largeTitle">{title}</UIText>
            </View>
          ) : (
            <UIText variant="largeTitle">{title}</UIText>
          ))}
        {children}
      </ScrollView>
      {docked && <DockedSearchBar />}
    </>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  measure: { width: '100%', alignSelf: 'center' },
});
