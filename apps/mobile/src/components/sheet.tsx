import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Pressable, type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, {
  type SharedValue,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { ScaledSymbol } from '@/components/scaled-symbol';
import { schemeOf } from '@/design/appearance';
import { cardEdge } from '@/design/chrome';
import { quickPickerSheetSurface } from '@/design/quick-picker';
import { sheetDragEnd } from '@/design/sheet-drag';
import { useBerean, useSolidChrome } from '@/design/theme';
import { hairline, radii, spacing } from '@/design/tokens';

// The reader's sheets and popover cards, shared by the Aa quick picker and
// the bookmark picker: the surface and edge, the drag handle, the close
// button, a bottom sheet that slides and drags, and an anchored card.

const OPEN_MS = 250;
const CLOSE_MS = 200;
/** Under Reduce Motion, a sheet that fades does so in this long. */
const FADE_MS = 200;

/**
 * The sheet's and popover's chrome: never accent-tinted, and solid with a
 * 1px outline under Reduce Transparency or Increase Contrast (rule 5,
 * solidChrome). Its surface is already opaque. A card anchored over the
 * reader also takes a hairline edge in the iOS look's dark schemes
 * (cardEdge), where neither its fill nor its shadow parts it from the page.
 */
export function useSheetChrome() {
  const { look, colors, m3, mode } = useBerean();
  const solid = useSolidChrome();
  const scheme = schemeOf(mode);
  return {
    material: look === 'material',
    background: quickPickerSheetSurface(look, scheme, m3, colors),
    edge: solid ? { borderWidth: 1, borderColor: colors.outline } : undefined,
    cardEdge: cardEdge({ look, dark: scheme === 'dark', solid }, colors, hairline),
  };
}

/** The drag handle, which TalkBack and VoiceOver can also press to close. */
export function SheetHandle({ onClose }: { onClose: () => void }) {
  const { look, colors, m3 } = useBerean();
  const material = look === 'material';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={material ? 'Close' : 'Close sheet'}
      onPress={onClose}
      style={styles.handleArea}
    >
      <View
        style={[
          material ? styles.materialHandle : styles.iosHandle,
          { backgroundColor: material ? m3.onSurfaceVariant : colors.textSecondary },
        ]}
      />
    </Pressable>
  );
}

/** The close button: an M3 icon button, or the iOS look's round ×. */
export function SheetCloseButton({ onClose }: { onClose: () => void }) {
  const { look, colors, m3 } = useBerean();
  const material = look === 'material';
  const target = material ? 48 : 44;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Close"
      onPress={onClose}
      hitSlop={material ? undefined : spacing.xs}
      style={({ pressed }) => [
        styles.close,
        { width: target, height: target, opacity: pressed ? 0.6 : 1 },
        !material && { backgroundColor: colors.surface },
      ]}
    >
      <ScaledSymbol
        name={{ ios: 'xmark', android: 'close' }}
        size={material ? 24 : 15}
        tintColor={material ? m3.onSurfaceVariant : colors.textSecondary}
        accessible={false}
      />
    </Pressable>
  );
}

type SlidingSheetProps = {
  open: boolean;
  /** Asked for by a dismissing drag. */
  onClose: () => void;
  /** Once it has gone (slid away, faded, or at once under Reduce Motion). */
  onHidden?: () => void;
  /** Its full height. */
  height: number;
  /**
   * A lower detent it opens at, if any: it then drags up to `height` and
   * back down to this, and a drag down from here closes it.
   */
  restHeight?: number;
  /**
   * Where it opens: at the lower detent (the default), at its full height,
   * or not yet, while its owner measures what it holds. Until then it is
   * laid out below the screen's edge and unseen, so it opens once, straight
   * to where it settles. Read as it opens; a change while open moves nothing.
   */
  opening?: 'rest' | 'full' | 'pending';
  /** Under Reduce Motion, cross-fade rather than appear and go at once. */
  fadeUnderReducedMotion?: boolean;
  /** Driven from 0 (gone) to 1 (shown) with the sheet, for a scrim. */
  visibility?: SharedValue<number>;
  /** Its surface, corners, edge and horizontal place; it sits at the bottom. */
  style: StyleProp<ViewStyle>;
  /** The part that drags: the handle and the title. */
  header: ReactNode;
  children: ReactNode;
};

/**
 * A bottom sheet in the view it is drawn in: mounted while open and while
 * it slides away; drag the header down to close it (or, with a lower
 * detent, up to its full height). Opening and closing slide where motion is
 * allowed; under Reduce Motion it appears and goes, or cross-fades.
 */
