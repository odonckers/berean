import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { shownKeyboardHeight } from './shown-keyboard.ts';

describe('shownKeyboardHeight', () => {
  test('an IME inset covering nearly the whole window (input view hidden, window kept): no keyboard', () => {
    assert.equal(shownKeyboardHeight(842.3, 914), 0);
  });

  test('a soft keyboard as drawn: unchanged', () => {
    assert.equal(shownKeyboardHeight(300, 914), 300);
  });

  test('no keyboard: 0', () => {
    assert.equal(shownKeyboardHeight(0, 914), 0);
  });
});
