import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { SpanKind } from 'berean-ffi-rn';

import {
  fromCoreSpans,
  segmentsBefore,
  type SourceSpan,
  type StyledSegment,
  styledSegments,
  type SyntaxKind,
  syntaxKind,
} from './syntax-spans.ts';

const joined = (segments: { text: string }[]) => segments.map((s) => s.text).join('');

/** The span over `needle`'s first match at or after `from`, as the core would report it. */
function spanOf(text: string, needle: string, kind: SyntaxKind, from = 0): SourceSpan {
  const start = text.indexOf(needle, from);
  assert.notEqual(start, -1, `${needle} in the text`);
  return { start, end: start + needle.length, kind };
}

const allKinds: SyntaxKind[] = [
  'headingMarker',
  'emphasisMarker',
  'strongMarker',
  'strikeMarker',
  'codeMarker',
  'code',
  'linkBracket',
  'linkUrl',
  'listMarker',
  'taskMarker',
  'quoteMarker',
  'rule',
  'tag',
];

describe('syntaxKind', () => {
  test("each of the core's kinds has its own name, and every name is used", () => {
    const names = allKinds.map((_, kind) => syntaxKind(kind));
    assert.deepEqual(new Set(names), new Set(allKinds));
    assert.equal(new Set(names).size, allKinds.length);
  });

  test('a kind the core numbered past these has no name', () => {
    assert.equal(syntaxKind(allKinds.length), undefined);
    assert.equal(syntaxKind(-1), undefined);
  });

  test("fromCoreSpans names the core's spans and drops unknown kinds", () => {
    assert.deepEqual(
      fromCoreSpans([
        { start: 0, end: 2, kind: 0 },
        { start: 4, end: 9, kind: 99 as SpanKind },
        { start: 9, end: 15, kind: 12 },
      ]),
      [
        { start: 0, end: 2, kind: 'headingMarker' },
        { start: 9, end: 15, kind: 'tag' },
      ],
    );
  });
});

