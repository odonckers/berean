import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { placeOrDiscard, rememberOutcome } from './writes.ts';

describe('placing a new note, or discarding it', () => {
  const failing = () => {
    throw new Error('full');
  };

  test('a failed place removes the note just made and rethrows', () => {
    const removed: string[] = [];
    assert.throws(
      () => placeOrDiscard({ createdNoteId: 'n1' }, failing, (id) => removed.push(id)),
      /full/,
    );
    assert.deepEqual(removed, ['n1']);
  });

  test('a failed removal still rethrows the place’s error', () => {
    const discard = () => {
      throw new Error('locked');
    };
    assert.throws(() => placeOrDiscard({ createdNoteId: 'n1' }, failing, discard), /full/);
  });

  test('a successful place removes nothing', () => {
    const removed: string[] = [];
    assert.equal(
      placeOrDiscard({ createdNoteId: 'n1' }, () => 7, (id) => removed.push(id)),
      7,
    );
    assert.deepEqual(removed, []);
  });

  test('a note picked from the existing ones is never removed', () => {
    const removed: string[] = [];
    assert.throws(() => placeOrDiscard({}, failing, (id) => removed.push(id)), /full/);
    assert.deepEqual(removed, []);
  });
});

describe('remembering a workspace', () => {
  const gone = new Error('NotFound');
  const isGone = (e: unknown) => e === gone;

  test('ok when the write works', () => {
    assert.equal(rememberOutcome(() => {}, isGone), 'ok');
  });

  test('gone on NotFound, so the screen reads again at once', () => {
    const write = () => {
      throw gone;
    };
    assert.equal(rememberOutcome(write, isGone), 'gone');
  });

  test('failed on any other error', () => {
    const write = () => {
      throw new Error('Io');
    };
    assert.equal(rememberOutcome(write, isGone), 'failed');
  });
});
