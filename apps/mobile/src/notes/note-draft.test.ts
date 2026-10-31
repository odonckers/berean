import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { SAVE_DELAY_MS, isEmptyDraft, leaveStep, shouldSave } from './note-draft.ts';

const draft = (title: string, content: string) => ({ title, content });

describe('note draft', () => {
  test('saves about 800 ms after typing stops', () => {
    assert.equal(SAVE_DELAY_MS, 800);
  });

  test('empty: title and body blank, whitespace included', () => {
    assert.equal(isEmptyDraft(draft('', '')), true);
    assert.equal(isEmptyDraft(draft('  ', '\n\t ')), true);
    assert.equal(isEmptyDraft(draft('Light', '')), false);
    assert.equal(isEmptyDraft(draft('', '#grace')), false);
  });

  test('saves only a change', () => {
    const saved = draft('Light before law', 'The witness');
    assert.equal(shouldSave(draft('Light before law', 'The witness'), saved), false);
    assert.equal(shouldSave(draft('Light before law ', 'The witness'), saved), true);
    assert.equal(shouldSave(draft('Light before law', 'The witness is'), saved), true);
  });

  test('leaving: a fresh empty note goes, else a change saves', () => {
    const blank = draft('', '');
    assert.equal(leaveStep(blank, blank, true), 'remove');
    assert.equal(leaveStep(draft(' ', ''), draft('Light', ''), true), 'remove');
    assert.equal(leaveStep(draft('Light', ''), blank, true), 'save');
    assert.equal(leaveStep(draft('Light', ''), draft('Light', ''), true), 'none');
    // An existing note left empty is saved empty, not removed.
    assert.equal(leaveStep(blank, draft('Light', ''), false), 'save');
    assert.equal(leaveStep(blank, blank, false), 'none');
  });
});
