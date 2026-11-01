import { StyleSheet, Text, View } from 'react-native';

import { ScaledSymbol } from '@/components/scaled-symbol';
import { useBerean } from '@/design/theme';
import { radii, spacing } from '@/design/tokens';
import type { SymbolName } from '@/notes/list-rows';
import type { Point } from '@/studyspace/camera';
import { cardEdge, cardFill, cardText, kindFill, titleScale, type CardKind } from '@/studyspace/cards';
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
  /** The content layer's top-left in canvas points; the card sits at its frame less this. */
  origin: Point;
};

/**
 * One card on the canvas, at its frame in canvas points relative to the
 * content layer's box (the content layer places and zooms it). Title-only
 * for now (§5 L1 and L2): below 48 pt on screen, or too short for one whole
 * title line, a solid block in its kind's colour with the glyph on it
 * (kindFill); otherwise as many whole title lines as fit (up to 2) at the
 * reader's text size, never smaller. Passage and publication cards are placeholders until they
 * become live readers.
 */
export function StudyCard({ card, zoom, fontScale, origin }: StudyCardProps) {
  const { look, scheme, colors, m3, type } = useBerean();
  const material = look === 'material';
  const { frame } = card;
  // The title layer is laid out at frame / up, then scaled back up inside
  // the zoomed card: below 100% its text stays at the reader's size on
  // screen; at 100% and above (up = 1) it is canvas-sized and grows with
  // the zoom, wrapping at the card's width.
  const up = titleScale(zoom);
  // Only whole lines fit in that layer's height, so none is cut mid-letter.
  const { level, titleLines, caption } = cardText(
    frame,
    zoom,
    fontScale,
    {
      padding: spacing.md,
      gap: spacing.xs,
      lineHeight: (type.ui.body.lineHeight ?? 0) * fontScale,
      captionLineHeight: (type.ui.caption.lineHeight ?? 0) * fontScale,
    },
    card.missing,
  );
  const ink = material ? m3.onSurface : colors.text;
  const secondary = material ? m3.onSurfaceVariant : colors.textSecondary;
  const edge = cardEdge(scheme === 'dark', material ? m3.outline : colors.outline);
  // L1 is a solid block in its kind's colour with the glyph on it.
  const block = level === 1 ? kindFill(card.kind, look, colors, m3) : undefined;

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
          left: frame.x - origin.x,
          top: frame.y - origin.y,
          width: frame.width,
          height: frame.height,
          backgroundColor: block?.fill ?? cardFill(look, scheme === 'dark', colors, m3),
          // 1 pt on screen once the camera settles. The L1 block needs no
          // edge beyond its fill, except a missing card's dashes.
          borderColor: block === undefined ? edge.border : block.ink,
          borderWidth: block === undefined || card.missing ? 1 / zoom : 0,
          borderRadius: radii.studyCard,
          // Missing is said in the label and shown in words, not by the dashes alone.
          borderStyle: card.missing ? 'dashed' : 'solid',
          // Light canvases carry the edge with the guide's soft shadow.
          boxShadow: block === undefined ? edge.shadow : undefined,
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
          <ScaledSymbol name={GLYPHS[card.kind]} size={16} tintColor={block?.ink ?? secondary} />
        ) : (
          <>
            <Text numberOfLines={titleLines} style={[type.ui.body, styles.title, { color: ink }]}>
              {card.title}
            </Text>
            {caption && (
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
