import {
  type AtlasAttribution,
  type AtlasCitation,
  AtlasConfidence,
  type AtlasEvent,
  type AtlasNote,
  AtlasNoteKind,
  type AtlasPassage,
  type AtlasPeriod,
  type AtlasPerson,
  type AtlasPlace,
  AtlasPlaceKind,
  PubKind,
} from 'berean-ffi-rn';
import { router } from 'expo-router';
import { type ReactNode, useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';

import { FilterChip } from '@/components/filter-chip';
import { ScaledSymbol } from '@/components/scaled-symbol';
import { UIText } from '@/components/text';
import { TextButton } from '@/components/text-button';
import { useContentInsets } from '@/design/tab-chrome';
import { useBerean } from '@/design/theme';
import { hairline, radii, readingColumnPadding, spacing } from '@/design/tokens';
import { useWindowClass } from '@/design/use-window-class';
import { atlas, library } from '@/ffi/core';
import { displayTitle } from '@/library/labels';
import { type Loaded, load } from '@/library/load';
import { rememberedBible } from '@/reader/session';

import { AtlasMap, type MapPlace } from './atlas-map';
import {
  type Selection,
  dateLabel,
  initialSelection,
  listOf,
  placeLabels,
  placePoint,
  routePoints,
  spokenDate,
  spokenReference,
} from './model';
import type { Point } from './projection';
import { Timeline } from './timeline';

// The Bible map and timeline: Paul's journeys and his voyage to Rome, each
// drawn on the map with its stops, and the events of Acts along it. On a
// phone the map sits above the list; on a wide window, beside it. The list
// holds everything the map shows, so a screen reader reads the list.

export type AtlasParams = { event?: string; place?: string; book?: number; chapter?: number };

type Data = {
  places: AtlasPlace[];
  periods: AtlasPeriod[];
  events: AtlasEvent[];
  people: AtlasPerson[];
  attribution: AtlasAttribution[];
};

function readAtlas(): Loaded<Data> {
  return load(() => {
    const a = atlas();
    return {
      places: a.places(),
      periods: a.periods(),
      events: a.events(),
      people: a.people(),
      attribution: a.attribution(),
    };
  });
}

export function AtlasView({ params }: { params: AtlasParams }) {
  const { colors } = useBerean();
  const [data] = useState(readAtlas);
  if (!data.ok) {
    return (
      <View style={[styles.fill, styles.centered, { backgroundColor: colors.surface }]}>
        <UIText secondary>{data.message}</UIText>
      </View>
    );
  }
  if (data.value.periods.length === 0) {
    return (
      <View style={[styles.fill, styles.centered, { backgroundColor: colors.surface }]}>
        <UIText secondary>There is nothing to show on the map yet.</UIText>
      </View>
    );
  }
  return <Atlas data={data.value} params={params} />;
}

/** Where a place in the list asked to be shown: fits the map to it. */
type Shown = Selection & { placeFromList?: boolean };

function Atlas({ data, params }: { data: Data; params: AtlasParams }) {
  const { look, colors } = useBerean();
  const windowClass = useWindowClass();
  const { height, fontScale } = useWindowDimensions();
  const insets = useContentInsets();

  const placesById = useMemo(() => new Map(data.places.map((p) => [p.id, p])), [data.places]);
  const peopleById = useMemo(() => new Map(data.people.map((p) => [p.id, p])), [data.people]);
  const labels = useMemo(() => placeLabels(data.places), [data.places]);
  const [shown, setShown] = useState<Shown>(
    () => initialSelection(data.periods, data.events, params) ?? { periodId: data.periods[0]!.id },
  );

  const period = data.periods.find((p) => p.id === shown.periodId) ?? data.periods[0]!;
  const periodEvents = data.events.filter((e) => e.periodIds.includes(period.id));
  const event = shown.eventId === undefined ? undefined : data.events.find((e) => e.id === shown.eventId);
  const place = shown.placeId === undefined ? undefined : placesById.get(shown.placeId);

  const route = routePoints(period, placesById);
  const routeIds = new Set(route.map((r) => r.id));
  const eventIds = new Set(event?.placeIds ?? []);
  const mapPlaces: MapPlace[] = [];
  for (const p of data.places) {
    const at = placePoint(p);
    if (at === undefined) continue;
    mapPlaces.push({
      id: p.id,
      label: labels.get(p.id) ?? p.name,
      at,
      emphasis: eventIds.has(p.id) ? 'event' : routeIds.has(p.id) ? 'route' : 'other',
      uncertain: p.confidence !== AtlasConfidence.Established,
    });
  }

  const pointsOf = (ids: readonly string[]): Point[] =>
    ids.flatMap((id) => {
      const p = placesById.get(id);
      const at = p === undefined ? undefined : placePoint(p);
      return at === undefined ? [] : [at];
    });
  const placeAt = place === undefined ? undefined : placePoint(place);
  const eventPoints = event === undefined ? [] : pointsOf(event.placeIds);
  const focus =
    shown.placeFromList && placeAt !== undefined
      ? [placeAt]
      : eventPoints.length > 0
        ? eventPoints
        : route.map((r) => r.at);
  const focusKey = `${period.id}|${event?.id ?? ''}|${shown.placeFromList ? (place?.id ?? '') : ''}`;

  const routeNames = route.map((r) => labels.get(r.id) ?? r.id);
  const mapLabel =
    event !== undefined && event.placeIds.length > 0
      ? `Map of ${event.title}, at ${listOf(event.placeIds.map((id) => labels.get(id) ?? id))}`
      : `Map of ${period.name}${routeNames.length > 0 ? `, by way of ${listOf(dedupe(routeNames))}` : ''}`;

  const [bible] = useState(firstBible);
  const read = (passage: AtlasPassage) => {
    if (bible === undefined) {
      router.navigate('/library');
      return;
    }
    router.navigate({
      pathname: '/',
      params: {
        pubKey: bible.pubKey,
        title: bible.title,
        book: String(passage.book),
        chapter: String(passage.start.chapter),
        verse: String(passage.start.verse),
      },
    });
  };

  const selectPeriod = (periodId: string) => setShown({ periodId });
  const selectEvent = (e: AtlasEvent) =>
    setShown((s) =>
      s.eventId === e.id
        ? { periodId: s.periodId }
        : { periodId: e.periodIds.includes(s.periodId) ? s.periodId : (e.periodIds[0] ?? s.periodId), eventId: e.id },
    );
  const selectPlace = (placeId: string | undefined, fromList: boolean) =>
    setShown((s) => ({ ...s, placeId, placeFromList: fromList && placeId !== undefined }));

  const wide = windowClass === 'expanded';
  const sidePadding = readingColumnPadding[look];

  const map = (
    <AtlasMap
      places={mapPlaces}
      route={route.map((r) => r.at)}
      focus={focus}
      focusKey={focusKey}
      selectedPlaceId={place?.id}
      onPlacePress={(id) => selectPlace(id, false)}
      accessibilityLabel={mapLabel}
    />
  );

  const panel = (
    <View style={styles.panel}>
      <Section title="Timeline">
        <Timeline periods={data.periods} selectedId={period.id} onSelect={selectPeriod} />
      </Section>

      {place !== undefined && (
        <PlaceCard
          place={place}
          label={labels.get(place.id) ?? place.name}
          parent={place.parentId === undefined ? undefined : placesById.get(place.parentId)}
          events={atlas().eventsAtPlace(place.id)}
          selectedEventId={event?.id}
          onEvent={(e) => selectEvent(e)}
          onClose={() => selectPlace(undefined, false)}
        />
      )}

      <View style={styles.periodHeader}>
        <UIText variant="title" accessibilityRole="header">
          {period.name}
        </UIText>
        <UIText secondary accessibilityLabel={`${spokenDate(period.date)}, ${spokenReference(period.passage.reference)}`}>
          {`${dateLabel(period.date)} · ${period.passage.reference}`}
        </UIText>
        {routeNames.length > 0 && (
          <UIText variant="caption" secondary>
            {dedupe(routeNames).join(' → ')}
          </UIText>
        )}
        <Notes notes={period.notes} />
        <TextButton
          title={bible === undefined ? 'Get a Bible to read this' : `Read ${period.passage.reference}`}
          accessibilityLabel={
            bible === undefined ? 'Get a Bible to read this' : `Read ${spokenReference(period.passage.reference)}`
          }
          align="leading"
          onPress={() => read(period.passage)}
        />
      </View>

      <View accessibilityRole="list" style={[styles.events, { borderColor: colors.separator }]}>
        {periodEvents.map((e) => (
          <EventRow
            key={e.id}
            event={e}
            expanded={e.id === event?.id}
            onPress={() => selectEvent(e)}
            placeNames={e.placeIds.map((id) => ({ id, name: labels.get(id) ?? id }))}
            selectedPlaceId={place?.id}
            onPlace={(id) => selectPlace(id, true)}
            people={e.personIds.flatMap((id) => {
              const person = peopleById.get(id);
              return person === undefined ? [] : [person.name];
            })}
            readTitle={bible === undefined ? undefined : `Read ${e.passage.reference}`}
            onRead={() => read(e.passage)}
          />
        ))}
      </View>

      <Attribution sources={data.attribution} />
    </View>
  );

  if (wide) {
    const panelWidth = Math.min(Math.round(400 * Math.min(fontScale, 1.6)), 560);
    return (
      <View
        style={[
          styles.fill,
          styles.row,
          { backgroundColor: colors.surface, paddingLeft: insets.left, paddingRight: insets.right },
        ]}
      >
        <View style={[styles.fill, { padding: spacing.lg, paddingBottom: insets.bottom + spacing.lg }]}>{map}</View>
        <ScrollView
          style={{ width: panelWidth, flexGrow: 0 }}
          contentContainerStyle={{
            paddingTop: spacing.lg,
            paddingRight: sidePadding,
            paddingLeft: spacing.xs,
            paddingBottom: insets.bottom + spacing.xxl,
          }}
        >
          {panel}
        </ScrollView>
      </View>
    );
  }

  // One column: the map above, sized to the window, the list scrolling below.
  const mapHeight = Math.round(Math.min(480, Math.max(220, height * (windowClass === 'medium' ? 0.45 : 0.38))));
  return (
    <View style={[styles.fill, { backgroundColor: colors.surface }]}>
      <View
        style={{
          height: mapHeight,
          paddingTop: spacing.sm,
          paddingLeft: insets.left + spacing.md,
          paddingRight: insets.right + spacing.md,
        }}
      >
        {map}
      </View>
      <ScrollView
        style={styles.fill}
        contentContainerStyle={{
          paddingTop: spacing.lg,
          paddingBottom: insets.bottom + spacing.xxl,
          paddingLeft: insets.left + sidePadding,
          paddingRight: insets.right + sidePadding,
        }}
      >
        <View style={[styles.column, windowClass === 'medium' && styles.measure]}>{panel}</View>
      </ScrollView>
    </View>
  );
}

function dedupe(names: readonly string[]): string[] {
  return names.filter((n, i) => names.indexOf(n) === i);
}

/** The Bible last open, else the first installed one. */
function firstBible(): { pubKey: string; title: string } | undefined {
  const remembered = rememberedBible();
  if (remembered !== undefined) return remembered;
  const found = load(() =>
    library()
      .installed()
      .find((p) => p.kind === PubKind.Bible),
  );
  return found.ok && found.value !== undefined
    ? { pubKey: found.value.pubKey, title: displayTitle(found.value) }
    : undefined;
}

// ---------------------------------------------------------------------------

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <UIText variant="label" secondary accessibilityRole="header">
        {title}
      </UIText>
      {children}
    </View>
  );
}

