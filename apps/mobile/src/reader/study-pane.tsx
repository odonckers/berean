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
import { SymbolView } from 'expo-symbols';
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
import {
  hairline,
  radii,
  readingColumnPadding,
  spacing,
  studyPaneInset,
} from '@/design/tokens';
import { rememberTab, rememberedTab } from '@/reader/session';

export type PaneTab = 'studyNotes' | 'crossRefs' | 'research' | 'footnotes';

// Lookups only: which tabs show, and in what order, comes from the data.
const TAB_LABELS: Record<PaneTab, string> = {
  studyNotes: 'Study notes',
  crossRefs: 'Cross refs',
  research: 'Research',
  footnotes: 'Footnotes',
};

// Tab content arrives with the core's per-verse study content; until then
// each tab says so.
const TAB_EMPTY_COPY: Record<PaneTab, string> = {
  studyNotes: "Study notes aren't available in the app yet.",
  crossRefs: "Cross references aren't available in the app yet.",
  research: "Research needs the study guide, which isn't installed.",
  footnotes: "Footnotes aren't available in the app yet.",
};

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
  /** Shown under the reference, e.g. the publication title. */
  subtitle: string;
  pubKey: string;
  /**
   * The tabs that have content for this verse, in display order. Tabs not
   * listed are hidden; none shows the Empty state with no tab row.
   * 'research' is ignored here: it follows guideInstalled.
   */
  available: readonly PaneTab[];
  /** While the study guide isn't installed, a Research tab offers it. */
  guideInstalled: boolean;
  /** Re-opened after a remount: no opening animation or announcement (spec §8). */
  restored: boolean;
  onClose: () => void;
};

/**
 * The inline study pane (docs/design/inline-study-pane.md). It is part of
 * the chapter's scroll content, rendered right after the selected verse, so
 * nothing above it moves. Material look: an M3 surfaceContainer card with a
 * 1dp ring and primary tabs. iOS look: a raised card with a hairline border
 * and a segmented control.
 */
