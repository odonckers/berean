import type { SymbolViewProps } from 'expo-symbols';
import { type ComponentRef, type ReactNode, useRef } from 'react';
import {
  type AccessibilityActionEvent,
  type AccessibilityActionInfo,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';

import { ScaledSymbol } from '@/components/scaled-symbol';
import { UIText } from '@/components/text';
import { useBerean } from '@/design/theme';
import { hairline, spacing } from '@/design/tokens';
import { swipeActionColors } from '@/notes/sheet-colors';

export type SymbolName = SymbolViewProps['name'];

/** Where a menu opens from: the window frame of the button that opened it. */
export type Anchor = { x: number; y: number; width: number; height: number };

const hidden = {
  accessible: false,
  importantForAccessibility: 'no-hide-descendants',
  accessibilityElementsHidden: true,
} as const;

/**
 * A list section. iOS look: an inset grouped list, its caption header over
 * a rounded group on the raised surface. Material: an M3 list subheader over
 * full-width list items.
 */
export function ListSection({ title, children }: { title?: string; children: ReactNode }) {
  const { look, colors, m3 } = useBerean();
  if (look === 'material') {
    return (
      <View>
        {title !== undefined && (
          <UIText accessibilityRole="header" style={[styles.materialHeader, { color: m3.onSurfaceVariant }]}>
            {title}
          </UIText>
        )}
        {children}
      </View>
    );
  }
  return (
    <View style={styles.iosSection}>
      {title !== undefined && (
        <UIText accessibilityRole="header" variant="caption" secondary style={styles.iosHeader}>
          {title.toUpperCase()}
        </UIText>
      )}
      <View style={[styles.iosGroup, { backgroundColor: colors.surfaceRaised }]}>{children}</View>
    </View>
  );
}

type ListRowProps = {
  label: string;
  icon?: SymbolName;
  /** Trailing supporting text on the title line: a count, a date. */
  detail?: string;
  /** A second line under the label. */
  children?: ReactNode;
  /** Not the group's first row: the iOS look draws a separator above it. */
  separated?: boolean;
  chevron?: boolean;
  accent?: boolean;
  /** The row whose note is open beside the list (list-detail). */
  selected?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  /** Material look: a trailing overflow ⋮ that opens the row's menu there. */
  onMenu?: (anchor: Anchor) => void;
  menuLabel?: string;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityActions?: readonly AccessibilityActionInfo[];
  onAccessibilityAction?: (event: AccessibilityActionEvent) => void;
};

/**
 * One row. iOS look: 44pt, a separator inset to the label, a chevron where
 * it drills in. Material: an M3 list item, 56dp, a leading icon 16dp from
 * the label, trailing supporting text, and the overflow ⋮ as a 48dp target.
 */
export function ListRow({
  label,
  icon,
  detail,
  children,
  separated = false,
  chevron = false,
  accent = false,
  selected,
  onPress,
  onLongPress,
  onMenu,
  menuLabel,
  accessibilityLabel,
  accessibilityHint,
  accessibilityActions,
  onAccessibilityAction,
}: ListRowProps) {
  const { look, colors, m3 } = useBerean();
  const material = look === 'material';
  const menuRef = useRef<ComponentRef<typeof Pressable>>(null);
  const labelColor = accent ? (material ? m3.primary : colors.accent) : material ? m3.onSurface : colors.text;
  const iconColor = accent ? labelColor : material ? m3.onSurfaceVariant : colors.accent;

  const openMenu = () =>
    menuRef.current?.measureInWindow((x, y, width, height) => onMenu?.({ x, y, width, height }));

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (detail ? `${label}, ${detail}` : label)}
      accessibilityHint={accessibilityHint}
      accessibilityState={selected === undefined ? undefined : { selected }}
      accessibilityActions={accessibilityActions ? [...accessibilityActions] : undefined}
      onAccessibilityAction={onAccessibilityAction}
      onPress={onPress}
      onLongPress={onLongPress}
      android_ripple={material ? { color: colors.separator } : undefined}
      style={({ pressed }) => [
        material ? styles.materialRow : styles.iosRow,
        { backgroundColor: material ? m3.surface : colors.surfaceRaised },
        selected && { backgroundColor: material ? m3.secondaryContainer : colors.separator },
        !material && pressed && { backgroundColor: colors.separator },
      ]}
    >
      {icon !== undefined && (
        <ScaledSymbol name={icon} size={material ? 24 : 22} tintColor={iconColor} {...hidden} />
      )}
      <View
        style={[
          styles.body,
          !material && separated && { borderTopWidth: hairline, borderTopColor: colors.separator },
        ]}
      >
        <View style={styles.text}>
          {/* The detail and ⋮ trail the title line only (guide §7.1), so at
              large text the title wraps across the row and the lines under
              it run full width. */}
          <View style={styles.titleLine}>
            <UIText style={[styles.label, { color: labelColor }]}>{label}</UIText>
            {detail !== undefined && (
              <UIText secondary style={[styles.detail, material && { color: m3.onSurfaceVariant }]} {...hidden}>
                {detail}
              </UIText>
            )}
            {material && onMenu !== undefined && (
              <Pressable
                ref={menuRef}
                accessibilityRole="button"
                accessibilityLabel={menuLabel ?? `More actions for ${label}`}
                onPress={openMenu}
                hitSlop={0}
                style={({ pressed }) => [styles.menuButton, { opacity: pressed ? 0.6 : 1 }]}
              >
                <ScaledSymbol
                  name={{ ios: 'ellipsis', android: 'more_vert' }}
                  size={24}
                  tintColor={m3.onSurfaceVariant}
                  {...hidden}
                />
              </Pressable>
            )}
          </View>
          {children}
        </View>
        {chevron && !material && (
          <ScaledSymbol
            name={{ ios: 'chevron.right', android: 'chevron_right' }}
            size={14}
            tintColor={colors.textSecondary}
            {...hidden}
          />
        )}
      </View>
    </Pressable>
  );
}

