import { type ComponentRef, type Ref, useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  GestureDetector,
  type PanGesture,
  Pressable,
  useExclusiveGestures,
  usePanGesture,
  useTapGesture,
} from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  ReduceMotion,
  type SharedValue,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { ScaledSymbol } from '@/components/scaled-symbol';
import { UIText } from '@/components/text';
import { useBerean } from '@/design/theme';
import { hairline, radii, spacing } from '@/design/tokens';
import type { SymbolName } from '@/notes/list-rows';
import type { LiveFrame, Rect } from '@/studyspace/camera';
import {
  cardEdge,
  cardFill,
  cardText,
  kindFill,
  readerText,
  type ReaderText,
  titleScale,
  touchScrolls,
  type CardKind,
} from '@/studyspace/cards';
import type { CardView } from '@/studyspace/data';
import { type CardAction, dragFrame, type Guide, lineChanged, SNAP_DISTANCE, snapGuides } from '@/studyspace/edit';
import { liftHaptic, snapHaptic } from '@/studyspace/haptics';
import { LiveReader, ReaderSnippet, useReaderPlace } from '@/studyspace/reader-card';

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
// §9: a reader card's Read does what its tap does: focus it, or on a phone open the full-screen reader.
const READ_ACTION = { name: 'read', label: 'Read' } as const;
const READER_ACTIONS = [READ_ACTION, ...ACTIONS];

// §4.1: a long press lifts a card.
const LONG_PRESS_MS = 500;
// The lift: a slight grow while the card follows the finger.
const LIFT_SCALE = 1.02;
const LIFT_MS = 120;
// §7.2: the landing highlight is a 3 pt outline that fades by about 1.5 s.
const HIGHLIGHT_WIDTH = 3;
const HIGHLIGHT_FADE_MS = 400;
export const HIGHLIGHT_MS = 1500;
// Lumen: a snap springs, stiff and short with no overshoot; with Reduce
// Motion it jumps (§9).
const SNAP_SPRING = { duration: 160, dampingRatio: 1, reduceMotion: ReduceMotion.System } as const;
// The snap guides run this far past the cards they join, in screen points.
const GUIDE_OVERHANG = 8;
// §6.1: a focused reader card's outline is 3 pt.
const FOCUS_WIDTH = 3;
// Room the card's title leaves for Done, in screen points.
const DONE_ROOM = 80;

type StudyCardProps = {
  ref?: Ref<ComponentRef<typeof View>>;
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
  /**
   * How far the card at `live`'s index is drawn from its live frame, in
   * canvas units: a snap's spring, settling to 0. The overlay adds it too.
   */
  springX: SharedValue<number>;
  springY: SharedValue<number>;
  /** The snap guides a drag has caught now, for the canvas's overlay to draw. */
  guides: SharedValue<Guide[]>;
  /** Set while any card is moved or resized, so the canvas stays put. */
  editing: SharedValue<boolean>;
  /** Spoken; the canvas's selection overlay draws the outline and handle. */
  selected: boolean;
  /** Just added: the landing highlight shows. */
  highlighted: boolean;
  /** The focused reader card (§6.1): its 3 pt outline and Done show, and "focused" is spoken. */
  focused: boolean;
  /** The canvas's one-finger pan, which a live reader card's scroll blocks (§6.1). */
  canvasPan: PanGesture;
  onLift: (id: bigint) => void;
  /**
   * A tap, or a reader card's Read action; `verse` is a passage card's
   * verse now (where its reader is, else its first), for the announcement.
   */
  onTap: (id: bigint, verse: number | undefined) => void;
  /** Done on the focused card. */
  onDone: (id: bigint) => void;
  /** A live reader card's text began to scroll (§6.6 touch_item, once a session). */
  onRead: (id: bigint) => void;
  /** A move ended at `frame`. */
  onCommit: (id: bigint, frame: Rect) => void;
  onAction: (card: CardView, action: CardAction) => void;
};

