import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { useBerean } from '@/design/theme';
import { radii, spacing } from '@/design/tokens';
import { markerCount, markerLabel } from '@/notes/verse-notes';

/**
 * The guide's note glyph (§7.2, "solid page, cut corner"), on its 16-unit
 * grid: a solid 12x14 page with its top trailing corner cut by 4. Drawn
 * with Views, not a symbol font, so both platforms show the same shape; it
 * scales with the font scale.
 */
export function NoteGlyph({ color, background, scale = 1 }: { color: string; background: string; scale?: number }) {
  const unit = scale;
  const cut = 4 * unit;
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={{ width: 12 * unit, height: 14 * unit, backgroundColor: color, borderRadius: unit }}
    >
      {/* The cut: a triangle in the surface color over the corner. */}
      <View
        style={[
          styles.cut,
          {
            borderTopWidth: cut,
            borderLeftWidth: cut,
            borderTopColor: background,
          },
        ]}
      />
    </View>
  );
}

/**
 * The notes count on a verse number where there's no margin (guide §7.2):
 * an accent capsule. It is an inline View inside the number's span, not
 * text: the paragraph's text then holds only a placeholder character for
 * it (BADGE_TEXT), so a screen reader reading the verse never says the
 * count as a stray number, and the View itself is hidden from
 * accessibility. It takes no touches, so a tap on it is a tap on the
 * number's span around it.
 */
export function NoteBadge({ count }: { count: string }) {
  const { colors, type } = useBerean();
  const { fontScale } = useWindowDimensions();
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      pointerEvents="none"
      style={[styles.badge, { minWidth: BADGE_LINE * fontScale, backgroundColor: colors.accent }]}
    >
      <Text style={[type.verseNumber, styles.badgeCount, { color: colors.onAccent }]}>{count}</Text>
    </View>
  );
}

const BADGE_LINE = 14;

/** The leading gutter the reader keeps in margin layouts, with or without notes, so lines never rebreak. */
export const MARKER_GUTTER = 36;

type NoteMarkerProps = {
  /** "Genesis 1": the chapter heading, for the label. */
  heading: string;
  verses: readonly number[];
  count: number;
  /** The verse's first line in the column: its top and height. */
  lineTop: number;
  lineHeight: number;
  onPress: () => void;
};

/**
 * A margin marker beside a verse's first line, outside the text flow: the
 * note glyph and, for more than one note, the count. Its touch target is
 * 48dp (Material) or 44pt (iOS look), centered in the leading gutter.
 */
export function NoteMarker({ heading, verses, count, lineTop, lineHeight, onPress }: NoteMarkerProps) {
  const { look, colors, type } = useBerean();
  const { fontScale } = useWindowDimensions();
  const target = look === 'material' ? 48 : 44;
  const shown = markerCount(count);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={markerLabel(heading, verses, count)}
      accessibilityHint="Opens the study pane at My notes"
      onPress={onPress}
      style={({ pressed }) => [
        styles.marker,
        {
          width: target,
          height: target,
          left: -MARKER_GUTTER / 2 - target / 2,
          top: lineTop + lineHeight / 2 - target / 2,
          opacity: pressed ? 0.6 : 1,
        },
      ]}
    >
      <View style={styles.row}>
        <NoteGlyph color={colors.textSecondary} background={colors.surface} scale={fontScale} />
        {shown !== undefined && (
          <Text
            style={[type.verseNumber, { color: colors.textSecondary }]}
            accessible={false}
            importantForAccessibility="no-hide-descendants"
          >
            {shown}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cut: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 0,
    height: 0,
    borderLeftColor: 'transparent',
  },
  marker: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  // Fully rounded: the capsule radius is half its height whatever the text size.
  badge: {
    borderRadius: radii.capsule,
    paddingHorizontal: spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeCount: { lineHeight: BADGE_LINE, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs / 2 },
});