describe('styledSegments', () => {
  test('no spans: the whole text, plain', () => {
    assert.deepEqual(styledSegments('Light before law', []), [{ text: 'Light before law' }]);
  });

  test('a heading line, and bold text between its markers', () => {
    const text = '## Light\nHe was **not** the light';
    const spans: SourceSpan[] = [
      spanOf(text, '##', 'headingMarker'),
      spanOf(text, '**', 'strongMarker'),
      spanOf(text, '**', 'strongMarker', text.indexOf('not')),
    ];
    assert.deepEqual(styledSegments(text, spans), [
      { text: '##', kind: 'headingMarker', heading: 2 },
      { text: ' Light', heading: 2 },
      { text: '\nHe was ' },
      { text: '**', kind: 'strongMarker' },
      { text: 'not', strong: true },
      { text: '**', kind: 'strongMarker' },
      { text: ' the light' },
    ]);
  });

  test('a setext underline or closing run styles no heading', () => {
    const text = 'Light\n===\n# Grace #';
    const spans: SourceSpan[] = [
      spanOf(text, '===', 'headingMarker'),
      spanOf(text, '#', 'headingMarker'),
      spanOf(text, '#', 'headingMarker', text.indexOf('Grace')),
    ];
    assert.deepEqual(styledSegments(text, spans), [
      { text: 'Light\n' },
      { text: '===', kind: 'headingMarker' },
      { text: '\n' },
      { text: '#', kind: 'headingMarker', heading: 1 },
      { text: ' Grace ', heading: 1 },
      { text: '#', kind: 'headingMarker', heading: 1 },
    ]);
  });

  test('italic and struck text, with markers nested in bold', () => {
    const text = '**a *b* c** ~~d~~';
    const spans: SourceSpan[] = [
      { start: 0, end: 2, kind: 'strongMarker' },
      { start: 4, end: 5, kind: 'emphasisMarker' },
      { start: 6, end: 7, kind: 'emphasisMarker' },
      { start: 9, end: 11, kind: 'strongMarker' },
      { start: 12, end: 14, kind: 'strikeMarker' },
      { start: 15, end: 17, kind: 'strikeMarker' },
    ];
    assert.deepEqual(styledSegments(text, spans), [
      { text: '**', kind: 'strongMarker' },
      { text: 'a ', strong: true },
      { text: '*', kind: 'emphasisMarker', strong: true },
      { text: 'b', strong: true, emphasis: true },
      { text: '*', kind: 'emphasisMarker', strong: true },
      { text: ' c', strong: true },
      { text: '**', kind: 'strongMarker' },
      { text: ' ' },
      { text: '~~', kind: 'strikeMarker' },
      { text: 'd', strike: true },
      { text: '~~', kind: 'strikeMarker' },
    ]);
  });

  test('a link, a #tag and emoji: UTF-16 offsets land on the right characters', () => {
    // Each emoji is two UTF-16 units, so code-point offsets would be off by one per emoji.
    const text = '# Light 🕯️\nSee 🙏 [John 1:9](berean://bible/asv/john/1/9) #grace';
    const spans: SourceSpan[] = [
      spanOf(text, '#', 'headingMarker'),
      spanOf(text, '[', 'linkBracket'),
      spanOf(text, '](', 'linkBracket'),
      spanOf(text, 'berean://bible/asv/john/1/9', 'linkUrl'),
      spanOf(text, ')', 'linkBracket'),
      spanOf(text, '#grace', 'tag'),
    ];
    const segments = styledSegments(text, spans);
    assert.equal(joined(segments), text);
    assert.deepEqual(segments, [
      { text: '#', kind: 'headingMarker', heading: 1 },
      { text: ' Light 🕯️', heading: 1 },
      { text: '\nSee 🙏 ' },
      { text: '[', kind: 'linkBracket' },
      { text: 'John 1:9' },
      { text: '](', kind: 'linkBracket' },
      { text: 'berean://bible/asv/john/1/9', kind: 'linkUrl' },
      { text: ')', kind: 'linkBracket' },
      { text: ' ' },
      { text: '#grace', kind: 'tag' },
    ]);
  });

  test('spans out of order are taken by start', () => {
    const spans: SourceSpan[] = [
      { start: 3, end: 4, kind: 'emphasisMarker' },
      { start: 0, end: 1, kind: 'emphasisMarker' },
    ];
    assert.deepEqual(styledSegments('*hi* there', spans), [
      { text: '*', kind: 'emphasisMarker' },
      { text: 'hi', emphasis: true },
      { text: '*', kind: 'emphasisMarker' },
      { text: ' there' },
    ]);
  });

  test('out-of-range spans are clipped or dropped', () => {
    const text = 'see #grace';
    const spans: SourceSpan[] = [
      { start: -3, end: 1, kind: 'quoteMarker' },
      { start: 4, end: 99, kind: 'tag' },
      { start: 50, end: 60, kind: 'rule' },
      { start: 3, end: 2, kind: 'code' },
      { start: Number.NaN, end: 2, kind: 'code' },
    ];
    const segments = styledSegments(text, spans);
    assert.deepEqual(segments, [
      { text: 's', kind: 'quoteMarker' },
      { text: 'ee ' },
      { text: '#grace', kind: 'tag' },
    ]);
    assert.equal(joined(segments), text);
  });

  test('overlapping spans cover the text once', () => {
    const text = '[John 1:9](berean://x)';
    const spans: SourceSpan[] = [
      { start: 0, end: 11, kind: 'linkBracket' },
      { start: 10, end: 22, kind: 'linkUrl' },
      { start: 12, end: 14, kind: 'code' },
    ];
    const segments = styledSegments(text, spans);
    assert.deepEqual(segments, [
      { text: '[John 1:9](', kind: 'linkBracket' },
      { text: 'berean://x)', kind: 'linkUrl' },
    ]);
    assert.equal(joined(segments), text);
  });

  test('an unmatched marker styles nothing after it', () => {
    const text = '**a** and ** b';
    const spans: SourceSpan[] = [
      { start: 0, end: 2, kind: 'strongMarker' },
      { start: 3, end: 5, kind: 'strongMarker' },
      { start: 10, end: 12, kind: 'strongMarker' },
    ];
    assert.deepEqual(styledSegments(text, spans).at(-1), { text: ' b' });
  });

  test('empty text: no segments', () => {
    assert.deepEqual(styledSegments('', []), []);
    assert.deepEqual(styledSegments('', [{ start: 0, end: 3, kind: 'rule' }]), []);
  });
});

describe('link targets', () => {
  test('a target is a plain dimmed run with its full URL, from the text alone', () => {
    // No caret or selection goes in: Android leaves lines undrawn after a caret-driven restyle.
    const text = 'In [John 1:9](berean://bible/asv/john/1/9), the light';
    const spans: SourceSpan[] = [
      spanOf(text, '[', 'linkBracket'),
      spanOf(text, '](', 'linkBracket'),
      spanOf(text, 'berean://bible/asv/john/1/9', 'linkUrl'),
      spanOf(text, ')', 'linkBracket'),
    ];
    assert.equal(styledSegments.length, 2, 'takes only the text and its spans');
    const segments = styledSegments(text, spans);
    assert.deepEqual(
      segments.find((s) => s.kind === 'linkUrl'),
      { text: 'berean://bible/asv/john/1/9', kind: 'linkUrl' },
    );
    assert.deepEqual(styledSegments(text, spans), segments, 'the same runs every time');
    assert.equal(joined(segments), text);
  });
});

describe('segmentsBefore', () => {
  const segments: StyledSegment[] = [{ text: 'Plain ' }, { text: '**', kind: 'strongMarker' }, { text: 'bold', strong: true }];

  test('cuts the run the caret is in, keeping its style', () => {
    assert.deepEqual(segmentsBefore(segments, 9), [
      { text: 'Plain ' },
      { text: '**', kind: 'strongMarker' },
      { text: 'b', strong: true },
    ]);
  });

  test('a caret on a run’s edge ends with the run before it', () => {
    assert.deepEqual(segmentsBefore(segments, 6), [{ text: 'Plain ' }]);
  });

  test('nothing at the start; everything at the end or past it', () => {
    assert.deepEqual(segmentsBefore(segments, 0), []);
    assert.equal(joined(segmentsBefore(segments, 12)), 'Plain **bold');
    assert.equal(joined(segmentsBefore(segments, 99)), 'Plain **bold');
  });
});
