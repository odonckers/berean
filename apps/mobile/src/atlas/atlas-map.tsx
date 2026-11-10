import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { type LayoutChangeEvent, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { GestureDetector, usePanGesture, usePinchGesture, useSimultaneousGestures, useTapGesture } from 'react-native-gesture-handler';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Circle, G, Path, Polyline, Text as SvgText } from 'react-native-svg';
import { scheduleOnRN } from 'react-native-worklets';

import { ScaledSymbol } from '@/components/scaled-symbol';
import { useBerean } from '@/design/theme';
import { radii, spacing } from '@/design/tokens';

import { LAND } from './basemap.generated';
import {
  type Camera,
  type LabelRequest,
  type Size,
  afterTransform,
  clampCamera,
  fitAll,
  layoutLabels,
  toScreen,
  transformBetween,
  viewBox,
  zoomLimits,
} from './model';
import type { Point } from './projection';

// The Bible map: Natural Earth coastlines drawn as one SVG path, the
// places as dots, and the selected period's route as a line through its
// stops. Pinch and drag move it; while the fingers are down the drawn map
// is only transformed, and when they lift the camera is committed and the
// SVG redrawn sharp. The buttons zoom and fit for anyone who can't pinch.
// Everything here is also in the list beside it, which is what screen
// readers use; the map itself is one image with a summary.

export type MapPlace = {
  id: string;
  label: string;
  at: Point;
  /** How it is drawn: on the selected event, on the selected route, or elsewhere. */
  emphasis: 'event' | 'route' | 'other';
  /** The identification is hedged or disputed: drawn as a ring. */
  uncertain: boolean;
};

type Props = {
  places: readonly MapPlace[];
  route: readonly Point[];
  /** Map points to fit when they change: the selected event's or period's places. */
  focus: readonly Point[];
  /** Changes when the selection does, to fit again even if `focus` is the same. */
  focusKey: string;
  selectedPlaceId: string | undefined;
  onPlacePress: (id: string | undefined) => void;
  accessibilityLabel: string;
  /** Drawn over the map's bottom edge: the attribution. */
  footer?: ReactNode;
};

/** A marker's tap target: 22 points around it, a 44-point circle. */
const HIT_RADIUS = 22;
const FIT_MARGIN = 48;
const MOVE_MS = 350;

