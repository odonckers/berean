import { type ComponentRef, type Ref, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, type LayoutChangeEvent, StyleSheet, useWindowDimensions, View } from 'react-native';
import {
  GestureDetector,
  usePanGesture,
  usePinchGesture,
  useSimultaneousGestures,
  useTapGesture,
} from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';

import { useBerean } from '@/design/theme';
import { radii } from '@/design/tokens';
import { useWindowClass } from '@/design/use-window-class';
import {
  ANDROID_DECAY,
  type Camera,
  IOS_DECAY,
  type Point,
  type Rect,
  type Size,
  type ZoomLimits,
  cameraAbout,
  cameraBetween,
  clamp,
  contentTransform,
  doubleTapTarget,
  fitAll,
  fitPadding,
  gestureRange,
  gridOffset,
  hitsFrame,
  inertia,
  inertiaProgress,
  layerBox,
  type LiveFrame,
  nearZoom,
  restoreCamera,
  rubberBandZoom,
  screenToCanvas,
  selectionRect,
  settleZoom,
  zoomAbout,
} from '@/studyspace/camera';
import { StudyCard } from '@/studyspace/card';
import type { CardView } from '@/studyspace/data';
import { dotGridBackground } from '@/studyspace/dot-grid';
import { type CardAction, type Guide, guideOnScreen, resizeBy } from '@/studyspace/edit';
import { resizeHaptic } from '@/studyspace/haptics';

/** An automatic camera move: zoom in log space, about `focal` if there is one. */
type Flight = { from: Camera; to: Camera; focal?: Point };

// §3.6: the settle spring is SwiftUI's .smooth (0.5 s, no bounce); with
// Reduce Motion the pinch settle is a 150 ms ease-out instead. Every
// animation here picks its own Reduce Motion behaviour, so none defer to
// Reanimated's (which would jump inertia to its end).
const SETTLE_SPRING = { duration: 500, dampingRatio: 1, reduceMotion: ReduceMotion.Never } as const;
const REDUCED_SETTLE = { duration: 150, easing: Easing.out(Easing.cubic), reduceMotion: ReduceMotion.Never } as const;
// §4.1: double tap within 450 ms.
const DOUBLE_TAP_MS = 450;
// A spring seeded faster than this (in progress per second) would overshoot visibly.
const MAX_SEED = 10;

// Guide §4's dot grid: 1 px dots every 14 px on phones, 1.2 px every 28 px
// on tablets, in canvasDot, drawn as a repeating radial-gradient background
// (dotGridBackground) so it needs no image assets.
const DOT_GRIDS = {
  phone: { spacing: 14, dot: 1 },
  tablet: { spacing: 28, dot: 1.2 },
} as const;

// §7.1: the selected outline is 2 pt, 3 pt off the card; the handle 8 pt.
const SELECTED_WIDTH = 2;
const SELECTED_OFFSET = 3;
const HANDLE = 8;
// §4.2: a snap guide is a 1 pt line.
const GUIDE_WIDTH = 1;

/** The camera and view size now, an automatic move of the camera, and a card's screen-reader focus. */
export type CanvasHandle = {
  view: () => { camera: Camera; size: Size } | undefined;
  /** Pan to `camera` with the settle spring; a jump with Reduce Motion (§7.2). */
  moveTo: (camera: Camera) => void;
  /** Move VoiceOver / TalkBack focus to card `id`; false if it hasn't rendered yet. */
  focusCard: (id: bigint) => boolean;
};

type CanvasProps = {
  ref?: Ref<CanvasHandle>;
  cards: readonly CardView[];
  /** The workspace's saved camera; none the first time (it opens at fit-all). */
  saved: Camera | undefined;
  limits: ZoomLimits;
  selected: bigint | undefined;
  /** The card just added, while its landing highlight shows. */
  highlighted: bigint | undefined;
  /** The camera once a gesture or its animation has come to rest; never per frame. */
  onSettle: (camera: Camera) => void;
  onLiftCard: (id: bigint) => void;
  onTapCard: (id: bigint) => void;
  /** A card's move or resize ended at `frame`. */
  onCommitCard: (id: bigint, frame: Rect) => void;
  onCardAction: (card: CardView, action: CardAction) => void;
  onTapEmpty: () => void;
};

