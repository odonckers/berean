// The map and timeline's pure parts: labels, the timeline's lanes, the
// camera and where map labels fit. No React Native here, so the Node tests
// load it directly; the shapes are the FFI records' (berean-ffi-rn's
// AtlasPlace and friends), narrowed to what is read.

import { MAP_HEIGHT, MAP_WIDTH, type Point, project } from './projection.ts';

export type DateSpanLike = { start: number; end: number; approx: boolean; inherited: boolean };
export type PlaceLike = {
  id: string;
  name: string;
  alternateNames: readonly string[];
  coordinates?: { lat: number; lon: number };
};
export type PeriodLike = { id: string; name: string; date: DateSpanLike; route: readonly { placeId: string }[] };
export type PassageLike = {
  book: number;
  reference: string;
  start: { chapter: number; verse: number };
  end: { chapter: number; verse: number };
};
export type EventLike = {
  id: string;
  title: string;
  periodIds: readonly string[];
  placeIds: readonly string[];
  passage: PassageLike;
  date: DateSpanLike;
};

// ---------------------------------------------------------------------------
// Words

/** "47 C.E." or "5 B.C.E.": years are signed, with no year 0. */
export function yearLabel(year: number): string {
  return year < 0 ? `${-year} B.C.E.` : `${year} C.E.`;
}

/**
 * "c. 49–52 C.E.", "c. 49 C.E.", "c. 5 B.C.E.–2 C.E.". The era is written
 * once when both ends share it.
 */
export function dateLabel(date: DateSpanLike): string {
  const about = date.approx ? 'c. ' : '';
  if (date.start === date.end) return `${about}${yearLabel(date.start)}`;
  const sameEra = date.start < 0 === date.end < 0;
  const from = sameEra ? String(Math.abs(date.start)) : yearLabel(date.start);
  return `${about}${from}–${yearLabel(date.end)}`;
}

/** The same, spoken: "about 49 to 52 C.E." (screen readers stumble on "c." and "–"). */
export function spokenDate(date: DateSpanLike): string {
  const about = date.approx ? 'about ' : '';
  if (date.start === date.end) return `${about}${yearLabel(date.start)}`;
  const sameEra = date.start < 0 === date.end < 0;
  const from = sameEra ? String(Math.abs(date.start)) : yearLabel(date.start);
  return `${about}${from} to ${yearLabel(date.end)}`;
}

/** A reference spoken: en dashes and hyphens read as "to". */
export function spokenReference(reference: string): string {
  return reference.replace(/[–-]/g, ' to ');
}

/**
 * Each place's label on the map and in lists. Two places with the same NWT
 * name (Antioch of Syria and Antioch of Pisidia) take the first alternate
 * name that starts with it ("Antioch of Syria"), so they can be told apart.
 */
export function placeLabels(places: readonly PlaceLike[]): Map<string, string> {
  const counts = new Map<string, number>();
  for (const p of places) counts.set(p.name, (counts.get(p.name) ?? 0) + 1);
  const labels = new Map<string, string>();
  for (const p of places) {
    const shared = (counts.get(p.name) ?? 0) > 1;
    const fuller = shared ? p.alternateNames.find((n) => n.startsWith(`${p.name} `)) : undefined;
    labels.set(p.id, fuller ?? p.name);
  }
  return labels;
}

/** "Antioch of Syria, Seleucia and Cyprus". */
export function listOf(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

// ---------------------------------------------------------------------------
// Timeline

export type TimelineBar = { id: string; start: number; end: number; lane: number };

/**
 * The periods as bars on a year axis, each in the first lane where it
 * doesn't touch an earlier bar. A year is a whole slot, so 49–52 and 52–56
 * share 52 and take two lanes. Years are counted without the missing year
 * 0 (1 B.C.E. is followed by 1 C.E.).
 */
export function timelineBars(periods: readonly PeriodLike[]): { bars: TimelineBar[]; first: number; last: number; lanes: number } {
  const slot = (year: number) => (year < 0 ? year + 1 : year);
  const laneEnds: number[] = [];
  const bars = [...periods]
    .sort((a, b) => slot(a.date.start) - slot(b.date.start))
    .map((p) => {
      const start = slot(p.date.start);
      const end = slot(p.date.end) + 1;
      let lane = laneEnds.findIndex((e) => e <= start);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(end);
      } else {
        laneEnds[lane] = end;
      }
      return { id: p.id, start, end, lane };
    });
  const first = Math.min(...bars.map((b) => b.start));
  const last = Math.max(...bars.map((b) => b.end));
  return { bars, first, last, lanes: Math.max(1, laneEnds.length) };
}

