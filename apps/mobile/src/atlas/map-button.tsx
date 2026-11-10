import { router } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { ScaledSymbol } from '@/components/scaled-symbol';
import { useBerean } from '@/design/theme';
import { atlas } from '@/ffi/core';
import { load } from '@/library/load';

export const MAP_LABEL = 'Map and timeline';

/**
 * Opens the map and timeline at this chapter's first event. Shown only in
 * chapters the map covers; monochrome like Today and Aa, a 48dp / 44pt target.
 */
export function MapButton({ book, chapter }: { book: number; chapter: number }) {
  const { look, colors, m3 } = useBerean();
  const covered = useMemo(() => {
    const found = load(() => atlas().eventsInPassage(book, chapter, undefined).length > 0);
    return found.ok && found.value;
  }, [book, chapter]);
  if (!covered) return null;
  const material = look === 'material';
  const target = material ? 48 : 44;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={MAP_LABEL}
      accessibilityHint="Shows this chapter's places on a map"
      onPress={() => router.push({ pathname: '/atlas', params: { book: String(book), chapter: String(chapter) } })}
      style={({ pressed }) => [styles.button, { minWidth: target, minHeight: target, opacity: pressed ? 0.6 : 1 }]}
    >
      <ScaledSymbol
        name={{ ios: 'map', android: 'map' }}
        size={material ? 24 : 22}
        tintColor={material ? m3.onSurfaceVariant : colors.text}
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { alignItems: 'center', justifyContent: 'center' },
});
