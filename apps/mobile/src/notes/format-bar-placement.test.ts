import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  type CaretReveal,
  caretRevealOffset,
  type FormatBarFrame,
  type FormatBarState,
  formatBarBottom,
  formatBarPlacement,
  type ScrollFrameState,
  scrollFrame,
} from './format-bar-placement.ts';

const state = (over: Partial<FormatBarState>): FormatBarState => ({
  writing: true,
  bodyFocused: false,
  keyboardHeight: 0,
  ...over,
});

describe('format bar placement', () => {
  test('the body focused, soft keyboard up: above it', () => {
    assert.equal(formatBarPlacement(state({ bodyFocused: true, keyboardHeight: 300 })), 'keyboard');
  });

  test('the body focused with no soft keyboard (a hardware keyboard): docked at the bottom', () => {
    assert.equal(formatBarPlacement(state({ bodyFocused: true })), 'docked');
  });

  test('the title focused, soft keyboard up: hidden, the bar is the body’s', () => {
    assert.equal(formatBarPlacement(state({ bodyFocused: false, keyboardHeight: 300 })), 'hidden');
  });

  test('the title focused with no soft keyboard (a hardware keyboard): hidden, not docked', () => {
    assert.equal(formatBarPlacement(state({ bodyFocused: false })), 'hidden');
  });

  test('nothing focused and no keyboard: hidden', () => {
    assert.equal(formatBarPlacement(state({})), 'hidden');
  });

  test('never in Read', () => {
    assert.equal(formatBarPlacement(state({ writing: false, bodyFocused: true, keyboardHeight: 300 })), 'hidden');
    assert.equal(formatBarPlacement(state({ writing: false, bodyFocused: true })), 'hidden');
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

const scroll = (over: Partial<ScrollFrameState>): ScrollFrameState => ({
  writing: true,
  placement: 'keyboard',
  toolsBottom: 0,
  toolsHeight: 0,
  bottomInset: 0,
  writeEnd: 24,
  readEnd: 48,
  ...over,
});

describe('scroll frame', () => {
  test('Write above the keyboard: the frame ends at the tools, a little room after the last line', () => {
    const above = { toolsBottom: 214, toolsHeight: 52, bottomInset: 48 };
    assert.deepEqual(scrollFrame(scroll(above)), { frameBottom: 266, paddingBottom: 24 });
  });

  test('Write docked: the frame ends at the tools over the system bars', () => {
    const docked = { placement: 'docked', toolsBottom: 48, toolsHeight: 52, bottomInset: 48 } as const;
    assert.deepEqual(scrollFrame(scroll(docked)), { frameBottom: 100, paddingBottom: 24 });
  });

  test('Write with the tools hidden: the whole body, padded clear of the system bars', () => {
    const hidden = { placement: 'hidden', toolsHeight: 52, bottomInset: 48 } as const;
    assert.deepEqual(scrollFrame(scroll(hidden)), { frameBottom: 0, paddingBottom: 72 });
  });

  test('Read: the whole body, with more room after the last line', () => {
    const read = { writing: false, placement: 'hidden', bottomInset: 48 } as const;
    assert.deepEqual(scrollFrame(scroll(read)), { frameBottom: 0, paddingBottom: 96 });
  });
});

const caret = (over: Partial<CaretReveal>): CaretReveal => ({
  caretTop: 500,
  caretBottom: 524,
  scrollY: 0,
  viewportHeight: 400,
  margin: 8,
  ...over,
});

describe('caret reveal offset', () => {
  test('a line the shrunk frame hides: just above its bottom', () => {
    assert.equal(caretRevealOffset(caret({})), 132);
  });

  test('a line in view, or touching the edges: no scroll', () => {
    assert.equal(caretRevealOffset(caret({ viewportHeight: 600 })), undefined);
    assert.equal(caretRevealOffset(caret({ viewportHeight: 524 })), undefined);
    assert.equal(caretRevealOffset(caret({ scrollY: 500 })), undefined);
  });

  test('a line partly under the bottom edge: the whole line shows', () => {
    assert.equal(caretRevealOffset(caret({ viewportHeight: 510 })), 22);
  });

  test('a line above the view: its top at the top, less the margin', () => {
    assert.equal(caretRevealOffset(caret({ scrollY: 520 })), 492);
  });

  test('never above the content’s start', () => {
    assert.equal(caretRevealOffset(caret({ caretTop: 4, caretBottom: 28, scrollY: 10 })), 0);
  });
});
