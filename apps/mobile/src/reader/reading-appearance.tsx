import { useFocusEffect } from 'expo-router';
import { type ComponentRef, type ReactNode, type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { PopoverCard, SheetCloseButton, SheetHandle, SlidingSheet, useSheetChrome } from '@/components/sheet';
import { AppearanceGroups } from '@/design/appearance-groups';
import { QUICK_PICKER_WIDTH, quickPickerLayout, quickPickerPlacement, sheetHeight } from '@/design/quick-picker';
import { sideSheetEdge } from '@/design/chrome';
import { useContentInsets } from '@/design/tab-chrome';
import { useBerean, useSolidChrome } from '@/design/theme';
import { hairline, radii, spacing } from '@/design/tokens';
import { useWindowClass } from '@/design/use-window-class';
import { moveAccessibilityFocus } from '@/reader/study-pane';

// The reader's Aa quick picker (themes spec §4, rule 12, F01, F04): the
// Appearance groups over the live reader, so the reader is the preview and
// every tap applies at once (no Done or Apply).
//
// It is drawn in the reader's own view rather than as a native modal, so
// there is no scrim and the reader above or beside it stays live:
// - phone, material look: an M3 standard bottom sheet with a drag handle;
//   drag down or Back closes it.
// - phone, iOS look: a sheet at the medium detent (large at large text)
//   with a close button; drag down closes it too.
// - wider, material look: a trailing side sheet; the reading column reflows.
// - wider, iOS look: a popover card anchored under the Aa button.
// Opening and closing slide where motion is allowed; under Reduce Motion
// the sheet just appears and goes. Escape reaches Back on Android.

export const READING_APPEARANCE_TITLE = 'Reading appearance';

type ButtonRef = RefObject<ComponentRef<typeof View> | null>;

/** The reader's Aa button: monochrome (rule 6), a 48dp / 44pt target. */
export function AaButton({ buttonRef, onPress }: { buttonRef: ButtonRef; onPress: () => void }) {
  const { look, colors, m3, type } = useBerean();
  const material = look === 'material';
  const target = material ? 48 : 44;
  return (
    <Pressable
      ref={buttonRef}
      accessibilityRole="button"
      accessibilityLabel="Reading appearance"
      onPress={onPress}
      style={({ pressed }) => [
        styles.aa,
        { minWidth: target, minHeight: target, opacity: pressed ? 0.6 : 1 },
      ]}
    >
      <Text
        style={[type.ui.body, styles.aaText, { color: material ? m3.onSurfaceVariant : colors.text }]}
      >
        Aa
      </Text>
    </Pressable>
  );
}

/** Whether the Aa picker is open, and the ref for the button it anchors to. */
export function useReadingAppearance() {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<ComponentRef<typeof View>>(null);
  const toggle = useCallback(() => setOpen((was) => !was), []);
  const close = useCallback(() => setOpen(false), []);
  return { open, toggle, close, buttonRef };
}

type HostProps = {
  open: boolean;
  onClose: () => void;
  buttonRef: ButtonRef;
  children: ReactNode;
};

/**
 * Wraps a reader screen. The reader keeps one place in the tree whether
 * the picker is open or not, so opening it never remounts the reader or
 * loses its scroll.
 */
export function ReadingAppearanceHost({ open, onClose, buttonRef, children }: HostProps) {
  const { look } = useBerean();
  const windowClass = useWindowClass();
  const placement = quickPickerPlacement(look, windowClass);
  const host = useRef<ComponentRef<typeof View>>(null);
  const [area, setArea] = useState<{ width: number; height: number }>();
  const [anchor, setAnchor] = useState<{ top: number; right: number }>();

  // Back (and Escape, which Android maps to it) closes the picker first.
  useFocusEffect(
    useCallback(() => {
      if (!open) return;
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        onClose();
        return true;
      });
      return () => subscription.remove();
    }, [open, onClose]),
  );

  // The popover hangs under the Aa button, wherever the header put it.
  useEffect(() => {
    if (!open || placement !== 'popover') return;
    buttonRef.current?.measureInWindow((x, y, width, height) => {
      host.current?.measureInWindow((hx, hy, hostWidth) => {
        setAnchor({ top: Math.max(0, y + height - hy) + spacing.xs, right: Math.max(spacing.sm, hx + hostWidth - (x + width)) });
      });
    });
  }, [open, placement, buttonRef]);

  // A screen reader moves to the picker's title as it opens, and back to
  // the Aa button as it closes.
  const wasOpen = useRef(open);
  useEffect(() => {
    if (wasOpen.current && !open) {
      const frame = requestAnimationFrame(() => moveAccessibilityFocus(buttonRef.current));
      wasOpen.current = open;
      return () => cancelAnimationFrame(frame);
    }
    wasOpen.current = open;
  }, [open, buttonRef]);

  return (
    <View
      ref={host}
      style={styles.row}
      onLayout={(e) => setArea({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
    >
      <View style={styles.fill}>{children}</View>
      {area !== undefined && placement === 'sideSheet' && open && <SideSheet onClose={onClose} />}
      {area !== undefined && (placement === 'bottomSheet' || placement === 'sheet') && (
        <BottomSheet open={open} onClose={onClose} area={area} />
      )}
      {area !== undefined && placement === 'popover' && open && (
        <>
          {/* A tap outside the popover, on the reader, closes it. */}
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessible={false} />
          <Popover onClose={onClose} area={area} anchor={anchor} />
        </>
      )}
    </View>
  );
}

/** "Reading appearance", where a screen reader lands as the picker opens. */
function Title() {
  const { colors, type } = useBerean();
  const ref = useRef<ComponentRef<typeof Text>>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => moveAccessibilityFocus(ref.current));
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <Text ref={ref} accessibilityRole="header" style={[type.ui.title, styles.title, { color: colors.text }]}>
      {READING_APPEARANCE_TITLE}
    </Text>
  );
}