export type SwipeAction = { key: string; label: string; icon: SymbolName; destructive?: boolean; onPress: () => void };

/**
 * Swipe actions on a phone row: drag left to show them, the last at the
 * trailing (outer) edge; a destructive one is red in the iOS look. Each is
 * also in the row's menu and its accessibility actions (WCAG 2.5.7), so
 * the panel itself is hidden from assistive tech.
 */
export function SwipeRow({
  actions,
  enabled = true,
  children,
}: {
  actions: readonly SwipeAction[];
  /** Off, the row doesn't swipe; it keeps its element, so its focus too. */
  enabled?: boolean;
  children: ReactNode;
}) {
  const { look, colors, m3 } = useBerean();
  const renderRightActions = (_p: unknown, _t: unknown, swipe: SwipeableMethods) => (
    <View style={styles.swipeActions} {...hidden}>
      {actions.map((action) => {
        const { fill, ink } = swipeActionColors(look, action.destructive === true, colors, m3);
        return (
          <Pressable
            key={action.key}
            focusable={false}
            onPress={() => {
              swipe.close();
              action.onPress();
            }}
            style={({ pressed }) => [styles.swipeAction, { backgroundColor: fill, opacity: pressed ? 0.8 : 1 }]}
          >
            <ScaledSymbol name={action.icon} size={22} tintColor={ink} />
            <UIText variant="caption" style={{ color: ink }}>
              {action.label}
            </UIText>
          </Pressable>
        );
      })}
    </View>
  );
  return (
    <ReanimatedSwipeable enabled={enabled} friction={2} rightThreshold={40} overshootRight={false} renderRightActions={renderRightActions}>
      {children}
    </ReanimatedSwipeable>
  );
}

const styles = StyleSheet.create({
  // M3 list subheader: title small, 16dp in.
  materialHeader: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  materialRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingStart: spacing.lg,
    paddingEnd: spacing.sm,
  },
  iosSection: { marginHorizontal: spacing.lg, marginTop: spacing.xl },
  iosHeader: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  // Inset grouped: 10pt corners.
  iosGroup: { borderRadius: 10, overflow: 'hidden' },
  iosRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingStart: spacing.lg,
  },
  body: {
    flex: 1,
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingEnd: spacing.lg,
  },
  text: { flex: 1, gap: 2 },
  titleLine: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  label: { flex: 1 },
  detail: { flexShrink: 0 },
  // The 48dp target reaches past the title line rather than heightening it,
  // so the preview sits right under the title; the glyph centers on its
  // first line.
  menuButton: {
    minWidth: 48,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginEnd: -spacing.md,
    marginVertical: -spacing.md,
  },
  swipeActions: { flexDirection: 'row' },
  swipeAction: {
    width: 76,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
});
