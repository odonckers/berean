import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { type FormatBarState, formatBarPlacement } from './format-bar-placement.ts';

const state = (over: Partial<FormatBarState>): FormatBarState => ({
  writing: true,
  fieldFocused: false,
  keyboardHeight: 0,
  whenKeyboardClosed: 'hide',
  ...over,
});

describe('format bar placement', () => {
  test('soft keyboard up: above it', () => {
    assert.equal(formatBarPlacement(state({ fieldFocused: true, keyboardHeight: 300 })), 'keyboard');
  });

  test('a field focused with no soft keyboard (a hardware keyboard): docked at the bottom', () => {
    assert.equal(formatBarPlacement(state({ fieldFocused: true })), 'docked');
  });

  test('no field focused and no keyboard: hidden', () => {
    assert.equal(formatBarPlacement(state({})), 'hidden');
  });

  test('the knob keeps it docked with the keyboard closed', () => {
    assert.equal(formatBarPlacement(state({ whenKeyboardClosed: 'show' })), 'docked');
  });

  test('never in Read', () => {
    assert.equal(formatBarPlacement(state({ writing: false, fieldFocused: true, keyboardHeight: 300 })), 'hidden');
    assert.equal(formatBarPlacement(state({ writing: false, whenKeyboardClosed: 'show' })), 'hidden');
  });
});
