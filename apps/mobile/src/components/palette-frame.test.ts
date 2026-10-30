import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { paletteFrame } from './palette-frame.ts';

const phone = { top: 48, bottom: 48, left: 0, right: 0 };

describe('paletteFrame', () => {
  test('keeps the margin inside the status and navigation bars', () => {
    const frame = paletteFrame(900, phone, 0, 24);
    assert.equal(frame.paddingTop, 72);
    assert.equal(frame.paddingBottom, 72);
    assert.equal(frame.maxHeight, 900 - 72 - 72);
  });

  test('sits above the keyboard, which covers the navigation bar', () => {
    const frame = paletteFrame(900, phone, 320, 24);
    assert.equal(frame.paddingBottom, 344);
    assert.equal(frame.maxHeight, 900 - 72 - 344);
  });

  test('never reserves less than the navigation bar for a short keyboard bar', () => {
    assert.equal(paletteFrame(900, phone, 30, 24).paddingBottom, 72);
  });

  test('clears side insets, e.g. a landscape cutout', () => {
    const frame = paletteFrame(400, { top: 0, bottom: 0, left: 32, right: 48 }, 0, 24);
    assert.equal(frame.paddingStart, 56);
    assert.equal(frame.paddingEnd, 72);
  });

  test('never goes negative in a tiny window', () => {
    assert.equal(paletteFrame(100, phone, 320, 24).maxHeight, 0);
  });
});
