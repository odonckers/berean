import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { ParagraphStyle } from 'berean-ffi-rn';

import {
  type Block,
  type CoreBlock,
  type Run,
  blockSegments,
  chapterBlocks,
  lineAt,
  numberBlock,
  numberOffset,
  numberSpan,
  numberedVerses,
  paneSplit,
  verseLabel,
  withoutBookTitle,
} from './chapter-blocks.ts';

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

  test('a note run has no number, even with a label', () => {
    assert.equal(verseLabel({ verse: 0, label: '*', text: 'A note' }), undefined);
    assert.equal(verseLabel({ verse: 0, label: '', text: 'A note' }), undefined);
  });
});

describe('block segments', () => {
  test('a space between consecutive runs, none before the first; a number holds its own', () => {
    assert.deepEqual(
      blockSegments([
        { verse: 1, label: '1', text: 'In the beginning' },
        { verse: 2, label: '2', text: 'Now the earth' },
        { verse: 2, text: 'was formless' },
      ]),
      [
        { kind: 'number', verse: 1, label: '1', separated: false },
        { kind: 'text', verse: 1, text: 'In the beginning' },
        { kind: 'number', verse: 2, label: '2', separated: true },
        { kind: 'text', verse: 2, text: 'Now the earth' },
        { kind: 'space' },
        { kind: 'text', verse: 2, text: 'was formless' },
      ],
    );
  });

  test('a note run is a note, spaced like any run, with no number', () => {
    assert.deepEqual(
      blockSegments([
        { verse: 0, label: '0', text: 'To the director.' },
        { verse: 1, label: '1', text: 'Hear' },
        { verse: 0, text: 'Selah' },
      ]),
      [
        { kind: 'note', text: 'To the director.' },
        { kind: 'number', verse: 1, label: '1', separated: true },
        { kind: 'text', verse: 1, text: 'Hear' },
        { kind: 'space' },
        { kind: 'note', text: 'Selah' },
      ],
    );
  });

  test('none for no runs', () => {
    assert.deepEqual(blockSegments([]), []);
  });

  test("a number's span: narrow no-break pads, a no-break space after", () => {
    assert.deepEqual(numberSpan('12', true), {
      separator: ' ',
      pad: String.fromCharCode(0x202f),
      label: '12',
      trailing: String.fromCharCode(0xa0),
    });
    assert.equal(numberSpan('1', false).separator, '');
  });
});

describe('verses and the pane split', () => {
  const blocks: Block[] = [
    { kind: 'heading', text: 'Heading' },
    {
      kind: 'paragraph',
      paragraph: 1,
      style: PROSE,
      runs: [
        { verse: 0, label: '0', text: 'A note' },
        { verse: 1, label: '1', text: 'one' },
        { verse: 2, label: '2', text: 'two' },
      ],
    },
    {
      kind: 'paragraph',
      paragraph: 2,
      style: POETRY_LINE,
      runs: [
        { verse: 2, text: 'two, again' },
        { verse: 0, text: 'Selah' },
        { verse: 3, label: '3', text: 'three' },
      ],
    },
  ];

  test('numbered verses leave out notes and later parts', () => {
    assert.deepEqual(numberedVerses(blocks[1].kind === 'paragraph' ? blocks[1].runs : []), [1, 2]);
    assert.deepEqual(numberedVerses(blocks[2].kind === 'paragraph' ? blocks[2].runs : []), [3]);
  });

  test("the pane goes after the verse's last part", () => {
    assert.deepEqual(paneSplit(blocks, 1), { block: 1, run: 1 });
    assert.deepEqual(paneSplit(blocks, 2), { block: 2, run: 0 });
    assert.deepEqual(paneSplit(blocks, 3), { block: 2, run: 2 });
  });

  test('a note is never a verse to split at', () => {
    assert.equal(paneSplit(blocks, 0), undefined);
    assert.equal(paneSplit(blocks, undefined), undefined);
    assert.equal(paneSplit(blocks, 9), undefined);
  });

  test("focus returns to the block with the verse's number", () => {
    assert.equal(numberBlock(blocks, 2), 1);
    assert.equal(numberBlock(blocks, 3), 2);
    assert.equal(numberBlock(blocks, 0), -1);
  });
});

describe("the core's book title (temporary, until the core tags it)", () => {
  const title: Block = { kind: 'heading', text: 'EXODUS' };
  const verse: Block = {
    kind: 'paragraph',
    paragraph: 1,
    style: PROSE,
    runs: [{ verse: 1, label: '1', text: 'Now' }],
  };

  test('chapter 1 drops a first heading naming the book, ignoring case', () => {
    assert.deepEqual(withoutBookTitle([title, verse], 1, 'Exodus'), [verse]);
    assert.deepEqual(
      withoutBookTitle([{ kind: 'heading', text: '1 samuel' }, verse], 1, '1 Samuel'),
      [verse],
    );
  });

  test('every other heading stays', () => {
    const division: Block = { kind: 'heading', text: 'BOOK ONE' };
    assert.deepEqual(withoutBookTitle([division, verse], 1, 'Psalms'), [division, verse]);
    assert.deepEqual(withoutBookTitle([title, verse], 2, 'Exodus'), [title, verse]);
    assert.deepEqual(withoutBookTitle([verse, title], 1, 'Exodus'), [verse, title]);
    assert.deepEqual(withoutBookTitle([title, verse], 1, undefined), [title, verse]);
    assert.deepEqual(withoutBookTitle([title, title, verse], 1, 'Exodus'), [title, verse]);
    assert.deepEqual(withoutBookTitle([], 1, 'Exodus'), []);
  });
});

describe("where a verse's number is in its block", () => {
  const runs: Run[] = [
    { verse: 1, label: '1', text: 'In the beginning' },
    { verse: 0, text: 'note' },
    { verse: 2, label: '2', text: 'Now' },
    { verse: 3, label: '10', text: 'the earth' },
  ];
  // The block's text as drawn: its segments, each number with its whole span.
  const drawn = blockSegments(runs)
    .map((segment) => {
      if (segment.kind === 'space') return ' ';
      if (segment.kind !== 'number') return segment.text;
      const span = numberSpan(segment.label, segment.separated);
      return span.separator + span.pad + span.label + span.pad + span.trailing;
    })
    .join('');
  const pad = numberSpan('1', false).pad;

  test('the offset of its fill, after the separator', () => {
    assert.equal(numberOffset(runs, 1), 0);
    for (const [verse, label] of [
      [2, '2'],
      [3, '10'],
    ] as const) {
      const offset = numberOffset(runs, verse);
      assert.ok(offset !== undefined);
      assert.equal(drawn.slice(offset, offset + pad.length + label.length), pad + label);
      assert.equal(drawn[offset - 1], ' ');
    }
  });

  test('none for a verse the block does not number', () => {
    assert.equal(numberOffset(runs, 0), undefined);
    assert.equal(numberOffset([{ verse: 4, text: 'later part' }], 4), undefined);
    assert.equal(numberOffset(runs, 9), undefined);
  });

  test('the line holding an offset', () => {
    const lines = [{ text: 'abc ' }, { text: 'def ' }, { text: 'gh' }];
    assert.equal(lineAt(lines, 0), 0);
    assert.equal(lineAt(lines, 3), 0);
    assert.equal(lineAt(lines, 4), 1);
    assert.equal(lineAt(lines, 9), 2);
    assert.equal(lineAt(lines, 99), 2);
    assert.equal(lineAt([], 0), -1);
  });
});
