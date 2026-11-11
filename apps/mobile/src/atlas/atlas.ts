// The map and timeline's logic over the core's atlas records: years as
// people read and hear them, the timeline's sections, what the map draws
// and highlights for a selection, where the camera goes, and which labels
// fit. No React Native imports, so node --test can run it.

import { type Camera, type Size, clamp } from '../studyspace/camera.ts';
import { MAP_SIZE, type MapPoint, project } from './projection.ts';

/** The shapes of the core's atlas records this module needs. */
export type DatingLike = { start: number; end: number; approx: boolean };
export type VerseLike = { chapter: number; verse: number };
export type ScriptureLike = { book: number; start: VerseLike; end: VerseLike; reference: string };
export type PlaceLike = {
  id: string;
  name: string;
  coordinates?: { lat: number; lon: number };
  parent?: string;
};
export type PeriodLike = {
  id: string;
  name: string;
  dating: DatingLike;
  scripture: ScriptureLike;
  route: readonly { placeId: string }[];
};
export type EventLike = {
  id: string;
  name: string;
  sequence: number;
  scripture: ScriptureLike;
  periodIds: readonly string[];
  placeIds: readonly string[];
  dating: DatingLike;
};

// ---- Years -----------------------------------------------------------------

function era(year: number): string {
  return year < 0 ? 'B.C.E.' : 'C.E.';
}

/** `c. 49–52 C.E.`, `c. 49 C.E.`; B.C.E. years are negative. */
export function yearsLabel(d: DatingLike): string {
  const c = d.approx ? 'c. ' : '';
  const start = Math.abs(d.start);
  const end = Math.abs(d.end);
  if (d.start === d.end) return `${c}${start} ${era(d.start)}`;
  if (era(d.start) === era(d.end)) return `${c}${start}–${end} ${era(d.end)}`;
  return `${c}${start} ${era(d.start)}–${end} ${era(d.end)}`;
}

/** The same, for a screen reader: `about 49 to 52 C.E.`. */
export function spokenYears(d: DatingLike): string {
  return yearsLabel(d)
    .replace(/^c\. /, 'about ')
    .replace('–', ' to ');
}

// ---- The timeline ----------------------------------------------------------

/** A timeline section: a period with its events, or events between periods. */
export type TimelineSection<P, E> = {
  key: string;
  /** Undefined for events between periods. */
  period?: P;
  title: string;
  dating: DatingLike;
  events: E[];
};

export const BETWEEN_TITLE = 'Between the tours';

/**
 * The periods in time order, each with its events in the order of the
 * account, and a section for each run of events that belong to no period,
 * placed where the account has them.
 */
export function timelineSections<P extends PeriodLike, E extends EventLike>(
  periods: readonly P[],
  events: readonly E[],
): TimelineSection<P, E>[] {
  const sections: TimelineSection<P, E>[] = periods.map((p) => ({
    key: p.id,
    period: p,
    title: p.name,
    dating: p.dating,
    events: events.filter((e) => e.periodIds.includes(p.id)),
  }));
  const loose = events.filter((e) => e.periodIds.length === 0);
  const runs: E[][] = [];
  for (const e of loose) {
    const last = runs.at(-1);
    const prev = last?.at(-1);
    if (last !== undefined && prev !== undefined && !events.some((x) => x.sequence > prev.sequence && x.sequence < e.sequence && x.periodIds.length > 0)) {
      last.push(e);
    } else {
      runs.push([e]);
    }
  }
  for (const run of runs) {
    const first = run[0].sequence;
    const section: TimelineSection<P, E> = {
      key: `between:${run[0].id}`,
      title: BETWEEN_TITLE,
      dating: {
        start: Math.min(...run.map((e) => e.dating.start)),
        end: Math.max(...run.map((e) => e.dating.end)),
        approx: run.some((e) => e.dating.approx),
      },
      events: run,
    };
    // Before the first section whose events come later in the account.
    const at = sections.findIndex((s) => (s.events[0]?.sequence ?? Infinity) > first);
    sections.splice(at === -1 ? sections.length : at, 0, section);
  }
  return sections;
}

