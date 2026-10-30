import { useNavigation } from 'expo-router';
import { useLayoutEffect, useState } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

import { useBerean } from '@/design/theme';

type ScrollEvent = NativeSyntheticEvent<NativeScrollEvent>;

// M3: the top app bar picks up a tonal fill once content scrolls under it.
// Cleared again in the iOS look so a runtime Look switch leaves nothing behind.
// Spread the returned handlers onto the screen's ScrollView.
export function useTopAppBarFill(): {
  onScroll: (e: ScrollEvent) => void;
  onScrollEndDrag: (e: ScrollEvent) => void;
  onMomentumScrollEnd: (e: ScrollEvent) => void;
} {
  const { look, m3 } = useBerean();
  const navigation = useNavigation();
  const [scrolled, setScrolled] = useState(false);
  const material = look === 'material';

  useLayoutEffect(() => {
    navigation.setOptions({
      headerStyle: material
        ? { backgroundColor: scrolled ? m3.surfaceContainer : m3.surface }
        : undefined,
    });
  }, [navigation, material, scrolled, m3]);

  // Tracked in both looks so the fill is right after a Look switch.
  // Also re-checked when a drag or fling ends: the last throttled
  // onScroll of a fast fling to the top can still report y > 0.
  const update = (e: ScrollEvent) => setScrolled(e.nativeEvent.contentOffset.y > 0);
  return { onScroll: update, onScrollEndDrag: update, onMomentumScrollEnd: update };
}