export function SlidingSheet({
  open,
  onClose,
  onHidden,
  height,
  restHeight,
  opening = 'rest',
  fadeUnderReducedMotion = false,
  visibility,
  style,
  header,
  children,
}: SlidingSheetProps) {
  const reducedMotion = useReducedMotion();
  const fades = reducedMotion && fadeUnderReducedMotion;
  // How far down the lower detent sits from the full height.
  const rest = restHeight === undefined ? 0 : Math.max(0, height - restHeight);
  const expandable = rest > 0;
  const pending = opening === 'pending';
  const opensFull = expandable && opening === 'full';

  // Mounted while open and while it slides away.
  const [mounted, setMounted] = useState(open);
  // Under Reduce Motion it goes at once, unless it fades.
  if (open !== mounted && (open || (reducedMotion && !fades))) setMounted(open);
  const offset = useSharedValue(height);
  const ownVisibility = useSharedValue(0);
  const shown = visibility ?? ownVisibility;
  // At full height (1) or the lower detent (0); the content's hidden strip follows.
  const expanded = useSharedValue(0);
  const opens = open && !pending;
  const [expandedHere, setExpandedHere] = useState(opens && opensFull);
  // Each opening starts where its owner asked (the lower detent unless told).
  const [wasOpening, setWasOpening] = useState(opens);
  if (opens !== wasOpening) {
    setWasOpening(opens);
    if (opens) setExpandedHere(opensFull);
  }
  useEffect(() => {
    if (open && pending) {
      // Mounted and laid out, but off screen and unseen until it knows where it opens.
      offset.set(height);
      shown.set(0);
    } else if (open) {
      expanded.set(opensFull ? 1 : 0);
      const to = opensFull ? 0 : rest;
      offset.set(reducedMotion ? to : withTiming(to, { duration: OPEN_MS }));
      shown.set(fades ? withTiming(1, { duration: FADE_MS }) : reducedMotion ? 1 : withTiming(1, { duration: OPEN_MS }));
    } else if (fades) {
      shown.set(
        withTiming(0, { duration: FADE_MS }, (finished) => {
          if (finished) scheduleOnRN(setMounted, false);
        }),
      );
    } else if (!reducedMotion) {
      shown.set(withTiming(0, { duration: CLOSE_MS }));
      offset.set(
        withTiming(height, { duration: CLOSE_MS }, (finished) => {
          if (finished) scheduleOnRN(setMounted, false);
        }),
      );
    } else {
      shown.set(0);
    }
    // A new height (rotation, text size) while open moves nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reducedMotion, pending]);

  // Once it has gone, the owner hears so (not on mounting closed).
  const wasMounted = useRef(mounted);
  useEffect(() => {
    if (wasMounted.current && !mounted) onHidden?.();
    wasMounted.current = mounted;
  }, [mounted, onHidden]);

  const drag = usePanGesture({
    enabled: opens,
    activeOffsetY: [-10, 10],
    onUpdate: (e) => {
      'worklet';
      const base = expanded.get() === 1 ? 0 : rest;
      offset.set(Math.max(0, base + e.translationY));
    },
    onDeactivate: (e) => {
      'worklet';
      switch (sheetDragEnd({ expandable, expanded: expanded.get() === 1 }, e.translationY, e.velocityY)) {
        case 'close':
          scheduleOnRN(onClose);
          break;
        case 'expand':
          expanded.set(1);
          scheduleOnRN(setExpandedHere, true);
          offset.set(withTiming(0, { duration: OPEN_MS }));
          break;
        case 'collapse':
          expanded.set(0);
          scheduleOnRN(setExpandedHere, false);
          offset.set(withTiming(rest, { duration: CLOSE_MS }));
          break;
        case 'stay':
          offset.set(withTiming(expanded.get() === 1 ? 0 : rest, { duration: CLOSE_MS }));
          break;
      }
    },
  });

  const slide = useAnimatedStyle(() => ({
    transform: [{ translateY: offset.get() }],
    ...(fades ? { opacity: shown.get() } : {}),
  }));
  if (!mounted) return null;

  return (
    <Animated.View onAccessibilityEscape={onClose} style={[styles.sheet, { height }, style, slide]}>
      <GestureDetector gesture={drag}>
        <View>{header}</View>
      </GestureDetector>
      {/* Below the full height, the strip under the screen's edge is left
          empty, so the content's end stays in view. */}
      {expandable ? <View style={[styles.fill, { paddingBottom: expandedHere ? 0 : rest }]}>{children}</View> : children}
    </Animated.View>
  );
}

/** A card hanging from an anchor (top and trailing offsets) in its area. */
export function PopoverCard({
  top,
  right,
  width,
  maxHeight,
  radius,
  onClose,
  children,
}: {
  top: number;
  right: number;
  width: number;
  maxHeight: number;
  radius: number;
  onClose: () => void;
  children: ReactNode;
}) {
  const { background, cardEdge: edge } = useSheetChrome();
  return (
    <View
      onAccessibilityEscape={onClose}
      style={[
        styles.popover,
        { top, right, width, maxHeight, borderRadius: radius, backgroundColor: background },
        edge,
      ]}
    >
      {children}
    </View>
  );
}

export const sheetShadow = {
  shadowColor: '#000',
  shadowOpacity: 0.18,
  shadowRadius: 16,
  shadowOffset: { width: 0, height: 4 },
  elevation: 6,
} as const;

const styles = StyleSheet.create({
  fill: { flex: 1 },
  sheet: { position: 'absolute', bottom: 0, ...sheetShadow },
  // M3 drag handle: 32×4 in a 48dp target. iOS grabber: 36×5.
  handleArea: { minHeight: 48, minWidth: 48, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
  materialHandle: { width: 32, height: 4, borderRadius: 2, opacity: 0.4 },
  iosHandle: { width: 36, height: 5, borderRadius: 2.5, opacity: 0.5 },
  close: { alignItems: 'center', justifyContent: 'center', borderRadius: radii.capsule },
  popover: { position: 'absolute', ...sheetShadow },
});
