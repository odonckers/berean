import { type ComponentRef, useEffect, useRef } from 'react';
import {
  Modal,
  type NativeSyntheticEvent,
  Pressable,
  StyleSheet,
  Text,
  type TargetedEvent,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScaledSymbol } from '@/components/scaled-symbol';
import { UIText } from '@/components/text';
import { TextButton } from '@/components/text-button';
import { systemBarStyle, useBerean } from '@/design/theme';
import { type HighlightName, hairline, radii, spacing } from '@/design/tokens';
import { HIGHLIGHT_ORDER, highlightLabel } from '@/reader/highlights';
import { moveAccessibilityFocus } from '@/reader/study-pane';
import { followFocusRingIn } from '../../modules/berean-shortcuts';
import { ModalNavigationBarStyle } from '../../modules/berean-system-bars';

type HighlightSheetProps = {
  visible: boolean;
  /** The verse's reference, the sheet's title: "John 1:4". */
  reference: string;
  /** The verse's highlight color, if it has one. */
  current: HighlightName | undefined;
  /** The last change's error, shown until the next one or the sheet closes. */
  error: string | undefined;
  onChoose: (color: HighlightName) => void;
  onRemove: () => void;
  onCopy: () => void;
  onClose: () => void;
};

// The sheet is a Modal, its own window, outside the root's focus ring.
const followRing = (e: NativeSyntheticEvent<TargetedEvent>) => followFocusRingIn(e.nativeEvent.target);

/**
 * A verse's context menu, opened by a long press on its text or its
 * Highlight accessibility action. Highlight comes first: its chips row,
 * each chip "Aa" on its fill and the color's name, and Remove highlight
 * while the verse has one. Then Copy verse. iOS look: a compact sheet on
 * the raised surface, with Cancel, Copy verse a plain row. Material: an M3
 * bottom sheet on surface-container with a drag handle, Copy verse a
 * one-line list item; the scrim or Back closes it.
 */
export function HighlightSheet({
  visible,
  reference,
  current,
  error,
  onChoose,
  onRemove,
  onCopy,
  onClose,
}: HighlightSheetProps) {
  const { look, scheme, colors, m3, highlights, type } = useBerean();
  const material = look === 'material';
  const insets = useSafeAreaInsets();
  const target = material ? 48 : 44;
  const selectedEdge = material ? m3.primary : colors.accent;

  // A screen reader lands on the title as the sheet opens.
  const titleRef = useRef<ComponentRef<typeof Text>>(null);
  useEffect(() => {
    if (!visible) return;
    const frame = requestAnimationFrame(() => moveAccessibilityFocus(titleRef.current));
    return () => cancelAnimationFrame(frame);
  }, [visible]);

  const chips = HIGHLIGHT_ORDER.map((name) => {
    const selected = name === current;
    const label = highlightLabel(name);
    return (
      <Pressable
        key={name}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected }}
        onPress={() => onChoose(name)}
        onFocus={followRing}
        style={({ pressed }) => [
          styles.chip,
          {
            minHeight: target,
            borderRadius: material ? radii.materialChip : radii.capsule,
            // The edge is always drawn, clear when off, so selecting never
            // moves the row.
            borderColor: selected ? selectedEdge : 'transparent',
            opacity: pressed ? 0.6 : 1,
          },
        ]}
      >
        <View style={[styles.swatch, { backgroundColor: highlights[name] }]}>
          <Text style={[type.ui.body, { color: colors.text }]}>Aa</Text>
        </View>
        <UIText
          style={[
            { color: material ? m3.onSurface : colors.text },
            selected && styles.selectedLabel,
          ]}
        >
          {label}
        </UIText>
      </Pressable>
    );
  });

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
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
              backgroundColor: material ? m3.surfaceContainer : colors.surfaceRaised,
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
              {reference}
            </Text>
            {!material && <TextButton title="Cancel" onPress={onClose} onFocus={followRing} />}
          </View>
          <UIText variant="caption" secondary style={styles.section}>
            Highlight
          </UIText>
          <View style={styles.chips}>{chips}</View>
          {error !== undefined && (
            <UIText accessibilityLiveRegion="polite" secondary style={styles.error}>
              {error}
            </UIText>
          )}
          {current !== undefined && (
            <View style={styles.actions}>
              <TextButton
                title="Remove highlight"
                align="leading"
                onPress={onRemove}
                onFocus={followRing}
              />
            </View>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Copy verse"
            onPress={onCopy}
            onFocus={followRing}
            style={({ pressed }) => [
              material ? styles.materialItem : styles.iosRow,
              !material && { borderTopColor: colors.separator },
              { opacity: pressed ? 0.6 : 1 },
            ]}
          >
            {material && (
              <ScaledSymbol
                name={{ ios: 'doc.on.doc', android: 'content_copy' }}
                size={24}
                tintColor={m3.onSurfaceVariant}
                accessible={false}
                importantForAccessibility="no-hide-descendants"
                accessibilityElementsHidden
              />
            )}
            <UIText style={{ color: material ? m3.onSurface : colors.accent }}>Copy verse</UIText>
          </Pressable>
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
  // M3 bottom sheet drag handle: 32x4dp, centered, decorative.
  handle: {
    alignSelf: 'center',
    width: 32,
    height: 4,
    borderRadius: 2,
    marginVertical: spacing.sm,
    opacity: 0.4,
  },
  header: { flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: spacing.sm },
  title: { flex: 1 },
  // The iOS sheet title: 17pt semibold.
  iosTitle: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
  section: { marginTop: spacing.sm, marginBottom: spacing.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingStart: spacing.xs,
    paddingEnd: spacing.md,
    borderWidth: 2,
  },
  swatch: {
    borderRadius: radii.chip,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  selectedLabel: { fontWeight: '600' },
  error: { marginTop: spacing.md },
  actions: { marginTop: spacing.sm, flexDirection: 'row' },
  // A plain action row under a hairline, as in an iOS action list: 44pt.
  iosRow: {
    minHeight: 44,
    justifyContent: 'center',
    marginTop: spacing.md,
    borderTopWidth: hairline,
  },
  // M3 one-line list item with a leading icon: 56dp, the icon 16dp from
  // the label. The sheet's padding is the item's.
  materialItem: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    marginTop: spacing.sm,
  },
});
