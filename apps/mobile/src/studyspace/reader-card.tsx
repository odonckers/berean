import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type ScrollViewInstance,
  type StyleProp,
  StyleSheet,
  Text,
  useWindowDimensions,
  type ViewStyle,
} from 'react-native';
import { type PanGesture, ScrollView } from 'react-native-gesture-handler';

import { ScriptureText } from '@/components/text';
import { useBerean } from '@/design/theme';
import { readingMeasure, spacing } from '@/design/tokens';
import { load, type Loaded } from '@/library/load';
import { readerMeasure } from '@/studyspace/cards';
import { type CardReader, readReaderText, type ReaderTextRead, saveReaderState } from '@/studyspace/data';
import { debounce } from '@/studyspace/debounce';
import {
  type Part,
  type Position,
  positionAt,
  restorePosition,
  type Row,
  type RowLayout,
  type RowPosition,
  rowPositionAt,
  scrollYFor,
  snippetParts,
} from '@/studyspace/reader-state';

// Enough characters for 3 lines at any card width L3 draws, before the ellipsis.
const SNIPPET_CHARS = 400;
// §6.6: a reader's place is saved this long after its scroll settles.
const SAVE_READER_MS = 500;

/**
 * Canvas item `id`'s reader text and its place in it (§6.6), for a reader
 * card and the phone's full-screen reader alike. The text is read once
 * `wanted` (the card draws it), and again only when the saved place changes
 * elsewhere (readKey). The place is the last settled scroll this session,
 * else the saved anchor. `settled` saves a new place, debounced; `saver`
 * flushes it (it flushes itself on unmount).
 */
export function useReaderPlace(id: bigint, reader: CardReader | undefined, wanted: boolean) {
  const [text, setText] = useState<{ key: string; read: Loaded<ReaderTextRead> }>();
  if (reader !== undefined && wanted && text?.key !== reader.readKey) {
    setText({ key: reader.readKey, read: load(() => readReaderText(reader)) });
  }
  const key = text !== undefined && text.key === reader?.readKey ? text.key : undefined;
  const read = key === undefined ? undefined : text?.read;
  const shown = read?.ok === true ? read.value : undefined;
  const [position, setPosition] = useState<{ key: string; position: Position }>();
  const place = position !== undefined && position.key === key ? position.position : shown?.wanted;
  const at = useMemo(() => (shown === undefined ? undefined : restorePosition(shown.rows, place)), [shown, place]);

  const saver = useMemo(
    () =>
      debounce<{ scope: ReaderTextRead['scope']; position: Position }>(
        ({ scope, position: p }) => saveReaderState(id, scope, p),
        SAVE_READER_MS,
      ),
    [id],
  );
  useEffect(() => () => saver.flush(), [saver]);
  const settled = (rowAt: RowPosition) => {
    if (shown === undefined || key === undefined) return;
    const p = positionAt(shown.rows, rowAt);
    if (p === undefined) return;
    setPosition({ key, position: p });
    saver.call({ scope: shown.scope, position: p });
  };

  return { key, read, shown, place, at, saver, settled };
}

/** The reading serif at `scale` × the reader's size (§5: the zoom, below 100%). */
function useScaled(variant: 'scripture' | 'sectionHeading', scale: number) {
  const { type } = useBerean();
  const role = type.reading[variant];
  return { fontSize: (role.fontSize ?? 0) * scale, lineHeight: (role.lineHeight ?? 0) * scale };
}

/** A row's parts: verse and paragraph numbers in the secondary ink, the text in the reading ink. */
function PartsText({ parts, scale, heading, numberOfLines, maxWidth, onLayout }: {
  parts: readonly Part[];
  scale: number;
  heading?: boolean;
  numberOfLines?: number;
  maxWidth?: number;
  onLayout?: (layout: RowLayout) => void;
}) {
  const { colors, type } = useBerean();
  const number = { ...type.verseNumber, fontSize: (type.verseNumber.fontSize ?? 0) * scale, color: colors.textSecondary };
  const sized = useScaled(heading ? 'sectionHeading' : 'scripture', scale);
  return (
    <ScriptureText
      variant={heading ? 'sectionHeading' : 'scripture'}
      numberOfLines={numberOfLines}
      onLayout={onLayout && ((e) => onLayout({ y: e.nativeEvent.layout.y, height: e.nativeEvent.layout.height }))}
      style={[sized, { maxWidth }]}
    >
      {parts.map((part, i) =>
        part.number ? (
          <Text key={i} style={number}>
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
  const { fontScale } = useWindowDimensions();
  return (
    <PartsText
      parts={snippetParts(rows, at, SNIPPET_CHARS)}
      scale={scale}
      numberOfLines={lines}
      maxWidth={readerMeasure(readingMeasure, fontScale, scale)}
    />
  );
}

type LiveReaderProps = {
  rows: readonly Row[];
  /** Where to open: put at the top once its row (and every row above it) is laid out. */
  start: RowPosition;
  scale: number;
  /** On a card: the canvas's one-finger pan, which waits while a touch that began here may scroll (§6.1). */
  canvasPan?: PanGesture;
  /** Full screen: padding around the text. */
  contentStyle?: StyleProp<ViewStyle>;
  /** A drag began: the card is being read. */
  onScrollStart?: () => void;
  /** Momentum began, so the drag's end wasn't where the scroll settles. */
  onMoving: () => void;
  /** The scroll settled with `at` at the top (§6.6). */
  onSettle: (at: RowPosition) => void;
};

/**
 * §5 L4: the card's whole chapter or document, scrolled by one finger
 * (§6.1); also the phone's full-screen reader (§8), at scale 1. Mount it
 * again (key it) when the text reflows, so it reopens at the anchor. On a
 * card, a touch that begins here blocks the canvas's pan; pinch and two
 * fingers still move the canvas (the scroll yields to continuous
 * gestures), and a long press still lifts the card.
 *
 * Offsets map to scroll positions by each row's laid-out height, not its
 * lines (scrollYFor): approximate within a paragraph.
 */
export function LiveReader(props: LiveReaderProps) {
  const { rows, start, scale, canvasPan, contentStyle, onScrollStart, onMoving, onSettle } = props;
  const { fontScale } = useWindowDimensions();
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
      contentContainerStyle={[
        styles.liveContent,
        { maxWidth: readerMeasure(readingMeasure, fontScale, scale) },
        contentStyle,
      ]}
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