/** Tick years for the axis: every `step` years from the first multiple. */
export function axisTicks(first: number, last: number, step: number): number[] {
  const ticks: number[] = [];
  for (let y = Math.ceil(first / step) * step; y <= last; y += step) ticks.push(y);
  return ticks;
}

// ---------------------------------------------------------------------------
// The camera: which part of the map fills the view. `zoom` is screen points
// per map unit; (x, y) is the map point at the view's centre.

export type Camera = { x: number; y: number; zoom: number };
export type Size = { width: number; height: number };

/** The whole basemap, fitted. */
export function fitAll(view: Size): Camera {
  return fitBox(view, { minX: 0, minY: 0, maxX: MAP_WIDTH, maxY: MAP_HEIGHT }, 0);
}

type Box = { minX: number; minY: number; maxX: number; maxY: number };

/** Fits `box` with `margin` points around it. */
export function fitBox(view: Size, box: Box, margin: number): Camera {
  const width = Math.max(box.maxX - box.minX, 1);
  const height = Math.max(box.maxY - box.minY, 1);
  const zoom = Math.min(
    Math.max(view.width - 2 * margin, 1) / width,
    Math.max(view.height - 2 * margin, 1) / height,
  );
  return { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2, zoom };
}

/** The zoom range: from the whole map to about 60 km across the view. */
export function zoomLimits(view: Size): { min: number; max: number } {
  const min = fitAll(view).zoom;
  return { min, max: Math.max(min * 2, Math.min(view.width, view.height) / 50) };
}

/** Keeps the zoom in range and the map's centre within the basemap. */
export function clampCamera(camera: Camera, view: Size): Camera {
  const { min, max } = zoomLimits(view);
  const zoom = Math.min(max, Math.max(min, camera.zoom));
  // The view's half size in map units; a view wider than the map centres it.
  const halfW = view.width / 2 / zoom;
  const halfH = view.height / 2 / zoom;
  const clampAxis = (v: number, half: number, size: number) =>
    half * 2 >= size ? size / 2 : Math.min(size - half, Math.max(half, v));
  return { x: clampAxis(camera.x, halfW, MAP_WIDTH), y: clampAxis(camera.y, halfH, MAP_HEIGHT), zoom };
}

/**
 * Fits `points` (map units), keeping a margin for markers and labels, and
 * never closer than a zoom that shows about 300 km, so one place shows
 * where it is.
 */
