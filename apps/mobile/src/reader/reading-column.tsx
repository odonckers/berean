import type { ComponentProps, ReactNode } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';

import { useContentInsets } from '@/design/tab-chrome';
import { useBerean } from '@/design/theme';
import { readingColumnPadding, readingMeasure, spacing } from '@/design/tokens';

// ReadingColumn's top padding: the column's y in the scroll content.
export const CONTENT_PADDING_TOP = spacing.lg;

/** A scrolling surface with the reading column: capped at the measure, centered. */
export function ReadingColumn({
  children,
  ...scrollProps
}: { children: ReactNode } & Pick<
  ComponentProps<typeof ScrollView>,
  'ref' | 'onScroll' | 'onLayout' | 'scrollEventThrottle'
>) {
  const { look, colors } = useBerean();
  const { fontScale } = useWindowDimensions();
  const insets = useContentInsets();
  const measure = readingMeasure * fontScale;
  const padding = readingColumnPadding[look];
  return (
    <ScrollView
      {...scrollProps}
      style={{ backgroundColor: colors.surface }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{
        paddingTop: CONTENT_PADDING_TOP,
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
