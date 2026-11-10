import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  afterTransform,
  axisTicks,
  clampCamera,
  dateLabel,
  fitAll,
  fitPoints,
  initialSelection,
  layoutLabels,
  listOf,
  placeLabels,
  routePoints,
  spokenDate,
  spokenReference,
  timelineBars,
  toMap,
  toScreen,
  transformBetween,
  zoomLimits,
} from './model.ts';
import { MAP_HEIGHT, MAP_WIDTH, project } from './projection.ts';

const date = (start: number, end: number, approx = true) => ({ start, end, approx, inherited: false });

test('dates read as the publications write them', () => {
  assert.equal(dateLabel(date(49, 52)), 'c. 49–52 C.E.');
  assert.equal(dateLabel(date(49, 49)), 'c. 49 C.E.');
  assert.equal(dateLabel(date(-5, 2, false)), '5 B.C.E.–2 C.E.');
  assert.equal(dateLabel(date(-20, -10)), 'c. 20–10 B.C.E.');
  assert.equal(spokenDate(date(49, 52)), 'about 49 to 52 C.E.');
  assert.equal(spokenReference('Acts 13:1–14:28'), 'Acts 13:1 to 14:28');
  assert.equal(spokenReference('Acts 17:22b-31'), 'Acts 17:22b to 31');
});

test('places that share a name are told apart', () => {
  const labels = placeLabels([
    { id: 'place:antioch-syria', name: 'Antioch', alternateNames: ['Antioch of Syria', 'Antakya'] },
    { id: 'place:antioch-pisidia', name: 'Antioch', alternateNames: ['Pisidian Antioch', 'Antioch of Pisidia'] },
    { id: 'place:derbe', name: 'Derbe', alternateNames: ['Antioch of nowhere'] },
  ]);
  assert.equal(labels.get('place:antioch-syria'), 'Antioch of Syria');
  assert.equal(labels.get('place:antioch-pisidia'), 'Antioch of Pisidia');
  assert.equal(labels.get('place:derbe'), 'Derbe');
  assert.equal(listOf(['A', 'B', 'C']), 'A, B and C');
  assert.equal(listOf(['A']), 'A');
});

test('timeline bars share a lane only when they do not touch', () => {
  const period = (id: string, start: number, end: number) => ({ id, name: id, date: date(start, end), route: [] });
  const { bars, first, last, lanes } = timelineBars([
    period('trip2', 49, 52),
    period('trip1', 47, 48),
    period('trip3', 52, 56),
    period('custody', 56, 58),
    period('rome', 58, 61),
  ]);
  assert.deepEqual(
    bars.map((b) => [b.id, b.lane]),
    [
      ['trip1', 0],
      ['trip2', 0],
      ['trip3', 1],
      ['custody', 0],
      ['rome', 1],
    ],
  );
  assert.equal(first, 47);
  assert.equal(last, 62);
  assert.equal(lanes, 2);
  assert.deepEqual(axisTicks(47, 62, 5), [50, 55, 60]);
});

test('the camera fits the map and stays on it', () => {
  const view = { width: 400, height: 300 };
  const all = fitAll(view);
  assert.ok(Math.abs(all.x - MAP_WIDTH / 2) < 1e-9 && Math.abs(all.y - MAP_HEIGHT / 2) < 1e-9);
  const { min, max } = zoomLimits(view);
  assert.equal(min, all.zoom);
  assert.ok(max > min);
  // Zoomed out past the whole map: back to the whole map, centred.
  assert.deepEqual(clampCamera({ x: 0, y: 0, zoom: min / 4 }, view), { x: all.x, y: all.y, zoom: min });
  // Panned off the edge: pulled back so the view stays on the map.
  const near = clampCamera({ x: -500, y: 10_000, zoom: min * 4 }, view);
  assert.equal(near.x, view.width / 2 / near.zoom);
  assert.equal(near.y, MAP_HEIGHT - view.height / 2 / near.zoom);
});

test('screen and map points convert both ways', () => {
  const view = { width: 400, height: 300 };
  const camera = { x: 1200, y: 700, zoom: 0.5 };
  const p = { x: 1000, y: 800 };
  const back = toMap(camera, view, toScreen(camera, view, p));
  assert.ok(Math.abs(back.x - p.x) < 1e-9 && Math.abs(back.y - p.y) < 1e-9);
});

