// Turns Natural Earth's land polygons into src/atlas/basemap.generated.ts:
// the coastlines under the Bible map, clipped to the area it covers,
// projected (src/atlas/projection.ts) and simplified to SVG path data, so
// the app ships no GeoJSON and draws no tiles. Natural Earth is in the
// public domain (https://www.naturalearthdata.com/about/terms-of-use/).
//
// Run it with plain node, giving the downloaded 1:10m land file
// (https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_land.geojson):
//
//   node scripts/gen-basemap.ts path/to/ne_10m_land.geojson
//
// The output is committed; nothing in the build or CI needs the network.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BOUNDS, MAP_HEIGHT, MAP_WIDTH, type Point, project } from '../src/atlas/projection.ts';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '../src/atlas/basemap.generated.ts');

/** Points closer than this to the simplified line are dropped (map units). */
const TOLERANCE = 0.9;
/** Islands smaller than this (square map units) are left out. */
const MIN_AREA = 6;

type Ring = [number, number][];

/** Sutherland–Hodgman: the part of a ring inside one edge of the bounds. */
function clipEdge(ring: Ring, inside: (p: [number, number]) => boolean, cross: (a: [number, number], b: [number, number]) => [number, number]): Ring {
  const out: Ring = [];
  for (let i = 0; i < ring.length; i++) {
    const current = ring[i];
    const previous = ring[(i + ring.length - 1) % ring.length];
    if (inside(current)) {
      if (!inside(previous)) out.push(cross(previous, current));
      out.push(current);
    } else if (inside(previous)) {
      out.push(cross(previous, current));
    }
  }
  return out;
}

function clip(ring: Ring): Ring {
  const atLon = (lon: number) => (a: [number, number], b: [number, number]): [number, number] => [lon, a[1] + ((b[1] - a[1]) * (lon - a[0])) / (b[0] - a[0])];
  const atLat = (lat: number) => (a: [number, number], b: [number, number]): [number, number] => [a[0] + ((b[0] - a[0]) * (lat - a[1])) / (b[1] - a[1]), lat];
  let r = ring;
  r = clipEdge(r, (p) => p[0] >= BOUNDS.west, atLon(BOUNDS.west));
  r = clipEdge(r, (p) => p[0] <= BOUNDS.east, atLon(BOUNDS.east));
  r = clipEdge(r, (p) => p[1] >= BOUNDS.south, atLat(BOUNDS.south));
  r = clipEdge(r, (p) => p[1] <= BOUNDS.north, atLat(BOUNDS.north));
  return r;
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Douglas–Peucker. */
function simplify(points: Point[]): Point[] {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    let furthest = -1;
    let distance = TOLERANCE;
    for (let i = first + 1; i < last; i++) {
      const d = distanceToSegment(points[i], points[first], points[last]);
      if (d > distance) {
        distance = d;
        furthest = i;
      }
    }
    if (furthest !== -1) {
      keep[furthest] = 1;
      stack.push([first, furthest], [furthest, last]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

function area(points: Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/** SVG path data with relative moves, one decimal. */
function pathData(points: Point[]): string {
  const round = (n: number) => Math.round(n * 10) / 10;
  let x = round(points[0].x);
  let y = round(points[0].y);
  let d = `M${x} ${y}l`;
  const steps: string[] = [];
  for (const p of points.slice(1)) {
    const nx = round(p.x);
    const ny = round(p.y);
    const dx = round(nx - x);
    const dy = round(ny - y);
    if (dx === 0 && dy === 0) continue;
    steps.push(`${dx} ${dy}`.replace(/ -/g, '-'));
    x = nx;
    y = ny;
  }
  return `${d}${steps.join(' ').replace(/ -/g, '-')}z`;
}

function main() {
  const source = process.argv[2];
  if (source === undefined) throw new Error('usage: node scripts/gen-basemap.ts ne_10m_land.geojson');
  const geojson = JSON.parse(readFileSync(source, 'utf8')) as {
    features: { geometry: { type: string; coordinates: number[][][] | number[][][][] } }[];
  };
  const paths: string[] = [];
  for (const feature of geojson.features) {
    const { type, coordinates } = feature.geometry;
    const polygons = (type === 'Polygon' ? [coordinates] : coordinates) as number[][][][];
    for (const polygon of polygons) {
      // Land rings only: Natural Earth's land has no holes worth drawing at
      // this scale (the inner seas are their own outlines).
      const ring = clip(polygon[0].map(([lon, lat]) => [lon, lat] as [number, number]));
      if (ring.length < 3) continue;
      const projected = simplify(ring.map(([lon, lat]) => project(lat, lon)));
      if (projected.length < 3 || area(projected) < MIN_AREA) continue;
      paths.push(pathData(projected));
    }
  }
  const body = `// Generated by scripts/gen-basemap.ts from Natural Earth 1:10m land (public
// domain). Do not edit: run \`node scripts/gen-basemap.ts ne_10m_land.geojson\`.

/** The basemap's size in map units (src/atlas/projection.ts). */
export const BASEMAP_WIDTH = ${Math.round(MAP_WIDTH * 10) / 10};
export const BASEMAP_HEIGHT = ${Math.round(MAP_HEIGHT * 10) / 10};

/** The land, as one SVG path. */
export const LAND = ${JSON.stringify(paths.join(''))};
`;
  writeFileSync(OUT, body);
  console.log(`${paths.length} shapes, ${body.length} bytes`);
}

main();
