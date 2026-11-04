import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  headerFitsActions,
  type HeaderFitInput,
  headerRowWidth,
  headerSearchWidth,
  headerWidth,
} from './header-fit.ts';

// The Library header in the Material look, with the token values the screen
// passes: M3 title large (22sp) title, body (16sp) button labels, the text
// button's 13dp label inset and 48dp target, spacing.sm between buttons and
// spacing.lg at the edges.
function library(windowWidth: number, fontScale: number): HeaderFitInput {
  return {
    windowWidth,
    fontScale,
    title: 'Library',
    titleFontSize: 22,
    actions: ['Appearance', 'Catalog'],
    labelFontSize: 16,
    labelInset: 13,
    minTarget: 48,
    actionGap: 8,
    edgeInset: 16,
  };
}

describe('Material header: title beside text-button actions', () => {
  test('fits at font 1.0 on a 411dp phone, as the header is now', () => {
    assert.ok(headerFitsActions(library(411, 1)));
  });

  test('fits at font 1.0 on a 360dp phone', () => {
    assert.ok(headerFitsActions(library(360, 1)));
  });

  test('does not fit at font 2.0 on a 411dp phone', () => {
    assert.equal(headerFitsActions(library(411, 2)), false);
  });

  test('fits at font 2.0 on an 840dp window', () => {
    assert.ok(headerFitsActions(library(840, 2)));
  });

  test('the needed width grows with the font scale', () => {
    assert.ok(headerRowWidth(library(411, 1.5)) > headerRowWidth(library(411, 1)));
    assert.ok(headerRowWidth(library(411, 2)) > headerRowWidth(library(411, 1.5)));
  });

  test('a short label still takes the whole touch target', () => {
    const input = { ...library(411, 1), title: '', actions: ['A'], edgeInset: 0 };
    assert.equal(headerRowWidth(input), 48);
  });
});

// A Material tablet: the 80dp navigation rail beside the screen and the
// 360dp app-bar search (shrinking to 72dp) in the header before the buttons.
const search = { width: 360, minWidth: 72 };

function tablet(windowWidth: number, fontScale: number) {
  return { ...library(windowWidth, fontScale), railWidth: 80, search };
}

describe('Material tablet header: title beside the rail, app-bar search and buttons', () => {
  test('the header is the window less the rail', () => {
    assert.equal(headerWidth(tablet(720, 1)), 640);
  });

  test('does not fit at font 1.0 on a 720dp window with search and both buttons', () => {
    assert.equal(headerFitsActions(tablet(720, 1)), false);
  });

  test('fits at font 1.0 on a 720dp window without Appearance (Expo 8 added it)', () => {
    assert.ok(headerFitsActions({ ...tablet(720, 1), actions: ['Catalog'] }));
  });

  test('fits at font 1.0 on a 720dp window with the buttons moved below the header', () => {
    const moved = { ...tablet(720, 1), actions: [] };
    assert.ok(headerFitsActions(moved));
    assert.equal(headerSearchWidth(moved), 360);
  });

  test('fits everything at font 1.0 on a 1200dp window', () => {
    assert.ok(headerFitsActions(tablet(1200, 1)));
  });

  test('the search shrinks, not the title, when it alone leaves the title no room', () => {
    const moved = { ...tablet(600, 2), actions: [] };
    assert.equal(headerFitsActions(moved), false);
    const width = headerSearchWidth(moved);
    assert.ok(width < 360 && width >= 72);
    assert.ok(headerFitsActions({ ...moved, search: { width, minWidth: 72 } }));
  });

  test('the search never shrinks under its minimum', () => {
    const longTitle = { ...tablet(600, 2), actions: [], title: 'A title far too long for any header' };
    assert.equal(headerSearchWidth(longTitle), 72);
  });
});