test('a gesture transform and a camera move agree', () => {
  const view = { width: 400, height: 300 };
  const from = { x: 1200, y: 700, zoom: 0.5 };
  const to = { x: 1300, y: 650, zoom: 1 };
  const { tx, ty, scale } = transformBetween(from, to, view);
  const after = afterTransform(from, view, tx, ty, scale);
  assert.ok(Math.abs(after.x - to.x) < 1e-6, `${after.x}`);
  assert.ok(Math.abs(after.y - to.y) < 1e-6, `${after.y}`);
  assert.ok(Math.abs(after.zoom - to.zoom) < 1e-9);
});

test('fitting points never zooms closer than a region', () => {
  const view = { width: 400, height: 300 };
  const one = fitPoints(view, [project(37.35, 33.36)], 40);
  assert.ok(one.zoom <= 300 / 270 + 1e-9);
  const two = fitPoints(view, [project(36.2, 36.18), project(41.9, 12.5)], 40);
  assert.ok(two.zoom < one.zoom);
});

test('labels move around their marker, and skip when nothing fits', () => {
  const view = { width: 300, height: 200 };
  const placed = layoutLabels(
    [
      { id: 'a', text: 'Philippi', at: { x: 100, y: 100 }, radius: 5 },
      // Beside a: its label takes the left.
      { id: 'b', text: 'Neapolis', at: { x: 103, y: 102 }, radius: 5 },
      // Under both: above and the sides are taken, so below.
      { id: 'c', text: 'Amphipolis', at: { x: 101, y: 104 }, radius: 5 },
      // Nothing left around it.
      { id: 'd', text: 'Apollonia', at: { x: 102, y: 101 }, radius: 5 },
      // Near the right edge: its label goes left.
      { id: 'e', text: 'Troas', at: { x: 290, y: 50 }, radius: 5 },
    ],
    view,
    7,
    16,
  );
  assert.deepEqual(
    placed.map((p) => [p.id, p.anchor]),
    [
      ['a', 'start'],
      ['b', 'end'],
      ['c', 'middle'],
      ['e', 'end'],
    ],
  );
});

test('the screen opens where it was asked to', () => {
  const periods = [
    { id: 'p1', name: 'one', date: date(47, 48), route: [] },
    { id: 'p2', name: 'two', date: date(49, 52), route: [] },
  ];
  const passage = (c1: number, c2: number) => ({
    book: 44,
    reference: '',
    start: { chapter: c1, verse: 1 },
    end: { chapter: c2, verse: 5 },
  });
  const events = [
    { id: 'e1', title: '', periodIds: ['p1'], placeIds: ['x'], passage: passage(13, 13), date: date(47, 48) },
    { id: 'e2', title: '', periodIds: ['p2'], placeIds: ['y'], passage: passage(16, 17), date: date(49, 52) },
  ];
  assert.deepEqual(initialSelection(periods, events, {}), { periodId: 'p1' });
  assert.deepEqual(initialSelection(periods, events, { event: 'e2' }), { periodId: 'p2', eventId: 'e2' });
  assert.deepEqual(initialSelection(periods, events, { book: 44, chapter: 17 }), { periodId: 'p2', eventId: 'e2' });
  assert.deepEqual(initialSelection(periods, events, { book: 44, chapter: 2 }), { periodId: 'p1' });
  assert.deepEqual(initialSelection(periods, events, { place: 'y' }), { periodId: 'p2', placeId: 'y' });
  assert.equal(initialSelection([], events, {}), undefined);
});

test('a route draws its places with coordinates, once per stop', () => {
  const places = new Map([
    ['a', { id: 'a', name: 'A', alternateNames: [], coordinates: { lat: 36, lon: 36 } }],
    ['r', { id: 'r', name: 'Region', alternateNames: [] }],
    ['b', { id: 'b', name: 'B', alternateNames: [], coordinates: { lat: 35, lon: 33 } }],
  ]);
  const route = routePoints(
    { id: 'p', name: 'p', date: date(47, 48), route: [{ placeId: 'a' }, { placeId: 'r' }, { placeId: 'b' }, { placeId: 'b' }] },
    places,
  );
  assert.deepEqual(
    route.map((r) => r.id),
    ['a', 'b'],
  );
});
