import { StyleSheet, Text, View } from 'react-native';

import { ScaledSymbol } from '@/components/scaled-symbol';
import { useBerean } from '@/design/theme';
import { spacing } from '@/design/tokens';
import type { SymbolName } from '@/notes/list-rows';
import { cardLevel, titleScale, type CardKind } from '@/studyspace/cards';
import type { CardView } from '@/studyspace/data';

const GLYPHS: Record<CardKind, SymbolName> = {
  note: { ios: 'note.text', android: 'sticky_note_2' },
  passage: { ios: 'text.quote', android: 'format_quote' },
  publication: { ios: 'book', android: 'menu_book' },
};

const hidden = {
  accessible: false,
  importantForAccessibility: 'no-hide-descendants',
  accessibilityElementsHidden: true,
} as const;

type StudyCardProps = {
  card: CardView;
  /** The camera's zoom when it last settled: levels and title size follow it. */
  zoom: number;
  fontScale: number;
};

/**
 * One card on the canvas, at its frame in canvas points (the content layer
 * zooms it). Title-only for now (§5 L1 and L2): below 48 pt on screen a
 * glyph on the card's fill, otherwise the title at the reader's text size,
 * never smaller. Passage and publication cards are placeholders until they
 * become live readers.
 */
export function StudyCard({ card, zoom, fontScale }: StudyCardProps) {
  const { look, colors, m3, type } = useBerean();
  const material = look === 'material';
  const { frame } = card;
  const level = cardLevel(frame.width * zoom, fontScale);
  // The title layer is laid out at the on-screen size, then scaled back up
  // inside the zoomed card, so its text stays at the reader's size.
  const up = titleScale(zoom);
  const ink = material ? m3.onSurface : colors.text;
  const secondary = material ? m3.onSurfaceVariant : colors.textSecondary;

  return (
    // TODO(Expo 7 slices 2 and 4): a tap opens the note editor or the
    // full-screen reader on phones (§8); on tablets a small card zooms to
    // itself and a wide reader card scrolls (§6.1). Until then a card only
    // takes screen reader focus.
    <View
      accessible
      accessibilityRole="button"
      accessibilityLabel={card.accessibilityLabel}
      style={[
        styles.card,
        {
          left: frame.x,
          top: frame.y,
          width: frame.width,
          height: frame.height,
          backgroundColor: material ? m3.surfaceContainerLow : colors.surfaceRaised,
          borderColor: material ? m3.outlineVariant : colors.separator,
          // 1 pt on screen once the camera settles.
          borderWidth: 1 / zoom,
          borderRadius: material ? 14 : 12,
          // Missing is said in the label and shown in words, not by the dashes alone.
          borderStyle: card.missing ? 'dashed' : 'solid',
        },
      ]}
    >
      <View
        {...hidden}
        style={[
          styles.content,
          {
            width: frame.width / up,
            height: frame.height / up,
            transform: [{ scale: up }],
          },
          level === 1 && styles.glyphOnly,
        ]}
      >
        {level === 1 ? (
          <ScaledSymbol name={GLYPHS[card.kind]} size={16} tintColor={secondary} />
        ) : (
          <>
            <Text numberOfLines={2} style={[type.ui.body, styles.title, { color: ink }]}>
              {card.title}
            </Text>
            {card.missing && (
              <Text numberOfLines={1} style={[type.ui.caption, { color: secondary }]}>
                {card.kind === 'note' ? 'Note deleted' : 'Not on this device'}
              </Text>
            )}
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { position: 'absolute', overflow: 'hidden' },
  content: { transformOrigin: 'left top', padding: spacing.md, gap: spacing.xs },
  glyphOnly: { padding: 0, alignItems: 'center', justifyContent: 'center' },
  title: { fontWeight: '600' },
});
