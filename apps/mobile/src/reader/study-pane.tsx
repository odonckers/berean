import { type ComponentRef, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  findNodeHandle,
  useWindowDimensions,
} from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, {
  FadeIn,
  FadeOut,
  ReduceMotion,
  clamp,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
  type EntryAnimationsValues,
  type ExitAnimationsValues,
  type LayoutAnimation,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { UIText } from '@/components/text';
import { useBerean } from '@/design/theme';
import { hairline, radii, spacing } from '@/design/tokens';
import { rememberTab, rememberedTab } from '@/reader/session';

export type PaneTab = 'studyNotes' | 'crossRefs' | 'research' | 'footnotes';

const TABS: { key: PaneTab; label: string }[] = [
  { key: 'studyNotes', label: 'Study notes' },
  { key: 'crossRefs', label: 'Cross refs' },
  { key: 'research', label: 'Research' },
  { key: 'footnotes', label: 'Footnotes' },
];

// Spec §5: open is a spring (response 0.38 s, damping 0.9), close a spring
// (0.30 s, damping 1.0). Exported so the verses below the pane move with it.
export const OPEN_SPRING = { duration: 380, dampingRatio: 0.9 } as const;
const CLOSE_SPRING = { duration: 300, dampingRatio: 1 } as const;

// Pane height as a fraction of the window (spec §4, §7): it starts at 40%
// (60% at accessibility text sizes), drags between 25% and 85%, and settles
// on the nearest detent.
const MIN_HEIGHT = 0.25;
const MAX_HEIGHT = 0.85;
const LARGE_TEXT_SCALE = 1.5;

// A fast flick down on the header dismisses the pane.
const DISMISS_VELOCITY = 800;

function growOpen(values: EntryAnimationsValues): LayoutAnimation {
  'worklet';
  return {
    initialValues: { height: 0, opacity: 0 },
    animations: {
      height: withSpring(values.targetHeight, OPEN_SPRING),
      opacity: withTiming(1, { duration: 200 }),
    },
  };
}

function collapseClosed(values: ExitAnimationsValues): LayoutAnimation {
  'worklet';
  return {
    initialValues: { height: values.currentHeight, opacity: 1 },
    animations: {
      height: withSpring(0, CLOSE_SPRING),
      opacity: withTiming(0, { duration: 200 }),
    },
  };
}

// Reduce Motion: a cross-fade at the final height, no movement. Never lets
// the fade play even though the system setting is on.
const fadeOpen = FadeIn.duration(200).reduceMotion(ReduceMotion.Never);
const fadeClosed = FadeOut.duration(150).reduceMotion(ReduceMotion.Never);
const tabFade = FadeIn.duration(150).reduceMotion(ReduceMotion.Never);

/** Moves VoiceOver / TalkBack focus to a mounted element, if any. */
export function moveAccessibilityFocus(node: ComponentRef<typeof Text> | null | undefined) {
  const tag = node ? findNodeHandle(node) : undefined;
  if (tag != null) AccessibilityInfo.setAccessibilityFocus(tag);
}

type StudyPaneProps = {
  reference: string;
  pubKey: string;
  /** The tabs that have content for this verse. Empty shows the Empty state. */
  available: readonly PaneTab[];
  /** Re-opened after a remount: no opening animation or announcement (spec §8). */
  restored: boolean;
  onClose: () => void;
};

/**
 * The inline study pane (docs/design/inline-study-pane.md). It is part of
 * the chapter's scroll content, rendered right after the selected verse, so
 * nothing above it moves. Material look: an M3 surfaceContainer card with
 * primary tabs. iOS look: an offset-background card with hairlines and a
 * segmented control.
 */
export function StudyPane({ reference, pubKey, available, restored, onClose }: StudyPaneProps) {
  const { look, colors, m3, type } = useBerean();
  const reducedMotion = useReducedMotion();
  const { height: windowHeight, fontScale } = useWindowDimensions();
  const material = look === 'material';

  // Tabs with no content are hidden; at least one tab always shows.
  const shown = available.length > 0 ? TABS.filter((t) => available.includes(t.key)) : [TABS[0]];
  const [openedOn] = useState(() => {
    const remembered = rememberedTab(pubKey);
    return shown.find((t) => t.key === remembered) ?? shown[0];
  });
  const [active, setActive] = useState(openedOn.key);
  const tab = shown.find((t) => t.key === active) ?? shown[0];
  const select = (key: PaneTab) => {
    setActive(key);
    if (available.includes(key)) rememberTab(pubKey, key);
  };

  // The pane remounts per verse, so this runs once per open.
  const headerRef = useRef<ComponentRef<typeof Text>>(null);
  useEffect(() => {
    if (!restored) {
      AccessibilityInfo.announceForAccessibility(`Study pane, ${reference}, ${openedOn.label}`);
    }
    const frame = requestAnimationFrame(() => moveAccessibilityFocus(headerRef.current));
    return () => cancelAnimationFrame(frame);
  }, [reference, restored, openedOn]);

  const largeText = fontScale >= LARGE_TEXT_SCALE;
  const detents = largeText ? [0.25, 0.4, 0.6, 0.85] : [0.25, 0.4, 0.85];
  const [fraction, setFraction] = useState(largeText ? 0.6 : 0.4);
  // The live height while dragging, as a fraction so rotation keeps it.
  const height = useSharedValue(fraction);
  const dragStart = useSharedValue(fraction);
  const animatedHeight = useAnimatedStyle(() => ({ height: height.get() * windowHeight }));

  // Settle on a detent; Reduce Motion settles with no overshoot.
  const settle = (target: number) => {
    'worklet';
    return reducedMotion
      ? withTiming(target, { duration: 200, reduceMotion: ReduceMotion.Never })
      : withSpring(target, OPEN_SPRING);
  };
  const moveTo = (target: number | undefined) => {
    if (target === undefined) return;
    setFraction(target);
    height.set(settle(target));
  };

  const resize = usePanGesture({
    activeOffsetY: [-10, 10],
    failOffsetX: [-20, 20],
    onBegin: () => {
      'worklet';
      dragStart.set(height.get());
    },
    onUpdate: (e) => {
      'worklet';
      height.set(clamp(dragStart.get() - e.translationY / windowHeight, MIN_HEIGHT, MAX_HEIGHT));
    },
    onDeactivate: (e) => {
      'worklet';
      const dragged = dragStart.get() - e.translationY / windowHeight;
      if (e.velocityY > DISMISS_VELOCITY || dragged < MIN_HEIGHT) {
        scheduleOnRN(onClose);
        return;
      }
      const current = height.get();
      const target = detents.reduce((best, d) =>
        Math.abs(d - current) < Math.abs(best - current) ? d : best,
      );
      height.set(settle(target));
      scheduleOnRN(setFraction, target);
    },
  });

  const separator = material ? m3.outlineVariant : colors.separator;
  const closeSize = material ? 48 : 44;

  return (
    <Animated.View
      entering={restored ? undefined : reducedMotion ? fadeOpen : growOpen}
      exiting={reducedMotion ? fadeClosed : collapseClosed}
      accessibilityLabel={`Study pane, ${reference}, ${tab.label}`}
      style={[
        styles.pane,
        animatedHeight,
        material
          ? { backgroundColor: m3.surfaceContainer, borderRadius: radii.materialPane }
          : {
              backgroundColor: m3.surfaceContainerLow,
              borderRadius: radii.studyPane,
              borderTopWidth: hairline,
              borderBottomWidth: hairline,
              borderColor: colors.separator,
            },
      ]}
    >
      <GestureDetector gesture={resize}>
        <View>
          <View
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel="Pane height"
            accessibilityValue={{ text: `${Math.round(fraction * 100)} percent` }}
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
            onAccessibilityAction={(e) => {
              if (e.nativeEvent.actionName === 'increment') {
                moveTo(detents.find((d) => d > fraction));
              } else if (e.nativeEvent.actionName === 'decrement') {
                moveTo(detents.findLast((d) => d < fraction));
              }
            }}
            style={styles.grabberRow}
          >
            <View
              style={[
                material ? styles.grabberMaterial : styles.grabberIos,
                { backgroundColor: material ? m3.onSurfaceVariant : colors.textSecondary },
              ]}
            />
          </View>
          <View style={styles.header}>
            {/* A plain Text so it can take the ref that receives focus on open. */}
            <Text
              ref={headerRef}
              accessibilityRole="header"
              style={[type.ui.title, { color: colors.text }, styles.reference]}
            >
              {reference}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close study pane"
              onPress={onClose}
              style={({ pressed }) => [
                styles.close,
                { width: closeSize, height: closeSize, opacity: pressed ? 0.6 : 1 },
              ]}
            >
              <UIText secondary={!material} style={material && { color: m3.onSurfaceVariant }}>
                ✕
              </UIText>
            </Pressable>
          </View>
        </View>
      </GestureDetector>

      {material ? (
        <View
          accessibilityRole="tablist"
          style={[styles.materialTabs, { borderBottomColor: separator }]}
        >
          {shown.map((t) => {
            const selected = t.key === tab.key;
            return (
              <Pressable
                key={t.key}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                onPress={() => select(t.key)}
                style={({ pressed }) => [styles.materialTab, { opacity: pressed ? 0.6 : 1 }]}
              >
                <View>
                  <UIText
                    style={[
                      styles.materialTabLabel,
                      { color: selected ? m3.primary : m3.onSurfaceVariant },
                    ]}
                  >
                    {t.label}
                  </UIText>
                  <View
                    style={[
                      styles.indicator,
                      { backgroundColor: selected ? m3.primary : 'transparent' },
                    ]}
                  />
                </View>
              </Pressable>
            );
          })}
        </View>
      ) : (
        <View
          accessibilityRole="tablist"
          style={[styles.segmentTrack, { backgroundColor: colors.separator }]}
        >
          {shown.map((t) => {
            const selected = t.key === tab.key;
            return (
              <Pressable
                key={t.key}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                onPress={() => select(t.key)}
                hitSlop={{ top: 6, bottom: 6 }}
                style={({ pressed }) => [
                  styles.segment,
                  selected && { backgroundColor: colors.surface },
                  { opacity: pressed && !selected ? 0.6 : 1 },
                ]}
              >
                <UIText
                  variant="caption"
                  numberOfLines={1}
                  style={selected && styles.segmentSelectedLabel}
                >
                  {t.label}
                </UIText>
              </Pressable>
            );
          })}
        </View>
      )}

      <ScrollView
        nestedScrollEnabled
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
      >
        <Animated.View key={tab.key} entering={tabFade}>
          {/* Tab content arrives with the core's per-verse study content;
              until then only the Empty state (spec §2) has anything to say. */}
          {available.length === 0 && <UIText secondary>No study notes for this verse</UIText>}
        </Animated.View>
      </ScrollView>

      <View style={[styles.myNotes, { borderTopColor: separator }]}>
        <UIText
          variant={material ? 'label' : 'caption'}
          accessibilityRole="header"
          style={!material && styles.myNotesLabelIos}
        >
          My notes
        </UIText>
        <UIText secondary>Notes for this verse appear here.</UIText>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Wider than the text column by spacing.sm each side; the column's own
  // padding keeps it inset from the screen edge.
  pane: {
    overflow: 'hidden',
    marginHorizontal: -spacing.sm,
    marginVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  grabberRow: { alignItems: 'center', paddingTop: spacing.sm },
  // M3 drag handle: 32x4 in onSurfaceVariant at 40%.
  grabberMaterial: { width: 32, height: 4, borderRadius: radii.capsule, opacity: 0.4 },
  grabberIos: { width: 36, height: 5, borderRadius: radii.capsule, opacity: 0.4 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  reference: { flex: 1 },
  close: { alignItems: 'center', justifyContent: 'center', marginEnd: -spacing.md },
  // M3 primary tabs: a full-width row, 48dp tall, with a divider below.
  materialTabs: {
    flexDirection: 'row',
    marginHorizontal: -spacing.lg,
    borderBottomWidth: hairline,
  },
  materialTab: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  // M3 title small.
  materialTabLabel: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
    textAlign: 'center',
    paddingTop: 14,
    paddingBottom: 11,
  },
  indicator: {
    height: 3,
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
  },
  segmentTrack: {
    flexDirection: 'row',
    padding: 2,
    marginTop: spacing.xs,
    borderRadius: radii.chip,
  },
  segment: {
    flex: 1,
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
    borderRadius: radii.chip,
  },
  segmentSelectedLabel: { fontWeight: '600' },
  // The body scrolls on its own between the tabs and My notes.
  body: { flex: 1 },
  bodyContent: { paddingVertical: spacing.lg },
  myNotes: { borderTopWidth: hairline, paddingTop: spacing.md, gap: spacing.xs },
  // 13 pt caption, semibold: the 10 pt tab-bar label is below the minimum.
  myNotesLabelIos: { fontWeight: '600' },
});
