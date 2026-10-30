import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { keyboardBottom, paletteFrame } from './palette-frame.ts';

const phone = { top: 48, bottom: 48, left: 0, right: 0 };
// Whether the reported keyboard height excludes the bottom system bar.
const ANDROID = true;
const IOS = false;

describe('keyboardBottom', () => {
  test('is the bottom inset while the keyboard is closed, on both platforms', () => {
    assert.equal(keyboardBottom(0, 48, ANDROID), 48);
    assert.equal(keyboardBottom(0, 34, IOS), 34);
  });

  test('on Android adds the navigation bar under the reported keyboard', () => {
    assert.equal(keyboardBottom(320, 48, ANDROID), 368);
  });

  test('on iOS takes the keyboard, which already covers the home indicator', () => {
    assert.equal(keyboardBottom(336, 34, IOS), 336);
    assert.equal(keyboardBottom(30, 34, IOS), 34);
  });
});

describe('paletteFrame', () => {
  test('keeps the margin inside the status and navigation bars', () => {
    for (const platform of [ANDROID, IOS]) {
      const frame = paletteFrame(900, phone, 0, platform, 24);
      assert.equal(frame.paddingTop, 72);
      assert.equal(frame.paddingBottom, 72);
      assert.equal(frame.maxHeight, 900 - 72 - 72);
    }
  });

  test('on Android sits the margin above the keyboard and the navigation bar under it', () => {
    const frame = paletteFrame(900, phone, 320, ANDROID, 24);
    assert.equal(frame.paddingBottom, 48 + 320 + 24);
    assert.equal(frame.maxHeight, 900 - 72 - (48 + 320 + 24));
  });

  test('on iOS sits above the keyboard, whose height covers the bottom inset', () => {
    const frame = paletteFrame(900, phone, 320, IOS, 24);
    assert.equal(frame.paddingBottom, 344);
    assert.equal(frame.maxHeight, 900 - 72 - 344);
  });

  test('on iOS never reserves less than the bottom inset for a short keyboard bar', () => {
    assert.equal(paletteFrame(900, phone, 30, IOS, 24).paddingBottom, 72);
  });

  test('clears side insets, e.g. a landscape cutout', () => {
    const frame = paletteFrame(400, { top: 0, bottom: 0, left: 32, right: 48 }, 0, IOS, 24);
    assert.equal(frame.paddingStart, 56);
    assert.equal(frame.paddingEnd, 72);
  });

  test('never goes negative in a tiny window', () => {
    assert.equal(paletteFrame(100, phone, 320, IOS, 24).maxHeight, 0);
    assert.equal(paletteFrame(100, phone, 320, ANDROID, 24).maxHeight, 0);
  });
});
