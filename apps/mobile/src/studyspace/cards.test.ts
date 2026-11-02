import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { colorSets, type ColorSetName, m3Roles } from '../design/colors.ts';
import { contrast } from '../design/contrast.ts';
import {
  addedAnnouncement,
  cardAccessibilityLabel,
  cardCount,
  cardEdge,
  cardFill,
  cardLevel,
  cardText,
  deleteWorkspacePrompt,
  kindFill,
  LIGHT_CARD_SHADOW,
  isFront,
  pickWorkspace,
  readerText,
  titleScale,
  toFront,
  touchScrolls,
  workspaceAnnouncement,
} from './cards.ts';

describe('wording', () => {
  test('announcement is the name and the card count', () => {
    assert.equal(workspaceAnnouncement('Workspace 2', 14), 'Workspace 2, 14 cards');
    assert.equal(workspaceAnnouncement('Romans', 1), 'Romans, 1 card');
    assert.equal(cardCount(0), '0 cards');
  });

  test('an add names the item and the workspace (§7.2)', () => {
    assert.equal(addedAnnouncement('Romans 8', 'Workspace 2'), 'Added Romans 8 to Workspace 2');
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

  test('the remembered workspace when it is still there', () => {
    assert.equal(pickWorkspace(list, 2n)?.id, 2n);
  });

  test('the first when the remembered one is gone (deleted, or imported over)', () => {
    assert.equal(pickWorkspace(list, 9n)?.id, 1n);
  });

  test('the first when none is remembered', () => {
    assert.equal(pickWorkspace(list, undefined)?.id, 1n);
  });

  test('none when there are no workspaces', () => {
    assert.equal(pickWorkspace([], 1n), undefined);
    assert.equal(pickWorkspace([], undefined), undefined);
  });
});

describe('z-order', () => {
  const cards = [{ id: 1n }, { id: 2n }, { id: 3n }];

  test('the last card (back to front) is already in front: no write', () => {
    assert.equal(isFront(cards, 3n), true);
    assert.equal(isFront(cards, 1n), false);
    assert.equal(isFront([], 1n), false);
  });

  test('brought to the front, a card draws last', () => {
    assert.deepEqual(
      toFront(cards, 1n).map((c) => c.id),
      [2n, 3n, 1n],
    );
    assert.deepEqual(
      toFront(cards, 3n).map((c) => c.id),
      [1n, 2n, 3n],
    );
    assert.deepEqual(
      toFront(cards, 9n).map((c) => c.id),
      [1n, 2n, 3n],
    );
    assert.equal(isFront(toFront(cards, 2n), 2n), true);
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

describe('readerText (§5, §6.3): body text at the reader size × zoom, never under 11 pt', () => {
  // As cardText's, plus the reading serif: 17 pt on 25.5 pt lines.
  const ios = { padding: 12, gap: 4, lineHeight: 22, captionLineHeight: 18, bodySize: 17, bodyLineHeight: 25.5 };
  const reader = { width: 634, height: 568 };
  const small = { width: 300, height: 200 };

  test('a default reader card at 100% is live (L4), as many lines as fit under one title line', () => {
    // 568 − 24 padding − 22 title − 4 gap = 518: 20 lines of 25.5.
    assert.deepEqual(readerText(reader, 1, 1, ios, false), {
      level: 4,
      titleLines: 1,
      caption: false,
      bodyLines: 20,
      bodyScale: 1,
    });
  });

  test('L3 shows up to 3 lines', () => {
    assert.deepEqual(readerText(small, 1, 1, ios, false), {
      level: 3,
      titleLines: 1,
      caption: false,
      bodyLines: 3,
      bodyScale: 1,
    });
  });

  test('below 100% the body scales with the zoom', () => {
    // 210 pt wide: L3, body 11.9 pt on screen.
    const t = readerText(small, 0.7, 1, ios, false);
    assert.equal(t.level, 3);
    assert.equal(t.bodyScale, 0.7);
    assert.equal(t.bodyLines, 3);
  });

  test('under the floor, the card drops to title only (frame 01, panel 6: 60%)', () => {
    // 380 pt wide is L4 by width, but 17 × 0.6 = 10.2 pt < 11.
    assert.deepEqual(readerText(reader, 0.6, 1, ios, false), {
      level: 2,
      titleLines: 2,
      caption: false,
      bodyLines: 0,
      bodyScale: 0.6,
    });
    assert.equal(readerText(reader, 0.65, 1, ios, false).level, 4);
    assert.equal(readerText(reader, 0.64, 1, ios, false).level, 2);
  });

  test('the floor and breakpoints scale with the font scale', () => {
    // At 2× text L4 starts at 640 pt, so 634 pt is L3; 11 × 2 floor against 17 × 2 body.
    const big = { ...ios, lineHeight: 44, bodyLineHeight: 51 };
    assert.equal(readerText(reader, 1, 2, big, false).level, 3);
    assert.equal(readerText(reader, 0.64, 2, big, false).level, 2);
  });

  test('no room for one body line: title only', () => {
    assert.deepEqual(readerText({ width: 300, height: 60 }, 1, 1, ios, false), {
      level: 2,
      titleLines: 1,
      caption: false,
      bodyLines: 0,
      bodyScale: 1,
    });
  });

  test('a missing card never draws text', () => {
    const t = readerText(reader, 1, 1, ios, true);
    assert.equal(t.level, 2);
    assert.equal(t.caption, true);
    assert.equal(t.bodyLines, 0);
  });

  test('L1 and L2 are cardText’s', () => {
    assert.equal(readerText({ width: 40, height: 400 }, 1, 1, ios, false).level, 1);
    assert.equal(readerText({ width: 100, height: 400 }, 1, 1, ios, false).level, 2);
  });
});

describe('touchScrolls (§6.1): one finger scrolls a live reader card, else pans', () => {
  test('only a passage or publication card at L4', () => {
    assert.equal(touchScrolls('passage', 4), true);
    assert.equal(touchScrolls('publication', 4), true);
    assert.equal(touchScrolls('publication', 3), false);
    assert.equal(touchScrolls('note', 4), false);
  });

  test('at least 320 pt × font scale on screen, with body over the floor', () => {
    const ios = { padding: 12, gap: 4, lineHeight: 22, captionLineHeight: 18, bodySize: 17, bodyLineHeight: 25.5 };
    const level = (width: number, zoom: number, fontScale: number) =>
      readerText({ width, height: 568 }, zoom, fontScale, ios, false).level;
    assert.equal(touchScrolls('passage', level(320, 1, 1)), true);
    assert.equal(touchScrolls('passage', level(319, 1, 1)), false);
    assert.equal(touchScrolls('passage', level(639, 1, 2)), false);
    assert.equal(touchScrolls('passage', level(800, 0.6, 1)), false);
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
