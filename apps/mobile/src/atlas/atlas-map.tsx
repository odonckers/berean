import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  type AccessibilityActionEvent,
  type LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type ViewStyle,
} from 'react-native';
import { GestureDetector, usePanGesture, usePinchGesture, useSimultaneousGestures, useTapGesture } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDecay,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Path, Polyline } from 'react-native-svg';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';

import {
  clampCamera,
  fitPoints,
  type MapHighlight,
  type Marker,
  markerAt,
  maxZoom,
  minZoom,
  placeLabels,
  toScreen,
  visibleRect,
} from '@/atlas/atlas';
import { LAND_PATH } from '@/atlas/basemap.generated';
import { MAP_SIZE } from '@/atlas/projection';
import { mix } from '@/design/appearance';
import { useBerean } from '@/design/theme';
import { type Camera, cameraAbout, clamp, screenToCanvas, type Size } from '@/studyspace/camera';

/**
 * The map's colours, from the theme, as a printed atlas has them: the sea
 * plain page, the land a step toward the text with a drawn coast. (Water
 * washed with the accent read as land in the earthy themes.)
 */
export function mapPalette(colors: { surface: string; text: string; textSecondary: string; accent: string }) {
  return {
    land: mix(colors.surface, colors.text, 0.09),
    water: colors.surface,
    coast: mix(colors.surface, colors.text, 0.38),
    dot: colors.textSecondary,
    accent: colors.accent,
    halo: colors.surface,
  };
}

type Palette = ReturnType<typeof mapPalette>;

/** Room kept round a fit for labels and the attribution. */
const FIT_PADDING = 44;
/** How far from a dot a tap still picks it. */
const TAP_REACH = 22;
const FLY = { duration: 420, easing: Easing.out(Easing.cubic) };
const LABEL_SIZE = 13;
/** Labels grow with the text size up to this, so they don't cover the map. */
const LABEL_SCALE_CAP = 1.6;

type Props = {
  markers: readonly Marker[];
  highlight: MapHighlight;
  /** When this changes the map flies to the highlight. */
  fitKey: string;
  /** Read out for the map as a whole: what it shows. */
  accessibilityLabel: string;
  onOpenPlace?: (id: string) => void;
  /** False for a still map (a place's own): no gestures. */
  interactive?: boolean;
  style?: ViewStyle;
};

/**
 * The Bible lands map: Natural Earth land, the selection's route and places,
 * and labels that fit. Pans and pinches like any map, held to the frame.
 *
 * Two layers: a whole-frame drawing moved by the camera on the UI thread
 * while fingers move it (scaled, so soft), and a view-sized drawing at the
 * camera where it came to rest, crisp, shown whenever the camera is there.
 * Labels are text, laid out for the resting camera, and fade while it moves.
 */
