import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { onNotesChanged, notesChanged } from './changes.ts';
import { UNDO_MS, undoDuration, undoMessages } from './undo.ts';

describe('undo', () => {
  test('8 s, twice that with a screen reader', () => {
    assert.equal(UNDO_MS, 8_000);
    assert.equal(undoDuration(false), 8_000);
    assert.equal(undoDuration(true), 16_000);
  });

  test('Material: the snackbar says what kind of thing went', () => {
    assert.deepEqual(undoMessages('material', 'Folder', 'Signs'), {
      label: 'Folder deleted',
      announcement: 'Folder deleted. Undo available.',
    });
  });

  test('iOS look: the toast names it, in curly quotes', () => {
    assert.deepEqual(undoMessages('ios', 'Folder', 'Signs'), {
      label: 'Deleted “Signs”',
      announcement: 'Deleted “Signs”. Undo available.',
    });
  });
});

describe('notes changed', () => {
  test('listeners hear changes until they unsubscribe', () => {
    let heard = 0;
    const off = onNotesChanged(() => heard++);
    notesChanged();
    off();
    notesChanged();
    assert.equal(heard, 1);
  });
});
