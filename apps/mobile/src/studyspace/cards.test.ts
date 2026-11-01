import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { colorSets, type ColorSetName, m3Roles } from '../design/colors.ts';
import { contrast } from '../design/contrast.ts';
import {
  cardAccessibilityLabel,
  cardCount,
  cardEdge,
  cardFill,
  cardLevel,
  cardText,
  deleteWorkspacePrompt,
  kindFill,
  LIGHT_CARD_SHADOW,
  pickWorkspace,
  titleScale,
  workspaceAnnouncement,
} from './cards.ts';

describe('wording', () => {
  test('announcement is the name and the card count', () => {
    assert.equal(workspaceAnnouncement('Workspace 2', 14), 'Workspace 2, 14 cards');
    assert.equal(workspaceAnnouncement('Romans', 1), 'Romans, 1 card');
    assert.equal(cardCount(0), '0 cards');
  });

  test('delete says the notes are kept', () => {
    const { title, message } = deleteWorkspacePrompt('Romans', 3);
    assert.equal(title, 'Delete “Romans”?');
    assert.match(message, /3 cards/);
    assert.match(message, /notes are kept/);
    assert.match(deleteWorkspacePrompt('Empty', 0).message, /no cards/);
  });

  test('card labels by type, then missing', () => {
    assert.equal(cardAccessibilityLabel('note', 'Hope in Romans 8', false), 'Note, Hope in Romans 8');
    assert.equal(cardAccessibilityLabel('publication', 'Romans 8', false), 'Romans 8, publication');
    assert.equal(cardAccessibilityLabel('passage', 'John 1:1–5', true), 'John 1:1–5, passage, missing');
  });
});

describe('pickWorkspace', () => {
  const list = [{ id: 1n }, { id: 2n }];

  test('the wanted one, else the first, else none', () => {
    assert.equal(pickWorkspace(list, 2n)?.id, 2n);
    assert.equal(pickWorkspace(list, 9n)?.id, 1n);
    assert.equal(pickWorkspace(list, undefined)?.id, 1n);
    assert.equal(pickWorkspace([], 1n), undefined);
  });
});

describe('levels (§5)', () => {
  test('by on-screen width at 17 pt', () => {
    assert.equal(cardLevel(26, 1), 1);
    assert.equal(cardLevel(48, 1), 2);
    assert.equal(cardLevel(159, 1), 2);
    assert.equal(cardLevel(160, 1), 3);
    assert.equal(cardLevel(320, 1), 4);
  });

  test('breakpoints scale with the text size', () => {
    assert.equal(cardLevel(90, 2), 1);
    assert.equal(cardLevel(300, 2), 2);
    assert.equal(cardLevel(640, 2), 4);
  });

  test('titles never shrink below 100%, grow with zoom above it', () => {
    assert.equal(titleScale(0.5), 2);
    assert.equal(titleScale(0.1) * 0.1, 1);
    assert.equal(titleScale(1), 1);
    assert.equal(titleScale(3), 1);
  });
});

