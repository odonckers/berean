import type { ComponentProps, ReactNode } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';

import { useContentInsets } from '@/design/tab-chrome';
import { useBerean } from '@/design/theme';
import { readingColumnPadding, readingMeasure, spacing } from '@/design/tokens';

// ReadingColumn's top padding: the column's y in the scroll content. A tab
// root follows the look's stack options, which may hide the native header,
// so it also pads for the status bar there; pushed screens keep the header.
export function useColumnPaddingTop(tabRoot: boolean): number {
  const insets = useContentInsets();
  return (tabRoot ? insets.top : 0) + spacing.lg;
}

/** A scrolling surface with the reading column: capped at the measure, centered. */
export function ReadingColumn({
  children,
  tabRoot = false,
  ...scrollProps
}: { children: ReactNode; tabRoot?: boolean } & Pick<
  ComponentProps<typeof ScrollView>,
  'ref' | 'onScroll' | 'onScrollEndDrag' | 'onMomentumScrollEnd' | 'onLayout' | 'scrollEventThrottle'
>) {
  const { look, colors } = useBerean();
  const { fontScale } = useWindowDimensions();
  const insets = useContentInsets();
  const paddingTop = useColumnPaddingTop(tabRoot);
  const measure = readingMeasure * fontScale;
  const padding = readingColumnPadding[look];
  return (
    <ScrollView
      {...scrollProps}
      style={{ backgroundColor: colors.surface }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{
        paddingTop,
        paddingBottom: insets.bottom + spacing.lg,
        paddingLeft: insets.left + padding,
        paddingRight: insets.right + padding,
      }}
    >
      <View style={[styles.column, { maxWidth: measure }]}>{children}</View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  column: { width: '100%', alignSelf: 'center', gap: spacing.md },
});
