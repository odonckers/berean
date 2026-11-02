import { useRef } from 'react';
import { type ScrollViewInstance, StyleSheet, Text } from 'react-native';
import { type PanGesture, ScrollView } from 'react-native-gesture-handler';

import { ScriptureText } from '@/components/text';
import { useBerean } from '@/design/theme';
import { spacing } from '@/design/tokens';
import {
  type Part,
  type Row,
  type RowLayout,
  type RowPosition,
  rowPositionAt,
  scrollYFor,
  snippetParts,
} from '@/studyspace/reader-state';

// Enough characters for 3 lines at any card width L3 draws, before the ellipsis.
const SNIPPET_CHARS = 400;

/** The reading serif at `scale` × the reader's size (§5: the zoom, below 100%). */
function useScaled(variant: 'scripture' | 'sectionHeading', scale: number) {
  const { type } = useBerean();
  const role = type.reading[variant];
  return { fontSize: (role.fontSize ?? 0) * scale, lineHeight: (role.lineHeight ?? 0) * scale };
}

/** A row's parts: verse and paragraph numbers in the secondary ink, the text in the reading ink. */
function PartsText({ parts, scale, heading, numberOfLines, onLayout }: {
  parts: readonly Part[];
  scale: number;
  heading?: boolean;
  numberOfLines?: number;
  onLayout?: (layout: RowLayout) => void;
}) {
  const { look, colors, m3 } = useBerean();
  const secondary = look === 'material' ? m3.onSurfaceVariant : colors.textSecondary;
  const sized = useScaled(heading ? 'sectionHeading' : 'scripture', scale);
  return (
    <ScriptureText
      variant={heading ? 'sectionHeading' : 'scripture'}
      numberOfLines={numberOfLines}
      onLayout={onLayout && ((e) => onLayout({ y: e.nativeEvent.layout.y, height: e.nativeEvent.layout.height }))}
      style={sized}
    >
      {parts.map((part, i) =>
        part.number ? (
          <Text key={i} style={{ color: secondary }}>
            {part.text}
          </Text>
        ) : (
          part.text
        ),
      )}
    </ScriptureText>
  );
}

/** §5 L3: about `lines` lines from the anchor's verse or paragraph (with its number), ending in an ellipsis. */
export function ReaderSnippet({ rows, at, lines, scale }: {
  rows: readonly Row[];
  at: RowPosition;
  lines: number;
  scale: number;
}) {
  return <PartsText parts={snippetParts(rows, at, SNIPPET_CHARS)} scale={scale} numberOfLines={lines} />;
}

type LiveReaderProps = {
  rows: readonly Row[];
  /** Where to open: put at the top once its row (and every row above it) is laid out. */
  start: RowPosition;
  scale: number;
  /** The canvas's one-finger pan, which waits while a touch that began here may scroll (§6.1). */
  canvasPan: PanGesture;
  /** A drag began: the card is being read. */
  onScrollStart: () => void;
  /** Momentum began, so the drag's end wasn't where the scroll settles. */
  onMoving: () => void;
  /** The scroll settled with `at` at the top (§6.6). */
  onSettle: (at: RowPosition) => void;
};

/**
 * §5 L4: the card's whole chapter or document, scrolled by one finger
 * (§6.1). Mount it again (key it) when the text reflows, so it reopens at
 * the anchor. A touch that begins here blocks the canvas's pan; pinch and
 * two fingers still move the canvas (the scroll yields to continuous
 * gestures), and a long press still lifts the card.
 *
 * Offsets map to scroll positions by each row's laid-out height, not its
 * lines (scrollYFor): approximate within a paragraph.
 */
export function LiveReader({ rows, start, scale, canvasPan, onScrollStart, onMoving, onSettle }: LiveReaderProps) {
  const scroll = useRef<ScrollViewInstance>(null);
  const layouts = useRef<(RowLayout | undefined)[]>([]);
  const restored = useRef(false);

  const restore = () => {
    if (restored.current) return;
    for (let i = 0; i <= start.row; i++) if (layouts.current[i] === undefined) return;
    const layout = layouts.current[start.row];
    const row = rows[start.row];
    restored.current = true;
    if (layout === undefined || row === undefined) return;
    scroll.current?.scrollTo({ y: scrollYFor(layout, row.length, start.offset), animated: false });
  };

  const settled = (y: number) => {
    const at = rowPositionAt(layouts.current, rows, y);
    if (at !== undefined) onSettle(at);
  };

  return (
    <ScrollView
      ref={scroll}
      block={canvasPan}
      disallowInterruption
      yieldsToContinuousGestures
      style={styles.live}
      contentContainerStyle={styles.liveContent}
      onContentSizeChange={restore}
      onScrollBeginDrag={onScrollStart}
      onScrollEndDrag={(e) => settled(e.nativeEvent.contentOffset.y)}
      onMomentumScrollBegin={onMoving}
      onMomentumScrollEnd={(e) => settled(e.nativeEvent.contentOffset.y)}
    >
      {rows.map((row, i) => (
        <PartsText
          key={i}
          parts={row.parts}
          heading={row.heading}
          scale={scale}
          onLayout={(layout) => {
            layouts.current[i] = layout;
            restore();
          }}
        />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  live: { flex: 1 },
  liveContent: { gap: spacing.sm, paddingBottom: spacing.md },
});