/** The span of years the timeline covers. */
export function timelineSpan(sections: readonly { dating: DatingLike }[]): { start: number; end: number } {
  return {
    start: Math.min(...sections.map((s) => s.dating.start)),
    end: Math.max(...sections.map((s) => s.dating.end)),
  };
}

/**
 * The era bar: the sections side by side in the account's order, each as
 * wide as the years it covers (counting both ends), as fractions of the
 * whole. Years are whole, so neighbouring sections often share one (the
 * second tour ends in 52 and the third begins in it); laying them end to
 * end keeps the bar one row and still shows which parts ran long.
 */
export function eraBands(sections: readonly { key: string; dating: DatingLike }[]): { key: string; left: number; width: number }[] {
  const years = sections.map((s) => Math.max(1, s.dating.end - s.dating.start + 1));
  const total = years.reduce((a, b) => a + b, 0);
  let left = 0;
  return sections.map((s, i) => {
    const band = { key: s.key, left: left / total, width: years[i] / total };
    left += years[i];
    return band;
  });
}

// ---- Selection -------------------------------------------------------------

/** What the map shows: a section (a period or a run between) or one event in it. */
export type Selection = { section: string; event?: string };

/** The section an event belongs to; its first if it has more than one. */
export function sectionOf(sections: readonly TimelineSection<PeriodLike, EventLike>[], eventId: string): string | undefined {
  return sections.find((s) => s.events.some((e) => e.id === eventId))?.key;
}

/**
 * Where the atlas opens: the event asked for, else the first event in the
 * chapter being read, else the first section.
 */
export function initialSelection(
  sections: readonly TimelineSection<PeriodLike, EventLike>[],
  wanted: { event?: string; period?: string },
): Selection | undefined {
  if (wanted.event !== undefined) {
    const section = sectionOf(sections, wanted.event);
    if (section !== undefined) return { section, event: wanted.event };
  }
  if (wanted.period !== undefined && sections.some((s) => s.key === wanted.period)) return { section: wanted.period };
  const first = sections[0];
  return first === undefined ? undefined : { section: first.key };
}

/** The first event whose passage reaches into `chapter` of `book`. */
export function firstEventInChapter<E extends EventLike>(events: readonly E[], book: number, chapter: number): E | undefined {
  return events.find(
    (e) => e.scripture.book === book && e.scripture.start.chapter <= chapter && e.scripture.end.chapter >= chapter,
  );
}

// ---- Places ----------------------------------------------------------------

/** The core's AtlasPlaceKind, in its order. */
const PLACE_KINDS = ['City', 'Port', 'Harbor', 'Station', 'Island', 'Cape', 'Bay', 'Region'] as const;

export function placeKindLabel(kind: number): string {
  return PLACE_KINDS[kind] ?? 'Place';
}

/** What the core's AtlasConfidence (Established, Likely, Uncertain) says of a place's site. */
export function siteConfidence(confidence: number): string {
  return ['The site is known.', 'The site is likely but not certain.', 'The site is uncertain.'][confidence] ?? '';
}

/** What the core's AtlasPrecision (Precise, Rough, Related) says of its point on the map. */
export function pointPrecision(precision: number): string | undefined {
  return [undefined, 'The point marks the area, not the exact site.', 'The point stands for the whole island or district.'][
    precision
  ];
}

const PUBLICATIONS: Record<string, string> = {
  nwtsty: 'Study Bible',
  'it-1': 'Insight, Volume 1',
  'it-2': 'Insight, Volume 2',
  gl: '“See the Good Land”',
};

/** A cited publication's name, from its symbol. */
export function publicationName(symbol: string): string {
  return PUBLICATIONS[symbol] ?? symbol;
}

// ---- What the map draws ----------------------------------------------------

export type Marker = { id: string; name: string; at: MapPoint };