describe('cardText (§5): only whole title lines', () => {
  // The iOS look's body (22 pt lines), caption (18 pt), 12 pt padding, 4 pt gap.
  const ios = { padding: 12, gap: 4, lineHeight: 22, captionLineHeight: 18 };
  const card = { width: 260, height: 180 };

  test('two lines at 100% and above, however far it zooms in', () => {
    // Above 100% the text and the card grow together, so the lines that fit don't change.
    assert.deepEqual(cardText(card, 1, 1, ios, false), { level: 3, titleLines: 2, caption: false });
    for (const zoom of [2, 4, 8]) assert.deepEqual(cardText(card, zoom, 1, ios, false), { level: 4, titleLines: 2, caption: false });
  });

  test('lines follow the on-screen height below 100%', () => {
    // 180 × 0.25 = 45 pt on screen, 21 after padding: not one 22 pt line.
    assert.deepEqual(cardText(card, 0.25, 1, ios, false), { level: 1, titleLines: 0, caption: false });
    // 180 × 0.3 = 54 pt, 30 after padding: one line, ellipsised.
    assert.deepEqual(cardText(card, 0.3, 1, ios, false), { level: 2, titleLines: 1, caption: false });
    // 180 × 0.4 = 72 pt, 48 after padding: two.
    assert.equal(cardText(card, 0.4, 1, ios, false).titleLines, 2);
  });

  test('a height of exactly n lines fits n', () => {
    assert.equal(cardText({ width: 200, height: 24 + 44 }, 1, 1, ios, false).titleLines, 2);
    assert.equal(cardText({ width: 200, height: 24 + 43.9 }, 1, 1, ios, false).titleLines, 1);
  });

  test('narrow cards are L1 whatever their height', () => {
    assert.equal(cardText({ width: 40, height: 400 }, 1, 1, ios, false).level, 1);
  });

  test('the font scale grows the lines it needs', () => {
    // 60 pt after padding: two 22 pt lines, one 44 pt line, none of 66.
    const tall = { width: 400, height: 84 };
    assert.equal(cardText(tall, 1, 1, { ...ios, lineHeight: 22 }, false).titleLines, 2);
    assert.equal(cardText(tall, 1, 2, { ...ios, lineHeight: 44 }, false).titleLines, 1);
    assert.equal(cardText(tall, 1, 3, { ...ios, lineHeight: 66 }, false).level, 1);
  });

  test('the missing caption takes a title line, never the last one', () => {
    // 60 after padding: 2 title lines, or 1 plus the caption's 4 + 18.
    assert.deepEqual(cardText({ width: 300, height: 84 }, 1, 1, ios, true), { level: 3, titleLines: 1, caption: true });
    // 30 after padding: one title line and no room for the caption.
    assert.deepEqual(cardText({ width: 300, height: 54 }, 1, 1, ios, true), { level: 3, titleLines: 1, caption: false });
    // 70 after padding: both title lines and the caption (44 + 4 + 18 = 66).
    assert.deepEqual(cardText({ width: 300, height: 94 }, 1, 1, ios, true), { level: 3, titleLines: 2, caption: true });
  });
});

// Every iOS-look colour set, and both Material modes on their scheme's canvas.
const looks = [
  ...(Object.keys(colorSets) as ColorSetName[]).map((name) => ({
    name: `iOS ${name}`,
    look: 'ios' as const,
    dark: name === 'dark',
    colors: colorSets[name],
    m3: m3Roles[name === 'dark' ? 'dark' : 'light'],
    outline: colorSets[name].outline,
    surface: colorSets[name].surface,
  })),
  ...(['light', 'dark'] as const).map((mode) => ({
    name: `Material ${mode}`,
    look: 'material' as const,
    dark: mode === 'dark',
    colors: colorSets[mode],
    m3: m3Roles[mode],
    outline: m3Roles[mode].outline,
    surface: m3Roles[mode].surface,
  })),
];

describe('card edges against the canvas (WCAG 1.4.11)', () => {
  for (const s of looks) {
    test(`${s.name}: the outline clears 3:1, light adds the shadow`, () => {
      const edge = cardEdge(s.dark, s.outline);
      assert.notEqual(s.colors.canvas.toUpperCase(), s.surface.toUpperCase());
      assert.equal(edge.border, s.outline);
      assert.equal(edge.shadow, s.dark ? undefined : LIGHT_CARD_SHADOW);
      assert.ok(contrast(edge.border, s.colors.canvas) >= 3, `${edge.border} on ${s.colors.canvas}`);
    });
  }

  test('the Material light card is the raised paper; dark keeps surfaceContainerLow', () => {
    assert.equal(cardFill('material', false, colorSets.light, m3Roles.light), '#FFFCF5');
    assert.equal(cardFill('material', true, colorSets.dark, m3Roles.dark), m3Roles.dark.surfaceContainerLow);
  });
});

describe('L1 blocks (§5)', () => {
  test('notes take the accent, the others the secondary ink', () => {
    const { colors, m3 } = looks[0];
    assert.deepEqual(kindFill('note', 'ios', colors, m3), { fill: colors.accent, ink: colors.onAccent });
    assert.deepEqual(kindFill('passage', 'material', colors, m3), { fill: m3.onSurfaceVariant, ink: m3.surface });
  });

  for (const s of looks) {
    for (const kind of ['note', 'passage', 'publication'] as const) {
      test(`${s.name} ${kind}: glyph and block both read at 3:1`, () => {
        const { fill, ink } = kindFill(kind, s.look, s.colors, s.m3);
        assert.ok(contrast(ink, fill) >= 3, `glyph ${ink} on ${fill}`);
        assert.ok(contrast(fill, s.colors.canvas) >= 3, `block ${fill} on ${s.colors.canvas}`);
      });
    }
  }
});
