import type { DocBlock, MeetingPart, PublicationSummary } from 'berean-ffi-rn';
import { router, useFocusEffect } from 'expo-router';
import { type ComponentRef, type ReactNode, type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, AppState, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';

import { ScaledSymbol } from '@/components/scaled-symbol';
import { UIText } from '@/components/text';
import { TextButton } from '@/components/text-button';
import { useContentInsets } from '@/design/tab-chrome';
import { useBerean } from '@/design/theme';
import { radii, readingColumnPadding, readingMeasure, spacing } from '@/design/tokens';
import { useWindowClass } from '@/design/use-window-class';
import { reader } from '@/ffi/core';
import { useCatalogUpdate } from '@/library/catalog-update';
import { type InstallJob, onLibraryChanged, startInstall, useInstalls } from '@/library/installs';
import { JobStatus } from '@/library/job-status';
import { displayTitle } from '@/library/labels';
import { load } from '@/library/load';
import { useSelectedLanguage } from '@/library/selected-language';
import { DocBlocksView } from '@/reader/doc-blocks-view';
import { moveAccessibilityFocus } from '@/reader/study-pane';
import { NoticeBar, useBookmarkBar } from '@/reader/use-bookmark-host';
import { addDays, dayTitle, localDay, relativeDay, relativeWeek, weekStart, weekTitle } from '@/today/days';

// Today, inside Read: the day's text and the week's meetings, as JW
// Library's Daily Text and Meetings tabs show them. Each moves on its own,
// a day or a week at a time, and "Today" brings it back. A publication that
// isn't on the device yet shows a Download that installs it in place; the
// card turns into the reading once it lands.

/** The local day, kept current across midnight and returns to the app. */
function useToday(): number {
  const [today, setToday] = useState(() => localDay(new Date()));
  const refresh = useCallback(() => setToday(localDay(new Date())), []);
  useFocusEffect(refresh);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => subscription.remove();
  }, [refresh]);
  useEffect(() => {
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
    const timer = setTimeout(refresh, midnight.getTime() - now.getTime());
    return () => clearTimeout(timer);
  }, [today, refresh]);
  return today;
}

/** Bumped when the installed publications change: a download lands, a publication is removed. */
function useLibraryVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => onLibraryChanged(() => setVersion((v) => v + 1)), []);
  return version;
}

/**
 * `read()` once per `key`, kept across renders (install progress re-renders
 * often, and each read decrypts a document). A new key reads again.
 */
function useRead<T>(read: () => T, key: string): T {
  const [state, setState] = useState(() => ({ key, value: read() }));
  if (state.key === key) return state.value;
  const value = read();
  setState({ key, value });
  return value;
}

/** The daily text's blocks without its date heading, which the day row shows. */
function withoutDate(blocks: readonly DocBlock[]): readonly DocBlock[] {
  return blocks[0]?.tag === 'Heading' ? blocks.slice(1) : blocks;
}

function announce(message: string) {
  // Android reads the live region on the label; iOS needs the announcement.
  if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(message);
}

