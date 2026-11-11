import type { AtlasAttribution, AtlasEvent, AtlasLike, AtlasPeriod, AtlasPlace } from 'berean-ffi-rn';

import { getCore } from '@/ffi/core';
import { load, type Loaded } from '@/library/load';

import { markers, type Marker, timelineSections, type TimelineSection } from '@/atlas/atlas';

/** The atlas as the screens read it, built once: it's compiled into the core. */
export type AtlasData = {
  atlas: AtlasLike;
  sections: TimelineSection<AtlasPeriod, AtlasEvent>[];
  events: AtlasEvent[];
  places: AtlasPlace[];
  placesById: ReadonlyMap<string, AtlasPlace>;
  markers: Marker[];
  attributions: AtlasAttribution[];
};

let cached: AtlasData | undefined;

export function atlasData(): Loaded<AtlasData> {
  if (cached !== undefined) return { ok: true, value: cached };
  const read = load(() => {
    const atlas = getCore().atlas();
    const events = atlas.allEvents();
    const places = atlas.places();
    return {
      atlas,
      sections: timelineSections(atlas.periods(), events),
      events,
      places,
      placesById: new Map(places.map((p) => [p.id, p])),
      markers: markers(places),
      attributions: atlas.attributions(),
    };
  });
  if (read.ok) cached = read.value;
  return read;
}