/** Every place with a point, projected. */
export function markers(places: readonly PlaceLike[]): Marker[] {
  return places.flatMap((p) =>
    p.coordinates === undefined ? [] : [{ id: p.id, name: p.name, at: project(p.coordinates.lon, p.coordinates.lat) }],
  );
}

/** Places along `ids` that have a point, in order, without a place twice in a row. */
export function pathThrough(ids: readonly string[], byId: ReadonlyMap<string, Marker>): Marker[] {
  const out: Marker[] = [];
  for (const id of ids) {
    const m = byId.get(id);
    if (m !== undefined && out.at(-1)?.id !== m.id) out.push(m);
  }
  return out;
}

export type MapHighlight = {
  /** The section's route, joined in order (a period's stops, else its events' places). */
  route: Marker[];
  /** The selected event's own path, for a leg; its place, for a stop. */
  path: Marker[];
  /** Labeled and drawn in the accent: the event's places, else the section's. */
  focus: string[];
  /** In the accent but unlabeled: the section's other places. */
  context: string[];
  /** Where the camera goes. */
  fit: MapPoint[];
  /** Places in the selection that have no point, by name (regions, Lasea). */
  unmapped: string[];
};

/** What to draw for `selection`. */
export function highlight(
  sections: readonly TimelineSection<PeriodLike, EventLike>[],
  selection: Selection,
  places: readonly PlaceLike[],
): MapHighlight {
  const byId = new Map(markers(places).map((m) => [m.id, m]));
  const names = new Map(places.map((p) => [p.id, p.name]));
  const section = sections.find((s) => s.key === selection.section);
  const eventIds = section?.events.flatMap((e) => e.placeIds) ?? [];
  const routeIds = section?.period !== undefined && section.period.route.length > 0
    ? section.period.route.map((s) => s.placeId)
    : eventIds;
  const route = pathThrough(routeIds, byId);
  const sectionIds = unique([...routeIds, ...eventIds]);
  const event = section?.events.find((e) => e.id === selection.event);
  const focusIds = event !== undefined ? unique(event.placeIds) : sectionIds;
  const path = event !== undefined ? pathThrough(event.placeIds, byId) : [];
  const drawn = (id: string) => byId.has(id);
  const focus = focusIds.filter(drawn);
  return {
    route,
    path,
    focus,
    context: sectionIds.filter((id) => drawn(id) && !focus.includes(id)),
    fit: focus.map((id) => byId.get(id)!.at),
    unmapped: focusIds.filter((id) => !drawn(id)).map((id) => names.get(id) ?? id),
  };
}

function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}

// ---- The camera ------------------------------------------------------------

/** The least map width a fit shows, so one place isn't blown up: about 7° of longitude. */
export const MIN_FIT_SPAN = 220;

/** The zoom at which the whole frame just covers the view. */
export function minZoom(view: Size): number {
  'worklet';
  return Math.max(view.width / MAP_SIZE.width, view.height / MAP_SIZE.height);
}

/** The closest zoom: four times the frame's own scale on this view, at least 3. */
export function maxZoom(view: Size): number {
  'worklet';
  return Math.max(3, minZoom(view) * 6);
}

/** `camera` held inside the frame: zoomed in at least to cover the view, its centre where the view stays on the map. */
export function clampCamera(camera: Camera, view: Size): Camera {
  'worklet';
  const zoom = clamp(camera.zoom, minZoom(view), maxZoom(view));
  const halfW = view.width / 2 / zoom;
  const halfH = view.height / 2 / zoom;
  return {
    zoom,
    x: clamp(camera.x, halfW, Math.max(halfW, MAP_SIZE.width - halfW)),
    y: clamp(camera.y, halfH, Math.max(halfH, MAP_SIZE.height - halfH)),
  };
}

