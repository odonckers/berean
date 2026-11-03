import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  accentOptions,
  DEFAULT_CHOICE,
  mix,
  oppositeMode,
  parseChoice,
  resolveMode,
  resolvePalette,
  serializeChoice,
} from './appearance.ts';
import { contrast } from './contrast.ts';
import { THEME_IDS, THEME_MODES } from './theme-tokens.generated.ts';

describe('parseChoice', () => {
  test('nothing stored is Paper, slot 1, Automatic', () => {
    assert.deepEqual(DEFAULT_CHOICE, { theme: 'paper', accent: 1, appearance: 'automatic' });
    assert.deepEqual(parseChoice(undefined), DEFAULT_CHOICE);
  });

  test('reads a stored value', () => {
    assert.deepEqual(parseChoice({ version: 1, theme: 'sage', accent: 3, appearance: 'dark' }), {
      theme: 'sage',
      accent: 3,
      appearance: 'dark',
    });
  });

  test('what is not an object is the default', () => {
    for (const raw of [null, 'paper', 3, [], true]) assert.deepEqual(parseChoice(raw), DEFAULT_CHOICE);
  });

  test('each unknown or out-of-range field falls back on its own', () => {
    assert.deepEqual(parseChoice({ theme: 'mauve', accent: 2, appearance: 'light' }), {
      theme: 'paper',
      accent: 2,
      appearance: 'light',
    });
    for (const accent of [0, 7, 2.5, '2', null]) {
      assert.deepEqual(parseChoice({ theme: 'stone', accent, appearance: 'dark' }), {
        theme: 'stone',
        accent: 1,
        appearance: 'dark',
      });
    }
    assert.deepEqual(parseChoice({ theme: 'sepia', accent: 4, appearance: 'sepia' }), {
      theme: 'sepia',
      accent: 4,
      appearance: 'automatic',
    });
    assert.deepEqual(parseChoice({ version: 1 }), DEFAULT_CHOICE);
  });

  test('a "system" accent shows as slot 1', () => {
    assert.equal(parseChoice({ theme: 'paper', accent: 'system', appearance: 'automatic' }).accent, 1);
  });
});

describe('serializeChoice', () => {
  test('the berean.appearance shape, version 1', () => {
    assert.deepEqual(JSON.parse(serializeChoice({ theme: 'stone', accent: 5, appearance: 'light' })), {
      version: 1,
      theme: 'stone',
      accent: 5,
      appearance: 'light',
    });
  });

  test('round-trips through parseChoice', () => {
    const choice = { theme: 'sage', accent: 6, appearance: 'dark' } as const;
    assert.deepEqual(parseChoice(JSON.parse(serializeChoice(choice))), choice);
  });

  test('a stored "system" accent is kept until another accent is picked', () => {
    const stored = { version: 1, theme: 'paper', accent: 'system', appearance: 'automatic' };
    const themeChanged = JSON.parse(serializeChoice({ theme: 'sepia', accent: 1, appearance: 'automatic' }, stored));
    assert.equal(themeChanged.accent, 'system');
    assert.equal(themeChanged.theme, 'sepia');
    assert.equal(JSON.parse(serializeChoice({ ...DEFAULT_CHOICE, accent: 2 }, stored)).accent, 2);
  });
});

describe('resolveMode', () => {
  test('Automatic follows the system', () => {
    assert.equal(resolveMode('automatic', 'light', false), 'light');
    assert.equal(resolveMode('automatic', 'dark', false), 'dark');
    assert.equal(resolveMode('automatic', null, false), 'light');
    assert.equal(resolveMode('automatic', undefined, false), 'light');
  });

  test('Light and Dark ignore the system', () => {
    assert.equal(resolveMode('light', 'dark', false), 'light');
    assert.equal(resolveMode('dark', 'light', false), 'dark');
  });

  test('Increase Contrast picks the IC set of the mode', () => {
    assert.equal(resolveMode('automatic', 'dark', true), 'darkIC');
    assert.equal(resolveMode('automatic', 'light', true), 'lightIC');
    assert.equal(resolveMode('light', 'dark', true), 'lightIC');
    assert.equal(resolveMode('dark', 'light', true), 'darkIC');
  });

  test('the opposite mode keeps the contrast level', () => {
    assert.deepEqual(THEME_MODES.map(oppositeMode), ['dark', 'light', 'darkIC', 'lightIC']);
  });
});

