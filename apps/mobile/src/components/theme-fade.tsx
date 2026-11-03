import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { useBerean } from '@/design/theme';
import { shouldCrossFade, THEME_FADE_MS } from '@/design/theme-fade';

/**
 * The theme cross-fade (rule 12). When the page color changes, a
 * full-window veil in the old page color is drawn over the new theme in the
 * same frame, then fades out over 200 ms, so the old page gives way to the
 * new one with nothing moving. It approximates a true cross-fade (the old
 * text isn't kept) without a snapshot dependency. It never takes touches
 * and screen readers never see it. Under Reduce Motion the theme swaps at
 * once. Mounted once, over the root stack.
 */
export function ThemeFade() {
  const { colors } = useBerean();
  const reducedMotion = useReducedMotion();
  const page = colors.surface;
  const [shown, setShown] = useState(page);
  const [veil, setVeil] = useState<{ color: string; key: number }>();

  // Caught while rendering, so the veil lands in the same commit as the new theme.
  if (page !== shown) {
    setShown(page);
    if (shouldCrossFade(shown, page, reducedMotion)) setVeil({ color: shown, key: (veil?.key ?? 0) + 1 });
  }

  if (veil === undefined) return null;
  return <Veil key={veil.key} color={veil.color} onDone={() => setVeil(undefined)} />;
}

function Veil({ color, onDone }: { color: string; onDone: () => void }) {
  const opacity = useSharedValue(1);
  useEffect(() => {
    opacity.set(
      withTiming(0, { duration: THEME_FADE_MS }, (finished) => {
        if (finished) scheduleOnRN(onDone);
      }),
    );
    // Runs once per veil; a newer change mounts a new one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const fade = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  return (
    <Animated.View
      pointerEvents="none"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[StyleSheet.absoluteFill, { backgroundColor: color }, fade]}
    />
  );
}