export function StudyPane({
  reference,
  subtitle,
  pubKey,
  available,
  guideInstalled,
  restored,
  onClose,
}: StudyPaneProps) {
  const { look, scheme, colors, m3, studyPane } = useBerean();
  const reducedMotion = useReducedMotion();
  const { height: windowHeight, fontScale } = useWindowDimensions();
  const material = look === 'material';

  // The tab row is built from the data. With no content there is no tab
  // row at all, and Research alone never counts as content.
  const content: PaneTab[] = available.filter((key) => key !== 'research');
  const shown: PaneTab[] =
    content.length === 0 || guideInstalled ? content : [...content, 'research'];
  const [openedOn] = useState<PaneTab | undefined>(() => {
    const remembered = rememberedTab(pubKey);
    return shown.find((key) => key === remembered) ?? shown[0];
  });
  const [active, setActive] = useState(openedOn);
  const tab = shown.find((key) => key === active) ?? shown[0];
  const select = (key: PaneTab) => {
    setActive(key);
    if (content.includes(key)) rememberTab(pubKey, key);
  };
  const paneLabel = `Study pane, ${reference}${tab === undefined ? '' : `, ${TAB_LABELS[tab]}`}`;

  // The pane remounts per verse, so this runs once per open.
  const headerRef = useRef<ComponentRef<typeof Text>>(null);
  useEffect(() => {
    if (!restored) {
      const opened = openedOn === undefined ? '' : `, ${TAB_LABELS[openedOn]}`;
      AccessibilityInfo.announceForAccessibility(`Study pane, ${reference}${opened}`);
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
  const iconProps = {
    accessible: false,
    importantForAccessibility: 'no-hide-descendants',
    accessibilityElementsHidden: true,
  } as const;

  return (
    <Animated.View
      entering={restored ? undefined : reducedMotion ? fadeOpen : growOpen}
      exiting={reducedMotion ? fadeClosed : collapseClosed}
      accessibilityLabel={paneLabel}
      style={[
        styles.pane,
        // Wider than the text: the pane sits studyPaneInset from the
        // column's outer edge, inside the column padding.
        { marginHorizontal: studyPaneInset[look] - readingColumnPadding[look] },
        animatedHeight,
        material
          ? {
              backgroundColor: m3.surfaceContainer,
              borderRadius: radii.materialPane,
              borderWidth: 1,
              borderColor: studyPane.materialRing,
            }
          : {
              backgroundColor: colors.surfaceRaised,
              borderRadius: radii.studyPane,
              borderWidth: hairline,
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
            <View style={styles.titles}>
              {/* A plain Text so it can take the ref that receives focus on open. */}
              <Text
                ref={headerRef}
                accessibilityRole="header"
                numberOfLines={1}
                style={[material ? styles.titleMaterial : styles.titleIos, { color: colors.text }]}
              >
                {reference}
              </Text>
              <UIText numberOfLines={1} secondary style={styles.subtitle}>
                {subtitle}
              </UIText>
            </View>
            {material ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close study pane"
                onPress={onClose}
                style={({ pressed }) => [styles.closeMaterial, { opacity: pressed ? 0.6 : 1 }]}
              >
                <SymbolView
                  {...iconProps}
                  name={{ ios: 'xmark', android: 'close' }}
                  size={24}
                  tintColor={m3.onSurfaceVariant}
                />
              </Pressable>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close study pane"
                onPress={onClose}
                // 30pt visual, 44pt target.
                hitSlop={7}
                style={({ pressed }) => [
                  styles.closeIos,
                  // Accent at about 12% alpha.
                  { backgroundColor: `${colors.accent}1F`, opacity: pressed ? 0.6 : 1 },
                ]}
              >
                <SymbolView
                  {...iconProps}
                  name={{ ios: 'xmark', android: 'close' }}
                  size={13}
                  tintColor={colors.accent}
                />
              </Pressable>
            )}
          </View>
        </View>
      </GestureDetector>

      {tab !== undefined &&
        (material ? (
          <View
            accessibilityRole="tablist"
            style={[styles.materialTabs, { borderBottomColor: separator }]}
          >
            {shown.map((key) => {
              const selected = key === tab;
              return (
                <Pressable
                  key={key}
                  accessibilityRole="tab"
                  accessibilityState={{ selected }}
                  onPress={() => select(key)}
                  style={({ pressed }) => [styles.materialTab, { opacity: pressed ? 0.6 : 1 }]}
                >
                  <View>
                    <UIText
                      style={[
                        styles.materialTabLabel,
                        { color: selected ? m3.primary : m3.onSurfaceVariant },
                      ]}
                    >
                      {TAB_LABELS[key]}
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
            style={[styles.segmentTrack, { backgroundColor: studyPane.segmentTrack }]}
          >
            {shown.map((key) => {
              const selected = key === tab;
              return (
                <Pressable
                  key={key}
                  accessibilityRole="tab"
                  accessibilityState={{ selected }}
                  onPress={() => select(key)}
                  hitSlop={{ top: 6, bottom: 6 }}
                  style={({ pressed }) => [
                    styles.segment,
                    selected && { backgroundColor: studyPane.segmentThumb },
                    // Only the light thumb lifts off the track.
                    selected && scheme === 'light' && styles.segmentThumbShadow,
                    { opacity: pressed && !selected ? 0.6 : 1 },
                  ]}
                >
                  <UIText
                    variant="caption"
                    numberOfLines={1}
                    style={[{ color: studyPane.segmentText }, selected && styles.segmentSelectedLabel]}
                  >
                    {TAB_LABELS[key]}
                  </UIText>
                </Pressable>
              );
            })}
          </View>
        ))}

      <ScrollView
        nestedScrollEnabled
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
      >
        <Animated.View key={tab ?? 'empty'} entering={tabFade}>
          <UIText secondary>
            {tab === undefined ? TAB_EMPTY_COPY.studyNotes : TAB_EMPTY_COPY[tab]}
          </UIText>
        </Animated.View>
      </ScrollView>

      {/* A sibling of the body, so it stays pinned while the body scrolls.
          Not pressable yet: Add a note comes later. */}
      <View
        style={[
          styles.myNotes,
          {
            minHeight: material ? 48 : 44,
            backgroundColor: material ? studyPane.materialFooter : studyPane.iosFooter,
            borderTopColor: separator,
          },
        ]}
      >
        <UIText
          accessibilityRole="header"
          style={[
            material ? styles.myNotesLabelMaterial : styles.myNotesLabelIos,
            { color: colors.textSecondary },
          ]}
        >
          My notes
        </UIText>
        <SymbolView
          {...iconProps}
          name={{ ios: 'pencil', android: 'edit' }}
          size={material ? 20 : 17}
          tintColor={colors.accent}
        />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  pane: {
    overflow: 'hidden',
    marginVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  grabberRow: { alignItems: 'center', paddingTop: spacing.sm },
  // M3 drag handle: 32x4 in onSurfaceVariant at 40%.
  grabberMaterial: { width: 32, height: 4, borderRadius: radii.capsule, opacity: 0.4 },
  grabberIos: { width: 36, height: 5, borderRadius: radii.capsule, opacity: 0.4 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 48 },
  titles: { flex: 1 },
  titleMaterial: { fontSize: 16, lineHeight: 24, fontWeight: '500' },
  titleIos: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
  subtitle: { fontSize: 12, lineHeight: 16 },
  // M3 icon button: a 48dp target; the 24dp icon lines up with the padding.
  closeMaterial: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginEnd: -spacing.md,
  },
  closeIos: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  segmentThumbShadow: {
    shadowColor: '#000000',
    shadowOpacity: 0.12,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  segmentSelectedLabel: { fontWeight: '600' },
  // The body scrolls on its own between the tabs and My notes.
  body: { flex: 1 },
  bodyContent: { paddingVertical: spacing.lg },
  // Full-bleed: out through the pane's horizontal padding to its edges.
  myNotes: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginHorizontal: -spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderTopWidth: hairline,
  },
  myNotesLabelMaterial: { fontSize: 14, lineHeight: 20, fontWeight: '500' },
  myNotesLabelIos: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
});