export function AtlasMap({ places, route, focus, focusKey, selectedPlaceId, onPlacePress, accessibilityLabel, footer }: Props) {
  const { colors, m3, look } = useBerean();
  const { fontScale } = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const material = look === 'material';
  const [view, setView] = useState<Size | undefined>();
  const [camera, setCamera] = useState<Camera | undefined>();

  // The gesture's transform of the drawn map, about its top-left corner.
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const scale = useSharedValue(1);
  const startScale = useSharedValue(1);
  const focalX = useSharedValue(0);
  const focalY = useSharedValue(0);
  const moving = useRef(false);
  // The gesture callbacks run later; they read the view and places from here.
  const viewRef = useRef(view);
  const tapTargets = useRef<{ camera: Camera | undefined; places: readonly MapPlace[] }>({ camera, places });
  useLayoutEffect(() => {
    viewRef.current = view;
    tapTargets.current = { camera, places };
  }, [view, camera, places]);

  const commit = (dx: number, dy: number, s: number) => {
    moving.current = false;
    const at = viewRef.current;
    setCamera((c) => (c === undefined || at === undefined ? c : afterTransform(c, at, dx, dy, s)));
    tx.set(0);
    ty.set(0);
    scale.set(1);
  };

  /** Moves to `target`, animated unless Reduce Motion is on. */
  const moveTo = (target: Camera) => {
    if (view === undefined || camera === undefined) return;
    const to = clampCamera(target, view);
    if (reducedMotion) {
      setCamera(to);
      return;
    }
    const t = transformBetween(camera, to, view);
    moving.current = true;
    const timing = { duration: MOVE_MS, easing: Easing.out(Easing.cubic) };
    tx.set(withTiming(t.tx, timing));
    ty.set(withTiming(t.ty, timing));
    scale.set(
      withTiming(t.scale, timing, (finished) => {
        'worklet';
        if (finished) scheduleOnRN(commit, t.tx, t.ty, t.scale);
      }),
    );
  };

  // Fit the focus when the selection changes or the view is first measured.
  const fitted = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (view === undefined) return;
    const key = `${focusKey}@${view.width}x${view.height}`;
    if (fitted.current === key) return;
    const first = fitted.current === undefined || camera === undefined;
    fitted.current = key;
    const target = focusCamera(view, focus);
    if (first) setCamera(target);
    else moveTo(target);
    // moveTo reads the current camera; only a new selection or size refits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey, view]);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width > 0 && height > 0 && (width !== view?.width || height !== view?.height)) setView({ width, height });
  };

  // One finger drags; two pinch about their centre (and drag as they move).
  const pan = usePanGesture({
    maxPointers: 1,
    onUpdate: (e) => {
      'worklet';
      tx.set(tx.get() + e.changeX);
      ty.set(ty.get() + e.changeY);
    },
    onDeactivate: () => {
      'worklet';
      scheduleOnRN(commit, tx.get(), ty.get(), scale.get());
    },
  });
  const pinch = usePinchGesture({
    onActivate: (e) => {
      'worklet';
      startScale.set(scale.get());
      focalX.set(e.focalX);
      focalY.set(e.focalY);
    },
    onUpdate: (e) => {
      'worklet';
      const next = startScale.get() * e.scale;
      const was = scale.get();
      // The drawn point under the fingers' last centre goes under their new one.
      const ux = (focalX.get() - tx.get()) / was;
      const uy = (focalY.get() - ty.get()) / was;
      scale.set(next);
      tx.set(e.focalX - ux * next);
      ty.set(e.focalY - uy * next);
      focalX.set(e.focalX);
      focalY.set(e.focalY);
    },
    onDeactivate: () => {
      'worklet';
      scheduleOnRN(commit, tx.get(), ty.get(), scale.get());
    },
  });
  const tapAt = (x: number, y: number) => {
    const { camera: now, places: shown } = tapTargets.current;
    const at = viewRef.current;
    if (now === undefined || at === undefined || moving.current) return;
    let best: { id: string; distance: number } | undefined;
    for (const p of shown) {
      const s = toScreen(now, at, p.at);
      const distance = Math.hypot(s.x - x, s.y - y);
      if (distance <= HIT_RADIUS && (best === undefined || distance < best.distance)) best = { id: p.id, distance };
    }
    onPlacePress(best?.id);
  };
  const tap = useTapGesture({
    onActivate: (e) => {
      'worklet';
      scheduleOnRN(tapAt, e.x, e.y);
    },
  });
  const gesture = useSimultaneousGestures(pan, pinch, tap);

  const drawn = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.get() }, { translateY: ty.get() }, { scale: scale.get() }],
  }));

  const zoomBy = (factor: number) => {
    if (camera !== undefined) moveTo({ ...camera, zoom: camera.zoom * factor });
  };
  const limits = view === undefined ? undefined : zoomLimits(view);

  // Sizes in map units, so they stay the same on screen at any zoom.
  const zoom = camera?.zoom ?? 1;
  const textScale = Math.min(fontScale, 1.6);
  const fontSize = 12 * textScale;
  const px = (points: number) => points / zoom;

  const labels = useMemo(() => {
    if (camera === undefined || view === undefined) return [];
    const order = { event: 0, route: 1, other: 2 } as const;
    const requests: LabelRequest[] = [...places]
      .filter((p) => p.emphasis !== 'other' || p.id === selectedPlaceId)
      .sort((a, b) => (a.id === selectedPlaceId ? -1 : b.id === selectedPlaceId ? 1 : order[a.emphasis] - order[b.emphasis]))
      .map((p) => ({
        id: p.id,
        text: p.label,
        at: toScreen(camera, view, p.at),
        radius: p.emphasis === 'event' || p.id === selectedPlaceId ? 8 : 6,
      }));
    return layoutLabels(requests, view, fontSize * 0.56, fontSize * 1.25);
  }, [camera, view, places, selectedPlaceId, fontSize]);

  // Colours: the sea is the page, the land a raised surface; markers in the accent.
  const sea = material ? m3.surfaceContainer : colors.canvas;
  const land = material ? m3.surfaceContainerLowest : colors.surface;
  const coast = material ? m3.outlineVariant : colors.separator;
  const accent = material ? m3.primary : colors.accent;
  const quiet = material ? m3.onSurfaceVariant : colors.textSecondary;
  // Behind labels and around markers, so they read over coastlines.
  const halo = land;

  const ordered = [...places].sort((a, b) => rank(a, selectedPlaceId) - rank(b, selectedPlaceId));

  return (
    <View
      style={[styles.frame, { backgroundColor: sea }]}
      onLayout={onLayout}
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
    >
      {view !== undefined && camera !== undefined && (
        <GestureDetector gesture={gesture}>
          <Animated.View style={[styles.fill, { transformOrigin: 'left top' }, drawn]}>
            <Svg width={view.width} height={view.height} viewBox={viewBox(camera, view)}>
              <Path d={LAND} fill={land} stroke={coast} strokeWidth={px(1)} />
              {route.length > 1 && (
                <Polyline
                  points={route.map((p) => `${p.x},${p.y}`).join(' ')}
                  fill="none"
                  stroke={accent}
                  strokeOpacity={0.75}
                  strokeWidth={px(3)}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  strokeDasharray={`${px(1)} ${px(6)}`}
                />
              )}
              {ordered.map((p) => {
                const selected = p.id === selectedPlaceId;
                const big = p.emphasis === 'event' || selected;
                const r = px(big ? 7 : p.emphasis === 'route' ? 5 : 3);
                const fill = p.emphasis === 'other' && !selected ? quiet : accent;
                return (
                  <G key={p.id}>
                    {selected && <Circle cx={p.at.x} cy={p.at.y} r={px(13)} fill={accent} fillOpacity={0.2} />}
                    <Circle
                      cx={p.at.x}
                      cy={p.at.y}
                      r={r}
                      fill={p.uncertain ? halo : fill}
                      stroke={p.uncertain ? fill : halo}
                      strokeWidth={px(p.uncertain ? 2 : 1.5)}
                    />
                  </G>
                );
              })}
              {labels.map((l) => {
                const at = { x: camera.x + (l.x - view.width / 2) / zoom, y: camera.y + (l.y - view.height / 2) / zoom };
                const strong = l.id === selectedPlaceId || places.find((p) => p.id === l.id)?.emphasis === 'event';
                const text = {
                  x: at.x,
                  y: at.y,
                  fontSize: px(fontSize),
                  fontWeight: strong ? '600' : '400',
                  textAnchor: l.anchor,
                } as const;
                // Twice: a halo in the land's colour under the text, so it
                // reads over coastlines and routes.
                return (
                  <G key={l.id}>
                    <SvgText {...text} fill={halo} stroke={halo} strokeWidth={px(3)} strokeLinejoin="round">
                      {l.text}
                    </SvgText>
                    <SvgText {...text} fill={material ? m3.onSurface : colors.text}>
                      {l.text}
                    </SvgText>
                  </G>
                );
              })}
            </Svg>
          </Animated.View>
        </GestureDetector>
      )}
      {limits !== undefined && camera !== undefined && (
        <View style={styles.controls} pointerEvents="box-none">
          <MapButton
            label="Zoom in"
            icon={{ ios: 'plus', android: 'add' }}
            disabled={camera.zoom >= limits.max * 0.999}
            onPress={() => zoomBy(2)}
          />
          <MapButton
            label="Zoom out"
            icon={{ ios: 'minus', android: 'remove' }}
            disabled={camera.zoom <= limits.min * 1.001}
            onPress={() => zoomBy(0.5)}
          />
          <MapButton
            label="Show the whole route"
            icon={{ ios: 'arrow.up.left.and.arrow.down.right', android: 'fit_screen' }}
            onPress={() => view !== undefined && moveTo(focusCamera(view, focus))}
          />
        </View>
      )}
      {footer !== undefined && (
        <View style={styles.footer} pointerEvents="box-none">
          {footer}
        </View>
      )}
    </View>
  );
}

