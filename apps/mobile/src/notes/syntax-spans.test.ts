import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { type SourceSpan, styledSegments } from './syntax-spans.ts';

const joined = (segments: { text: string }[]) => segments.map((s) => s.text).join('');

describe('styledSegments', () => {
  test('no spans: the whole text, plain', () => {
    assert.deepEqual(styledSegments('Light before law', []), [{ text: 'Light before law' }]);
  });

  test('spans split the text, plain runs between', () => {
    const text = '# Light **not** the light';
    const spans: SourceSpan[] = [
      { start: 0, end: 2, kind: 'headingMarker' },
      { start: 8, end: 10, kind: 'strongMarker' },
      { start: 13, end: 15, kind: 'strongMarker' },
    ];
    assert.deepEqual(styledSegments(text, spans), [
      { text: '# ', kind: 'headingMarker' },
      { text: 'Light ' },
      { text: '**', kind: 'strongMarker' },
      { text: 'not' },
      { text: '**', kind: 'strongMarker' },
      { text: ' the light' },
    ]);
  });

  test('spans out of order are taken by start', () => {
    const spans: SourceSpan[] = [
      { start: 4, end: 5, kind: 'emphasisMarker' },
      { start: 0, end: 1, kind: 'emphasisMarker' },
    ];
    assert.deepEqual(styledSegments('*hi* there', spans).map((s) => s.kind), [
      'emphasisMarker',
      undefined,
      'emphasisMarker',
      undefined,
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

  test('empty text: no segments', () => {
    assert.deepEqual(styledSegments('', []), []);
    assert.deepEqual(styledSegments('', [{ start: 0, end: 3, kind: 'rule' }]), []);
  });
});
