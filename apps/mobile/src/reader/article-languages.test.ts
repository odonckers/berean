import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { languageMatches, languageRowLabel, languageSections, vernacularLine } from './article-languages.ts';

const english = { mepsId: 0, code: 'E', name: 'English', vernacular: 'English' };
const french = { mepsId: 3, code: 'F', name: 'French', vernacular: 'Français' };
const german = { mepsId: 2, code: 'X', name: 'German', vernacular: 'Deutsch' };
const spanish = { mepsId: 1, code: 'S', name: 'Spanish', vernacular: 'español' };

// In the core's order: by English name.
const languages = [
  { language: english, publication: { pubKey: 'w26:0:20260800' }, installed: true },
  { language: french, publication: { pubKey: 'w26:3:20260800' }, installed: false },
  { language: german, publication: { pubKey: 'w26:2:20260800' }, installed: true },
  { language: spanish, publication: { pubKey: 'w26:1:20260800' }, installed: false },
];

const keys = (sections: ReturnType<typeof languageSections>) =>
  sections.map((s) => [s.key, s.title, s.data.map((d) => d.language.code)]);

describe('Article languages', () => {
  test('the language being read leads the device section, then the others, then downloads', () => {
    assert.deepEqual(keys(languageSections(languages, 'w26:2:20260800', '')), [
      ['device', 'On This Device', ['X', 'E']],
      ['download', 'Download', ['F', 'S']],
    ]);
  });

  test('search matches the English name, the own name or the code, without accents', () => {
    assert.deepEqual(keys(languageSections(languages, 'w26:0:20260800', 'espa')), [
      ['download', 'Download', ['S']],
    ]);
    assert.deepEqual(keys(languageSections(languages, 'w26:0:20260800', 'FRANCAIS')), [
      ['download', 'Download', ['F']],
    ]);
    assert.deepEqual(keys(languageSections(languages, 'w26:0:20260800', ' x ')), [
      ['device', 'On This Device', ['X']],
    ]);
    assert.deepEqual(languageSections(languages, 'w26:0:20260800', 'klingon'), []);
    assert.equal(languageMatches(german, ''), true);
    // A code matches only whole: "x" is German's code, and no name holds an x.
    assert.equal(languageMatches(german, 'x'), true);
    assert.equal(languageMatches(french, 'x'), false);
    assert.equal(languageMatches(german, 'ger'), true);
  });

  test('the own name shows when it differs from the English name', () => {
    assert.equal(vernacularLine(english), undefined);
    assert.equal(vernacularLine(spanish), 'español');
    assert.equal(vernacularLine({ ...english, vernacular: 'english' }), undefined);
  });

  test('screen reader labels say the state', () => {
    assert.equal(languageRowLabel(english, 'reading'), 'English, reading now');
    assert.equal(languageRowLabel(spanish, 'installed'), 'Spanish, español');
    assert.equal(languageRowLabel(spanish, 'download'), 'Spanish, español, not downloaded');
    assert.equal(languageRowLabel(french, 'downloading'), 'French, Français, downloading');
  });
});