const NOTE_LABELS: Record<AtlasNoteKind, string> = {
  [AtlasNoteKind.Conflict]: 'Sources differ',
  [AtlasNoteKind.Gap]: 'Not recorded',
  [AtlasNoteKind.Note]: 'Note',
};

function Notes({ notes }: { notes: readonly AtlasNote[] }) {
  if (notes.length === 0) return null;
  return (
    <View style={styles.notes}>
      {notes.map((n, i) => (
        <UIText key={i} variant="caption" secondary>
          <UIText variant="caption" style={styles.strong}>{`${NOTE_LABELS[n.kind]}. `}</UIText>
          {n.text}
        </UIText>
      ))}
    </View>
  );
}

type EventRowProps = {
  event: AtlasEvent;
  expanded: boolean;
  onPress: () => void;
  placeNames: { id: string; name: string }[];
  selectedPlaceId: string | undefined;
  onPlace: (id: string) => void;
  people: string[];
  readTitle: string | undefined;
  onRead: () => void;
};

function EventRow({
  event,
  expanded,
  onPress,
  placeNames,
  selectedPlaceId,
  onPlace,
  people,
  readTitle,
  onRead,
}: EventRowProps) {
  const { look, colors, m3 } = useBerean();
  const material = look === 'material';
  const accent = material ? m3.primary : colors.accent;
  const where = listOf(placeNames.map((p) => p.name));
  return (
    <View style={[styles.eventRow, { borderColor: colors.separator }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${event.title}, ${spokenReference(event.passage.reference)}${where === '' ? '' : `, at ${where}`}`}
        accessibilityHint={expanded ? undefined : 'Shows it on the map'}
        accessibilityState={{ expanded, selected: expanded }}
        onPress={onPress}
        style={({ pressed }) => [
          styles.eventButton,
          { minHeight: material ? 48 : 44, opacity: pressed ? 0.6 : 1 },
        ]}
      >
        <View style={[styles.marker, { borderColor: accent, backgroundColor: expanded ? accent : 'transparent' }]} />
        <View style={styles.fill}>
          <UIText style={expanded && styles.strong}>{event.title}</UIText>
          <UIText variant="caption" secondary>
            {where === '' ? event.passage.reference : `${event.passage.reference} · ${where}`}
          </UIText>
        </View>
        <ScaledSymbol
          name={{ ios: expanded ? 'chevron.up' : 'chevron.down', android: expanded ? 'expand_less' : 'expand_more' }}
          tintColor={colors.textSecondary}
          size={18}
          accessible={false}
        />
      </Pressable>
      {expanded && (
        <View style={styles.eventDetail}>
          <UIText variant="caption" secondary accessibilityLabel={spokenDate(event.date)}>
            {event.date.inherited ? `During the period, ${dateLabel(event.date)}` : dateLabel(event.date)}
          </UIText>
          {placeNames.length > 0 && (
            <View style={styles.chips}>
              {placeNames.map((p) => (
                <FilterChip
                  key={p.id}
                  label={p.name}
                  selected={p.id === selectedPlaceId}
                  accessibilityLabel={`${p.name}, show on the map`}
                  onPress={() => onPlace(p.id)}
                />
              ))}
            </View>
          )}
          {people.length > 0 && <UIText variant="caption">{`With ${listOf(people)}`}</UIText>}
          <TextButton
            title={readTitle ?? 'Get a Bible to read this'}
            accessibilityLabel={readTitle === undefined ? undefined : `Read ${spokenReference(event.passage.reference)}`}
            align="leading"
            onPress={onRead}
          />
          <Sources citations={event.citations} />
        </View>
      )}
    </View>
  );
}

function Sources({ citations }: { citations: readonly AtlasCitation[] }) {
  const { colors } = useBerean();
  if (citations.length === 0) return null;
  return (
    <View style={styles.sources}>
      <UIText variant="label" secondary accessibilityRole="header">
        Sources
      </UIText>
      {citations.map((c, i) => (
        <View key={i} style={styles.source}>
          {c.quote !== undefined && <UIText variant="caption">{`“${c.quote}”`}</UIText>}
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`${c.publication}, ${c.location}. Opens in the browser`}
            onPress={() => void Linking.openURL(c.url)}
            hitSlop={8}
            style={({ pressed }) => [styles.sourceLink, { opacity: pressed ? 0.6 : 1 }]}
          >
            <UIText variant="caption" style={{ color: colors.accent }}>
              {`${c.publication}, ${c.location}`}
            </UIText>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

const KIND_LABELS: Record<AtlasPlaceKind, string> = {
  [AtlasPlaceKind.City]: 'City',
  [AtlasPlaceKind.Port]: 'Port',
  [AtlasPlaceKind.Harbor]: 'Harbor',
  [AtlasPlaceKind.Island]: 'Island',
  [AtlasPlaceKind.Region]: 'Region',
  [AtlasPlaceKind.Cape]: 'Cape',
  [AtlasPlaceKind.Bay]: 'Bay',
  [AtlasPlaceKind.Station]: 'Stopping place',
};

const CONFIDENCE_LABELS: Record<AtlasConfidence, string | undefined> = {
  [AtlasConfidence.Established]: undefined,
  [AtlasConfidence.Likely]: 'Likely location',
  [AtlasConfidence.Uncertain]: 'Location uncertain',
};

type PlaceCardProps = {
  place: AtlasPlace;
  label: string;
  parent: AtlasPlace | undefined;
  events: AtlasEvent[];
  selectedEventId: string | undefined;
  onEvent: (e: AtlasEvent) => void;
  onClose: () => void;
};

function PlaceCard({ place, label, parent, events, selectedEventId, onEvent, onClose }: PlaceCardProps) {
  const { look, colors, m3 } = useBerean();
  const material = look === 'material';
  const kind = [KIND_LABELS[place.kind], parent === undefined ? undefined : `on ${parent.name}`, CONFIDENCE_LABELS[place.confidence]]
    .filter((s) => s !== undefined)
    .join(' · ');
  const others = place.alternateNames.filter((n) => n !== label);
  const sites = place.alternateSites.filter((s) => !s.rejected);
  return (
    <View
      style={[
        styles.card,
        material
          ? { backgroundColor: m3.surfaceContainerLow, borderRadius: radii.materialPane }
          : { backgroundColor: colors.surfaceRaised, borderRadius: radii.card },
      ]}
    >
      <View style={styles.cardHeader}>
        <View style={styles.fill}>
          <UIText variant="title" accessibilityRole="header">
            {label}
          </UIText>
          <UIText variant="caption" secondary>
            {kind}
          </UIText>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Close ${label}`}
          onPress={onClose}
          style={({ pressed }) => [
            styles.close,
            { width: material ? 48 : 44, height: material ? 48 : 44, opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <ScaledSymbol name={{ ios: 'xmark.circle.fill', android: 'close' }} tintColor={colors.textSecondary} size={22} accessible={false} />
        </Pressable>
      </View>
      {others.length > 0 && <UIText variant="caption">{`Also called ${listOf(others)}`}</UIText>}
      {sites.length > 0 && (
        <UIText variant="caption" secondary>
          {`Other proposed sites: ${listOf(sites.map((s) => s.name))}`}
        </UIText>
      )}
      <Notes notes={place.notes} />
      {events.length > 0 && (
        <View style={styles.cardEvents}>
          <UIText variant="label" secondary accessibilityRole="header">
            {events.length === 1 ? 'What happened here' : `What happened here (${events.length})`}
          </UIText>
          {events.map((e) => (
            <TextButton
              key={e.id}
              title={`${e.title} (${e.passage.reference})`}
              accessibilityLabel={`${e.title}, ${spokenReference(e.passage.reference)}`}
              selected={e.id === selectedEventId}
              align="leading"
              onPress={() => onEvent(e)}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function Attribution({ sources }: { sources: readonly AtlasAttribution[] }) {
  const { colors } = useBerean();
  const all = [
    ...sources.map((s) => ({ name: s.name, url: s.url, license: s.license })),
    { name: 'Natural Earth', url: 'https://www.naturalearthdata.com/', license: 'public domain' },
  ];
  return (
    <View style={[styles.attribution, { borderColor: colors.separator }]}>
      <UIText variant="caption" secondary>
        Place locations and coastlines from:
      </UIText>
      {all.map((s) => (
        <Pressable
          key={s.name}
          accessibilityRole="link"
          accessibilityLabel={`${s.name}, ${s.license}. Opens in the browser`}
          onPress={() => void Linking.openURL(s.url)}
          hitSlop={8}
          style={({ pressed }) => [styles.sourceLink, { opacity: pressed ? 0.6 : 1 }]}
        >
          <UIText variant="caption" style={{ color: colors.accent }}>
            {`${s.name} (${s.license})`}
          </UIText>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  row: { flexDirection: 'row' },
  centered: { alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  column: { width: '100%', alignSelf: 'center' },
  measure: { maxWidth: 680 },
  panel: { gap: spacing.xl },
  section: { gap: spacing.sm },
  periodHeader: { gap: spacing.xs },
  strong: { fontWeight: '600' },
  notes: { gap: spacing.xs, marginTop: spacing.xs },
  events: { borderTopWidth: hairline },
  eventRow: { borderBottomWidth: hairline },
  eventButton: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  marker: { width: 12, height: 12, borderRadius: 6, borderWidth: 2 },
  eventDetail: { gap: spacing.sm, paddingLeft: 12 + spacing.md, paddingBottom: spacing.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  sources: { gap: spacing.sm },
  source: { gap: 2 },
  sourceLink: { alignSelf: 'flex-start', paddingVertical: 2 },
  card: { padding: spacing.lg, gap: spacing.sm },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  close: { alignItems: 'center', justifyContent: 'center', marginTop: -spacing.sm, marginRight: -spacing.sm },
  cardEvents: { gap: 0, marginTop: spacing.xs },
  attribution: { borderTopWidth: hairline, paddingTop: spacing.lg, gap: spacing.xs },
});