/** Draw order: quiet places first, then the route, the event's, and the selected place on top. */
function rank(p: MapPlace, selected: string | undefined): number {
  if (p.id === selected) return 3;
  return p.emphasis === 'event' ? 2 : p.emphasis === 'route' ? 1 : 0;
}

function focusCamera(view: Size, points: readonly Point[]): Camera {
  if (points.length === 0) return fitAll(view);
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const box = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  const width = Math.max(box.maxX - box.minX, 1);
  const height = Math.max(box.maxY - box.minY, 1);
  const zoom = Math.min(
    (view.width - 2 * FIT_MARGIN) / width,
    (view.height - 2 * FIT_MARGIN) / height,
    // Never closer than about 300 km across, so one place shows where it is.
    Math.min(view.width, view.height) / 270,
  );
  return clampCamera({ x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2, zoom: Math.max(zoom, 0.01) }, view);
}

function MapButton({
  label,
  icon,
  onPress,
  disabled = false,
}: {
  label: string;
  icon: { ios: string; android: string };
  onPress: () => void;
  disabled?: boolean;
}) {
  const { look, colors, m3 } = useBerean();
  const material = look === 'material';
  const target = material ? 48 : 44;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      android_ripple={material ? { color: m3.onSurfaceVariant, borderless: true, radius: target / 2 } : undefined}
      style={({ pressed }) => [
        styles.button,
        {
          minWidth: target,
          minHeight: target,
          backgroundColor: material ? m3.surfaceContainerHigh : colors.surfaceRaised,
          borderColor: material ? m3.outlineVariant : colors.separator,
          opacity: disabled ? 0.4 : !material && pressed ? 0.6 : 1,
        },
      ]}
    >
      <ScaledSymbol
        // The icon names are SF Symbols and Material Symbols; the cast keeps
        // expo-symbols' name union out of the props.
        name={icon as never}
        size={material ? 24 : 20}
        tintColor={material ? m3.onSurfaceVariant : colors.accent}
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1, overflow: 'hidden', borderRadius: radii.card },
  fill: StyleSheet.absoluteFill,
  controls: { position: 'absolute', top: spacing.sm, right: spacing.sm, gap: spacing.sm },
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.capsule,
    borderWidth: StyleSheet.hairlineWidth,
  },
  footer: { position: 'absolute', left: spacing.sm, right: spacing.sm, bottom: spacing.xs },
});