describe('resolvePalette', () => {
  test("Paper light is today's shipped look", () => {
    const { colors, m3, studyPane } = resolvePalette(DEFAULT_CHOICE, 'light');
    assert.deepEqual(colors, {
      surface: '#FBF7EC',
      surfaceRaised: '#FFFCF5',
      text: '#1F1A14',
      textSecondary: '#5C544A',
      accent: '#9B3F2A',
      separator: '#E6DCC2',
      outline: '#8B8275', // §2.1: the accessibility fix
      linkUnderline: '#C9A493',
      destructive: '#D70015',
      onAccent: '#FFFCF5',
      canvas: '#F5EFE0',
      canvasDot: '#D9CDB0',
    });
    assert.equal(m3.primary, '#9B3F2A');
    assert.equal(m3.onPrimary, '#FFFFFF');
    assert.equal(m3.secondaryContainer, '#F1DCD1');
    assert.equal(m3.surfaceContainerHigh, '#EEE5D3');
    assert.equal(m3.outlineVariant, '#D2C5AA');
    assert.equal(m3.scrimWarm, 'rgba(31,26,20,0.45)');
    assert.deepEqual(studyPane, {
      materialRing: '#E0D4BC',
      materialFooter: '#EEE5D3',
      iosFooter: '#F5EFE0',
      segmentTrack: '#E6DCC2',
      segmentThumb: '#FFFCF5',
      segmentThumbEdge: undefined,
      segmentText: '#1F1A14',
    });
  });

  test("Paper dark is today's shipped look", () => {
    const { colors, m3, studyPane } = resolvePalette(DEFAULT_CHOICE, 'dark');
    assert.deepEqual(colors, {
      surface: '#15120E',
      surfaceRaised: '#211D18',
      text: '#EDE6D8',
      textSecondary: '#A39A8B',
      accent: '#E59A7C',
      separator: '#38312A',
      outline: '#7A7165',
      linkUnderline: '#734F40',
      destructive: '#FF453A',
      onAccent: '#211D18',
      canvas: '#0F0D0A',
      canvasDot: '#2E2822',
    });
    assert.equal(m3.primary, '#E59A7C');
    assert.equal(m3.onPrimary, '#3A140A');
    assert.equal(m3.surfaceContainerLow, '#1A1612');
    assert.equal(m3.onError, '#0C0905');
    assert.deepEqual(studyPane, {
      materialRing: '#4E443B',
      materialFooter: '#26211C',
      iosFooter: '#2A241F',
      segmentTrack: '#2A241F',
      segmentThumb: '#5C544A',
      segmentThumbEdge: undefined,
      segmentText: '#EDE6D8',
    });
  });

  test('switching theme keeps the slot: slot 3 is Fern in Paper and Lake in Sage', () => {
    const fern = accentOptions('paper', 'light')[2];
    const lake = accentOptions('sage', 'light')[2];
    assert.equal(fern.name, 'Fern');
    assert.equal(lake.name, 'Lake');
    assert.equal(resolvePalette({ ...DEFAULT_CHOICE, accent: 3 }, 'light').colors.accent, fern.hex);
    assert.equal(resolvePalette({ theme: 'sage', accent: 3, appearance: 'automatic' }, 'light').colors.accent, lake.hex);
  });

  test('the chosen accent replaces accent, onAccent and M3 primary and onPrimary', () => {
    for (const mode of THEME_MODES) {
      const ink = accentOptions('stone', mode)[3];
      const { colors, m3 } = resolvePalette({ theme: 'stone', accent: 4, appearance: 'automatic' }, mode);
      assert.equal(colors.accent, ink.hex);
      assert.equal(colors.onAccent, ink.onAccent);
      assert.equal(m3.primary, ink.hex);
      assert.equal(m3.onPrimary, ink.onAccent);
      assert.equal(m3.inversePrimary, accentOptions('stone', oppositeMode(mode))[3].hex);
    }
  });

  test('slot 1 keeps the theme M3 primary pair', () => {
    const { m3 } = resolvePalette({ ...DEFAULT_CHOICE, theme: 'sepia' }, 'dark');
    assert.equal(m3.primary, accentOptions('sepia', 'dark')[0].hex);
  });

  test('highlights come from the theme, in the display order', () => {
    const { highlights } = resolvePalette(DEFAULT_CHOICE, 'light');
    assert.deepEqual(Object.keys(highlights), ['yellow', 'green', 'blue', 'pink', 'purple', 'orange']);
    assert.equal(highlights.yellow, '#FCEDA0');
    assert.equal(highlights.orange, '#D49E75');
  });

  test('mix moves along each channel', () => {
    assert.equal(mix('#000000', '#FFFFFF', 0.5), '#808080');
    assert.equal(mix('#FBF7EC', '#EEE5D3', 0), '#FBF7EC');
    assert.equal(mix('#0F0D0A', '#38312A', 0.75), '#2E2822');
  });
});

