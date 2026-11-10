// The map's projection, shared by the app and scripts/gen-basemap.ts so the
// coastlines and the places line up.
//
// Equirectangular around 37° N, the middle of the area Acts 13–28 covers
// (Rome to Antioch, Macedonia to Crete): longitudes are narrowed by
// cos(37°), so shapes there keep their proportions. Map units are
// hundredths of a degree of latitude; y grows southward, as on screen.

/** The area the basemap covers, in degrees. */
export const BOUNDS = { west: 8.5, east: 39.5, south: 29.5, north: 44.5 } as const;

const UNITS_PER_DEGREE = 100;
const STANDARD_PARALLEL = 37;
const X_SCALE = Math.cos((STANDARD_PARALLEL * Math.PI) / 180) * UNITS_PER_DEGREE;

export type Point = { x: number; y: number };

export function project(lat: number, lon: number): Point {
  return { x: (lon - BOUNDS.west) * X_SCALE, y: (BOUNDS.north - lat) * UNITS_PER_DEGREE };
}

/** The basemap's size in map units. */
export const MAP_WIDTH = (BOUNDS.east - BOUNDS.west) * X_SCALE;
export const MAP_HEIGHT = (BOUNDS.north - BOUNDS.south) * UNITS_PER_DEGREE;

/** Kilometres per map unit, for a scale bar: a unit is 0.01° of latitude. */
export const KM_PER_UNIT = 111.32 / UNITS_PER_DEGREE;