export function fitPoints(view: Size, points: readonly Point[], margin: number): Camera {
  if (points.length === 0) return fitAll(view);
  const box = {
    minX: Math.min(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxX: Math.max(...points.map((p) => p.x)),
    maxY: Math.max(...points.map((p) => p.y)),
  };
  const fitted = fitBox(view, box, margin);
  const closest = Math.min(view.width, view.height) / 270;
  return clampCamera({ ...fitted, zoom: Math.min(fitted.zoom, closest) }, view);
}

/** The SVG viewBox showing `camera` in `view`. */
export function viewBox(camera: Camera, view: Size): string {
  const w = view.width / camera.zoom;
  const h = view.height / camera.zoom;
  return `${camera.x - w / 2} ${camera.y - h / 2} ${w} ${h}`;
}

export function toScreen(camera: Camera, view: Size, p: Point): Point {
  return {
    x: (p.x - camera.x) * camera.zoom + view.width / 2,
    y: (p.y - camera.y) * camera.zoom + view.height / 2,
  };
}

export function toMap(camera: Camera, view: Size, p: Point): Point {
  return {
    x: (p.x - view.width / 2) / camera.zoom + camera.x,
    y: (p.y - view.height / 2) / camera.zoom + camera.y,
  };
}

/**
 * The camera after a gesture drew the old one scaled by `scale` about the
 * view's top-left corner and then moved by (tx, ty) points.
 */
export function afterTransform(camera: Camera, view: Size, tx: number, ty: number, scale: number): Camera {
  // The screen point now at the view's centre was at (centre - t) / scale.
  const before = { x: (view.width / 2 - tx) / scale, y: (view.height / 2 - ty) / scale };
  const centre = toMap(camera, view, before);
  return clampCamera({ x: centre.x, y: centre.y, zoom: camera.zoom * scale }, view);
}

/** The transform (about the top-left corner) that draws `from` as `to`. */
export function transformBetween(from: Camera, to: Camera, view: Size): { tx: number; ty: number; scale: number } {
  const scale = to.zoom / from.zoom;
  // A map point p is at toScreen(from, p) now and must land at toScreen(to, p).
  const origin = toScreen(to, view, toMap(from, view, { x: 0, y: 0 }));
  return { tx: origin.x, ty: origin.y, scale };
}

/** Where a place is on the map, if it has coordinates. */
export function placePoint(place: PlaceLike): Point | undefined {
  return place.coordinates === undefined ? undefined : project(place.coordinates.lat, place.coordinates.lon);
}

// ---------------------------------------------------------------------------
// Labels

export type LabelRequest = { id: string; text: string; at: Point; radius: number };
export type PlacedLabel = { id: string; text: string; x: number; y: number; anchor: 'start' | 'end' | 'middle' };

/**
 * Places labels in priority order, each beside its marker (right, left,
 * above, below; screen points), skipping one that would overlap a label or
 * marker already placed or leave the view. `charWidth` and `lineHeight`
 * estimate the text's size. `x`/`y` are the text's anchor and baseline.
 */
export function layoutLabels(
  requests: readonly LabelRequest[],
  view: Size,
  charWidth: number,
  lineHeight: number,
): PlacedLabel[] {
  type Rect = { x: number; y: number; w: number; h: number };
  const taken: Rect[] = requests.map((r) => ({
    x: r.at.x - r.radius,
    y: r.at.y - r.radius,
    w: r.radius * 2,
    h: r.radius * 2,
  }));
  const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const placed: PlacedLabel[] = [];
  requests.forEach((r, index) => {
    const w = r.text.length * charWidth;
    const h = lineHeight;
    const gap = r.radius + 3;
    const options: (Rect & { anchor: PlacedLabel['anchor']; tx: number; ty: number })[] = [
      { x: r.at.x + gap, y: r.at.y - h / 2, w, h, anchor: 'start', tx: r.at.x + gap, ty: r.at.y + h * 0.33 },
      { x: r.at.x - gap - w, y: r.at.y - h / 2, w, h, anchor: 'end', tx: r.at.x - gap, ty: r.at.y + h * 0.33 },
      { x: r.at.x - w / 2, y: r.at.y - gap - h, w, h, anchor: 'middle', tx: r.at.x, ty: r.at.y - gap - h * 0.2 },
      { x: r.at.x - w / 2, y: r.at.y + gap, w, h, anchor: 'middle', tx: r.at.x, ty: r.at.y + gap + h * 0.8 },
    ];
    const fit = options.find(
      (o) =>
        o.x >= 2 &&
        o.y >= 2 &&
        o.x + o.w <= view.width - 2 &&
        o.y + o.h <= view.height - 2 &&
        !taken.some((t, i) => i !== index && overlaps(o, t)),
    );
    if (fit === undefined) return;
    taken.push(fit);
    placed.push({ id: r.id, text: r.text, x: fit.tx, y: fit.ty, anchor: fit.anchor });
  });
  return placed;
}

// ---------------------------------------------------------------------------
// What is shown

export type Selection = { periodId: string; eventId?: string; placeId?: string };

/**
 * Where the screen opens: a given event; else the first event in the given
 * chapter (from the reader); else a given place's first period; else the
 * first period.
 */
export function initialSelection(
  periods: readonly PeriodLike[],
  events: readonly EventLike[],
  params: { event?: string; place?: string; book?: number; chapter?: number },
): Selection | undefined {
  const first = periods[0];
  if (first === undefined) return undefined;
  const periodOf = (e: EventLike) => e.periodIds.find((id) => periods.some((p) => p.id === id)) ?? first.id;
  const event =
    (params.event !== undefined ? events.find((e) => e.id === params.event) : undefined) ??
    (params.book !== undefined && params.chapter !== undefined
      ? events.find((e) => coversChapter(e.passage, params.book!, params.chapter!))
      : undefined);
  if (event !== undefined) return { periodId: periodOf(event), eventId: event.id };
  if (params.place !== undefined) {
    const at = events.find((e) => e.placeIds.includes(params.place!));
    return { periodId: at === undefined ? first.id : periodOf(at), placeId: params.place };
  }
  return { periodId: first.id };
}

/** Whether `passage` holds any of chapter `chapter` of `book`. */
export function coversChapter(passage: PassageLike, book: number, chapter: number): boolean {
  return passage.book === book && passage.start.chapter <= chapter && chapter <= passage.end.chapter;
}

/** The route's places that can be drawn, in order, without repeating a stop twice in a row. */
export function routePoints(period: PeriodLike, places: ReadonlyMap<string, PlaceLike>): { id: string; at: Point }[] {
  const out: { id: string; at: Point }[] = [];
  for (const stop of period.route) {
    const place = places.get(stop.placeId);
    const at = place === undefined ? undefined : placePoint(place);
    if (at === undefined || out[out.length - 1]?.id === stop.placeId) continue;
    out.push({ id: stop.placeId, at });
  }
  return out;
}
