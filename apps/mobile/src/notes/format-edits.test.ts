import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { applyFormat, insertLink, referenceCandidates, replaceRange } from './format-edits.ts';

const at = (text: string, start: number, end = start) => ({ text, selection: { start, end } });

describe('wrapping actions', () => {
  test('bold wraps the selection in ** and keeps it selected', () => {
    assert.deepEqual(applyFormat(at('see light here', 4, 9), 'bold'), at('see **light** here', 6, 11));
  });

  test('bold at a cursor puts **** with the cursor between', () => {
    assert.deepEqual(applyFormat(at('ab', 1), 'bold'), at('a****b', 3));
    assert.deepEqual(applyFormat(at('', 0), 'bold'), at('****', 2));
  });

  test('italic wraps in *', () => {
    assert.deepEqual(applyFormat(at('see light', 4, 9), 'italic'), at('see *light*', 5, 10));
    assert.deepEqual(applyFormat(at('', 0), 'italic'), at('**', 1));
  });

  test('a backwards or out of range selection is taken in order and clamped', () => {
    assert.deepEqual(applyFormat(at('light', 5, 0), 'bold'), at('**light**', 2, 7));
    assert.deepEqual(applyFormat(at('light', 2, 99), 'italic'), at('li*ght*', 3, 6));
  });

  test('wraps across lines as one run', () => {
    assert.deepEqual(applyFormat(at('a\nb', 0, 3), 'bold'), at('**a\nb**', 2, 5));
  });
});

describe('line actions', () => {
  test('heading, list, checklist and quote prefix the cursor line', () => {
    assert.deepEqual(applyFormat(at('one\ntwo', 5), 'heading'), at('one\n# two', 7));
    assert.deepEqual(applyFormat(at('one\ntwo', 5), 'list'), at('one\n- two', 7));
    assert.deepEqual(applyFormat(at('one\ntwo', 5), 'checklist'), at('one\n- [ ] two', 11));
    assert.deepEqual(applyFormat(at('one\ntwo', 5), 'quote'), at('one\n> two', 7));
  });

  test('a cursor at the line start moves past the prefix', () => {
    assert.deepEqual(applyFormat(at('one\ntwo', 4), 'list'), at('one\n- two', 6));
    assert.deepEqual(applyFormat(at('one', 0), 'heading'), at('# one', 2));
  });

  test('empty text gets the prefix', () => {
    assert.deepEqual(applyFormat(at('', 0), 'heading'), at('# ', 2));
    assert.deepEqual(applyFormat(at('', 0), 'checklist'), at('- [ ] ', 6));
  });

  test('every touched line of a multi-line selection, the selection kept over them', () => {
    assert.deepEqual(applyFormat(at('a\nb\nc', 0, 5), 'list'), at('- a\n- b\n- c', 2, 11));
    assert.deepEqual(applyFormat(at('xa\nb', 1, 4), 'quote'), at('> xa\n> b', 3, 8));
  });

  test('a selection ending at a line start leaves that line alone', () => {
    assert.deepEqual(applyFormat(at('a\nb', 0, 2), 'list'), at('- a\nb', 2, 4));
  });

  test('blank lines inside a selection stay blank', () => {
    assert.deepEqual(applyFormat(at('a\n\nb', 0, 4), 'quote'), at('> a\n\n> b', 2, 8));
  });

  test('only inserts: a line already a heading gets another marker', () => {
    assert.deepEqual(applyFormat(at('# a', 3), 'heading'), at('# # a', 5));
  });
});

describe('tag', () => {
  test('inserts # at the cursor, after whitespace or the start', () => {
    assert.deepEqual(applyFormat(at('', 0), 'tag'), at('#', 1));
    assert.deepEqual(applyFormat(at('see ', 4), 'tag'), at('see #', 5));
    assert.deepEqual(applyFormat(at('a\n', 2), 'tag'), at('a\n#', 3));
  });

  test('adds a space after other text', () => {
    assert.deepEqual(applyFormat(at('see', 3), 'tag'), at('see #', 5));
  });

  test('before a selection, keeping it selected', () => {
    assert.deepEqual(applyFormat(at('see grace', 4, 9), 'tag'), at('see #grace', 5, 10));
  });
});

describe('link', () => {
  test('a known target replaces the selection, the cursor after it', () => {
    const link = { text: 'John 1:14', url: 'berean://example' };
    const text = 'see John 1:14 now';
    assert.deepEqual(insertLink(at(text, 4, 13), link), at('see [John 1:14](berean://example) now', 33));
  });

  test('without a target wraps as [sel]() with the cursor in the parentheses', () => {
    assert.deepEqual(insertLink(at('see light', 4, 9)), at('see [light]()', 12));
    assert.deepEqual(insertLink(at('', 0)), at('[]()', 3));
  });
});

describe('replaceRange', () => {
  test('puts the cursor after the inserted text', () => {
    assert.deepEqual(replaceRange(at('see John 1:14', 13), { start: 4, end: 13 }, '[J](u)'), at('see [J](u)', 10));
  });
});

describe('referenceCandidates', () => {
  test('trailing runs of words before the cursor, longest first', () => {
    assert.deepEqual(referenceCandidates('see 1 John 1:14', 15, 4), [
      'see 1 John 1:14',
      '1 John 1:14',
      'John 1:14',
      '1:14',
    ]);
  });

  test('at most maxWords words', () => {
    assert.deepEqual(referenceCandidates('read see 1 John 1:14', 20, 3), ['1 John 1:14', 'John 1:14', '1:14']);
    assert.deepEqual(referenceCandidates('John 1:14', 9, 0), []);
  });

  test('ends at the cursor and stays on its line', () => {
    assert.deepEqual(referenceCandidates('Gen 1:1\nJohn 1:14 and', 17, 4), ['John 1:14', '1:14']);
  });

  test('keeps the text as written between words', () => {
    assert.deepEqual(referenceCandidates('a  John\t1:14', 12, 2), ['John\t1:14', '1:14']);
  });

  test('none after whitespace, at the start or past the text', () => {
    assert.deepEqual(referenceCandidates('John 1:14 ', 10, 4), []);
    assert.deepEqual(referenceCandidates('John\n', 5, 4), []);
    assert.deepEqual(referenceCandidates('John', 0, 4), []);
    assert.deepEqual(referenceCandidates('', 0, 4), []);
    assert.deepEqual(referenceCandidates('John', 9, 4), []);
  });
});
