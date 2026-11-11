import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  BETWEEN_TITLE,
  clampCamera,
  eraBands,
  firstEventInChapter,
  fitPoints,
  highlight,
  initialSelection,
  markerAt,
  markers,
  maxZoom,
  minZoom,
  pathThrough,
  placeKindLabel,
  placeLabels,
  pointPrecision,
  publicationName,
  siteConfidence,
  spokenYears,
  timelineSections,
  timelineSpan,
  toScreen,
  visibleRect,
  yearsLabel,
  type EventLike,
  type PeriodLike,
  type PlaceLike,
} from './atlas.ts';
import { MAP_SIZE, project } from './projection.ts';

const years = (start: number, end: number, approx = true) => ({ start, end, approx });
const passage = (chapter: number, verse: number, endChapter = chapter, endVerse = verse + 5) => ({
  book: 44,
  start: { chapter, verse },
  end: { chapter: endChapter, verse: endVerse },
  reference: `Acts ${chapter}:${verse}`,
});

const places: PlaceLike[] = [
  { id: 'place:antioch-syria', name: 'Antioch', coordinates: { lat: 36.2, lon: 36.15 } },
  { id: 'place:seleucia', name: 'Seleucia', coordinates: { lat: 36.12, lon: 35.92 } },
  { id: 'place:cyprus', name: 'Cyprus', coordinates: { lat: 35.0, lon: 33.2 } },
  { id: 'place:jerusalem', name: 'Jerusalem', coordinates: { lat: 31.78, lon: 35.23 } },
  { id: 'place:troas', name: 'Troas', coordinates: { lat: 39.75, lon: 26.16 } },
  { id: 'place:philippi', name: 'Philippi', coordinates: { lat: 41.01, lon: 24.29 } },
  { id: 'place:galatia', name: 'Galatia' },
  { id: 'place:caesarea', name: 'Caesarea', coordinates: { lat: 32.5, lon: 34.89 } },
];

const first: PeriodLike = {
  id: 'period:first',
  name: 'First tour',
  dating: years(47, 48),
  scripture: passage(13, 1, 14, 28),
  route: [{ placeId: 'place:antioch-syria' }, { placeId: 'place:seleucia' }, { placeId: 'place:cyprus' }],
};
const second: PeriodLike = {
  id: 'period:second',
  name: 'Second tour',
  dating: years(49, 52),
  scripture: passage(15, 36, 18, 22),
  route: [{ placeId: 'place:antioch-syria' }, { placeId: 'place:galatia' }, { placeId: 'place:troas' }, { placeId: 'place:philippi' }],
};
const custody: PeriodLike = {
  id: 'period:custody',
  name: 'Custody',
  dating: years(56, 58),
  scripture: passage(21, 27, 26, 32),
  route: [],
};

const event = (sequence: number, id: string, periodIds: string[], placeIds: string[], chapter: number, dating = years(47, 48)): EventLike => ({
  id,
  name: id,
  sequence,
  scripture: passage(chapter, 1),
  periodIds,
  placeIds,
  dating,
});

const events: EventLike[] = [
  event(1, 'event:sent', ['period:first'], ['place:antioch-syria'], 13),
  event(2, 'event:cyprus', ['period:first'], ['place:seleucia', 'place:cyprus'], 13),
  event(3, 'event:council', [], ['place:antioch-syria', 'place:jerusalem'], 15, years(49, 49)),
  event(4, 'event:letter', [], ['place:jerusalem', 'place:antioch-syria'], 15, years(49, 49)),
  event(5, 'event:macedonia', ['period:second'], ['place:troas', 'place:philippi'], 16, years(50, 50)),
  event(6, 'event:galatia', ['period:second'], ['place:galatia'], 16, years(49, 49)),
  event(7, 'event:arrest', ['period:custody'], ['place:jerusalem'], 21, years(56, 56)),
  event(8, 'event:caesarea', ['period:custody'], ['place:jerusalem', 'place:caesarea', 'place:caesarea'], 23, years(56, 56)),
];

const sections = timelineSections([first, second, custody], events);
const view = { width: 400, height: 300 };

describe('years', () => {
  test('a span of common-era years', () => {
    assert.equal(yearsLabel(years(49, 52)), 'c. 49–52 C.E.');
    assert.equal(spokenYears(years(49, 52)), 'about 49 to 52 C.E.');
  });

  test('one year, and exact years', () => {
    assert.equal(yearsLabel(years(49, 49)), 'c. 49 C.E.');
    assert.equal(yearsLabel(years(58, 61, false)), '58–61 C.E.');
    assert.equal(spokenYears(years(58, 61, false)), '58 to 61 C.E.');
  });

  test('years before the common era, and across it', () => {
    assert.equal(yearsLabel(years(-6, -4)), 'c. 6–4 B.C.E.');
    assert.equal(yearsLabel(years(-2, 1, false)), '2 B.C.E.–1 C.E.');
  });
});