export function TodayView() {
  const { colors, look } = useBerean();
  const windowClass = useWindowClass();
  const { fontScale } = useWindowDimensions();
  const insets = useContentInsets();
  const { mepsLanguage } = useSelectedLanguage();
  const today = useToday();
  // Undefined follows today; a day picked with the arrows stays put.
  const [pickedDay, setPickedDay] = useState<number | undefined>();
  const [pickedWeek, setPickedWeek] = useState<number | undefined>();
  const day = pickedDay ?? today;
  const weekDay = pickedWeek ?? today;
  // Away from today only while the pick isn't today (or this week): today
  // itself moves on at midnight and on returning to the app.
  const awayDay = pickedDay !== undefined && pickedDay !== today;
  const awayWeek = pickedWeek !== undefined && weekStart(pickedWeek) !== weekStart(today);
  const { jobs } = useInstalls();
  const bar = useBookmarkBar('today');
  // Read again when the installed publications change (a download lands, a
  // publication is removed) or a new catalog comes in (it names what to
  // download).
  const libraryVersion = useLibraryVersion();
  const { catalogVersion } = useCatalogUpdate();
  const versions = `${libraryVersion}:${catalogVersion}`;
  const text = useRead(() => load(() => reader().dailyText(mepsLanguage, day)), `${mepsLanguage}:${day}:${versions}`);
  const week = useRead(
    () => load(() => reader().meetingWeek(mepsLanguage, weekDay)),
    `${mepsLanguage}:${weekDay}:${versions}`,
  );
  // The week's days: the core's when it read the week, else counted here.
  const firstDay = week.ok ? week.value.firstDay : weekStart(weekDay);
  const lastDay = week.ok ? week.value.lastDay : addDays(firstDay, 6);
  const dayLabelRef = useRef<ComponentRef<typeof View>>(null);
  const weekLabelRef = useRef<ComponentRef<typeof View>>(null);

  const moveDay = (count: number) => {
    const next = addDays(day, count);
    setPickedDay(next === today ? undefined : next);
    announce(dayLabel(next, today));
  };
  const moveWeek = (count: number) => {
    const next = addDays(weekDay, count * 7);
    setPickedWeek(weekStart(next) === weekStart(today) ? undefined : next);
    const first = addDays(firstDay, count * 7);
    announce(weekLabel(first, addDays(first, 6), today));
  };
  // Back to today removes its own button, so focus moves to the label.
  const backToDay = () => {
    setPickedDay(undefined);
    announce(dayLabel(today, today));
    requestAnimationFrame(() => moveAccessibilityFocus(dayLabelRef.current));
  };
  const backToWeek = () => {
    setPickedWeek(undefined);
    const first = weekStart(today);
    announce(weekLabel(first, addDays(first, 6), today));
    requestAnimationFrame(() => moveAccessibilityFocus(weekLabelRef.current));
  };

  const dailyText = (
    <Section title="Daily text">
      <Stepper
        label={dayTitle(day)}
        caption={relativeDay(day, today)}
        accessibilityLabel={dayLabel(day, today)}
        previousLabel="Previous day"
        nextLabel="Next day"
        onPrevious={() => moveDay(-1)}
        onNext={() => moveDay(1)}
        onToday={awayDay ? backToDay : undefined}
        labelRef={dayLabelRef}
      />
      {!text.ok ? (
        <UIText secondary>{text.message}</UIText>
      ) : text.value.tag === 'Ready' ? (
        <View style={styles.reading}>
          {/* Keyed by day: an open footnote belongs to its day's text. */}
          <DocBlocksView key={day} blocks={withoutDate(text.value.inner.text.blocks)} onNotice={bar.notice} />
        </View>
      ) : text.value.tag === 'NotInstalled' ? (
        <DownloadCard
          publication={text.value.inner.publication}
          job={jobs.get(text.value.inner.publication.pubKey)}
          why="Download it to read the text for this day."
        />
      ) : (
        <Unavailable message="No daily text is available for this day in this language." />
      )}
    </Section>
  );

  const meetings = (
    <Section title="Meetings">
      <Stepper
        label={weekTitle(firstDay, lastDay)}
        caption={relativeWeek(firstDay, today)}
        accessibilityLabel={weekLabel(firstDay, lastDay, today)}
        previousLabel="Previous week"
        nextLabel="Next week"
        onPrevious={() => moveWeek(-1)}
        onNext={() => moveWeek(1)}
        onToday={awayWeek ? backToWeek : undefined}
        todayLabel="Back to this week"
        labelRef={weekLabelRef}
      />
      {week.ok ? (
        <>
          <MeetingCard
            meeting="Midweek meeting"
            part={week.value.midweek}
            jobs={jobs}
            unavailable="No meeting workbook covers this week."
          />
          <MeetingCard
            meeting="Weekend meeting"
            subtitle="Watchtower Study"
            part={week.value.weekend}
            jobs={jobs}
            unavailable="No Watchtower study article covers this week."
          />
        </>
      ) : (
        <UIText secondary>{week.message}</UIText>
      )}
    </Section>
  );

  // Wide windows set the two side by side, the text at its reading measure;
  // otherwise one column, capped and centered.
  const sidePadding = readingColumnPadding[look];
  const measure = readingMeasure * fontScale;
  const sideBySide = windowClass === 'expanded';
  return (
    <View style={styles.fill}>
      <ScrollView
        style={[styles.fill, { backgroundColor: colors.surface }]}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          paddingTop: spacing.lg,
          paddingBottom: insets.bottom + spacing.xxl,
          paddingLeft: insets.left + sidePadding,
          paddingRight: insets.right + sidePadding,
        }}
      >
        {sideBySide ? (
          <View style={[styles.columns, { maxWidth: measure * 2 }]}>
            <View style={[styles.column, { flex: 3 }]}>{dailyText}</View>
            <View style={[styles.column, { flex: 2 }]}>{meetings}</View>
          </View>
        ) : (
          <View style={[styles.single, { maxWidth: measure }]}>
            {dailyText}
            {meetings}
          </View>
        )}
      </ScrollView>
      <NoticeBar bar={bar} />
    </View>
  );
}

