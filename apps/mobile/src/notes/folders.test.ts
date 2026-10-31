import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  type FolderLike,
  childFolders,
  deleteFolderPrompt,
  folderAccessibilityLabel,
  folderCounts,
  folderMoveTargets,
  folderName,
  folderPath,
  folderTrail,
  moveTargetLabel,
  noteMetaLine,
  noteMoveTargets,
} from './folders.ts';

// The guide's sample tree, flat in tree order as folders() lists it.
const folder = (
  id: number,
  name: string,
  depth: number,
  noteCount: number,
  subfolderCount = 0,
  parentId?: number,
): FolderLike => ({
  id: BigInt(id),
  ...(parentId === undefined ? {} : { parentId: BigInt(parentId) }),
  name,
  depth,
  noteCount,
  subfolderCount,
});
const tree: FolderLike[] = [
  folder(1, 'Gospel of John', 0, 14, 3),
  folder(2, 'Prologue', 1, 6, 0, 1),
  folder(3, 'Signs', 1, 5, 1, 1),
  folder(8, 'Water to wine', 2, 1, 0, 3),
  folder(4, 'Witnesses', 1, 3, 0, 1),
  folder(5, 'Psalms', 0, 4),
  folder(6, 'Sermon prep', 0, 5),
  folder(7, 'Word studies', 0, 1),
];
const names = (fs: readonly { name: string }[]) => fs.map((f) => f.name);

describe('drill-in', () => {
  test('the top level, in tree order', () => {
    assert.deepEqual(names(childFolders(tree)), ['Gospel of John', 'Psalms', 'Sermon prep', 'Word studies']);
  });

  test("a folder's direct subfolders only", () => {
    assert.deepEqual(names(childFolders(tree, 1n)), ['Prologue', 'Signs', 'Witnesses']);
    assert.deepEqual(names(childFolders(tree, 3n)), ['Water to wine']);
    assert.deepEqual(childFolders(tree, 5n), []);
  });

  test('a path runs from the top level down', () => {
    assert.deepEqual(names(folderPath(tree, 8n)), ['Gospel of John', 'Signs', 'Water to wine']);
    assert.deepEqual(folderPath(tree, 99n), []);
    assert.deepEqual(folderPath(tree, undefined), []);
  });

  test('a cyclic list stops instead of looping', () => {
    const cyclic = [folder(1, 'A', 1, 0, 0, 2), folder(2, 'B', 1, 0, 0, 1)];
    assert.ok(folderPath(cyclic, 1n).length <= 2);
  });
});

describe('labels', () => {
  test('trail and metadata line', () => {
    assert.equal(folderTrail(tree, 2n), 'Gospel of John › Prologue');
    assert.equal(folderTrail(tree, undefined), '');
    assert.equal(noteMetaLine('Gospel of John › Prologue', 'Oct 28'), 'Gospel of John › Prologue · Oct 28');
    assert.equal(noteMetaLine('', 'Oct 28'), 'Oct 28');
  });

  test('counts show subfolders only when there are some', () => {
    assert.equal(folderCounts(tree[0]), '3 · 14');
    assert.equal(folderCounts(tree[5]), '4');
  });

  test('accessibility labels read the counts in words', () => {
    assert.equal(folderAccessibilityLabel(tree[0]), 'Gospel of John, 3 subfolders, 14 notes');
    assert.equal(folderAccessibilityLabel(tree[2]), 'Signs, 1 subfolder, 5 notes');
    assert.equal(folderAccessibilityLabel(tree[7]), 'Word studies, 1 note');
    assert.equal(folderAccessibilityLabel(folder(9, 'Empty', 0, 0)), 'Empty, 0 notes');
  });

  test('delete confirmation names what happens to notes and subfolders', () => {
    assert.deepEqual(deleteFolderPrompt(tree[6]), {
      title: 'Delete “Sermon prep”?',
      message: 'Its 5 notes become unfiled.',
    });
    assert.equal(
      deleteFolderPrompt(tree[0]).message,
      'Its 3 subfolders are deleted too. Its 14 notes become unfiled.',
    );
    assert.equal(deleteFolderPrompt(tree[2]).message, 'Its subfolder is deleted too. Its 5 notes become unfiled.');
    assert.equal(deleteFolderPrompt(tree[7]).message, 'Its note becomes unfiled.');
    assert.equal(deleteFolderPrompt(folder(9, 'Empty', 0, 0)).message, 'It has no notes.');
  });

  test('folder names are trimmed; blank is none', () => {
    assert.equal(folderName('  Signs '), 'Signs');
    assert.equal(folderName('   '), undefined);
  });
});

describe('Move to…', () => {
  test('a folder never moves into itself or its subfolders', () => {
    const targets = folderMoveTargets(tree, 3n);
    assert.deepEqual(names(targets), [
      'Top level',
      'Gospel of John',
      'Prologue',
      'Witnesses',
      'Psalms',
      'Sermon prep',
      'Word studies',
    ]);
    assert.deepEqual(
      targets.filter((t) => t.current).map((t) => t.name),
      ['Gospel of John'],
    );
    // Indented one step under Top level.
    assert.equal(targets[2].depth, 2);
  });

  test('a top-level folder is currently at the top level', () => {
    const targets = folderMoveTargets(tree, 5n);
    assert.equal(targets[0].current, true);
    assert.ok(!names(targets).includes('Psalms'));
  });

  test('a note can go to any folder or none', () => {
    const targets = noteMoveTargets(tree, 2n);
    assert.equal(targets.length, tree.length + 1);
    assert.equal(targets[0].name, 'No folder');
    assert.deepEqual(
      targets.filter((t) => t.current).map((t) => t.name),
      ['Prologue'],
    );
    assert.equal(noteMoveTargets(tree, undefined)[0].current, true);
  });

  test('target labels name the parents', () => {
    const targets = noteMoveTargets(tree, 8n);
    const wine = targets.find((t) => t.name === 'Water to wine')!;
    assert.equal(moveTargetLabel(wine, tree), 'Water to wine, in Gospel of John, Signs, current');
    assert.equal(moveTargetLabel(targets[0], tree), 'No folder');
  });
});