describe('timelineSections', () => {
  test('periods hold their events in order, and loose events sit between them', () => {
    assert.deepEqual(
      sections.map((s) => [s.title, s.events.map((e) => e.id)]),
      [
        ['First tour', ['event:sent', 'event:cyprus']],
        [BETWEEN_TITLE, ['event:council', 'event:letter']],
        ['Second tour', ['event:macedonia', 'event:galatia']],
        ['Custody', ['event:arrest', 'event:caesarea']],
      ],
    );
  });

  test('a section between periods takes its years from its events', () => {
    const between = sections[1];
    assert.equal(between.period, undefined);
    assert.equal(between.key, 'between:event:council');
    assert.deepEqual(between.dating, years(49, 49));
  });

  test('loose events split by a period make two sections', () => {
    const split = timelineSections(
      [first],
      [
        event(1, 'event:a', [], ['place:jerusalem'], 12),
        event(2, 'event:b', ['period:first'], ['place:cyprus'], 13),
        event(3, 'event:c', [], ['place:jerusalem'], 15),
      ],
    );
    assert.deepEqual(
      split.map((s) => s.key),
      ['between:event:a', 'period:first', 'between:event:c'],
    );
  });

  test('the span and the era bar', () => {
    assert.deepEqual(timelineSpan(sections), { start: 47, end: 58 });
    const bands = eraBands(sections);
    // 2 + 1 + 4 + 3 years, end to end.
    assert.deepEqual(
      bands.map((b) => [b.key, b.left * 10, b.width * 10]),
      [
        ['period:first', 0, 2],
        ['between:event:council', 2, 1],
        ['period:second', 3, 4],
        ['period:custody', 7, 3],
      ],
    );
  });
});

describe('selection', () => {
  test('opens at the event asked for, in its section', () => {
    assert.deepEqual(initialSelection(sections, { event: 'event:letter' }), {
      section: 'between:event:council',
      event: 'event:letter',
    });
  });

  test('falls back to the period, then the first section', () => {
    assert.deepEqual(initialSelection(sections, { event: 'event:nope', period: 'period:custody' }), {
      section: 'period:custody',
    });
    assert.deepEqual(initialSelection(sections, {}), { section: 'period:first' });
    assert.equal(initialSelection([], {}), undefined);
  });

  test('the first event in a chapter', () => {
    assert.equal(firstEventInChapter(events, 44, 16)?.id, 'event:macedonia');
    assert.equal(firstEventInChapter(events, 44, 30), undefined);
    assert.equal(firstEventInChapter(events, 43, 16), undefined);
  });
});

describe('what the map draws', () => {
  const byId = new Map(markers(places).map((m) => [m.id, m]));

  test('places without a point are left off', () => {
    assert.equal(byId.has('place:galatia'), false);
    assert.deepEqual(byId.get('place:troas')?.at, project(26.16, 39.75));
  });

  test('a path skips unmapped places and repeats', () => {
    assert.deepEqual(
      pathThrough(['place:jerusalem', 'place:galatia', 'place:caesarea', 'place:caesarea'], byId).map((m) => m.id),
      ['place:jerusalem', 'place:caesarea'],
    );
  });

  test('a period shows its route, its places labeled', () => {
    const h = highlight(sections, { section: 'period:second' }, places);
    assert.deepEqual(
      h.route.map((m) => m.id),
      ['place:antioch-syria', 'place:troas', 'place:philippi'],
    );
    assert.deepEqual(h.path, []);
    assert.deepEqual(h.focus, ['place:antioch-syria', 'place:troas', 'place:philippi']);
    assert.deepEqual(h.context, []);
    assert.deepEqual(h.unmapped, ['Galatia']);
    assert.equal(h.fit.length, 3);
  });

  test('an event shows its own path, the rest of the period unlabeled', () => {
    const h = highlight(sections, { section: 'period:second', event: 'event:macedonia' }, places);
    assert.deepEqual(h.path.map((m) => m.id), ['place:troas', 'place:philippi']);
    assert.deepEqual(h.focus, ['place:troas', 'place:philippi']);
    assert.deepEqual(h.context, ['place:antioch-syria']);
    assert.deepEqual(h.unmapped, []);
  });

  test("a period with no route follows its events' places", () => {
    const h = highlight(sections, { section: 'period:custody' }, places);
    assert.deepEqual(h.route.map((m) => m.id), ['place:jerusalem', 'place:caesarea']);
  });

  test('events between periods follow their places too', () => {
    const h = highlight(sections, { section: 'between:event:council' }, places);
    assert.deepEqual(
      h.route.map((m) => m.id),
      ['place:antioch-syria', 'place:jerusalem', 'place:antioch-syria'],
    );
    assert.deepEqual(h.focus, ['place:antioch-syria', 'place:jerusalem']);
  });

  test('an unknown section draws nothing', () => {
    const h = highlight(sections, { section: 'nope' }, places);
    assert.deepEqual([h.route, h.path, h.focus, h.fit], [[], [], [], []]);
  });
});