function dayLabel(day: number, today: number): string {
  const relative = relativeDay(day, today);
  return relative === undefined ? dayTitle(day) : `${relative}, ${dayTitle(day)}`;
}

function weekLabel(first: number, last: number, today: number): string {
  const relative = relativeWeek(first, today);
  const dates = weekTitle(first, last);
  return relative === undefined ? `Week of ${dates}` : `${relative}, ${dates}`;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <UIText variant="title">{title}</UIText>
      {children}
    </View>
  );
}

/** Back and forward a step, the current step in between, and Today when away from it. */
function Stepper({
  label,
  caption,
  accessibilityLabel,
  previousLabel,
  nextLabel,
  onPrevious,
  onNext,
  onToday,
  todayLabel = 'Back to today',
  labelRef,
}: {
  label: string;
  caption: string | undefined;
  accessibilityLabel: string;
  previousLabel: string;
  nextLabel: string;
  onPrevious: () => void;
  onNext: () => void;
  onToday: (() => void) | undefined;
  todayLabel?: string;
  labelRef: RefObject<ComponentRef<typeof View> | null>;
}) {
  const { look, colors, m3 } = useBerean();
  const fill = look === 'material' ? m3.surfaceContainerLow : colors.surfaceRaised;
  return (
    <View style={styles.stepperBlock}>
      <View style={[styles.stepper, { backgroundColor: fill }]}>
        <ArrowButton direction="previous" label={previousLabel} onPress={onPrevious} />
        <View
          ref={labelRef}
          style={styles.stepLabel}
          accessible
          accessibilityLabel={accessibilityLabel}
          accessibilityLiveRegion="polite"
        >
          {caption !== undefined && (
            <UIText variant="caption" secondary style={styles.centered}>
              {caption}
            </UIText>
          )}
          <UIText style={[styles.centered, styles.medium]}>{label}</UIText>
        </View>
        <ArrowButton direction="next" label={nextLabel} onPress={onNext} />
      </View>
      {onToday !== undefined && <TextButton title={todayLabel} align="leading" onPress={onToday} />}
    </View>
  );
}

function ArrowButton({ direction, label, onPress }: { direction: 'previous' | 'next'; label: string; onPress: () => void }) {
  const { look, colors, m3 } = useBerean();
  const material = look === 'material';
  const target = material ? 48 : 44;
  const previous = direction === 'previous';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      android_ripple={material ? { color: m3.onSurfaceVariant, borderless: true, radius: target / 2 } : undefined}
      style={({ pressed }) => [
        styles.arrow,
        { minWidth: target, minHeight: target },
        !material && pressed && { opacity: 0.6 },
      ]}
    >
      <ScaledSymbol
        name={{ ios: previous ? 'chevron.left' : 'chevron.right', android: previous ? 'chevron_left' : 'chevron_right' }}
        size={material ? 24 : 20}
        tintColor={material ? m3.onSurfaceVariant : colors.accent}
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      />
    </Pressable>
  );
}

function useCardFill(): string {
  const { look, colors, m3 } = useBerean();
  return look === 'material' ? m3.surfaceContainerLow : colors.surfaceRaised;
}

