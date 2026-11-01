import { type ComponentRef, useEffect, useRef } from 'react';
import {
  I18nManager,
  Modal,
  Platform,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  type TargetedEvent,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScaledSymbol } from '@/components/scaled-symbol';
import { UIText } from '@/components/text';
import { TextButton } from '@/components/text-button';
import { systemBarStyle, useBerean } from '@/design/theme';
import { hairline, radii, spacing } from '@/design/tokens';
import type { Anchor, SymbolName } from '@/notes/list-rows';
import { type MenuEdge, menuPlacement } from '@/notes/menu-placement';
import { sheetItemInk, sheetSurface } from '@/notes/sheet-colors';
import { moveAccessibilityFocus } from '@/reader/study-pane';
import { followFocusRingIn } from '../../modules/berean-shortcuts';
import { ModalNavigationBarStyle } from '../../modules/berean-system-bars';

export type SheetItem = {
  key: string;
  label: string;
  icon?: SymbolName;
  destructive?: boolean;
  /** Indent steps, for a folder picker's tree. */
  depth?: number;
  /** Marked with a check (the folder something is in now). */
  current?: boolean;
  accessibilityLabel?: string;
  onPress: () => void;
};

type ActionSheetProps = {
  visible: boolean;
  title: string;
  items: readonly SheetItem[];
  /** Material look: open as an M3 menu at this button instead of a bottom sheet. */
  anchor?: Anchor;
  /** The anchor's edge the menu lines up with: 'start' for a dropdown, 'end' (default) for an overflow ⋮. */
  anchorEdge?: MenuEdge;
  onClose: () => void;
};

// The sheet is a Modal, its own window, outside the root's focus ring.
const followRing = (e: NativeSyntheticEvent<TargetedEvent>) => followFocusRingIn(e.nativeEvent.target);

const hidden = {
  accessible: false,
  importantForAccessibility: 'no-hide-descendants',
  accessibilityElementsHidden: true,
} as const;

const MENU_ITEM = 48;
const MENU_WIDTH = 224;

/**
 * A row's context menu, or a Move to… folder picker. A long press opens it
 * as a sheet: iOS look, a compact sheet on the raised surface with Cancel;
 * Material, an M3 bottom sheet with a drag handle and one-line list items.
 * Material's overflow ⋮ opens it as an M3 menu under the button.
 */
