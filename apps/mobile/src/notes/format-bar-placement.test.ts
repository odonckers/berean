import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { type FormatBarFrame, type FormatBarState, formatBarBottom, formatBarPlacement } from './format-bar-placement.ts';

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

const frame = (over: Partial<FormatBarFrame>): FormatBarFrame => ({
  placement: 'keyboard',
  keyboardFromWindowBottom: 0,
  bodyGapFromWindowBottom: 0,
  dockedInset: 0,
  ...over,
});

describe('format bar bottom', () => {
  test('Android with tabs: what lies below the editor comes off the keyboard', () => {
    // A 294 keyboard over the 48 navigation bar; the editor ends 128 above the window's bottom.
    assert.equal(formatBarBottom(frame({ keyboardFromWindowBottom: 294 + 48, bodyGapFromWindowBottom: 128 })), 214);
  });

  test('an editor reaching the window bottom: the keyboard as measured', () => {
    assert.equal(formatBarBottom(frame({ keyboardFromWindowBottom: 342 })), 342);
  });

  test('a keyboard shorter than the gap: the editor bottom', () => {
    assert.equal(formatBarBottom(frame({ keyboardFromWindowBottom: 100, bodyGapFromWindowBottom: 128 })), 0);
  });

  test('docked: the inset over the system bars, whatever the keyboard', () => {
    const docked = { placement: 'docked', keyboardFromWindowBottom: 342, bodyGapFromWindowBottom: 128, dockedInset: 48 } as const;
    assert.equal(formatBarBottom(frame(docked)), 48);
  });

  test('hidden: nothing', () => {
    assert.equal(formatBarBottom(frame({ placement: 'hidden', keyboardFromWindowBottom: 342, dockedInset: 48 })), 0);
  });
});