/** One meeting's publication: opens it, offers its download, or says there is none. */
function MeetingCard({
  meeting,
  subtitle,
  part,
  jobs,
  unavailable,
}: {
  meeting: string;
  subtitle?: string;
  part: MeetingPart;
  jobs: ReadonlyMap<string, InstallJob>;
  unavailable: string;
}) {
  const { look, colors, m3 } = useBerean();
  const fill = useCardFill();
  const material = look === 'material';
  const overline = subtitle === undefined ? meeting : `${meeting} · ${subtitle}`;
  const head = (
    <UIText variant="caption" secondary style={styles.overline}>
      {overline}
    </UIText>
  );

  if (part.tag === 'Ready') {
    const { publication, docId, title } = part.inner;
    const issue = displayTitle(publication);
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${overline}: ${title}`}
        accessibilityHint={`Opens it in ${issue}`}
        onPress={() =>
          router.push({
            pathname: '/publication',
            params: { pubKey: publication.pubKey, title: issue, docId: String(docId) },
          })
        }
        android_ripple={material ? { color: m3.onSurfaceVariant } : undefined}
        style={({ pressed }) => [styles.card, { backgroundColor: fill }, !material && pressed && { opacity: 0.6 }]}
      >
        <View style={styles.cardRow}>
          <View style={styles.cardText}>
            {head}
            <UIText style={styles.medium}>{title}</UIText>
            <UIText variant="caption" secondary>
              {issue}
            </UIText>
          </View>
          <ScaledSymbol
            name={{ ios: 'chevron.right', android: 'chevron_right' }}
            size={material ? 24 : 16}
            tintColor={material ? m3.onSurfaceVariant : colors.textSecondary}
            accessible={false}
            importantForAccessibility="no-hide-descendants"
            accessibilityElementsHidden
          />
        </View>
      </Pressable>
    );
  }

  if (part.tag === 'NotInstalled') {
    return (
      <View style={[styles.card, { backgroundColor: fill }]}>
        {head}
        <DownloadBody publication={part.inner.publication} job={jobs.get(part.inner.publication.pubKey)} />
      </View>
    );
  }

  return (
    <View style={[styles.card, { backgroundColor: fill }]} accessible accessibilityLabel={`${overline}: ${unavailable}`}>
      {head}
      <UIText secondary>{unavailable}</UIText>
    </View>
  );
}

/** A publication to download for the daily text. */
function DownloadCard({ publication, job, why }: { publication: PublicationSummary; job: InstallJob | undefined; why: string }) {
  const fill = useCardFill();
  return (
    <View style={[styles.card, { backgroundColor: fill }]}>
      <DownloadBody publication={publication} job={job} why={why} />
    </View>
  );
}

function DownloadBody({ publication, job, why }: { publication: PublicationSummary; job: InstallJob | undefined; why?: string }) {
  const title = displayTitle(publication);
  return (
    <>
      <UIText style={styles.medium}>{title}</UIText>
      <UIText variant="caption" secondary>
        {why ?? 'Not downloaded yet.'}
      </UIText>
      {job === undefined ? (
        <TextButton title="Download" accessibilityLabel={`Download ${title}`} align="leading" onPress={() => startInstall(publication)} />
      ) : (
        <JobStatus job={job} />
      )}
    </>
  );
}

function Unavailable({ message }: { message: string }) {
  return (
    <View style={styles.unavailable}>
      <UIText secondary>{message}</UIText>
      <TextButton title="Open Library" align="leading" onPress={() => router.navigate('/library')} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  single: { width: '100%', alignSelf: 'center', gap: spacing.xxl },
  columns: { width: '100%', alignSelf: 'center', flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xxl },
  column: { minWidth: 0 },
  section: { gap: spacing.md },
  reading: { gap: spacing.md },
  stepperBlock: { gap: spacing.xs },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radii.card,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
  },
  stepLabel: { flex: 1, paddingVertical: spacing.xs },
  centered: { textAlign: 'center' },
  medium: { fontWeight: '600' },
  arrow: { alignItems: 'center', justifyContent: 'center' },
  card: { borderRadius: radii.card, padding: spacing.lg, gap: spacing.xs, overflow: 'hidden' },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  cardText: { flex: 1, gap: spacing.xs },
  overline: { textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: '600' },
  unavailable: { gap: spacing.xs },
});
