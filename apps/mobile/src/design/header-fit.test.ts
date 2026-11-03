import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { headerFitsActions, type HeaderFitInput, headerRowWidth } from './header-fit.ts';

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
