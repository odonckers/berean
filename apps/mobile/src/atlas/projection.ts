// The atlas map's projection: equirectangular, with longitude scaled by the
// cosine of the frame's middle latitude so distances in the Mediterranean
// keep their shape. Map units: 40 per degree of latitude, (0, 0) at the
// frame's north-west corner, y down. Pure, so the basemap generator and the
// Node tests share it with the app; worklets, so gestures can call it.

/** The part of the world the atlas draws, in degrees. */
export const FRAME = { west: 9.5, east: 38.5, south: 29.5, north: 44 } as const;

const UNITS_PER_DEGREE = 40;
const MID_LATITUDE = (FRAME.south + FRAME.north) / 2;
const LON_SCALE = Math.cos((MID_LATITUDE * Math.PI) / 180);

/** The frame's size in map units. */
export const MAP_SIZE = {
  width: (FRAME.east - FRAME.west) * LON_SCALE * UNITS_PER_DEGREE,
  height: (FRAME.north - FRAME.south) * UNITS_PER_DEGREE,
} as const;

export type MapPoint = { x: number; y: number };

/** Where longitude `lon`, latitude `lat` falls on the map. */
export function project(lon: number, lat: number): MapPoint {
  'worklet';
  return {
    x: (lon - FRAME.west) * LON_SCALE * UNITS_PER_DEGREE,
    y: (FRAME.north - lat) * UNITS_PER_DEGREE,
  };
}
