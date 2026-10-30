import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createPressGuard } from './press-guard.ts';

describe('press guard', () => {
  test('a tap opens', () => {
    const guard = createPressGuard();
    guard.pressIn(100, 200);
    assert.equal(guard.shouldOpen(100, 200), true);
  });

  test('scrolling during the touch blocks the open', () => {
    const guard = createPressGuard();
    guard.pressIn(100, 200);
    guard.scrolled();
    assert.equal(guard.shouldOpen(100, 200), false);
  });

  test('moving more than 10dp blocks the open', () => {
    const guard = createPressGuard();
    guard.pressIn(100, 647.6);
    assert.equal(guard.shouldOpen(100, 228.6), false);
    guard.pressIn(100, 200);
    assert.equal(guard.shouldOpen(108, 208), false);
  });

  test('jitter under 10dp still opens', () => {
    const guard = createPressGuard();
    guard.pressIn(100, 200);
    assert.equal(guard.shouldOpen(104, 197), true);
  });

  test('a new press after a scroll opens again', () => {
    const guard = createPressGuard();
    guard.pressIn(100, 200);
    guard.scrolled();
    assert.equal(guard.shouldOpen(100, 200), false);
    guard.pressIn(50, 300);
    assert.equal(guard.shouldOpen(50, 300), true);
  });

  test('an activation without a touch (TalkBack, keyboard) opens', () => {
    const guard = createPressGuard();
    assert.equal(guard.shouldOpen(0, 0), true);
  });

  test('an activation after a finished drag opens', () => {
    const guard = createPressGuard();
    guard.pressIn(100, 200);
    guard.scrolled();
    assert.equal(guard.shouldOpen(100, 200), false);
    assert.equal(guard.shouldOpen(0, 0), true);
  });

  test('a cancelled touch, then an activation, opens', () => {
    const guard = createPressGuard();
    guard.pressIn(100, 200);
    guard.scrolled();
    guard.end();
    assert.equal(guard.shouldOpen(0, 0), true);
  });
});
