import type { AtlasEvent, AtlasPeriod } from 'berean-ffi-rn';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Pressable, SectionList, StyleSheet, useWindowDimensions, View } from 'react-native';

import {
  eraBands,
  highlight as highlightFor,
  initialSelection,
  type Selection,
  spokenYears,
  type TimelineSection,
  timelineSpan,
  yearsLabel,
} from '@/atlas/atlas';
import { AtlasMap } from '@/atlas/atlas-map';
import { type AtlasData, atlasData } from '@/atlas/data';
import { UIText } from '@/components/text';
import { TextButton } from '@/components/text-button';
import { mix } from '@/design/appearance';
import { useContentInsets } from '@/design/tab-chrome';
import { useBerean } from '@/design/theme';
import { breakpoints, hairline, radii, spacing } from '@/design/tokens';

type Params = { event?: string; period?: string; pubKey?: string; title?: string };

type Section = TimelineSection<AtlasPeriod, AtlasEvent>;

/**
 * Maps and timeline (Berean's own): Paul's travels in Acts on a map of the
 * Bible lands, beside a timeline of the tours and what happened at each
 * stop. Picking a tour draws its route; picking an event draws its leg and
 * names its places, with a link to read the passage in the Bible it was
 * opened from. Phones stack the map over the timeline; wider windows put
 * them side by side.
 */
export default function AtlasScreen() {
  const { colors } = useBerean();
  const data = useMemo(() => atlasData(), []);
  if (!data.ok) {
    return (
      <View style={styles.message}>
        <UIText style={{ color: colors.accent }}>{data.message}</UIText>
      </View>
    );
  }
  return <Atlas data={data.value} />;
}

function Atlas({ data }: { data: AtlasData }) {
  const { colors } = useBerean();
  const insets = useContentInsets();
  const window = useWindowDimensions();
  const params = useLocalSearchParams<Params>();
  const { sections, places, markers } = data;
  const [selection, setSelection] = useState<Selection | undefined>(() =>
    initialSelection(sections, { event: params.event, period: params.period }),
  );
  const list = useRef<SectionList<AtlasEvent, Section & { data: AtlasEvent[] }>>(null);

  const highlight = useMemo(
    () => (selection === undefined ? undefined : highlightFor(sections, selection, places)),
    [sections, selection, places],
  );
  const section = sections.find((s) => s.key === selection?.section);
  const event = section?.events.find((e) => e.id === selection?.event);

  const listSections = useMemo(() => sections.map((s) => ({ ...s, data: s.events })), [sections]);

  const scrollTo = (sectionKey: string, eventId: string | undefined, animated: boolean) => {
    const sectionIndex = listSections.findIndex((s) => s.key === sectionKey);
    if (sectionIndex === -1) return;
    const itemIndex = eventId === undefined ? 0 : listSections[sectionIndex].data.findIndex((e) => e.id === eventId);
    list.current?.scrollToLocation({
      sectionIndex,
      itemIndex: Math.max(0, itemIndex),
      viewPosition: eventId === undefined ? 0 : 0.2,
      viewOffset: eventId === undefined ? 72 : 0,
      animated,
    });
  };

  // Opened at an event (from the reader): bring it into view once.
  const scrolled = useRef(false);
  const onListLayout = () => {
    if (scrolled.current || selection?.event === undefined) return;
    scrolled.current = true;
    const { section: key, event: id } = selection;
    // After the first rows have measured.
    setTimeout(() => scrollTo(key, id, false), 50);
  };

  const pickSection = (key: string) => {
    setSelection({ section: key });
    scrollTo(key, undefined, true);
  };
  const pickEvent = (s: Section, e: AtlasEvent) =>
    setSelection(selection?.event === e.id ? { section: s.key } : { section: s.key, event: e.id });

  const openPlace = (id: string) =>
    router.push({ pathname: '/atlas-place', params: { id, pubKey: params.pubKey, title: params.title } });

  const read = (e: AtlasEvent) => {
    if (params.pubKey === undefined) return;
    router.navigate({
      pathname: '/',
      params: {
        pubKey: params.pubKey,
        title: params.title ?? '',
        book: String(e.scripture.book),
        chapter: String(e.scripture.start.chapter),
        verse: String(e.scripture.start.verse),
      },
    });
  };

  const wide = window.width >= breakpoints.medium || window.width > window.height;
  const mapLabel = useMemo(() => {
    if (highlight === undefined || section === undefined) return 'Map of the Bible lands';
    const names = highlight.focus.map((id) => data.placesById.get(id)?.name).filter((n) => n !== undefined);
    const what = event !== undefined ? `${event.name}, ${event.scripture.reference}` : section.title;
    return `Map: ${what}. ${names.join(', ')}`;
  }, [highlight, section, event, data.placesById]);

  const map =
    highlight === undefined ? null : (
      <AtlasMap
        markers={markers}
        highlight={highlight}
        fitKey={`${selection?.section}/${selection?.event ?? ''}`}
        accessibilityLabel={mapLabel}
        onOpenPlace={openPlace}
        bottomInset={wide ? insets.bottom : 0}
        style={wide ? styles.wideMap : { height: Math.round(Math.min(Math.max(window.height * 0.38, 220), 440)) }}
      />
    );

  const timeline = (
    <SectionList
      ref={list}
      style={styles.list}
      onLayout={onListLayout}
      contentContainerStyle={{
        paddingLeft: wide ? 0 : insets.left,
        paddingRight: insets.right,
        paddingBottom: insets.bottom + spacing.xl,
      }}
      sections={listSections}
      keyExtractor={(e) => e.id}
      extraData={selection}
      stickySectionHeadersEnabled={false}
      // Every row at once (about fifty), so opening at an event can scroll to it.
      initialNumToRender={80}
      onScrollToIndexFailed={() => undefined}
      ListHeaderComponent={<EraBar sections={sections} selected={selection?.section} onPick={pickSection} />}
      renderSectionHeader={({ section: s }) => (
        <SectionHeader section={s} selected={s.key === selection?.section && selection.event === undefined} onPress={() => pickSection(s.key)} />
      )}
      renderItem={({ item, section: s }) => (
        <EventRow
          event={item}
          selected={item.id === selection?.event}
          inSelectedSection={s.key === selection?.section}
          data={data}
          canRead={params.pubKey !== undefined}
          onPress={() => pickEvent(s, item)}
          onRead={() => read(item)}
          onOpenPlace={openPlace}
        />
      )}
      ListFooterComponent={<AboutMap data={data} unmapped={highlight?.unmapped ?? []} />}
    />
  );

  if (wide) {
    return (
      <View style={[styles.wide, { paddingLeft: insets.left, backgroundColor: colors.surface }]}>
        <View style={styles.wideMapColumn}>{map}</View>
        <View style={[styles.wideList, { borderColor: colors.separator, width: Math.min(440, Math.max(320, window.width * 0.4)) }]}>
          {timeline}
        </View>
      </View>
    );
  }
  return (
    <View style={[styles.stack, { backgroundColor: colors.surface }]}>
      {map}
      <View style={[styles.stackList, { borderColor: colors.separator }]}>{timeline}</View>
    </View>
  );
}