export function AtlasMap({
  markers,
  highlight,
  fitKey,
  accessibilityLabel,
  onOpenPlace,
  interactive = true,
  style,
}: Props) {
  const { colors } = useBerean();
  const palette = useMemo(() => mapPalette(colors), [colors]);
  const reducedMotion = useReducedMotion();
  const { fontScale } = useWindowDimensions();
  const labelScale = Math.min(fontScale, LABEL_SCALE_CAP);

  const [view, setView] = useState<Size | undefined>(undefined);
  const [rested, setRested] = useState<Camera | undefined>(undefined);

  const vw = useSharedValue(0);
  const vh = useSharedValue(0);
  const cx = useSharedValue(MAP_SIZE.width / 2);
  const cy = useSharedValue(MAP_SIZE.height / 2);
  const cz = useSharedValue(1);
  // Where the crisp layer was drawn; it shows while the camera is there.
  const rx = useSharedValue(Number.NaN);
  const ry = useSharedValue(Number.NaN);
  const rz = useSharedValue(Number.NaN);
  const pinching = useSharedValue(false);
  const pinchStart = useSharedValue(1);
  const focalX = useSharedValue(0);
  const focalY = useSharedValue(0);
  // Animations still running on the camera; it rests when none are.
  const running = useSharedValue(0);

  useEffect(() => {
    if (rested === undefined) return;
    rx.set(rested.x);
    ry.set(rested.y);
    rz.set(rested.zoom);
  }, [rested, rx, ry, rz]);

  const rest = (x: number, y: number, zoom: number) => setRested({ x, y, zoom });

  const settle = () => {
    'worklet';
    if (running.get() > 0 || pinching.get()) return;
    scheduleOnRN(rest, cx.get(), cy.get(), cz.get());
  };

  const halt = () => {
    'worklet';
    cancelAnimation(cx);
    cancelAnimation(cy);
    cancelAnimation(cz);
    running.set(0);
  };

  const place = (c: Camera) => {
    'worklet';
    const held = clampCamera(c, { width: vw.get(), height: vh.get() });
    cx.set(held.x);
    cy.set(held.y);
    cz.set(held.zoom);
  };

  const fly = (to: Camera, animate: boolean) => {
    'worklet';
    halt();
    const held = clampCamera(to, { width: vw.get(), height: vh.get() });
    if (!animate) {
      place(held);
      settle();
      return;
    }
    running.set(3);
    const done = (finished?: boolean) => {
      'worklet';
      if (!finished) return;
      running.set(running.get() - 1);
      settle();
    };
    cx.set(withTiming(held.x, FLY, done));
    cy.set(withTiming(held.y, FLY, done));
    cz.set(withTiming(held.zoom, FLY, done));
  };

  // The camera for the highlight; the first layout jumps there, later
  // selections fly.
  const laidOut = useRef(false);
  useEffect(() => {
    if (view === undefined) return;
    const target = fitPoints(highlight.fit, view, Math.min(FIT_PADDING * labelScale, view.width / 4));
    scheduleOnUI(fly, target, laidOut.current && !reducedMotion);
    laidOut.current = true;
    // Only a new selection or size moves the camera, not a re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, view]);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (view !== undefined && view.width === width && view.height === height) return;
    vw.set(width);
    vh.set(height);
    setView({ width, height });
  };

  const tapped = (x: number, y: number) => {
    if (view === undefined || onOpenPlace === undefined) return;
    const camera = { x: cx.get(), y: cy.get(), zoom: cz.get() };
    const hit = markerAt(markers, camera, view, { x, y }, TAP_REACH);
    if (hit !== undefined) onOpenPlace(hit.id);
  };

  const pan = usePanGesture({
    enabled: interactive,
    maxPointers: 1,
    onBegin: () => {
      'worklet';
      halt();
    },
    onUpdate: (e) => {
      'worklet';
      if (pinching.get()) return;
      const zoom = cz.get();
      place({ x: cx.get() - e.changeX / zoom, y: cy.get() - e.changeY / zoom, zoom });
    },
    onDeactivate: (e) => {
      'worklet';
      if (pinching.get() || e.canceled) {
        settle();
        return;
      }
      // A fling glides on, held to the frame.
      const zoom = cz.get();
      const here = { width: vw.get(), height: vh.get() };
      const halfW = here.width / 2 / zoom;
      const halfH = here.height / 2 / zoom;
      const done = (finished?: boolean) => {
        'worklet';
        if (!finished) return;
        running.set(running.get() - 1);
        settle();
      };
      running.set(2);
      cx.set(
        withDecay(
          { velocity: -e.velocityX / zoom, clamp: [halfW, Math.max(halfW, MAP_SIZE.width - halfW)], deceleration: 0.996 },
          done,
        ),
      );
      cy.set(
        withDecay(
          { velocity: -e.velocityY / zoom, clamp: [halfH, Math.max(halfH, MAP_SIZE.height - halfH)], deceleration: 0.996 },
          done,
        ),
      );
    },
  });

  // Pinch zooms about the fingers; moving them pans.
  const pinch = usePinchGesture({
    enabled: interactive,
    onActivate: (e) => {
      'worklet';
      halt();
      pinching.set(true);
      pinchStart.set(cz.get());
      focalX.set(e.focalX);
      focalY.set(e.focalY);
    },
    onUpdate: (e) => {
      'worklet';
      const here = { width: vw.get(), height: vh.get() };
      const zoom = clamp(pinchStart.get() * e.scale, minZoom(here), maxZoom(here));
      const camera = { x: cx.get(), y: cy.get(), zoom: cz.get() };
      const under = screenToCanvas(camera, here, { x: focalX.get(), y: focalY.get() });
      place(cameraAbout(under, { x: e.focalX, y: e.focalY }, zoom, here));
      focalX.set(e.focalX);
      focalY.set(e.focalY);
    },
    onDeactivate: () => {
      'worklet';
      pinching.set(false);
      settle();
    },
  });

  // Double tap zooms in about the tap, as maps do.
  const doubleTap = useTapGesture({
    enabled: interactive,
    numberOfTaps: 2,
    onActivate: (e) => {
      'worklet';
      const here = { width: vw.get(), height: vh.get() };
      const camera = { x: cx.get(), y: cy.get(), zoom: cz.get() };
      const under = screenToCanvas(camera, here, { x: e.x, y: e.y });
      fly(cameraAbout(under, { x: e.x, y: e.y }, Math.min(camera.zoom * 2, maxZoom(here)), here), !reducedMotion);
    },
  });

  // A tap on a place opens it.
  const tap = useTapGesture({
    enabled: interactive,
    onActivate: (e) => {
      'worklet';
      scheduleOnRN(tapped, e.x, e.y);
    },
  });

  const gesture = useSimultaneousGestures(pan, pinch, doubleTap, tap);

  const baseStyle = useAnimatedStyle(() => {
    const zoom = cz.get();
    return {
      transform: [
        { translateX: vw.get() / 2 - cx.get() * zoom },
        { translateY: vh.get() / 2 - cy.get() * zoom },
        { scale: zoom },
      ],
    };
  });

  const restedStyle = useAnimatedStyle(() => ({
    opacity: cx.get() === rx.get() && cy.get() === ry.get() && cz.get() === rz.get() ? 1 : 0,
  }));

  // Accessibility: the map reads as one adjustable element; swiping up or
  // down zooms. The places are listed beside it, and the labeled ones are
  // buttons after it.
  const zoomBy = (factor: number) => {
    if (view === undefined) return;
    const zoom = clamp(cz.get() * factor, minZoom(view), maxZoom(view));
    scheduleOnUI(fly, { x: cx.get(), y: cy.get(), zoom }, !reducedMotion);
    AccessibilityInfo.announceForAccessibility(factor > 1 ? 'Zoomed in' : 'Zoomed out');
  };
  const onAccessibilityAction = (e: AccessibilityActionEvent) => {
    if (e.nativeEvent.actionName === 'increment') zoomBy(1.6);
    if (e.nativeEvent.actionName === 'decrement') zoomBy(1 / 1.6);
  };

  const labels = useMemo(() => {
    if (view === undefined || rested === undefined) return [];
    const byId = new Map(markers.map((m) => [m.id, m]));
    const wanted = highlight.focus.flatMap((id) => {
      const m = byId.get(id);
      return m === undefined ? [] : [m];
    });
    return placeLabels(wanted, rested, view, LABEL_SIZE * labelScale, 10).map((l) => ({
      ...l,
      marker: byId.get(l.id)!,
    }));
  }, [view, rested, markers, highlight, labelScale]);

  return (
    <GestureDetector gesture={gesture}>
      <View
        style={[styles.map, { backgroundColor: palette.water }, style]}
        onLayout={onLayout}
        collapsable={false}
      >
        <Animated.View pointerEvents="none" style={[styles.base, baseStyle]}>
          <Svg width={MAP_SIZE.width} height={MAP_SIZE.height}>
            <MapArt palette={palette} markers={markers} highlight={highlight} zoom={rested?.zoom ?? 1} />
          </Svg>
        </Animated.View>
        {view !== undefined && rested !== undefined && (
          <Animated.View pointerEvents="box-none" style={[StyleSheet.absoluteFill, restedStyle]}>
            <Svg width={view.width} height={view.height} viewBox={viewBox(rested, view)} pointerEvents="none">
              <MapArt palette={palette} markers={markers} highlight={highlight} zoom={rested.zoom} />
            </Svg>
          </Animated.View>
        )}
        <View
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={accessibilityLabel}
          accessibilityHint={interactive ? 'Swipe up or down to zoom' : undefined}
          accessibilityActions={interactive ? [{ name: 'increment' }, { name: 'decrement' }] : undefined}
          onAccessibilityAction={onAccessibilityAction}
        />
        {view !== undefined && rested !== undefined && (
          <Animated.View pointerEvents="box-none" style={[StyleSheet.absoluteFill, restedStyle]}>
            {labels.map(({ id, side, marker }) => {
              const at = toScreen(rested, view, marker.at);
              const height = LABEL_SIZE * labelScale * 1.3;
              const gap = 9;
              const position =
                side === 'right' ? { left: at.x + gap } : { right: view.width - at.x + gap };
              return (
                <Pressable
                  key={id}
                  disabled={!interactive || onOpenPlace === undefined}
                  onPress={() => onOpenPlace?.(id)}
                  accessibilityRole="button"
                  accessibilityLabel={marker.name}
                  accessibilityHint={interactive ? 'Shows the place' : undefined}
                  hitSlop={10}
                  style={[styles.label, position, { top: at.y - height / 2, height }]}
                >
                  <Text
                    maxFontSizeMultiplier={LABEL_SCALE_CAP}
                    numberOfLines={1}
                    style={[
                      styles.labelText,
                      { color: colors.text, textShadowColor: palette.halo },
                    ]}
                  >
                    {marker.name}
                  </Text>
                </Pressable>
              );
            })}
          </Animated.View>
        )}
        <Text
          accessible={false}
          importantForAccessibility="no"
          maxFontSizeMultiplier={1.3}
          style={[styles.credit, { color: colors.textSecondary, backgroundColor: mix(palette.water, palette.land, 0.6) }]}
        >
          Pleiades · OpenBible.info · Natural Earth
        </Text>
      </View>
    </GestureDetector>
  );
}

function viewBox(camera: Camera, view: Size): string {
  const r = visibleRect(camera, view);
  return `${r.x} ${r.y} ${r.width} ${r.height}`;
}

/**
 * The drawing in map units. Line widths and dot sizes are given in points
 * and divided by `zoom`, so they're right at the camera they're drawn for.
 */
function MapArt({
  palette,
  markers,
  highlight,
  zoom,
}: {
  palette: Palette;
  markers: readonly Marker[];
  highlight: MapHighlight;
  zoom: number;
}) {
  const u = 1 / zoom;
  const focus = new Set(highlight.focus);
  const context = new Set(highlight.context);
  const points = (ms: readonly Marker[]) => ms.map((m) => `${m.at.x},${m.at.y}`).join(' ');
  return (
    <>
      <Path d={LAND_PATH} fill={palette.land} stroke={palette.coast} strokeWidth={0.8 * u} strokeLinejoin="round" />
      {markers.map((m) =>
        focus.has(m.id) || context.has(m.id) ? null : (
          <Circle key={m.id} cx={m.at.x} cy={m.at.y} r={2.5 * u} fill={palette.dot} opacity={0.55} />
        ),
      )}
      {highlight.route.length > 1 && (
        <Polyline
          points={points(highlight.route)}
          fill="none"
          stroke={palette.accent}
          strokeWidth={2 * u}
          strokeDasharray={[5 * u, 4 * u]}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={highlight.path.length > 1 ? 0.45 : 0.85}
        />
      )}
      {highlight.path.length > 1 && (
        <Polyline
          points={points(highlight.path)}
          fill="none"
          stroke={palette.accent}
          strokeWidth={3.5 * u}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {markers.map((m) =>
        context.has(m.id) ? <Circle key={m.id} cx={m.at.x} cy={m.at.y} r={3.5 * u} fill={palette.accent} opacity={0.7} /> : null,
      )}
      {markers.map((m) =>
        focus.has(m.id) ? (
          <Circle
            key={m.id}
            cx={m.at.x}
            cy={m.at.y}
            r={5 * u}
            fill={palette.accent}
            stroke={palette.halo}
            strokeWidth={1.5 * u}
          />
        ) : null,
      )}
    </>
  );
}

const styles = StyleSheet.create({
  map: { overflow: 'hidden' },
  base: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: MAP_SIZE.width,
    height: MAP_SIZE.height,
    transformOrigin: [0, 0, 0],
  },
  label: { position: 'absolute', justifyContent: 'center' },
  labelText: {
    fontSize: LABEL_SIZE,
    fontWeight: '600',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 3,
  },
  credit: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    fontSize: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderTopLeftRadius: 6,
    overflow: 'hidden',
  },
});
