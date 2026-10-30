import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { ParagraphStyle } from 'berean-ffi-rn';

import { type CoreBlock, chapterBlocks, verseLabel } from './chapter-blocks.ts';

// The generated ParagraphStyle is a numeric enum (Prose, PoetryLine, ...
// from 0), which Node can't load; the mapping passes it through untouched.
const PROSE = 0 as ParagraphStyle;
const POETRY_LINE = 1 as ParagraphStyle;
const POETRY_CONTINUATION = 2 as ParagraphStyle;

const run = (verse: number, text: string, label?: string) => ({
  verse,
  label,
  text,
  footnotes: [],
  crossRefs: [],
});

describe('chapter blocks', () => {
  test('headings and paragraphs, in the core order', () => {
    const blocks: CoreBlock[] = [
      { tag: 'Heading', inner: { text: 'BOOK ONE' } },
      {
        tag: 'Paragraph',
        inner: { paragraph: 7, style: PROSE, runs: [run(1, 'In the beginning', '1'), run(2, 'Now')] },
      },
    ];
    assert.deepEqual(chapterBlocks(blocks), [
      { kind: 'heading', text: 'BOOK ONE' },
      {
        kind: 'paragraph',
        paragraph: 7,
        style: PROSE,
        runs: [
          { verse: 1, label: '1', text: 'In the beginning' },
          { verse: 2, text: 'Now' },
        ],
      },
    ]);
  });

  test('a verse split over lines of poetry keeps a run in each, labelled once', () => {
    const blocks: CoreBlock[] = [
      { tag: 'Paragraph', inner: { paragraph: 3, style: POETRY_LINE, runs: [run(4, 'first line', '4')] } },
      {
        tag: 'Paragraph',
        inner: { paragraph: 3, style: POETRY_CONTINUATION, runs: [run(4, 'second line')] },
      },
    ];
    assert.deepEqual(
      chapterBlocks(blocks).map((block) => (block.kind === 'paragraph' ? block.runs : [])),
      [[{ verse: 4, label: '4', text: 'first line' }], [{ verse: 4, text: 'second line' }]],
    );
  });

  test('the text and labels are the core strings as given', () => {
    const text = ' Reu′ben, Sim′e·on ';
    const [block] = chapterBlocks([
      { tag: 'Paragraph', inner: { paragraph: 1, style: PROSE, runs: [run(2, text, ' 2 ')] } },
    ]);
    assert.deepEqual(block, {
      kind: 'paragraph',
      paragraph: 1,
      style: PROSE,
      runs: [{ verse: 2, label: ' 2 ', text }],
    });
  });

  test('no blocks, no content', () => {
    assert.deepEqual(chapterBlocks([]), []);
  });
});

describe('verse labels', () => {
  test("the core's label", () => {
    assert.equal(verseLabel({ verse: 1, label: '1', text: '' }), '1');
    assert.equal(verseLabel({ verse: 1, label: '50', text: '' }), '50');
  });

  test('none without a label', () => {
    assert.equal(verseLabel({ verse: 4, text: '' }), undefined);
  });

  test('an empty label falls back to the verse number', () => {
    assert.equal(verseLabel({ verse: 12, label: '', text: '' }), '12');
  });
});