/**
 * The years at a glance: each part of the account as wide as the years it
 * covers, the selected one in the accent. A tap selects it.
 */
function EraBar({
  sections,
  selected,
  onPick,
}: {
  sections: readonly Section[];
  selected: string | undefined;
  onPick: (key: string) => void;
}) {
  const { colors } = useBerean();
  const bands = eraBands(sections);
  const span = timelineSpan(sections);
  const current = sections.find((s) => s.key === selected);
  return (
    <View style={styles.era}>
      <View style={styles.eraBar} accessibilityRole="tablist">
        {bands.map((b, i) => {
          const s = sections[i];
          const on = b.key === selected;
          const fill = on
            ? colors.accent
            : s.period === undefined
              ? mix(colors.surface, colors.textSecondary, 0.25)
              : mix(colors.surface, colors.accent, 0.28);
          return (
            <Pressable
              key={b.key}
              accessibilityRole="tab"
              accessibilityLabel={`${s.title}, ${spokenYears(s.dating)}`}
              accessibilityState={{ selected: on }}
              onPress={() => onPick(b.key)}
              hitSlop={{ top: 10, bottom: 10 }}
              style={[styles.eraBand, { flexGrow: b.width, backgroundColor: fill }]}
            />
          );
        })}
      </View>
      <View style={styles.eraEnds} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <UIText variant="caption" secondary>
          {yearsLabel({ start: span.start, end: span.start, approx: false })}
        </UIText>
        <UIText variant="caption" secondary>
          {yearsLabel({ start: span.end, end: span.end, approx: false })}
        </UIText>
      </View>
      {current !== undefined && (
        <UIText variant="caption" secondary accessibilityLiveRegion="polite" style={styles.eraCurrent}>
          {current.title}, {yearsLabel(current.dating)}
        </UIText>
      )}
    </View>
  );
}

