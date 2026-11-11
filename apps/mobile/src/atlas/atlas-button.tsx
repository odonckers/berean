import { router } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { firstEventInChapter } from '@/atlas/atlas';
import { atlasData } from '@/atlas/data';
import { ScaledSymbol } from '@/components/scaled-symbol';
import { useBerean } from '@/design/theme';

export const ATLAS_LABEL = 'Map and timeline';

/**
 * Opens the map and timeline at what happens in this chapter: shown only
 * where the atlas has something (Acts 13 to 28 for now). Monochrome like
 * Aa, a 48dp / 44pt target.
 */
export function AtlasButton({ pubKey, title, book, chapter }: { pubKey: string; title: string; book: number; chapter: number }) {
  const { look, colors, m3 } = useBerean();
  const event = useMemo(() => {
    const data = atlasData();
    return data.ok ? firstEventInChapter(data.value.events, book, chapter) : undefined;
  }, [book, chapter]);
  if (event === undefined) return null;
  const material = look === 'material';
  const target = material ? 48 : 44;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={ATLAS_LABEL}
      onPress={() => router.push({ pathname: '/atlas', params: { event: event.id, pubKey, title } })}
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
