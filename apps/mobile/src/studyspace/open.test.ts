import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { parseReaderParams, readerParams, tapAction } from './open.ts';

describe('what a tap on a card does', () => {
  test('phone: a reader card opens the full-screen reader, a note the editor', () => {
    assert.equal(tapAction('passage', 'phone', false), 'openReader');
    assert.equal(tapAction('publication', 'phone', false), 'openReader');
    assert.equal(tapAction('note', 'phone', false), 'openNote');
  });

  test('tablet: a reader card is focused, a note comes to the front', () => {
    assert.equal(tapAction('passage', 'tablet', false), 'focus');
    assert.equal(tapAction('publication', 'tablet', false), 'focus');
    assert.equal(tapAction('note', 'tablet', false), 'front');
  });

  test('a missing card only comes to the front', () => {
    for (const device of ['phone', 'tablet'] as const) {
      for (const kind of ['note', 'passage', 'publication'] as const) {
        assert.equal(tapAction(kind, device, true), 'front');
      }
    }
  });
});

describe('the full-screen reader route params', () => {
  test('round trip, ids past 2^53 included', () => {
    const big = 9_007_199_254_740_993n;
    const params = readerParams(3n, big);
    assert.deepEqual(params, { workspace: '3', item: '9007199254740993' });
    assert.deepEqual(parseReaderParams(params), { workspace: 3n, item: big });
  });

  test('missing, repeated or non-numeric params read as none', () => {
    assert.equal(parseReaderParams({}), undefined);
    assert.equal(parseReaderParams({ workspace: '3' }), undefined);
    assert.equal(parseReaderParams({ workspace: '3', item: 'abc' }), undefined);
    assert.equal(parseReaderParams({ workspace: '3', item: '1.5' }), undefined);
    assert.equal(parseReaderParams({ workspace: ['3', '4'], item: '1' }), undefined);
  });
});