function SectionHeader({ section, selected, onPress }: { section: Section; selected: boolean; onPress: () => void }) {
  const { colors, look } = useBerean();
  const material = look === 'material';
  const detail = [yearsLabel(section.dating), section.period?.scripture.reference].filter((d) => d !== undefined).join(' · ');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${section.title}, ${spokenYears(section.dating)}${section.period ? `, ${section.period.scripture.reference}` : ''}`}
      accessibilityHint="Shows it on the map"
      accessibilityState={{ selected }}
      onPress={onPress}
      android_ripple={{ color: colors.separator }}
      style={({ pressed }) => [
        styles.header,
        { borderColor: colors.separator, minHeight: material ? 56 : 44 },
        selected && { backgroundColor: mix(colors.surface, colors.accent, 0.1) },
        pressed && !material && { opacity: 0.6 },
      ]}
    >
      <UIText accessibilityRole="header" style={[styles.headerTitle, selected && { color: colors.accent }]}>
        {section.title}
      </UIText>
      <UIText variant="caption" secondary>
        {detail}
      </UIText>
    </Pressable>
  );
}

function EventRow({
  event,
  selected,
  inSelectedSection,
  data,
  canRead,
  onPress,
  onRead,
  onOpenPlace,
}: {
  event: AtlasEvent;
  selected: boolean;
  inSelectedSection: boolean;
  data: AtlasData;
  canRead: boolean;
  onPress: () => void;
  onRead: () => void;
  onOpenPlace: (id: string) => void;
}) {
  const { colors, look } = useBerean();
  const material = look === 'material';
  const placeIds = [...new Set(event.placeIds)];
  return (
    <View
      style={[
        styles.event,
        { borderColor: colors.separator },
        selected && { backgroundColor: mix(colors.surface, colors.accent, 0.1) },
      ]}
    >
      <View
        style={[styles.eventRail, { backgroundColor: selected ? colors.accent : inSelectedSection ? mix(colors.surface, colors.accent, 0.45) : colors.separator }]}
      />
      <View style={styles.eventBody}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${event.name}, ${event.scripture.reference}, ${spokenYears(event.dating)}`}
          accessibilityHint={selected ? 'Shows the whole tour' : 'Shows it on the map'}
          accessibilityState={{ selected, expanded: selected }}
          onPress={onPress}
          android_ripple={{ color: colors.separator }}
          style={({ pressed }) => [
            styles.eventMain,
            { minHeight: material ? 56 : 44 },
            pressed && !material && { opacity: 0.6 },
          ]}
        >
          <UIText style={selected && styles.selectedName}>{event.name}</UIText>
          <UIText variant="caption" secondary>
            {event.scripture.reference} · {yearsLabel(event.dating)}
          </UIText>
        </Pressable>
        {selected && (
          <View style={styles.eventMore}>
            {canRead && (
              <TextButton
                align="leading"
                title={`Read ${event.scripture.reference}`}
                onPress={onRead}
                bold
              />
            )}
            <View style={styles.places} accessibilityLabel="Places" accessibilityRole="list">
              {placeIds.map((id) => {
                const place = data.placesById.get(id);
                if (place === undefined) return null;
                return (
                  <Pressable
                    key={id}
                    accessibilityRole="button"
                    accessibilityLabel={place.name}
                    accessibilityHint="Shows the place"
                    onPress={() => onOpenPlace(id)}
                    style={({ pressed }) => [
                      styles.placeChip,
                      {
                        borderColor: colors.outline,
                        borderRadius: material ? radii.materialChip : radii.capsule,
                        minHeight: material ? 48 : 44,
                        opacity: pressed ? 0.6 : 1,
                      },
                    ]}
                  >
                    <UIText variant="caption" style={{ color: colors.text }}>
                      {place.name}
                    </UIText>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

function AboutMap({ data, unmapped }: { data: AtlasData; unmapped: readonly string[] }) {
  return (
    <View style={styles.about}>
      <UIText variant="caption" secondary accessibilityRole="header" style={styles.aboutTitle}>
        ABOUT THE MAP
      </UIText>
      <UIText variant="caption" secondary>
        Lines join the places in the order the account names them; they aren’t the roads or sea lanes taken. Dates are
        approximate, as the study Bible and Insight give them.
        {unmapped.length > 0 ? ` Not drawn, having no single point: ${unmapped.join(', ')}.` : ''}
      </UIText>
      <UIText variant="caption" secondary>
        Places: {data.attributions.map((a) => `${a.name} (${a.license})`).join(', ')}. Coastlines: Natural Earth (public
        domain).
      </UIText>
    </View>
  );
}

const styles = StyleSheet.create({
  message: { flex: 1, padding: spacing.lg },
  stack: { flex: 1 },
  stackList: { flex: 1, borderTopWidth: hairline },
  wide: { flex: 1, flexDirection: 'row' },
  wideMapColumn: { flex: 1 },
  wideMap: { flex: 1 },
  wideList: { borderLeftWidth: hairline },
  list: { flex: 1 },
  era: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.sm, gap: spacing.xs },
  eraBar: { flexDirection: 'row', height: 14, gap: 2, borderRadius: radii.chip, overflow: 'hidden' },
  eraBand: { flexBasis: 0 },
  eraEnds: { flexDirection: 'row', justifyContent: 'space-between' },
  eraCurrent: { fontWeight: '600' },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: hairline,
    justifyContent: 'center',
    gap: 2,
  },
  headerTitle: { fontWeight: '600' },
  event: { flexDirection: 'row', borderBottomWidth: hairline },
  eventRail: { width: 3, marginLeft: spacing.lg, marginRight: spacing.md },
  eventBody: { flex: 1, paddingRight: spacing.lg },
  eventMain: { justifyContent: 'center', paddingVertical: spacing.sm, gap: 2 },
  selectedName: { fontWeight: '600' },
  eventMore: { paddingBottom: spacing.md, gap: spacing.xs },
  places: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  placeChip: {
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
  },
  about: { padding: spacing.lg, gap: spacing.sm },
  aboutTitle: { letterSpacing: 0.4 },
});
