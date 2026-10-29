import { useEffect, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, {
  FadeIn,
  FadeOut,
  ReduceMotion,
  useReducedMotion,
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

type TabKey = 'notes' | 'crossRefs' | 'research' | 'footnotes';

// The core does not provide study content yet, so every tab shows its
// honest empty line. Hiding empty tabs (spec §2) waits on that content.
const TABS: { key: TabKey; label: string; empty: string }[] = [
  { key: 'notes', label: 'Study notes', empty: 'No study notes for this verse yet.' },
  { key: 'crossRefs', label: 'Cross refs', empty: 'No cross references for this verse yet.' },
  {
    key: 'research',
    label: 'Research',
    empty: "Research Guide references aren't available in the app yet.",
  },
  { key: 'footnotes', label: 'Footnotes', empty: 'No footnotes for this verse yet.' },
];

// Spec §5: open is a spring (response 0.38 s, damping 0.9), close a spring
// (0.30 s, damping 1.0). Exported so the verses below the pane move with it.
export const OPEN_SPRING = { duration: 380, dampingRatio: 0.9 } as const;
const CLOSE_SPRING = { duration: 300, dampingRatio: 1 } as const;

// The swipe-down-to-dismiss thresholds on the header.
const DISMISS_DISTANCE = 60;
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

type StudyPaneProps = {
  reference: string;
  onClose: () => void;
};

/**
 * The inline study pane (docs/design/inline-study-pane.md). It is part of
 * the chapter's scroll content, rendered right after the selected verse, so
 * nothing above it moves. Material look: an M3 surfaceContainer card with
 * primary tabs. iOS look: an offset-background card with hairlines and a
 * segmented control.
 */
export function StudyPane({ reference, onClose }: StudyPaneProps) {
  const { look, colors, m3 } = useBerean();
  const reducedMotion = useReducedMotion();
  const [active, setActive] = useState<TabKey>('notes');
  const tab = TABS.find((t) => t.key === active) ?? TABS[0];
  const material = look === 'material';

  // The pane remounts per verse, so it always opens on the first tab.
  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(`Study pane, ${reference}, ${TABS[0].label}`);
  }, [reference]);

  const swipeDown = usePanGesture({
    activeOffsetY: 10,
    failOffsetX: [-20, 20],
    onDeactivate: (e) => {
      'worklet';
      if (e.translationY > DISMISS_DISTANCE || e.velocityY > DISMISS_VELOCITY) {
        scheduleOnRN(onClose);
      }
    },
  });

  const separator = material ? m3.outlineVariant : colors.separator;
  const closeSize = material ? 48 : 44;

  return (
    <Animated.View
      entering={reducedMotion ? fadeOpen : growOpen}
      exiting={reducedMotion ? fadeClosed : collapseClosed}
      accessibilityLabel={`Study pane, ${reference}, ${tab.label}`}
      style={[
        styles.pane,
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
      <GestureDetector gesture={swipeDown}>
        <View>
          <View style={styles.grabberRow}>
            <View
              style={[
                material ? styles.grabberMaterial : styles.grabberIos,
                { backgroundColor: material ? m3.onSurfaceVariant : colors.textSecondary },
              ]}
            />
          </View>
          <View style={styles.header}>
            <UIText variant="title" accessibilityRole="header" style={styles.reference}>
              {reference}
            </UIText>
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
          {TABS.map((t) => {
            const selected = t.key === active;
            return (
              <Pressable
                key={t.key}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                onPress={() => setActive(t.key)}
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
          {TABS.map((t) => {
            const selected = t.key === active;
            return (
              <Pressable
                key={t.key}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                onPress={() => setActive(t.key)}
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

      <Animated.View key={active} entering={tabFade} style={styles.body}>
        <UIText secondary>{tab.empty}</UIText>
      </Animated.View>

      <View style={[styles.myNotes, { borderTopColor: separator }]}>
        <UIText variant="label" accessibilityRole="header">
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
  body: { paddingVertical: spacing.lg },
  myNotes: { borderTopWidth: hairline, paddingTop: spacing.md, gap: spacing.xs },
});
