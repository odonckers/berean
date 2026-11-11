import type { AtlasEvent } from 'berean-ffi-rn';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { type ReactNode, useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import {
  placeKindLabel,
  pointPrecision,
  publicationName,
  siteConfidence,
  spokenYears,
  yearsLabel,
} from '@/atlas/atlas';
import { AtlasMap } from '@/atlas/atlas-map';
import { atlasData } from '@/atlas/data';
import { UIText } from '@/components/text';
import { useContentInsets } from '@/design/tab-chrome';
import { useBerean } from '@/design/theme';
import { hairline, spacing } from '@/design/tokens';
import { load } from '@/library/load';

type Params = { id: string; pubKey?: string; title?: string };

/**
 * A place in the atlas: where it is, how sure the publications are of the
 * site, what they say of it, and the events of the account there.
 */
export default function AtlasPlaceScreen() {
  const { colors } = useBerean();
  const insets = useContentInsets();
  const params = useLocalSearchParams<Params>();
  const data = useMemo(() => atlasData(), []);
  const place = data.ok ? data.value.placesById.get(params.id) : undefined;
  const events = useMemo(
    () => (data.ok && place !== undefined ? load(() => data.value.atlas.eventsAt(place.id)) : undefined),
    [data, place],
  );

  if (!data.ok || place === undefined) {
    return (
      <View style={styles.message}>
        <UIText style={{ color: colors.accent }}>{data.ok ? 'This place isn’t in the atlas.' : data.message}</UIText>
      </View>
    );
  }

  const { markers, placesById } = data.value;
  const marker = markers.find((m) => m.id === place.id);
  const parent = place.parent === undefined ? undefined : placesById.get(place.parent);
  const precision = place.coordinates === undefined ? undefined : pointPrecision(place.coordinates.precision);

  const openEvent = (e: AtlasEvent) =>
    router.dismissTo({ pathname: '/atlas', params: { event: e.id, pubKey: params.pubKey, title: params.title } });
  const openPlace = (id: string) =>
    router.push({ pathname: '/atlas-place', params: { id, pubKey: params.pubKey, title: params.title } });

  return (
    <>
      <Stack.Screen options={{ title: place.name }} />
      <ScrollView
        style={{ backgroundColor: colors.surface }}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingLeft: insets.left, paddingRight: insets.right, paddingBottom: insets.bottom + spacing.xl }}
      >
        {marker !== undefined && (
          <AtlasMap
            markers={markers}
            highlight={{ route: [], path: [], focus: [place.id], context: [], fit: [marker.at], unmapped: [] }}
            fitKey={place.id}
            interactive={false}
            accessibilityLabel={`Map: ${place.name}`}
            style={styles.map}
          />
        )}
        <View style={styles.body}>
          <UIText variant="title">{place.name}</UIText>
          <UIText secondary>
            {[placeKindLabel(place.kind), parent === undefined ? undefined : `in ${parent.name}`]
              .filter((p) => p !== undefined)
              .join(' ')}
          </UIText>
          {place.alternateNames.length > 0 && (
            <UIText secondary>Also called {place.alternateNames.join(', ')}</UIText>
          )}
          <UIText>
            {siteConfidence(place.confidence)}
            {marker === undefined ? ' It isn’t drawn on the map.' : ''}
            {precision !== undefined ? ` ${precision}` : ''}
          </UIText>
        </View>
        {parent !== undefined && (
          <Section title="Part of">
            <Row label={parent.name} detail={placeKindLabel(parent.kind)} onPress={() => openPlace(parent.id)} hint="Shows the place" />
          </Section>
        )}

        {place.citations.some((c) => c.quote !== undefined) && (
          <Section title="What the publications say">
            {place.citations.map((c, i) =>
              c.quote === undefined ? null : (
                <View key={`${c.publication}-${i}`} style={[styles.quote, { borderColor: colors.separator }]}>
                  <UIText>“{c.quote}”</UIText>
                  <UIText variant="caption" secondary>
                    {publicationName(c.publication)}, {c.location.replace(`${c.publication} `, '')}
                  </UIText>
                </View>
              ),
            )}
          </Section>
        )}

        {place.alternateSites.length > 0 && (
          <Section title="Other proposed sites">
            {place.alternateSites.map((s) => (
              <View key={s.name} style={[styles.quote, { borderColor: colors.separator }]}>
                <UIText>
                  {s.name}
                  {s.rejected ? ' (not accepted)' : ''}
                </UIText>
                {s.note !== undefined && (
                  <UIText variant="caption" secondary>
                    {s.note}
                  </UIText>
                )}
              </View>
            ))}
          </Section>
        )}

        <Section title="In the account">
          {events === undefined || !events.ok ? (
            <UIText style={[styles.pad, { color: colors.accent }]}>{events?.ok === false ? events.message : ''}</UIText>
          ) : events.value.length === 0 ? (
            <UIText secondary style={styles.pad}>
              No events in the atlas happen here.
            </UIText>
          ) : (
            events.value.map((e) => (
              <Row
                key={e.id}
                label={e.name}
                detail={`${e.scripture.reference} · ${yearsLabel(e.dating)}`}
                accessibilityLabel={`${e.name}, ${e.scripture.reference}, ${spokenYears(e.dating)}`}
                hint="Shows it on the map"
                onPress={() => openEvent(e)}
              />
            ))
          )}
        </Section>

        {place.coordinates !== undefined && (
          <UIText variant="caption" secondary style={styles.pad}>
            Location from {place.coordinates.source}.
          </UIText>
        )}
      </ScrollView>
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const { colors } = useBerean();
  return (
    <View style={styles.section}>
      <UIText
        variant="caption"
        secondary
        accessibilityRole="header"
        style={[styles.sectionHeader, { borderColor: colors.separator }]}
      >
        {title.toUpperCase()}
      </UIText>
      {children}
    </View>
  );
}

function Row({
  label,
  detail,
  accessibilityLabel,
  hint,
  onPress,
}: {
  label: string;
  detail: string;
  accessibilityLabel?: string;
  hint: string;
  onPress: () => void;
}) {
  const { colors, look } = useBerean();
  const material = look === 'material';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? `${label}, ${detail}`}
      accessibilityHint={hint}
      onPress={onPress}
      android_ripple={{ color: colors.separator }}
      style={({ pressed }) => [
        styles.row,
        { borderColor: colors.separator, minHeight: material ? 56 : 44 },
        pressed && !material && { opacity: 0.6 },
      ]}
    >
      <UIText>{label}</UIText>
      <UIText variant="caption" secondary>
        {detail}
      </UIText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  message: { flex: 1, padding: spacing.lg },
  map: { height: 220 },
  body: { padding: spacing.lg, gap: spacing.sm },
  section: { marginTop: spacing.md },
  sectionHeader: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
    borderBottomWidth: hairline,
    letterSpacing: 0.4,
  },
  quote: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.xs, borderBottomWidth: hairline },
  row: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderBottomWidth: hairline, justifyContent: 'center', gap: 2 },
  pad: { padding: spacing.lg },
});
