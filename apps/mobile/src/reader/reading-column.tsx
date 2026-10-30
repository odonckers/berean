import type { ComponentProps, ReactNode } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { type NativeGesture, ScrollView } from 'react-native-gesture-handler';

import { useContentInsets } from '@/design/tab-chrome';
import { useBerean } from '@/design/theme';
import { readingColumnPadding, readingMeasure, spacing } from '@/design/tokens';
import { edgeFade } from '@/reader/edge-fade';

// ReadingColumn's top padding: the column's y in the scroll content. A tab
// root follows the look's stack options, which may hide the native header,
// so it also pads for the status bar there; pushed screens keep the header.
export function useColumnPaddingTop(tabRoot: boolean): number {
  const insets = useContentInsets();
  return (tabRoot ? insets.top : 0) + spacing.lg;
}

/**
 * A scrolling surface with the reading column: capped at the measure, centered.
 * The ScrollView is Gesture Handler's, so gestures in the column (the study
 * pane's resize drag) can take part in arbitration with the scroll; a plain
 * React Native ScrollView is invisible to Gesture Handler. onScrollGesture
 * hands out the scroll's native gesture for those relations.
 */
export function ReadingColumn({
  children,
  tabRoot = false,
  onScrollGesture,
  leadingGutter = 0,
  ...scrollProps
}: {
  children: ReactNode;
  tabRoot?: boolean;
  onScrollGesture?: (gesture: NativeGesture) => void;
  /** A leading margin for note markers: the padding is at least this wide. */
  leadingGutter?: number;
} & Pick<
  ComponentProps<typeof ScrollView>,
  'ref' | 'onScroll' | 'onScrollEndDrag' | 'onMomentumScrollEnd' | 'onLayout' | 'scrollEventThrottle'
>) {
  const { look, colors } = useBerean();
  const { fontScale } = useWindowDimensions();
  const insets = useContentInsets();
  const paddingTop = useColumnPaddingTop(tabRoot);
  const measure = readingMeasure * fontScale;
  const padding = readingColumnPadding[look];
  const scroll = (
    <ScrollView
      {...scrollProps}
      onGestureUpdate_CAN_CAUSE_INFINITE_RERENDER={onScrollGesture}
      style={{ backgroundColor: colors.surface }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{
        paddingTop,
        paddingBottom: insets.bottom + spacing.lg,
        paddingLeft: insets.left + Math.max(padding, leadingGutter),
        paddingRight: insets.right + padding,
      }}
    >
      <View style={[styles.column, { maxWidth: measure }]}>{children}</View>
    </ScrollView>
  );
  if (!tabRoot || look !== 'ios') return scroll;
  // The iOS look's tab root hides the native header, so scrolled text would
  // sit under the status bar: the surface, solid over its inset and fading
  // out over the 8 below, a sibling over the scroll so the content's layout
  // is untouched. On real iOS this becomes the system scroll-edge effect;
  // this fade is for the preview look, where nothing covers the status bar.
  // Wrapped whenever the look is iOS, so an inset change (rotation) doesn't
  // remount the scroll.
  return (
    <View style={styles.fill}>
      {scroll}
      {insets.top > 0 && (
        <View
          pointerEvents="none"
          style={[
            styles.edge,
            { height: insets.top + 8, backgroundImage: edgeFade(colors.surface, insets.top) },
          ]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  column: { width: '100%', alignSelf: 'center', gap: spacing.md },
  fill: { flex: 1 },
  edge: { position: 'absolute', top: 0, left: 0, right: 0 },
});