export function ActionSheet({ visible, title, items, anchor, anchorEdge = 'end', onClose }: ActionSheetProps) {
  const { look, scheme, colors, m3, type } = useBerean();
  const material = look === 'material';
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();

  const titleRef = useRef<ComponentRef<typeof Text>>(null);
  const firstRef = useRef<ComponentRef<typeof Pressable>>(null);
  useEffect(() => {
    if (!visible) return;
    // A screen reader lands on the title (a sheet) or the first item (a menu).
    const frame = requestAnimationFrame(() =>
      moveAccessibilityFocus(anchor && material ? firstRef.current : titleRef.current),
    );
    return () => cancelAnimationFrame(frame);
  }, [visible, anchor, material]);

  // The chosen item runs once the sheet has gone: iOS won't present an
  // alert or another Modal while one is still dismissing, so there it waits
  // for onDismiss. Android dismisses at once.
  const pending = useRef<(() => void) | undefined>(undefined);
  const runPending = () => {
    const run = pending.current;
    pending.current = undefined;
    run?.();
  };
  const choose = (item: SheetItem) => {
    pending.current = item.onPress;
    onClose();
    if (Platform.OS !== 'ios') setTimeout(runPending, 0);
  };

  const check = (item: SheetItem) =>
    item.current ? (
      <ScaledSymbol
        name={{ ios: 'checkmark', android: 'check' }}
        size={20}
        tintColor={material ? m3.primary : colors.accent}
        {...hidden}
      />
    ) : null;

  const row = (item: SheetItem, index: number, menu: boolean) => {
    const ink = sheetItemInk(look, item.destructive === true, menu, colors, m3);
    const iconInk = material && item.destructive && menu ? m3.error : m3.onSurfaceVariant;
    return (
      <Pressable
        key={item.key}
        ref={index === 0 ? firstRef : undefined}
        accessibilityRole={menu ? 'menuitem' : 'button'}
        accessibilityLabel={item.accessibilityLabel ?? item.label}
        accessibilityState={item.current === undefined ? undefined : { selected: item.current }}
        onPress={() => choose(item)}
        onFocus={followRing}
        android_ripple={material ? { color: colors.separator } : undefined}
        style={({ pressed }) => [
          menu ? styles.menuItem : material ? styles.materialItem : styles.iosRow,
          !menu && !material && index > 0 && { borderTopWidth: hairline, borderTopColor: colors.separator },
          { paddingStart: (menu ? spacing.md : 0) + (item.depth ?? 0) * spacing.lg },
          !material && { opacity: pressed ? 0.6 : 1 },
        ]}
      >
        {material && item.icon !== undefined && (
          <ScaledSymbol name={item.icon} size={24} tintColor={iconInk} {...hidden} />
        )}
        <UIText numberOfLines={1} style={[styles.label, { color: ink }]}>
          {item.label}
        </UIText>
        {check(item)}
      </Pressable>
    );
  };

  if (anchor && material) {
    // Under the anchor, lined up with its `anchorEdge`; above it when
    // there's no room below.
    const { top, left } = menuPlacement({
      anchor,
      edge: anchorEdge,
      menu: { width: MENU_WIDTH, height: items.length * MENU_ITEM + spacing.sm * 2 },
      window,
      insets,
      margin: spacing.sm,
      rtl: I18nManager.isRTL,
    });
    // `left` is the window's left; right to left, React Native reads a style's left as start.
    const across = I18nManager.isRTL && I18nManager.doLeftAndRightSwapInRTL ? { right: left } : { left };
    return (
      <Modal visible={visible} transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose} onDismiss={runPending}>
        <ModalNavigationBarStyle barStyle={systemBarStyle(scheme)} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close menu"
          onPress={onClose}
          onFocus={followRing}
          style={StyleSheet.absoluteFill}
        />
        <View
          accessibilityViewIsModal
          accessibilityRole="menu"
          accessibilityLabel={title}
          style={[styles.menu, { top, ...across, backgroundColor: sheetSurface(look, colors, m3) }]}
        >
          {items.map((item, i) => row(item, i, true))}
        </View>
      </Modal>
    );
  }

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose} onDismiss={runPending}>
      <ModalNavigationBarStyle barStyle={systemBarStyle(scheme)} />
      <View style={styles.root}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
          onFocus={followRing}
          style={[StyleSheet.absoluteFill, { backgroundColor: material ? m3.scrim : m3.scrimWarm }]}
        />
        <View
          accessibilityViewIsModal
          style={[
            styles.sheet,
            {
              maxHeight: window.height * 0.8,
              backgroundColor: sheetSurface(look, colors, m3),
              borderTopLeftRadius: material ? radii.sheet : radii.studyPane,
              borderTopRightRadius: material ? radii.sheet : radii.studyPane,
              paddingBottom: insets.bottom + spacing.lg,
            },
          ]}
        >
          {material && <View style={[styles.handle, { backgroundColor: m3.onSurfaceVariant }]} />}
          <View style={styles.header}>
            <Text
              ref={titleRef}
              accessibilityRole="header"
              numberOfLines={1}
              style={[
                material ? type.ui.title : styles.iosTitle,
                styles.title,
                { color: material ? m3.onSurface : colors.text },
              ]}
            >
              {title}
            </Text>
            {!material && <TextButton title="Cancel" onPress={onClose} onFocus={followRing} />}
          </View>
          <ScrollView>{items.map((item, i) => row(item, i, false))}</ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  handle: { alignSelf: 'center', width: 32, height: 4, borderRadius: 2, marginVertical: spacing.sm, opacity: 0.4 },
  header: { flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: spacing.sm },
  title: { flex: 1 },
  iosTitle: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
  label: { flex: 1 },
  iosRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  materialItem: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  // M3 menu: extra-small corners, 48dp items, elevation 2.
  menu: {
    position: 'absolute',
    minWidth: 112,
    width: MENU_WIDTH,
    paddingVertical: spacing.sm,
    borderRadius: 4,
    elevation: 2,
  },
  menuItem: {
    minHeight: MENU_ITEM,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingEnd: spacing.md,
  },
});