function BottomSheet({
  open,
  onClose,
  area,
}: {
  open: boolean;
  onClose: () => void;
  area: { width: number; height: number };
}) {
  const { look, type } = useBerean();
  const { material, background, edge } = useSheetChrome();
  const { fontScale } = useWindowDimensions();
  const insets = useContentInsets();
  const { layout, detent, accentGrid } = quickPickerLayout(area.width - 2 * spacing.lg, fontScale, look);
  const height = sheetHeight(detent, {
    areaHeight: area.height,
    topInset: insets.top,
    lineHeight: (type.reading.scripture.lineHeight ?? 0) * fontScale,
  });

  return (
    <SlidingSheet
      open={open}
      onClose={onClose}
      height={height}
      style={[
        styles.sheetEdges,
        { backgroundColor: background, borderTopLeftRadius: radii.sheet, borderTopRightRadius: radii.sheet },
        edge,
      ]}
      header={
        <>
          <SheetHandle onClose={onClose} />
          <View style={styles.header}>
            <Title />
            {!material && <SheetCloseButton onClose={onClose} />}
          </View>
        </>
      }
    >
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + spacing.lg }]}
      >
        <AppearanceGroups layout={layout} accentGrid={accentGrid} sections="plain" />
      </ScrollView>
    </SlidingSheet>
  );
}

function SideSheet({ onClose }: { onClose: () => void }) {
  const { look, colors, m3 } = useBerean();
  const { fontScale } = useWindowDimensions();
  const insets = useContentInsets();
  const { background } = useSheetChrome();
  const solid = useSolidChrome();
  const { layout, accentGrid } = quickPickerLayout(QUICK_PICKER_WIDTH - 2 * spacing.lg, fontScale, look);
  return (
    <View
      onAccessibilityEscape={onClose}
      style={[
        { width: QUICK_PICKER_WIDTH + insets.right, paddingRight: insets.right, backgroundColor: background },
        sideSheetEdge(solid, colors, m3, hairline),
      ]}
    >
      <View style={[styles.header, styles.sideHeader]}>
        <Title />
        <SheetCloseButton onClose={onClose} />
      </View>
      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + spacing.lg }]}>
        <AppearanceGroups layout={layout} accentGrid={accentGrid} sections="plain" />
      </ScrollView>
    </View>
  );
}

function Popover({
  onClose,
  area,
  anchor,
}: {
  onClose: () => void;
  area: { width: number; height: number };
  anchor?: { top: number; right: number };
}) {
  const { look } = useBerean();
  const { fontScale } = useWindowDimensions();
  const width = Math.min(QUICK_PICKER_WIDTH, area.width - 2 * spacing.lg);
  const { layout, accentGrid } = quickPickerLayout(width - 2 * spacing.lg, fontScale, look);
  // Until the button is measured it hangs from the top trailing corner,
  // where the Aa button is.
  const top = anchor?.top ?? spacing.sm;
  const right = Math.min(anchor?.right ?? spacing.lg, area.width - width - spacing.sm);
  return (
    <PopoverCard
      top={top}
      right={right}
      width={width}
      maxHeight={area.height - top - spacing.lg}
      radius={radii.studyPane}
      onClose={onClose}
    >
      <View style={[styles.header, styles.sideHeader]}>
        <Title />
        <SheetCloseButton onClose={onClose} />
      </View>
      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: spacing.lg }]}>
        <AppearanceGroups layout={layout} accentGrid={accentGrid} sections="plain" />
      </ScrollView>
    </PopoverCard>
  );
}

const styles = StyleSheet.create({
  row: { flex: 1, flexDirection: 'row' },
  fill: { flex: 1 },
  aa: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.sm },
  aaText: { fontWeight: '600' },
  sheetEdges: { left: 0, right: 0 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  sideHeader: { paddingTop: spacing.md, paddingRight: spacing.sm },
  title: { flex: 1 },
  body: { paddingHorizontal: spacing.lg, gap: spacing.xl },
});
