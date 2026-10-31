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
      { text: 'berean://bible/asv/john/1/9', kind: 'linkUrl', folded: true },
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
      { text: 'berean://x)', kind: 'linkUrl', folded: true },
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

describe('link target folding', () => {
  const text = 'In [John 1:9](berean://bible/asv/john/1/9), the light';
  const spans: SourceSpan[] = [
    spanOf(text, '[', 'linkBracket'),
    spanOf(text, '](', 'linkBracket'),
    spanOf(text, 'berean://', 'linkUrl'),
    spanOf(text, ')', 'linkBracket'),
  ];
  // The ](url) part, which the caret enters to unfold the target.
  const opens = text.indexOf('](');
  const closes = text.indexOf(')') + 1;

  const target = (segments: StyledSegment[]) => segments.find((s) => s.kind === 'linkUrl');
  const foldedAt = (start: number, end = start) => target(styledSegments(text, spans, { start, end }))?.folded === true;

  test('folded while the field has no selection', () => {
    assert.equal(target(styledSegments(text, spans))?.folded, true);
  });

  test('folded while the caret is elsewhere, or at the link’s edges', () => {
    assert.equal(foldedAt(0), true);
    assert.equal(foldedAt(text.length), true);
    assert.equal(foldedAt(opens), true, 'caret at the end of the link text');
    assert.equal(foldedAt(closes), true, 'caret just after the link');
  });

  test('unfolds once the caret enters it', () => {
    assert.equal(foldedAt(opens + 1), false, 'between ] and (');
    assert.equal(foldedAt(text.indexOf('john')), false, 'inside the target');
    assert.equal(foldedAt(closes - 1), false, 'before the )');
  });

  test('unfolds for a selection across it, either way round', () => {
    assert.equal(foldedAt(0, text.length), false);
    assert.equal(foldedAt(text.length, 0), false);
    assert.equal(foldedAt(0, opens), true, 'a selection that stops before it');
  });

  test('folding never changes the text', () => {
    for (const caret of [undefined, { start: 0, end: 0 }, { start: opens + 3, end: opens + 3 }]) {
      assert.equal(joined(styledSegments(text, spans, caret)), text);
    }
  });

  test('the caret changes only folded: same cuts, kinds and marks inside or outside the link', () => {
    // A size or structure change with the caret re-flows the field, and Android leaves lines undrawn.
    const note = '# Light\nSee **[John 1:9](berean://x)** and `code`';
    const noteSpans: SourceSpan[] = [
      spanOf(note, '#', 'headingMarker'),
      spanOf(note, '**', 'strongMarker'),
      spanOf(note, '[', 'linkBracket'),
      spanOf(note, '](', 'linkBracket'),
      spanOf(note, 'berean://x', 'linkUrl'),
      spanOf(note, ')', 'linkBracket'),
      spanOf(note, '**', 'strongMarker', note.indexOf(')')),
      spanOf(note, '`', 'codeMarker'),
      spanOf(note, 'code', 'code'),
      spanOf(note, '`', 'codeMarker', note.indexOf('code')),
    ];
    const unfoldedShape = (selection?: { start: number; end: number }) =>
      styledSegments(note, noteSpans, selection).map(({ folded: _folded, ...rest }) => rest);
    const outside = unfoldedShape();
    const inside = note.indexOf('berean://x') + 3;
    assert.equal(
      styledSegments(note, noteSpans, { start: inside, end: inside }).find((s) => s.kind === 'linkUrl')?.folded,
      undefined,
    );
    for (let caret = 0; caret <= note.length; caret++) {
      assert.deepEqual(unfoldedShape({ start: caret, end: caret }), outside, `caret at ${caret}`);
    }
  });

  test('each link folds on its own', () => {
    const two = '[a](x://1) [b](x://2)';
    const twoSpans: SourceSpan[] = [
      spanOf(two, '[', 'linkBracket'),
      spanOf(two, '](', 'linkBracket'),
      spanOf(two, 'x://1', 'linkUrl'),
      spanOf(two, ')', 'linkBracket'),
      spanOf(two, '[', 'linkBracket', 5),
      spanOf(two, '](', 'linkBracket', 5),
      spanOf(two, 'x://2', 'linkUrl'),
      spanOf(two, ')', 'linkBracket', 5),
    ];
    const caret = two.indexOf('x://2') + 1;
    const folded = styledSegments(two, twoSpans, { start: caret, end: caret })
      .filter((s) => s.kind === 'linkUrl')
      .map((s) => [s.text, s.folded === true]);
    assert.deepEqual(folded, [
      ['x://1', true],
      ['x://2', false],
    ]);
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