describe('the camera', () => {
  test('zoom limits follow the view', () => {
    const min = minZoom(view);
    assert.equal(min, Math.max(400 / MAP_SIZE.width, 300 / MAP_SIZE.height));
    assert.ok(maxZoom(view) >= 3);
  });

  test('a clamped camera keeps the view on the map', () => {
    const c = clampCamera({ x: -1000, y: 99999, zoom: 0.01 }, view);
    assert.equal(c.zoom, minZoom(view));
    const r = visibleRect(c, view);
    assert.ok(r.x >= -1e-9 && r.y >= -1e-9);
    assert.ok(r.x + r.width <= MAP_SIZE.width + 1e-9);
    assert.ok(r.y + r.height <= MAP_SIZE.height + 1e-9);
  });

  test('a fit shows every point inside the padding', () => {
    const points = [project(24.29, 41.01), project(36.15, 36.2)];
    const c = fitPoints(points, view, 24);
    for (const p of points) {
      const s = toScreen(c, view, p);
      assert.ok(s.x >= 24 - 1e-6 && s.x <= view.width - 24 + 1e-6, `x ${s.x}`);
      assert.ok(s.y >= 24 - 1e-6 && s.y <= view.height - 24 + 1e-6, `y ${s.y}`);
    }
  });

  test('one place is not blown up', () => {
    const c = fitPoints([project(35.23, 31.78)], view, 24);
    assert.ok(visibleRect(c, view).width >= 220);
  });

  test('a tap finds the nearest marker within reach', () => {
    const ms = markers(places);
    const c = fitPoints(ms.map((m) => m.at), view, 24);
    const troas = toScreen(c, view, project(26.16, 39.75));
    assert.equal(markerAt(ms, c, view, { x: troas.x + 5, y: troas.y }, 22)?.id, 'place:troas');
    assert.equal(markerAt(ms, c, view, { x: -100, y: -100 }, 22), undefined);
  });
});

describe('placeLabels', () => {
  const camera = { x: 100, y: 100, zoom: 1 };
  const square = { width: 200, height: 200 };
  const at = (id: string, x: number, y: number) => ({ id, name: id, at: { x, y } });

  test('labels go to the right where there is room', () => {
    assert.deepEqual(placeLabels([at('Troas', 50, 50)], camera, square, 12, 8), [{ id: 'Troas', side: 'right' }]);
  });

  test('a label that would leave the view flips left', () => {
    assert.deepEqual(placeLabels([at('Troas', 180, 50)], camera, square, 12, 8), [{ id: 'Troas', side: 'left' }]);
  });

  test('a label with no room on either side is dropped', () => {
    const placed = placeLabels([at('Philippi', 20, 50), at('Neapolis', 24, 62), at('Troas', 60, 150)], camera, square, 12, 8);
    assert.deepEqual(placed.map((p) => p.id), ['Philippi', 'Troas']);
  });

  test("no label covers another place's dot", () => {
    // Beroea's label would run over Pella's dot to its right.
    const placed = placeLabels([at('Beroea', 60, 100), at('Pella', 90, 100)], camera, square, 12, 8);
    assert.deepEqual(placed, [
      { id: 'Beroea', side: 'left' },
      { id: 'Pella', side: 'right' },
    ]);
  });
});

describe('places', () => {
  test('kinds, confidence and precision read in words', () => {
    assert.equal(placeKindLabel(0), 'City');
    assert.equal(placeKindLabel(7), 'Region');
    assert.equal(placeKindLabel(99), 'Place');
    assert.equal(siteConfidence(2), 'The site is uncertain.');
    assert.equal(pointPrecision(0), undefined);
    assert.match(pointPrecision(2) ?? '', /island/);
    assert.equal(publicationName('it-2'), 'Insight, Volume 2');
    assert.equal(publicationName('w26'), 'w26');
  });
});
