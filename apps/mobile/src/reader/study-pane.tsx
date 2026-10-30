import { type ComponentRef, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  findNodeHandle,
  type LayoutChangeEvent,
  useWindowDimensions,
} from 'react-native';
import { SymbolView } from 'expo-symbols';
import { GestureDetector, type NativeGesture, usePanGesture } from 'react-native-gesture-handler';
import Animated, {
  FadeIn,
  ReduceMotion,
  type SharedValue,
  cancelAnimation,
  clamp,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { ScriptureText, UIText } from '@/components/text';
import { useBerean } from '@/design/theme';
import {
  hairline,
  radii,
  readingColumnPadding,
  spacing,
  studyPaneInset,
} from '@/design/tokens';
import {
  DISMISS_VELOCITY,
  MAX_HEIGHT,
  MIN_HEIGHT,
  cappedDetents,
  dragFraction,
  openFraction,
  paneDetents,
  releaseTarget,
} from '@/reader/pane-snap';
import { rememberTab, rememberedTab } from '@/reader/session';
import type { PaneStudy, PaneTab } from '@/reader/verse-study';

export type { PaneTab };

// Lookups only: which tabs show, and in what order, comes from the data.
const TAB_LABELS: Record<PaneTab, string> = {
  studyNotes: 'Study notes',
  crossRefs: 'Cross refs',
  research: 'Research',
  footnotes: 'Footnotes',
};

// Spec §4, Empty: the verse has no study content.
const EMPTY_COPY = 'No study notes for this verse';
const RESEARCH_COPY = "Research needs the study guide, which isn't installed.";

// Spec §5: open is a spring (response 0.38 s, damping 0.9), close a spring
// (0.30 s, damping 1.0).
const OPEN_SPRING = { duration: 380, dampingRatio: 0.9 } as const;
const CLOSE_SPRING = { duration: 300, dampingRatio: 1 } as const;
const FADE_COLLAPSE = { duration: 200 } as const;

// The open and close fades. With Reduce Motion they are the whole open and
// close: a cross-fade at the pane's height, no movement. Never lets the
// fade play even though the system setting is on.
const FADE_OPEN = { duration: 200, reduceMotion: ReduceMotion.Never } as const;
const FADE_CLOSE = { duration: 150, reduceMotion: ReduceMotion.Never } as const;
const tabFade = FadeIn.duration(150).reduceMotion(ReduceMotion.Never);

/** Moves VoiceOver / TalkBack focus to a mounted element, if any. */
export function moveAccessibilityFocus(
  node: ComponentRef<typeof Text> | ComponentRef<typeof View> | null | undefined,
) {
  const tag = node ? findNodeHandle(node) : undefined;
  if (tag != null) AccessibilityInfo.setAccessibilityFocus(tag);
}

type StudyPaneProps = {
  reference: string;
  /** Shown under the reference, e.g. the publication title. */
  subtitle: string;
  pubKey: string;
  /**
   * The verse's study content: the tabs that have content, in display
   * order, and their items. Tabs not listed are hidden; none shows the
   * Empty state with no tab row. 'research' is ignored here: it follows
   * guideInstalled.
   */
  study: PaneStudy;
  /** While the study guide isn't installed, a Research tab offers it. */
  guideInstalled: boolean;
  /** Re-opened after a remount: no opening animation or announcement (spec §8). */
  restored: boolean;
  /** The height a restored pane had, as a window fraction; else it opens at the default. */
  initialFraction?: number;
  /**
   * A close was asked for: the pane collapses (or fades, with Reduce
   * Motion) and then calls onClosed, for the owner to unmount it. Turning
   * this back off before then reopens the pane at its height.
   */
  closing: boolean;
  /**
   * The chapter's scroll gesture. The resize drag blocks it: a drag that
   * starts on the header makes the scroll wait until the resize fails, and
   * once the resize is active the scroll never takes over.
   */
  chapterScroll?: NativeGesture;
  /**
   * The tallest the pane may be, as a window fraction (pane-snap's
   * paneMaxFraction). The owner keeps it current as the chapter scrolls,
   * so the pane never grows under the tab bar. Without it, the 85% maximum.
   */
  maxFraction?: SharedValue<number>;
  /** Asks to close: the close button and a dismissing drag. */
  onClose: () => void;
  /** The close animation finished; the pane can unmount. */
  onClosed: () => void;
  /** The pane settled at a new height, as a window fraction. */
  onResize?: (fraction: number) => void;
  /** The pane container's layout in the reading column. */
  onLayout?: (e: LayoutChangeEvent) => void;
};

/**
 * The inline study pane (docs/design/inline-study-pane.md). It is part of
 * the chapter's scroll content, splitting the selected verse's paragraph
 * right after that verse, so nothing above it moves. Material look: an M3 surfaceContainer card with a
 * 1dp ring and primary tabs. iOS look: a raised card with a hairline border
 * and a segmented control.
 */
export function StudyPane({
  reference,
  subtitle,
  pubKey,
  study,
  guideInstalled,
  restored,
  initialFraction,
  closing,
  chapterScroll,
  maxFraction,
  onClose,
  onClosed,
  onResize,
  onLayout,
}: StudyPaneProps) {
  const { look, scheme, colors, m3, studyPane } = useBerean();
  const reducedMotion = useReducedMotion();
  const { height: windowHeight, fontScale } = useWindowDimensions();
  const material = look === 'material';

  // The tab row is built from the data. With no content there is no tab
  // row at all, and Research alone never counts as content.
  const content: PaneTab[] = study.tabs.filter((key) => key !== 'research');
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

  const detents = paneDetents(fontScale);
  // The height the pane opens at (40%, 60% at accessibility text sizes), or
  // the height a restored pane had.
  const [opened] = useState(() => initialFraction ?? openFraction(fontScale));
  // Mirrors the settled height for the accessibility value, the session and
  // a reopen while closing; it never feeds back into a running drag.
  const [fraction, setFraction] = useState(opened);
  const settled = (target: number) => {
    setFraction(target);
    onResize?.(target);
  };
  // The pane's height, as a fraction of the window so rotation keeps it.
  // This shared value is its only owner from mount to unmount: the open,
  // the drag, the settle, the accessibility moves and the close all animate
  // it, and nothing else sets height (no layout animation, no height in the
  // static styles). As a layout prop it re-lays out the column every frame,
  // so the text below follows the pane, closing included. The open grows
  // from 0, except a restored pane (no animation) and Reduce Motion (a fade
  // at the final height).
  // React re-renders (a tab switch and back, a prop change) don't reset it:
  // Reanimated's PropsFilter hands React only the style's first-render
  // snapshot, and on Fabric its commit hook lays the latest animated values
  // over every React commit, so the snapshot never reaches the screen.
  const growsOpen = !restored && !reducedMotion;
  const height = useSharedValue(growsOpen ? 0 : opened);
  const opacity = useSharedValue(restored ? 1 : 0);
  const dragStart = useSharedValue(opened);
  // The running drag's cap, read as it begins: the chapter can't scroll
  // under a resize, so the pane's room stays put until it ends.
  const dragMax = useSharedValue(MAX_HEIGHT);
  const animatedPane = useAnimatedStyle(() => ({
    height: Math.max(height.get(), 0) * windowHeight,
    opacity: opacity.get(),
  }));

  // The open plays once per mount (the pane remounts per verse), even if
  // Reduce Motion changes while it is open.
  const openPlayed = useRef(false);
  useEffect(() => {
    if (openPlayed.current) return;
    openPlayed.current = true;
    if (restored) return;
    opacity.set(withTiming(1, FADE_OPEN));
    if (growsOpen) height.set(withSpring(opened, OPEN_SPRING));
  }, [restored, growsOpen, opened, height, opacity]);

  // Settle on a detent; Reduce Motion settles with no overshoot.
  const settle = (target: number) => {
    'worklet';
    return reducedMotion
      ? withTiming(target, { duration: 200, reduceMotion: ReduceMotion.Never })
      : withSpring(target, OPEN_SPRING);
  };
  // The accessibility moves step through the detents under the cap.
  const reachable = () => cappedDetents(detents, maxFraction?.get() ?? MAX_HEIGHT);
  const moveTo = (target: number | undefined) => {
    if (target === undefined || closing) return;
    settled(target);
    height.set(settle(target));
  };

  // The close runs on the same shared value: the height springs to 0 (or,
  // with Reduce Motion, the pane fades at its height), and only once that
  // finishes does the owner unmount the pane. Turned off midway (the verse
  // tapped again), the pane goes back to its settled height; the interrupted
  // animation reports unfinished, so it never unmounts the pane.
  const closeShown = useRef(closing);
  useEffect(() => {
    if (closeShown.current === closing) return;
    closeShown.current = closing;
    if (closing) {
      const done = (finished?: boolean) => {
        'worklet';
        if (finished) scheduleOnRN(onClosed);
      };
      if (reducedMotion) {
        opacity.set(withTiming(0, FADE_CLOSE, done));
      } else {
        opacity.set(withTiming(0, FADE_COLLAPSE));
        height.set(withSpring(0, CLOSE_SPRING, done));
      }
    } else {
      opacity.set(withTiming(1, FADE_OPEN));
      if (!reducedMotion) height.set(withSpring(fraction, OPEN_SPRING));
    }
  }, [closing, reducedMotion, fraction, onClosed, height, opacity]);
  // A pane unmounted mid-close (another verse tapped, another chapter)
  // stops its animations, which report unfinished, so its close never
  // reaches the owner.
  useEffect(
    () => () => {
      cancelAnimation(height);
      cancelAnimation(opacity);
    },
    [height, opacity],
  );

  const resize = usePanGesture({
    // No resizing while the pane closes.
    enabled: !closing,
    activeOffsetY: [-10, 10],
    failOffsetX: [-20, 20],
    block: chapterScroll,
    onBegin: () => {
      'worklet';
      // Grabbed while still growing open, the drag starts from the smallest
      // height rather than below it, so it can't read as a close.
      dragStart.set(clamp(height.get(), MIN_HEIGHT, MAX_HEIGHT));
      dragMax.set(maxFraction?.get() ?? MAX_HEIGHT);
    },
    onUpdate: (e) => {
      'worklet';
      height.set(
        dragFraction({
          start: dragStart.get(),
          translationY: e.translationY,
          windowHeight,
          min: MIN_HEIGHT,
          max: dragMax.get(),
        }),
      );
    },
    onDeactivate: (e) => {
      'worklet';
      const release = releaseTarget({
        start: dragStart.get(),
        translationY: e.translationY,
        velocityY: e.velocityY,
        windowHeight,
        detents: cappedDetents(detents, dragMax.get()),
        min: MIN_HEIGHT,
        dismissVelocity: DISMISS_VELOCITY,
      });
      if (release.kind === 'close') {
        scheduleOnRN(onClose);
        return;
      }
      height.set(settle(release.fraction));
      scheduleOnRN(settled, release.fraction);
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
      onLayout={onLayout}
      accessibilityLabel={paneLabel}
      style={[
        styles.pane,
        // Wider than the text: the pane sits studyPaneInset from the
        // column's outer edge, inside the column padding.
        { marginHorizontal: studyPaneInset[look] - readingColumnPadding[look] },
        animatedPane,
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
                moveTo(reachable().find((d) => d > fraction));
              } else if (e.nativeEvent.actionName === 'decrement') {
                moveTo(reachable().findLast((d) => d < fraction));
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

      {/* A nested scroll: while it scrolls, the chapter ScrollView doesn't
          intercept the drag (Android ScrollView checks its nested axes). */}
      <ScrollView
        nestedScrollEnabled
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
      >
        <Animated.View key={tab ?? 'empty'} entering={tabFade} style={styles.items}>
          {tab === undefined && <UIText secondary>{EMPTY_COPY}</UIText>}
          {tab === 'research' && <UIText secondary>{RESEARCH_COPY}</UIText>}
          {/* The core's strings as given, one step smaller than the
              reading text (spec §6); each label leads its text. */}
          {tab === 'studyNotes' &&
            study.studyNotes.map((note, index) => (
              <ScriptureText key={index} variant="noteBody">
                <Text style={styles.lead}>{note.label}</Text> {note.text}
              </ScriptureText>
            ))}
          {tab === 'crossRefs' &&
            study.crossRefs.map((ref, index) => (
              <ScriptureText key={index} variant="noteBody">
                <Text style={styles.lead}>{ref.label}</Text>
                {ref.reference !== undefined && ` ${ref.reference}`}
                {ref.snippet !== undefined && (
                  <Text style={{ color: colors.textSecondary }}> {ref.snippet}</Text>
                )}
              </ScriptureText>
            ))}
          {tab === 'footnotes' &&
            study.footnotes.map((note, index) => (
              <ScriptureText key={index} variant="noteBody">
                <Text style={styles.lead}>{note.marker}</Text> {note.text}
              </ScriptureText>
            ))}
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
  items: { gap: spacing.md },
  // A study note's, cross reference's or footnote's label, leading its text.
  lead: { fontWeight: '600' },
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