// The roles tokens.json doesn't define, derived for every theme and set.
describe('derived canvas and study pane colors stay visible', () => {
  for (const theme of THEME_IDS) {
    for (const mode of THEME_MODES) {
      const { colors, m3, studyPane } = resolvePalette({ ...DEFAULT_CHOICE, theme }, mode);
      const at = (fg: string, bg: string) => `${fg} on ${bg}: ${contrast(fg, bg).toFixed(2)}`;

      test(`${theme} ${mode}: the canvas is a step off the page; its dots at 1.3:1 (Paper ships 1.33)`, () => {
        assert.notEqual(colors.canvas, colors.surface);
        assert.ok(contrast(colors.canvasDot, colors.canvas) >= 1.3, at(colors.canvasDot, colors.canvas));
        assert.ok(contrast(colors.outline, colors.canvas) >= 3, at(colors.outline, colors.canvas));
      });

      test(`${theme} ${mode}: the Material pane ring at 1.2:1 on the page and the pane (Paper ships 1.25)`, () => {
        assert.ok(contrast(studyPane.materialRing, m3.surface) >= 1.2, at(studyPane.materialRing, m3.surface));
        assert.ok(
          contrast(studyPane.materialRing, m3.surfaceContainer) >= 1.2,
          at(studyPane.materialRing, m3.surfaceContainer),
        );
      });

      test(`${theme} ${mode}: the segment thumb at 1.3:1 on its track (Paper ships 1.33), or edged at 4.5:1 in IC; its text at 4.5:1`, () => {
        const { segmentThumb, segmentTrack, segmentText, segmentThumbEdge } = studyPane;
        if (segmentThumbEdge) {
          // Increase Contrast: the 1px outline edge, not the fill, marks the thumb (rule 5, rule 12's IC border floor).
          assert.ok(contrast(segmentThumbEdge, segmentTrack) >= 4.5, at(segmentThumbEdge, segmentTrack));
          assert.ok(contrast(segmentThumbEdge, segmentThumb) >= 4.5, at(segmentThumbEdge, segmentThumb));
        } else {
          assert.ok(contrast(segmentThumb, segmentTrack) >= 1.3, at(segmentThumb, segmentTrack));
        }
        assert.ok(contrast(segmentText, segmentTrack) >= 4.5, at(segmentText, segmentTrack));
        assert.ok(contrast(segmentText, segmentThumb) >= 4.5, at(segmentText, segmentThumb));
      });

      test(`${theme} ${mode}: the segment label at 4.5:1 on thumb and track, 7:1 under Increase Contrast`, () => {
        const ic = mode === 'lightIC' || mode === 'darkIC';
        const floor = ic ? 7 : 4.5;
        const { segmentThumb, segmentTrack, segmentText, segmentThumbEdge } = studyPane;
        assert.ok(contrast(segmentText, segmentThumb) >= floor, at(segmentText, segmentThumb));
        assert.ok(contrast(segmentText, segmentTrack) >= floor, at(segmentText, segmentTrack));
        // Rule 5: the IC thumb is edged 1px in outline; the standard thumb has no edge.
        assert.equal(segmentThumbEdge, ic ? colors.outline : undefined);
      });

      test(`${theme} ${mode}: the iOS footer a 1.05:1 step off the raised pane (Paper ships 1.09)`, () => {
        assert.ok(contrast(studyPane.iosFooter, colors.surfaceRaised) >= 1.05, at(studyPane.iosFooter, colors.surfaceRaised));
        assert.ok(contrast(colors.text, studyPane.iosFooter) >= 4.5, at(colors.text, studyPane.iosFooter));
      });
    }
  }
});
