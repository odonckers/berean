import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  cardAccessibilityLabel,
  cardCount,
  cardLevel,
  deleteWorkspacePrompt,
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