/** The camera that shows `points` with `padding` (pt) all round, at least MIN_FIT_SPAN wide. */
export function fitPoints(points: readonly MapPoint[], view: Size, padding: number): Camera {
  'worklet';
  if (points.length === 0) return clampCamera({ x: MAP_SIZE.width / 2, y: MAP_SIZE.height / 2, zoom: 0 }, view);
  let west = Infinity;
  let east = -Infinity;
  let north = Infinity;
  let south = -Infinity;
  for (const p of points) {
    west = Math.min(west, p.x);
    east = Math.max(east, p.x);
    north = Math.min(north, p.y);
    south = Math.max(south, p.y);
  }
  const span = Math.max(east - west, MIN_FIT_SPAN);
  const tall = Math.max(south - north, (MIN_FIT_SPAN * 2) / 3);
  const room = { width: Math.max(1, view.width - 2 * padding), height: Math.max(1, view.height - 2 * padding) };
  const zoom = Math.min(room.width / span, room.height / tall);
  return clampCamera({ x: (west + east) / 2, y: (north + south) / 2, zoom }, view);
}

/** Where map point `p` is on screen. */
export function toScreen(camera: Camera, view: Size, p: MapPoint): MapPoint {
  'worklet';
  return {
    x: (p.x - camera.x) * camera.zoom + view.width / 2,
    y: (p.y - camera.y) * camera.zoom + view.height / 2,
  };
}

/** The map rectangle the view shows, for the SVG viewBox. */
export function visibleRect(camera: Camera, view: Size): { x: number; y: number; width: number; height: number } {
  return {
    x: camera.x - view.width / 2 / camera.zoom,
    y: camera.y - view.height / 2 / camera.zoom,
    width: view.width / camera.zoom,
    height: view.height / camera.zoom,
  };
}

/** The marker nearest screen point `at`, within `reach` pt. */
export function markerAt(
  candidates: readonly Marker[],
  camera: Camera,
  view: Size,
  at: MapPoint,
  reach: number,
): Marker | undefined {
  let best: Marker | undefined;
  let bestDistance = reach;
  for (const m of candidates) {
    const s = toScreen(camera, view, m.at);
    const d = Math.hypot(s.x - at.x, s.y - at.y);
    if (d <= bestDistance) {
      best = m;
      bestDistance = d;
    }
  }
  return best;
}

// ---- Labels ----------------------------------------------------------------

/** The width of label text, generously (Roboto averages about 0.5 em). */
export function labelWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.56;
}

export type LabelSide = 'right' | 'left';
export type PlacedLabel = { id: string; side: LabelSide };

/**
 * Which labels to show, and on which side of their dot, at `camera`: in
 * order of `wanted` (most important first), each takes the right side, else
 * the left, where it overlaps no label already placed and stays on screen.
 * The rest stay unlabeled; their places are still listed.
 */
export function placeLabels(
  wanted: readonly Marker[],
  camera: Camera,
  view: Size,
  fontSize: number,
  dot: number,
): PlacedLabel[] {
  const height = fontSize * 1.3;
  const gap = dot / 2 + 4;
  const taken: { x: number; y: number; width: number; height: number }[] = [];
  const placed: PlacedLabel[] = [];
  const overlaps = (r: { x: number; y: number; width: number; height: number }) =>
    taken.some((t) => r.x < t.x + t.width && t.x < r.x + r.width && r.y < t.y + t.height && t.y < r.y + r.height);
  const onScreen = (r: { x: number; y: number; width: number; height: number }) =>
    r.x >= 0 && r.y >= 0 && r.x + r.width <= view.width && r.y + r.height <= view.height;
  // Every dot is taken first, so no label covers another place's dot.
  for (const m of wanted) {
    const s = toScreen(camera, view, m.at);
    taken.push({ x: s.x - dot / 2, y: s.y - dot / 2, width: dot, height: dot });
  }
  for (const m of wanted) {
    const s = toScreen(camera, view, m.at);
    const width = labelWidth(m.name, fontSize);
    const top = s.y - height / 2;
    const sides: [LabelSide, number][] = [
      ['right', s.x + gap],
      ['left', s.x - gap - width],
    ];
    for (const [side, x] of sides) {
      const rect = { x, y: top, width, height };
      if (onScreen(rect) && !overlaps(rect)) {
        taken.push(rect);
        placed.push({ id: m.id, side });
        break;
      }
    }
  }
  return placed;
}