/**
 * One card on the canvas, at its frame in canvas points relative to the
 * content layer's box (the content layer places and zooms it). Below 48 pt
 * on screen, or too short for one whole title line, a solid block in its
 * kind's colour with the glyph on it (kindFill); otherwise as many whole
 * title lines as fit (up to 2) at the reader's text size, never smaller.
 * Passage and publication cards are readers (readerText): at L3 about 3
 * lines from their anchor, at L4 their live text, scrolled by one finger
 * (§6.1) and saved where it settles (§6.6).
 *
 * A long press lifts the card and it follows the finger, snapping to other
 * cards (§4.2) with a short spring and guides in the canvas's overlay, on
 * the UI thread, telling JS once, on release. A selected
 * card's outline and resize handle are the canvas's selection overlay,
 * above every card; a resize reaches the card through `live`.
 */
export function StudyCard(props: StudyCardProps) {
  const { ref, card, zoom, fontScale, origin, liveZoom, frames, index, live, editing, selected, highlighted } = props;
  const { springX, springY, guides, focused } = props;
  const { canvasPan, onLift, onTap, onDone, onRead, onCommit, onAction } = props;
  const { look, scheme, colors, m3, type } = useBerean();
  const material = look === 'material';
  const reducedMotion = useReducedMotion();
  const { frame } = card;

  // The title layer is laid out at frame / up, then scaled back up inside
  // the zoomed card: below 100% its text stays at the reader's size on
  // screen; at 100% and above (up = 1) it is canvas-sized and grows with
  // the zoom, wrapping at the card's width.
  const up = titleScale(zoom);
  // Only whole lines fit in that layer's height, so none is cut mid-letter.
  const metrics = {
    padding: spacing.md,
    gap: spacing.xs,
    lineHeight: (type.ui.body.lineHeight ?? 0) * fontScale,
    captionLineHeight: (type.ui.caption.lineHeight ?? 0) * fontScale,
  };
  const reader = card.reader;
  const { level, titleLines, caption, bodyLines, bodyScale }: ReaderText =
    reader === undefined
      ? { ...cardText(frame, zoom, fontScale, metrics, card.missing), bodyLines: 0, bodyScale: 1 }
      : readerText(
          frame,
          zoom,
          fontScale,
          {
            ...metrics,
            bodySize: type.reading.scripture.fontSize ?? 0,
            bodyLineHeight: (type.reading.scripture.lineHeight ?? 0) * fontScale,
          },
          card.missing,
        );

  // A reader card's text, read once it first draws at L3 or L4 and kept
  // for this card's text, so pans and zooms never read it again; and where
  // its reader is (useReaderPlace).
  const { key: textKey, read, shown: text, place, at, saver, settled } = useReaderPlace(card.id, reader, bodyLines > 0);
  const shown = bodyLines > 0 ? text : undefined;
  // A focused card scrolls at any level with live text; that is L4 only, as for touch.
  const scrolls = shown !== undefined && touchScrolls(card.kind, level);

  // §6.6: saved once a scroll settles, debounced; flushed when the card
  // stops scrolling (it left L4), leaves focus, or unmounts.
  useEffect(() => {
    if (!scrolls || !focused) saver.flush();
  }, [scrolls, focused, saver]);

  // The verse a focus announces (§9): where a passage card's reader is, else the span's first.
  const verse =
    reader?.card.kind !== 'passage'
      ? undefined
      : (place?.key ?? reader.saved?.at.verse ?? reader.card.span.start.verse);

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
  const tapped = () => onTap(card.id, verse);
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
  // Declared before the worklets that call them, which capture them when created.
  const settleSprings = () => {
    'worklet';
    cancelAnimation(springX);
    cancelAnimation(springY);
    springX.set(0);
    springY.set(0);
    guides.set([]);
  };

  /** Spring an axis from where the card is drawn (its old target plus the spring) to its new target. */
  const springTo = (spring: SharedValue<number>, was: number, to: number) => {
    'worklet';
    spring.set(spring.get() + was - to);
    spring.set(withSpring(0, SNAP_SPRING));
  };

  // The release commits the snap's target, so a spring still settling ends there.
  const finish = () => {
    'worklet';
    if (!active.get()) return;
    active.set(false);
    moving.set(false);
    editing.set(false);
    settleSprings();
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
      settleSprings();
      scheduleOnRN(lifted);
    },
    onUpdate: (e) => {
      'worklet';
      const z = liveZoom.get();
      const near = others.get();
      const dx = e.translationX - startX.get();
      const dy = e.translationY - startY.get();
      const snap = dragFrame(start.get(), dx, dy, z, near, SNAP_DISTANCE);
      // A catch starting, ending or moving to another line springs the card
      // there; otherwise it is the target exactly, 1:1 with the finger when unsnapped.
      if (lineChanged(snapX.get(), snap.x)) springTo(springX, x.get(), snap.frame.x);
      if (lineChanged(snapY.get(), snap.y)) springTo(springY, y.get(), snap.frame.y);
      x.set(snap.frame.x);
      y.set(snap.frame.y);
      // The selection overlay follows the card, and draws the guides.
      live.set({ index, frame: snap.frame });
      guides.set(snapGuides(snap, near, GUIDE_OVERHANG / z));
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

  // A tap, by mouse or finger: the canvas decides what it does (tapAction):
  // on a tablet a reader card is focused (§6.1), on a phone it opens the
  // full-screen reader or the note editor (§8); either way it comes to the front.
  const tap = useTapGesture({
    onActivate: () => {
      'worklet';
      scheduleOnRN(tapped);
    },
  });

  const gesture = useExclusiveGestures(drag, tap);

  // The live frame, a resize's or this card's drag's, wins until the read-back, with a snap's spring.
  const frameStyle = useAnimatedStyle(() => {
    const o = origin.get();
    const l = live.get();
    const mine = l !== null && l.index === index;
    const f = mine ? l.frame : { x: x.get(), y: y.get(), width: w.get(), height: h.get() };
    const sx = mine ? springX.get() : 0;
    const sy = mine ? springY.get() : 0;
    return {
      left: f.x + sx - o.x,
      top: f.y + sy - o.y,
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

  const ink = material ? m3.onSurface : colors.text;
  const secondary = material ? m3.onSurfaceVariant : colors.textSecondary;
  const accent = material ? m3.primary : colors.accent;
  const edge = cardEdge(scheme === 'dark', material ? m3.outline : colors.outline);
  // L1 is a solid block in its kind's colour with the glyph on it.
  const block = level === 1 ? kindFill(card.kind, look, colors, m3) : undefined;
  // The edge, the landing highlight, the focus outline and Done are in screen points, so divided by the zoom.
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

  // The card as one button: its label and actions. A reader card showing
  // text (L3, L4) is the button behind its text instead, so a screen reader
  // reads the text, and scrolls it at L4, on its own (§9). So is a focused
  // card, so its Done is an element of its own.
  const withBody = bodyLines > 0;
  const behind = withBody || focused;
  const button = {
    accessible: true,
    accessibilityRole: 'button',
    accessibilityLabel: card.accessibilityLabel,
    accessibilityState: { selected },
    accessibilityValue: focused ? { text: 'focused' } : undefined,
    accessibilityActions: reader === undefined || card.missing ? ACTIONS : READER_ACTIONS,
    onAccessibilityAction: (e: { nativeEvent: { actionName: string } }) => {
      if (e.nativeEvent.actionName === READ_ACTION.name) tapped();
      else onAction(card, e.nativeEvent.actionName as CardAction);
    },
  } as const;

  const content = (
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
          <Text
            {...(withBody ? hidden : {})}
            numberOfLines={titleLines}
            // Clear of Done, in screen points (content points are 1 / (zoom × up) of one).
            style={[type.ui.body, styles.title, { color: ink }, focused && { marginEnd: (DONE_ROOM * pt) / up }]}
          >
            {card.title}
          </Text>
          {caption && (
            <Text numberOfLines={1} style={[type.ui.caption, { color: secondary }]}>
              {card.kind === 'note' ? 'Note deleted' : 'Not on this device'}
            </Text>
          )}
          {withBody && read?.ok === false && (
            <Text numberOfLines={2} style={[type.ui.caption, { color: secondary }]}>
              {read.message}
            </Text>
          )}
          {shown !== undefined && at !== undefined && level === 3 && (
            <ReaderSnippet rows={shown.rows} at={at} lines={bodyLines} scale={bodyScale} />
          )}
          {shown !== undefined && at !== undefined && level === 4 && (
            <LiveReader
              // Reflowed text (a new size or width) opens again at the anchor (§6.3); so
              // does a place saved elsewhere (the full-screen reader).
              key={`${bodyScale}:${frame.width}:${textKey}`}
              rows={shown.rows}
              start={at}
              scale={bodyScale}
              canvasPan={canvasPan}
              onScrollStart={() => onRead(card.id)}
              onMoving={saver.cancel}
              onSettle={settled}
            />
          )}
        </>
      )}
    </View>
  );

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        ref={behind ? undefined : ref}
        {...(behind ? { accessible: false } : button)}
        style={[styles.frame, frameStyle]}
      >
        <View
          ref={behind ? ref : undefined}
          {...(behind ? button : hidden)}
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
          {!withBody && content}
        </View>
        {withBody && <View style={[styles.card, { borderRadius: radii.studyCard }]}>{content}</View>}
        {highlighted && (
          <Animated.View {...hidden} pointerEvents="none" style={[styles.ring, ring(HIGHLIGHT_WIDTH, 0), glowStyle]} />
        )}
        {/* Focused is never colour alone: the outline's weight, Done, and "focused" spoken (§6.1, §9). */}
        {focused && <View {...hidden} pointerEvents="none" style={[styles.ring, ring(FOCUS_WIDTH, 0)]} />}
        {focused && (
          <DoneButton
            title={card.title}
            scale={pt}
            onPress={() => onDone(card.id)}
            // Done takes its own taps, not the card's tap or lift.
            block={[tap, drag]}
          />
        )}
      </Animated.View>
    </GestureDetector>
  );
}

/**
 * The focused card's Done (§6.1), at the trailing end of its header, the
 * same size on screen at any zoom (`scale` is 1 / zoom). The iOS look: a
 * glass capsule, approximated as the search field's (a raised translucent
 * capsule with a hairline edge), 44 pt hit. Material: a tonal text button,
 * 48 dp hit. A real button, so Switch Control finds it (§9).
 */
function DoneButton({ title, scale, onPress, block }: {
  title: string;
  scale: number;
  onPress: () => void;
  block: Parameters<typeof Pressable>[0]['block'];
}) {
  const { look, colors, m3 } = useBerean();
  const material = look === 'material';
  const hit = material ? 48 : 44;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Done"
      accessibilityHint={`Leaves ${title}`}
      onPress={onPress}
      block={block}
      style={[
        styles.done,
        { minHeight: hit, minWidth: hit, transform: [{ scale }] },
      ]}
    >
      {({ pressed }) => (
        <View
          style={[
            styles.doneFace,
            material
              ? { backgroundColor: m3.secondaryContainer }
              : { backgroundColor: colors.surfaceRaised, borderColor: colors.separator, borderWidth: hairline },
            { opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <UIText style={[styles.doneLabel, { color: material ? m3.onSecondaryContainer : colors.accent }]}>Done</UIText>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  frame: { position: 'absolute' },
  card: { ...StyleSheet.absoluteFill, overflow: 'hidden' },
  content: { transformOrigin: 'left top', padding: spacing.md, gap: spacing.xs },
  glyphOnly: { padding: 0, alignItems: 'center', justifyContent: 'center' },
  title: { fontWeight: '600' },
  ring: { position: 'absolute' },
  // At the card's top trailing corner, scaled about it.
  done: {
    position: 'absolute',
    top: 0,
    right: 0,
    transformOrigin: 'right top',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  doneFace: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radii.capsule },
  doneLabel: { fontWeight: '600' },
});
