import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { GestureDetector, useExclusiveGestures, usePanGesture, useTapGesture } from 'react-native-gesture-handler';
import Animated, {
  ReduceMotion,
  type SharedValue,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { ScaledSymbol } from '@/components/scaled-symbol';
import { useBerean } from '@/design/theme';
import { radii, spacing } from '@/design/tokens';
import type { SymbolName } from '@/notes/list-rows';
import type { LiveFrame, Rect } from '@/studyspace/camera';
import { cardEdge, cardFill, cardText, kindFill, titleScale, type CardKind } from '@/studyspace/cards';
import type { CardView } from '@/studyspace/data';
import { type CardAction, moveBy, SNAP_DISTANCE, snapFrame } from '@/studyspace/edit';
import { liftHaptic, snapHaptic } from '@/studyspace/haptics';

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

// The resize handle (the canvas's selection overlay) replaces none of these: they are the accessible way to
// move and size a card (§4.3, WCAG 2.5.7). Each step is 24 canvas units (NUDGE).
const ACTIONS: { name: CardAction; label: string }[] = [
  { name: 'moveLeft', label: 'Move left' },
  { name: 'moveRight', label: 'Move right' },
  { name: 'moveUp', label: 'Move up' },
  { name: 'moveDown', label: 'Move down' },
  { name: 'larger', label: 'Make larger' },
  { name: 'smaller', label: 'Make smaller' },
  { name: 'front', label: 'Bring to front' },
  { name: 'remove', label: 'Remove from workspace' },
];

// §4.1: a long press lifts a card.
const LONG_PRESS_MS = 500;
// The lift: a slight grow while the card follows the finger.
const LIFT_SCALE = 1.02;
const LIFT_MS = 120;
// §7.2: the landing highlight is a 3 pt outline that fades by about 1.5 s.
const HIGHLIGHT_WIDTH = 3;
const HIGHLIGHT_FADE_MS = 400;
export const HIGHLIGHT_MS = 1500;

type StudyCardProps = {
  card: CardView;
  /** The camera's zoom when it last settled: levels, title size and outlines follow it. */
  zoom: number;
  fontScale: number;
  /** The content layer's top-left in canvas points; the card sits at its frame less this. */
  origin: SharedValue<Rect>;
  /** The camera's zoom right now, for the finger's travel in canvas units. */
  liveZoom: SharedValue<number>;
  /** Every card's frame, back to front; this card's is at `index`. */
  frames: SharedValue<Rect[]>;
  index: number;
  /**
   * The frame a drag or resize has now, ahead of the committed one; the card
   * at its index draws it. The canvas clears it when it reads the frames back.
   */
  live: SharedValue<LiveFrame | null>;
  /** Set while any card is moved or resized, so the canvas stays put. */
  editing: SharedValue<boolean>;
  /** Spoken; the canvas's selection overlay draws the outline and handle. */
  selected: boolean;
  /** Just added: the landing highlight shows. */
  highlighted: boolean;
  onLift: (id: bigint) => void;
  onTap: (id: bigint) => void;
  /** A move ended at `frame`. */
  onCommit: (id: bigint, frame: Rect) => void;
  onAction: (card: CardView, action: CardAction) => void;
};

/**
 * One card on the canvas, at its frame in canvas points relative to the
 * content layer's box (the content layer places and zooms it). Title-only
 * for now (§5 L1 and L2): below 48 pt on screen, or too short for one whole
 * title line, a solid block in its kind's colour with the glyph on it
 * (kindFill); otherwise as many whole title lines as fit (up to 2) at the
 * reader's text size, never smaller. Passage and publication cards are
 * placeholders until they become live readers.
 *
 * A long press lifts the card and it follows the finger, snapping to other
 * cards (§4.2), on the UI thread, telling JS once, on release. A selected
 * card's outline and resize handle are the canvas's selection overlay,
 * above every card; a resize reaches the card through `live`.
 */
export function StudyCard(props: StudyCardProps) {
  const { card, zoom, fontScale, origin, liveZoom, frames, index, live, editing, selected, highlighted } = props;
  const { onLift, onTap, onCommit, onAction } = props;
  const { look, scheme, colors, m3, type } = useBerean();
  const material = look === 'material';
  const reducedMotion = useReducedMotion();
  const { frame } = card;

  // The frame as drawn: the committed one, or where a drag has it now.
  const x = useSharedValue(frame.x);
  const y = useSharedValue(frame.y);
  const w = useSharedValue(frame.width);
  const h = useSharedValue(frame.height);
  const active = useSharedValue(false);
  const moving = useSharedValue(false);
  // Drawn over the others from the lift until the committed order arrives.
  const raised = useSharedValue(false);
  const start = useSharedValue<Rect>(frame);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const others = useSharedValue<Rect[]>([]);
  // The lines caught now (NaN for none), so a haptic plays once per catch.
  const snapX = useSharedValue(NaN);
  const snapY = useSharedValue(NaN);

  // Each read of the cards is a new `card`: take its frame (the commit, or
  // the old one back if the write failed), unless a drag holds the card.
  useEffect(() => {
    if (active.get()) return;
    x.set(card.frame.x);
    y.set(card.frame.y);
    w.set(card.frame.width);
    h.set(card.frame.height);
    raised.set(false);
  }, [card, active, x, y, w, h, raised]);

  const lifted = () => {
    liftHaptic(look);
    onLift(card.id);
  };
  const snapped = () => snapHaptic(look);
  const tapped = () => onTap(card.id);
  const committed = (fx: number, fy: number, fw: number, fh: number) =>
    onCommit(card.id, { x: fx, y: fy, width: fw, height: fh });

  const begin = (tx: number, ty: number) => {
    'worklet';
    active.set(true);
    editing.set(true);
    // From the live frame if a resize's is still showing, ahead of the read-back.
    const l = live.get();
    const from = l !== null && l.index === index ? l.frame : { x: x.get(), y: y.get(), width: w.get(), height: h.get() };
    x.set(from.x);
    y.set(from.y);
    w.set(from.width);
    h.set(from.height);
    start.set(from);
    startX.set(tx);
    startY.set(ty);
  };

  // `live` keeps the frame until the canvas reads the cards back, so the
  // card doesn't snap back between the commit and the read.
  const finish = () => {
    'worklet';
    if (!active.get()) return;
    active.set(false);
    moving.set(false);
    editing.set(false);
    scheduleOnRN(committed, x.get(), y.get(), w.get(), h.get());
  };

  // A long press lifts the card; moving before then pans the canvas
  // instead (the pan fails past 10 pt), so one finger still pans (§8).
  const drag = usePanGesture({
    activateAfterLongPress: LONG_PRESS_MS,
    maxPointers: 1,
    onActivate: (e) => {
      'worklet';
      begin(e.translationX, e.translationY);
      moving.set(true);
      raised.set(true);
      others.set(frames.get().filter((_, i) => i !== index));
      snapX.set(NaN);
      snapY.set(NaN);
      scheduleOnRN(lifted);
    },
    onUpdate: (e) => {
      'worklet';
      const z = liveZoom.get();
      const to = moveBy(start.get(), e.translationX - startX.get(), e.translationY - startY.get(), z);
      const snap = snapFrame(to, others.get(), SNAP_DISTANCE, z);
      x.set(snap.frame.x);
      y.set(snap.frame.y);
      // The selection overlay follows the card.
      live.set({ index, frame: snap.frame });
      const caught =
        (snap.x !== undefined && snap.x !== snapX.get()) || (snap.y !== undefined && snap.y !== snapY.get());
      snapX.set(snap.x ?? NaN);
      snapY.set(snap.y ?? NaN);
      if (caught) scheduleOnRN(snapped);
    },
    onDeactivate: () => {
      'worklet';
      finish();
    },
  });

  // A tap brings the card to the front. TODO(Expo 7 slices 3 and 4): a tap
  // opens the note editor or the full-screen reader on phones (§8); on
  // tablets a small card zooms to itself and a wide reader card scrolls (§6.1).
  const tap = useTapGesture({
    onActivate: () => {
      'worklet';
      scheduleOnRN(tapped);
    },
  });

  const gesture = useExclusiveGestures(drag, tap);

  // The live frame, a resize's or this card's drag's, wins until the read-back.
  const frameStyle = useAnimatedStyle(() => {
    const o = origin.get();
    const l = live.get();
    const f = l !== null && l.index === index ? l.frame : { x: x.get(), y: y.get(), width: w.get(), height: h.get() };
    return {
      left: f.x - o.x,
      top: f.y - o.y,
      width: f.width,
      height: f.height,
      zIndex: raised.get() ? 1 : 0,
      transform: [
        { scale: withTiming(moving.get() ? LIFT_SCALE : 1, { duration: LIFT_MS, reduceMotion: ReduceMotion.System }) },
      ],
    };
  });

  // The landing highlight fades out by HIGHLIGHT_MS; with Reduce Motion it
  // stays still until the screen takes it away (§7.2, §9).
  const glow = useSharedValue(0);
  useEffect(() => {
    if (!highlighted) {
      glow.set(0);
      return;
    }
    glow.set(1);
    if (!reducedMotion) {
      glow.set(
        withDelay(
          HIGHLIGHT_MS - HIGHLIGHT_FADE_MS,
          withTiming(0, { duration: HIGHLIGHT_FADE_MS, reduceMotion: ReduceMotion.Never }),
        ),
      );
    }
  }, [highlighted, reducedMotion, glow]);
  const glowStyle = useAnimatedStyle(() => ({ opacity: glow.get() }));

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
  const accent = material ? m3.primary : colors.accent;
  const edge = cardEdge(scheme === 'dark', material ? m3.outline : colors.outline);
  // L1 is a solid block in its kind's colour with the glyph on it.
  const block = level === 1 ? kindFill(card.kind, look, colors, m3) : undefined;
  // The edge and the landing highlight are in screen points, so divided by the zoom.
  const pt = 1 / zoom;
  const ring = (width: number, offset: number) => ({
    top: -(width + offset) * pt,
    left: -(width + offset) * pt,
    right: -(width + offset) * pt,
    bottom: -(width + offset) * pt,
    borderWidth: width * pt,
    borderRadius: radii.studyCard + (width + offset) * pt,
    borderColor: accent,
  });

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        accessible
        accessibilityRole="button"
        accessibilityLabel={card.accessibilityLabel}
        accessibilityState={{ selected }}
        accessibilityActions={ACTIONS}
        onAccessibilityAction={(e) => onAction(card, e.nativeEvent.actionName as CardAction)}
        style={[styles.frame, frameStyle]}
      >
        <View
          {...hidden}
          style={[
            styles.card,
            {
              backgroundColor: block?.fill ?? cardFill(look, scheme === 'dark', colors, m3),
              // 1 pt on screen once the camera settles. The L1 block needs no
              // edge beyond its fill, except a missing card's dashes.
              borderColor: block === undefined ? edge.border : block.ink,
              borderWidth: block === undefined || card.missing ? pt : 0,
              borderRadius: radii.studyCard,
              // Missing is said in the label and shown in words, not by the dashes alone.
              borderStyle: card.missing ? 'dashed' : 'solid',
              // Light canvases carry the edge with the guide's soft shadow.
              boxShadow: block === undefined ? edge.shadow : undefined,
            },
          ]}
        >
          <View
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
        {highlighted && (
          <Animated.View {...hidden} pointerEvents="none" style={[styles.ring, ring(HIGHLIGHT_WIDTH, 0), glowStyle]} />
        )}
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  frame: { position: 'absolute' },
  card: { ...StyleSheet.absoluteFill, overflow: 'hidden' },
  content: { transformOrigin: 'left top', padding: spacing.md, gap: spacing.xs },
  glyphOnly: { padding: 0, alignItems: 'center', justifyContent: 'center' },
  title: { fontWeight: '600' },
  ring: { position: 'absolute' },
});