/**
 * A workspace's canvas (findings §3): one finger pans, pinch zooms about
 * the fingers, rubber-banding past the zoom limits and springing back;
 * double tap on empty canvas toggles 100% at the tap and fit-all; a tap
 * there clears the selection. Cards lift on a long press and move
 * (StudyCard); the selected one resizes by the handle in the selection
 * overlay, drawn in screen points above the content layer. All of it runs
 * on the UI thread on one translated and scaled content layer (and the
 * overlay that tracks it); the JS thread hears only where the camera settles
 * and where a card ends up. Mount one per workspace (key it by id): the
 * saved camera is read once, at the first layout.
 */
export function Canvas(props: CanvasProps) {
  const { ref, cards, saved, limits, selected, highlighted, onSettle, onTapEmpty } = props;
  const { onLiftCard, onTapCard, onCommitCard, onCardAction } = props;
  const { look, colors, m3 } = useBerean();
  const reducedMotion = useReducedMotion();
  const { fontScale } = useWindowDimensions();
  const decay = look === 'ios' ? IOS_DECAY : ANDROID_DECAY;
  const grid = DOT_GRIDS[useWindowClass() === 'compact' ? 'phone' : 'tablet'];
  const gridSpacing = grid.spacing;
  const gridBackground = useMemo(
    () => dotGridBackground(colors.canvasDot, grid.spacing, grid.dot),
    [colors.canvasDot, grid],
  );

  const [view, setView] = useState<Size>();
  // Levels and title sizes follow the settled zoom, not every frame.
  const [settledZoom, setSettledZoom] = useState(1);
  const frames = useMemo<Rect[]>(() => cards.map((c) => c.frame), [cards]);
  // The content layer's box holds every card, so Android (which clips a
  // child's accessibility bounds and touches to its parent's untransformed
  // box) sees whole cards at any zoom. The cards sit at their frames less
  // its top-left; both read it from one shared value, so a card moved by a
  // drag and the box it grows land together.
  const box = useMemo(() => layerBox(frames), [frames]);
  const origin = useSharedValue<Rect>(box);
  useEffect(() => {
    origin.set(box);
  }, [box, origin]);
  // A card is being moved or resized.
  const editing = useSharedValue(false);
  // The frame a card's drag or the handle's resize has now. It stays after
  // the release until the frames are read back (below), so nothing snaps
  // back between the commit and the read.
  const live = useSharedValue<LiveFrame | null>(null);
  // A snap's spring on the live frame's card, and the guides its drag has caught.
  const springX = useSharedValue(0);
  const springY = useSharedValue(0);
  const guides = useSharedValue<Guide[]>([]);
  // Each card's view, for moving screen-reader focus to it.
  const cardViews = useRef(new Map<bigint, ComponentRef<typeof View>>());
  const selectedIndex = cards.findIndex((c) => c.id === selected);
  const chosen = useSharedValue(selectedIndex);

  const cx = useSharedValue(0);
  const cy = useSharedValue(0);
  const cz = useSharedValue(1);
  const vw = useSharedValue(0);
  const vh = useSharedValue(0);
  const flight = useSharedValue<Flight | null>(null);
  const progress = useSharedValue(0);
  const fit = useSharedValue<Camera>({ x: 0, y: 0, zoom: 1 });
  const hitFrames = useSharedValue<Rect[]>([]);
  const panning = useSharedValue(false);
  const pinching = useSharedValue(false);
  const gliding = useSharedValue(false);
  // The camera moved since it last settled.
  const moved = useSharedValue(false);
  const pinchStart = useSharedValue(1);
  const pinchMin = useSharedValue(limits.min);
  const pinchMax = useSharedValue(limits.max);
  const focalX = useSharedValue(0);
  const focalY = useSharedValue(0);

  useEffect(() => {
    hitFrames.set(frames);
    live.set(null);
  }, [frames, hitFrames, live]);
  useEffect(() => {
    if (view !== undefined) fit.set(fitAll(frames, view, fitPadding(view), limits));
  }, [frames, view, limits, fit]);
  useEffect(() => {
    chosen.set(selectedIndex);
  }, [selectedIndex, chosen]);

  const onLayout = (e: LayoutChangeEvent) => {
    const size = { width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height };
    vw.set(size.width);
    vh.set(size.height);
    if (view === undefined) {
      const camera = restoreCamera(saved, frames, size, limits);
      cx.set(camera.x);
      cy.set(camera.y);
      cz.set(camera.zoom);
      setSettledZoom(camera.zoom);
    }
    // The camera is the view's centre, so a new size (rotation) keeps it.
    setView(size);
  };

  const settled = (x: number, y: number, zoom: number) => {
    setSettledZoom(zoom);
    onSettle({ x, y, zoom });
  };

  const size = (): Size => {
    'worklet';
    return { width: vw.get(), height: vh.get() };
  };

  const camera = (): Camera => {
    'worklet';
    const f = flight.get();
    if (f !== null) return cameraBetween(f.from, f.to, progress.get(), size(), f.focal);
    return { x: cx.get(), y: cy.get(), zoom: cz.get() };
  };

  const setCamera = (c: Camera) => {
    'worklet';
    cx.set(c.x);
    cy.set(c.y);
    cz.set(c.zoom);
  };

  /** Stop any glide or flight where it is now. */
  const halt = () => {
    'worklet';
    if (flight.get() !== null) {
      const now = camera();
      flight.set(null);
      cancelAnimation(progress);
      setCamera(now);
    }
    if (gliding.get()) {
      gliding.set(false);
      cancelAnimation(cx);
      cancelAnimation(cy);
    }
  };

  /** Tell JS where the camera came to rest, once nothing moves it. */
  const settle = () => {
    'worklet';
    if (!moved.get() || panning.get() || pinching.get() || gliding.get() || flight.get() !== null) return;
    moved.set(false);
    scheduleOnRN(settled, cx.get(), cy.get(), cz.get());
  };

  /** An automatic move to `to` with the settle spring, seeded with `velocity` (progress per second). */
  const fly = (to: Camera, focal: Point | undefined, velocity: number) => {
    'worklet';
    halt();
    moved.set(true);
    flight.set({ from: camera(), to, focal });
    progress.set(0);
    const landed = (finished?: boolean) => {
      'worklet';
      // Cut short by a new gesture, which halt() has already taken over.
      if (!finished) return;
      flight.set(null);
      setCamera(to);
      settle();
    };
    progress.set(
      reducedMotion
        ? withTiming(1, REDUCED_SETTLE, landed)
        : withSpring(1, { ...SETTLE_SPRING, velocity: clamp(velocity, -MAX_SEED, MAX_SEED) }, landed),
    );
  };

  /**
   * Pan inertia (§3.5): v0 · rate^t, rate per ms by look. Reanimated's
   * withDecay doesn't decay geometrically, so a timing animation follows
   * the formula through its easing instead.
   */
  const glide = (vx: number, vy: number) => {
    'worklet';
    const speed = Math.hypot(vx, vy);
    const { distance, duration } = inertia(speed, decay);
    if (duration <= 0) return;
    const zoom = cz.get();
    const easing = (u: number) => {
      'worklet';
      return inertiaProgress(u, decay, duration);
    };
    gliding.set(true);
    const config = { duration, easing, reduceMotion: ReduceMotion.Never };
    cx.set(withTiming(cx.get() - (distance * vx) / speed / zoom, config));
    cy.set(
      withTiming(cy.get() - (distance * vy) / speed / zoom, config, (finished) => {
        'worklet';
        if (!finished) return;
        gliding.set(false);
        settle();
      }),
    );
  };

  // One finger on the canvas pans; two belong to the pinch.
  // TODO(§3.4): rubber-band past the soft bounds (the cards' box plus one
  // view each side) and fling into them; the canvas is unbounded for now.
  const pan = usePanGesture({
    maxPointers: 1,
    onBegin: () => {
      'worklet';
      // A finger down catches a glide or a settle where it is.
      if (gliding.get() || flight.get() !== null) moved.set(true);
      halt();
    },
    onActivate: () => {
      'worklet';
      panning.set(true);
      moved.set(true);
    },
    onUpdate: (e) => {
      'worklet';
      // A lifted card's drag cancels this pan; the check keeps the canvas still regardless.
      if (pinching.get() || editing.get()) return;
      const zoom = cz.get();
      cx.set(cx.get() - e.changeX / zoom);
      cy.set(cy.get() - e.changeY / zoom);
    },
    onDeactivate: (e) => {
      'worklet';
      panning.set(false);
      if (!pinching.get() && !editing.get() && !e.canceled) glide(e.velocityX, e.velocityY);
      settle();
    },
    onFinalize: () => {
      'worklet';
      settle();
    },
  });

  // Pinch zooms about the fingers, and moving them pans. No zoom inertia.
  const pinch = usePinchGesture({
    onActivate: (e) => {
      'worklet';
      halt();
      pinching.set(true);
      moved.set(true);
      const zoom = cz.get();
      const range = gestureRange(limits, zoom);
      pinchStart.set(zoom);
      pinchMin.set(range.min);
      pinchMax.set(range.max);
      focalX.set(e.focalX);
      focalY.set(e.focalY);
    },
    onUpdate: (e) => {
      'worklet';
      const here = size();
      const zoom = rubberBandZoom(pinchStart.get() * e.scale, pinchMin.get(), pinchMax.get());
      // The canvas point under the fingers' last centre goes under their new one.
      const under = screenToCanvas(camera(), here, { x: focalX.get(), y: focalY.get() });
      setCamera(cameraAbout(under, { x: e.focalX, y: e.focalY }, zoom, here));
      focalX.set(e.focalX);
      focalY.set(e.focalY);
    },
    onDeactivate: (e) => {
      'worklet';
      pinching.set(false);
      const zoom = cz.get();
      const target = settleZoom(zoom, { min: pinchMin.get(), max: pinchMax.get() }, fit.get().zoom);
      if (target === zoom) {
        settle();
        return;
      }
      const focal = { x: focalX.get(), y: focalY.get() };
      // The fingers' zoom speed, in log space per second, as progress per second.
      const logSpeed = e.scale > 0 ? e.velocity / e.scale : 0;
      fly(zoomAbout(camera(), size(), focal, target), focal, logSpeed / Math.log(target / zoom));
    },
  });

  // Double tap on empty canvas: 100% at the tap ↔ fit-all (§3.2). Taps on
  // cards are theirs, and single taps are never delayed.
  const doubleTap = useTapGesture({
    numberOfTaps: 2,
    maxDelay: DOUBLE_TAP_MS,
    onActivate: (e) => {
      'worklet';
      halt();
      const here = size();
      const now = camera();
      const tap = { x: e.x, y: e.y };
      if (hitsFrame(hitFrames.get(), screenToCanvas(now, here, tap))) return;
      const target = doubleTapTarget(now, here, tap, fit.get());
      if (reducedMotion) {
        // §9: automatic camera moves jump with Reduce Motion.
        moved.set(true);
        setCamera(target);
        settle();
        return;
      }
      fly(target, nearZoom(now.zoom, 1) ? undefined : tap, 0);
    },
  });

  // A tap on empty canvas clears the selection (§7.1); a card's tap is its own.
  const tap = useTapGesture({
    onActivate: (e) => {
      'worklet';
      if (hitsFrame(hitFrames.get(), screenToCanvas(camera(), size(), { x: e.x, y: e.y }))) return;
      scheduleOnRN(onTapEmpty);
    },
  });

  const gesture = useSimultaneousGestures(pan, pinch, doubleTap, tap);

  const resizeStart = useSharedValue<Rect>({ x: 0, y: 0, width: 0, height: 0 });
  const resizeIndex = useSharedValue(-1);
  const resizeX = useSharedValue(0);
  const resizeY = useSharedValue(0);

  const resized = (x: number, y: number, width: number, height: number) => {
    if (selected !== undefined) onCommitCard(selected, { x, y, width, height });
  };

  // The selected card's resize handle (§4.3), in the selection overlay. It
  // takes the finger on its first move, and blocks the canvas's gestures
  // meanwhile; the cards' own gestures are not under it.
  const resize = usePanGesture({
    minDistance: 0,
    maxPointers: 1,
    block: [pan, tap, doubleTap],
    onActivate: (e) => {
      'worklet';
      const index = chosen.get();
      const l = live.get();
      const from = l !== null && l.index === index ? l.frame : hitFrames.get()[index];
      if (from === undefined) return;
      resizeIndex.set(index);
      resizeStart.set(from);
      resizeX.set(e.translationX);
      resizeY.set(e.translationY);
      editing.set(true);
      scheduleOnRN(resizeHaptic);
    },
    onUpdate: (e) => {
      'worklet';
      const index = resizeIndex.get();
      if (index < 0) return;
      const to = resizeBy(resizeStart.get(), e.translationX - resizeX.get(), e.translationY - resizeY.get(), cz.get());
      live.set({ index, frame: to });
    },
    onDeactivate: () => {
      'worklet';
      const index = resizeIndex.get();
      if (index < 0) return;
      resizeIndex.set(-1);
      editing.set(false);
      // `live` keeps the new frame until the frames are read back.
      const l = live.get();
      const to = l !== null && l.index === index ? l.frame : resizeStart.get();
      scheduleOnRN(resized, to.x, to.y, to.width, to.height);
    },
  });

  useImperativeHandle(ref, () => ({
    view: () => {
      if (view === undefined) return undefined;
      // Where the camera is headed if it is moving on its own.
      const f = flight.get();
      return { camera: f !== null ? f.to : { x: cx.get(), y: cy.get(), zoom: cz.get() }, size: view };
    },
    moveTo: (to: Camera) => {
      scheduleOnUI(() => {
        'worklet';
        if (!reducedMotion) {
          fly(to, undefined, 0);
          return;
        }
        // §9: automatic camera moves jump with Reduce Motion.
        halt();
        moved.set(true);
        setCamera(to);
        settle();
      });
    },
    focusCard: (id: bigint) => {
      const node = cardViews.current.get(id);
      if (node === undefined) return false;
      AccessibilityInfo.sendAccessibilityEvent(node, 'focus');
      return true;
    },
  }));

  // Reads every shared value itself: Reanimated finds a style's inputs in
  // its own closure, not in the helpers it calls. Laid out at its box, its
  // transform about the parent's (0,0): screen = translate + zoom · canvas,
  // whatever the box.
  const contentStyle = useAnimatedStyle(() => {
    const here = { width: vw.get(), height: vh.get() };
    const f = flight.get();
    const now =
      f !== null
        ? cameraBetween(f.from, f.to, progress.get(), here, f.focal)
        : { x: cx.get(), y: cy.get(), zoom: cz.get() };
    const t = contentTransform(now, here);
    const b = origin.get();
    return {
      left: b.x,
      top: b.y,
      width: b.width,
      height: b.height,
      transformOrigin: [-b.x, -b.y, 0],
      transform: [{ translateX: t.translateX }, { translateY: t.translateY }, { scale: t.scale }],
    };
  });

  // The dot grid keeps its screen size at any zoom and moves with the
  // canvas's translate, wrapped to one spacing: no per-frame JS.
  const gridStyle = useAnimatedStyle(() => {
    const here = { width: vw.get(), height: vh.get() };
    const f = flight.get();
    const now =
      f !== null
        ? cameraBetween(f.from, f.to, progress.get(), here, f.focal)
        : { x: cx.get(), y: cy.get(), zoom: cz.get() };
    const t = contentTransform(now, here);
    return {
      transform: [
        { translateX: gridOffset(t.translateX, gridSpacing) },
        { translateY: gridOffset(t.translateY, gridSpacing) },
      ],
    };
  });

  // The camera and view size now, through any flight, so the overlay
  // tracks pans, pinches and flights on the UI thread, every frame.
  const lens = useDerivedValue(() => {
    const here = { width: vw.get(), height: vh.get() };
    const f = flight.get();
    const now =
      f !== null
        ? cameraBetween(f.from, f.to, progress.get(), here, f.focal)
        : { x: cx.get(), y: cy.get(), zoom: cz.get() };
    return { camera: now, view: here };
  });

  // The selected card's frame on screen and the zoom, with a snap's spring as the card draws it.
  const selection = useDerivedValue(() => {
    const { camera: now, view: here } = lens.get();
    const l = live.get();
    const drawn =
      l === null
        ? null
        : { index: l.index, frame: { ...l.frame, x: l.frame.x + springX.get(), y: l.frame.y + springY.get() } };
    const rect = selectionRect(hitFrames.get(), drawn, chosen.get(), now, here);
    return rect === undefined ? null : { rect, zoom: now.zoom };
  });

  // The snap guides (§4.2), one per axis at most, 1 pt on screen.
  const guideXStyle = useAnimatedStyle(() => {
    const g = guides.get().find((d) => d.axis === 'x');
    if (g === undefined) return { display: 'none' as const };
    const { camera: now, view: here } = lens.get();
    const r = guideOnScreen(g, now, here, GUIDE_WIDTH);
    return { display: 'flex' as const, left: r.x, top: r.y, width: r.width, height: r.height };
  });
  const guideYStyle = useAnimatedStyle(() => {
    const g = guides.get().find((d) => d.axis === 'y');
    if (g === undefined) return { display: 'none' as const };
    const { camera: now, view: here } = lens.get();
    const r = guideOnScreen(g, now, here, GUIDE_WIDTH);
    return { display: 'flex' as const, left: r.x, top: r.y, width: r.width, height: r.height };
  });

  // Screen points, so no division by the zoom.
  const ringStyle = useAnimatedStyle(() => {
    const s = selection.get();
    if (s === null) return { display: 'none' as const };
    const reach = SELECTED_WIDTH + SELECTED_OFFSET;
    return {
      display: 'flex' as const,
      left: s.rect.x - reach,
      top: s.rect.y - reach,
      width: s.rect.width + 2 * reach,
      height: s.rect.height + 2 * reach,
      borderRadius: radii.studyCard * s.zoom + reach,
    };
  });

  // §4.1: the handle's hit area is 44 pt (iOS look) or 48 dp (Material), centred on the corner.
  const hit = look === 'material' ? 48 : 44;
  const handleStyle = useAnimatedStyle(() => {
    const s = selection.get();
    if (s === null) return { display: 'none' as const };
    return {
      display: 'flex' as const,
      left: s.rect.x + s.rect.width - hit / 2,
      top: s.rect.y + s.rect.height - hit / 2,
    };
  });
  const accent = look === 'material' ? m3.primary : colors.accent;

  return (
    <GestureDetector gesture={gesture}>
      <View
        onLayout={onLayout}
        style={[styles.canvas, { backgroundColor: colors.canvas }]}
      >
        {view !== undefined && (
          <Animated.View
            pointerEvents="none"
            accessible={false}
            importantForAccessibility="no-hide-descendants"
            accessibilityElementsHidden
            style={[
              styles.grid,
              { width: view.width + 2 * gridSpacing, height: view.height + 2 * gridSpacing },
              gridBackground,
              gridStyle,
            ]}
          />
        )}
        {view !== undefined && (
          <Animated.View style={[styles.content, contentStyle]}>
            {cards.map((card, index) => (
              <StudyCard
                key={String(card.id)}
                ref={(node) => {
                  if (node === null) return;
                  cardViews.current.set(card.id, node);
                  return () => {
                    cardViews.current.delete(card.id);
                  };
                }}
                card={card}
                zoom={settledZoom}
                fontScale={fontScale}
                origin={origin}
                liveZoom={cz}
                frames={hitFrames}
                index={index}
                live={live}
                springX={springX}
                springY={springY}
                guides={guides}
                editing={editing}
                selected={card.id === selected}
                highlighted={card.id === highlighted}
                onLift={onLiftCard}
                onTap={onTapCard}
                onCommit={onCommitCard}
                onAction={onCardAction}
              />
            ))}
          </Animated.View>
        )}
        {/* A drag's snap guides, in screen points above the cards, mounted before the lift selects the card. */}
        {view !== undefined && (
          <View
            pointerEvents="none"
            accessible={false}
            importantForAccessibility="no-hide-descendants"
            accessibilityElementsHidden
            style={StyleSheet.absoluteFill}
          >
            <Animated.View style={[styles.overlaid, { backgroundColor: accent }, guideXStyle]} />
            <Animated.View style={[styles.overlaid, { backgroundColor: accent }, guideYStyle]} />
          </View>
        )}
        {/*
          The selection overlay: after the content layer, so the selected
          card's outline and handle stay on top of every card, even one
          brought in front of it (as in Freeform and Keynote, selection
          chrome is always on top). Outside the content layer, so Android
          hit-tests the whole handle and the cards' gestures never see it.
        */}
        {view !== undefined && selectedIndex >= 0 && (
          <View
            pointerEvents="box-none"
            accessible={false}
            importantForAccessibility="no-hide-descendants"
            accessibilityElementsHidden
            style={StyleSheet.absoluteFill}
          >
            {/* Selected is never colour alone: the outline's weight, and "selected" spoken (§7.1). */}
            <Animated.View
              pointerEvents="none"
              style={[styles.overlaid, { borderWidth: SELECTED_WIDTH, borderColor: accent }, ringStyle]}
            />
            {/* Hidden from screen readers: the Size actions replace it. */}
            <GestureDetector gesture={resize}>
              <Animated.View style={[styles.handle, { width: hit, height: hit }, handleStyle]}>
                <View style={{ width: HANDLE, height: HANDLE, borderRadius: HANDLE / 2, backgroundColor: accent }} />
              </Animated.View>
            </GestureDetector>
          </View>
        )}
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  canvas: { flex: 1, overflow: 'hidden' },
  // At the cards' box (layerBox); the transform places and zooms it.
  content: { position: 'absolute' },
  // One spacing past the view on each side, so its offset in [−spacing, 0) always covers it.
  grid: { position: 'absolute', left: 0, top: 0 },
  overlaid: { position: 'absolute' },
  handle: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
});
