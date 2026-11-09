import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { blockSegments, type CoreBlock } from '../reader/chapter-blocks.ts';
import {
  MOVED_CAPTION,
  MOVED_NOTE,
  anchorTexts,
  bibleRows,
  type CoreDocBlock,
  docText,
  documentRows,
  positionAt,
  readerAt,
  readerLocation,
  readerTarget,
  restorePosition,
  type Row,
  rowPositionAt,
  scrollYFor,
  showsMovedCaption,
  snippetParts,
} from './reader-state.ts';

const NBSP = String.fromCharCode(0xa0);
const text = (r: Row) => r.parts.map((p) => p.text).join('');

// Romans 8-ish: a heading, verses 1–2 in one paragraph, verse 3 split over two.
const chapter: CoreBlock[] = [
  { tag: 'Heading', inner: { text: 'Life in the Spirit' } },
  {
    tag: 'Paragraph',
    inner: {
      paragraph: 1,
      style: 'Prose' as never,
      runs: [
        { verse: 1, label: '1', text: 'No condemnation.' },
        { verse: 2, label: '2', text: 'For the law.' },
      ],
    },
  },
  {
    tag: 'Paragraph',
    inner: { paragraph: 2, style: 'Prose' as never, runs: [{ verse: 3, label: '3', text: 'What the law' }] },
  },
  {
    tag: 'Paragraph',
    inner: { paragraph: 3, style: 'Prose' as never, runs: [{ verse: 3, text: 'could not do.' }] },
  },
];
const rows = bibleRows(chapter, blockSegments);

describe('bibleRows', () => {
  test('numbers, spaces and verse text as the reader draws them', () => {
    assert.equal(rows.length, 4);
    assert.equal(rows[0].heading, true);
    assert.deepEqual(rows[0].pieces, []);
    assert.equal(text(rows[1]), `1${NBSP}No condemnation. 2${NBSP}For the law.`);
    assert.deepEqual(rows[1].pieces, [
      { key: 1, start: 2, length: 16 },
      { key: 2, start: 21, length: 12 },
    ]);
    assert.equal(rows[1].length, text(rows[1]).length);
  });

  test('a verse’s later part has no number', () => {
    assert.equal(text(rows[3]), 'could not do.');
    assert.deepEqual(rows[3].pieces, [{ key: 3, start: 0, length: 13 }]);
  });

  test('a note run is drawn but never an anchor', () => {
    const [r] = bibleRows(
      [{ tag: 'Paragraph', inner: { paragraph: 1, style: 'Prose' as never, runs: [{ verse: 0, text: 'Note.' }] } }],
      blockSegments,
    );
    assert.equal(text(r), 'Note.');
    assert.deepEqual(r.pieces, []);
  });
});

describe('documentRows', () => {
  const t = (s: string) => ({ tag: 'Common' as const, inner: { inline: { tag: 'Text' as const, inner: { text: s } } } });
  const blocks: CoreDocBlock[] = [
    { tag: 'Heading', inner: { paragraph: 1, inlines: [t('Title')] } },
    { tag: 'Paragraph', inner: { paragraph: 2, number: '1', inlines: [t('First '), { tag: 'FootnoteRef' }, t('one.')] } },
    {
      tag: 'Aside',
      inner: {
        title: { paragraph: 3, inlines: [t('Box')] },
        blocks: [{ tag: 'List', inner: { items: [{ blocks: [{ tag: 'Paragraph', inner: { paragraph: 4, inlines: [t('Item')] } }] }] } }],
      },
    },
    { tag: 'Rule' },
    { tag: 'Question', inner: { paragraph: 5, number: '2', inlines: [t('Why?')] } },
  ];
  const doc = documentRows(blocks);

  test('headings, numbered paragraphs, and paragraphs inside asides and lists, in order', () => {
    assert.deepEqual(doc.map(text), ['Title', '1 First one.', 'Box', 'Item', '2 Why?']);
    assert.deepEqual(doc.map((r) => r.heading), [true, false, true, false, false]);
    assert.deepEqual(doc[1].pieces, [{ key: 2, start: 2, length: 10 }]);
  });

  test('plain text flattens nested inlines; footnote and page markers aren’t text', () => {
    assert.equal(
      docText([
        { tag: 'SmallCaps', inner: { children: [t('Lord')] } },
        { tag: 'Common', inner: { inline: { tag: 'Strong', inner: { children: [{ tag: 'Text', inner: { text: '!' } }] } } } },
        { tag: 'Common', inner: { inline: { tag: 'LineBreak' } } },
        { tag: 'PageMarker' },
      ]),
      'Lord!\n',
    );
  });
});

describe('restorePosition', () => {
  test('the saved verse and offset', () => {
    assert.deepEqual(restorePosition(rows, { key: 2, charOffset: 4 }), { row: 1, offset: 25 });
  });

  test('the offset is clamped to the block’s length', () => {
    assert.deepEqual(restorePosition(rows, { key: 1, charOffset: 999 }), { row: 1, offset: 18 });
  });

  test('a block split over rows counts its pieces in order', () => {
    // Verse 3 is "What the law" (12, after its number) then "could not do." (13).
    assert.deepEqual(restorePosition(rows, { key: 3, charOffset: 5 }), { row: 2, offset: 7 });
    assert.deepEqual(restorePosition(rows, { key: 3, charOffset: 14 }), { row: 3, offset: 2 });
    assert.deepEqual(restorePosition(rows, { key: 3, charOffset: 99 }), { row: 3, offset: 13 });
  });

  test('a gone block falls back to the nearest earlier one’s start', () => {
    assert.deepEqual(restorePosition(rows, { key: 7, charOffset: 5 }), { row: 2, offset: 2 });
  });

  test('nothing earlier, or nothing wanted: the first block', () => {
    const later = bibleRows(chapter.slice(2), blockSegments);
    assert.deepEqual(restorePosition(later, { key: 1, charOffset: 3 }), { row: 0, offset: 2 });
    assert.deepEqual(restorePosition(rows, undefined), { row: 1, offset: 2 });
  });

  test('no blocks: the top', () => {
    assert.deepEqual(restorePosition([], { key: 1, charOffset: 0 }), { row: 0, offset: 0 });
  });
});

describe('positionAt', () => {
  test('the verse holding the offset, and how far into it', () => {
    assert.deepEqual(positionAt(rows, { row: 1, offset: 25 }), { key: 2, charOffset: 4 });
  });

  test('a number belongs to the verse after it', () => {
    assert.deepEqual(positionAt(rows, { row: 1, offset: 0 }), { key: 1, charOffset: 0 });
    assert.deepEqual(positionAt(rows, { row: 1, offset: 18 }), { key: 1, charOffset: 16 });
    assert.deepEqual(positionAt(rows, { row: 1, offset: 19 }), { key: 2, charOffset: 0 });
  });

  test('a split verse adds the pieces before', () => {
    assert.deepEqual(positionAt(rows, { row: 3, offset: 2 }), { key: 3, charOffset: 14 });
  });

  test('a heading anchors at the next block', () => {
    assert.deepEqual(positionAt(rows, { row: 0, offset: 5 }), { key: 1, charOffset: 0 });
  });

  test('round-trips with restorePosition', () => {
    for (const p of [
      { key: 1, charOffset: 7 },
      { key: 2, charOffset: 0 },
      { key: 3, charOffset: 20 },
    ]) {
      assert.deepEqual(positionAt(rows, restorePosition(rows, p)), p);
    }
  });

  test('nothing to anchor: undefined', () => {
    assert.equal(positionAt([rows[0]], { row: 0, offset: 0 }), undefined);
  });
});

describe('snippetParts', () => {
  test('from the anchor verse’s number, on through the paragraphs after it, headings left out', () => {
    const parts = snippetParts(rows, { row: 1, offset: 25 }, 400);
    assert.equal(parts.map((p) => p.text).join(''), `2${NBSP}For the law. 3${NBSP}What the law could not do.`);
    assert.equal(parts[0].number, true);
  });

  test('stops after about `chars` characters, at a paragraph’s end', () => {
    const parts = snippetParts(rows, { row: 1, offset: 0 }, 10);
    assert.equal(parts.map((p) => p.text).join(''), text(rows[1]));
  });
});

describe('scroll offsets', () => {
  const layouts = [
    { y: 0, height: 30 },
    { y: 30, height: 100 },
    undefined,
    { y: 200, height: 20 },
  ];

  test('the offset’s fraction of the row’s height, below its top', () => {
    assert.equal(scrollYFor({ y: 30, height: 100 }, 50, 25), 80);
    assert.equal(scrollYFor({ y: 30, height: 100 }, 0, 0), 30);
  });

  test('the row starting at or above y, at the same fraction', () => {
    assert.deepEqual(rowPositionAt(layouts, rows, 80), { row: 1, offset: Math.floor(0.5 * rows[1].length) });
    assert.deepEqual(rowPositionAt(layouts, rows, 0), { row: 0, offset: 0 });
    assert.deepEqual(rowPositionAt(layouts, rows, 500), { row: 3, offset: rows[3].length });
  });

  test('none before any row is laid out', () => {
    assert.equal(rowPositionAt([undefined], rows, 0), undefined);
  });
});

describe('readerAt', () => {
  test('a passage reader is at one verse of its own Bible', () => {
    const at = readerAt(
      { kind: 'passage', verse: { pubKey: 'nwtsty', book: 45, chapter: 8, verse: 1 }, book: 45, chapter: 9 },
      { key: 3, charOffset: 4 },
    );
    assert.deepEqual(at, {
      kind: 'passage',
      span: {
        start: { pubKey: 'nwtsty', book: 45, chapter: 9, verse: 3 },
        end: { pubKey: 'nwtsty', book: 45, chapter: 9, verse: 3 },
      },
    });
  });

  test('a publication reader is at a paragraph of a document', () => {
    assert.deepEqual(readerAt({ kind: 'publication', pubKey: 'w:1', docId: 9n }, { key: 4, charOffset: 0 }), {
      kind: 'publication',
      location: { pubKey: 'w:1', docId: 9n, paragraph: 4 },
    });
  });
});

// Offsets as the core counts them (#81): in VerseAnchor.text, which joins a
// verse's runs with a space, and in ParagraphAnchor.text.
describe('offsets in the core’s anchor text', () => {
  const verses = anchorTexts([
    { verse: 1, text: 'No condemnation.' },
    { verse: 2, text: 'For the law.' },
    // Verse 3's two runs, joined by the core with a space.
    { verse: 3, text: 'What the law could not do.' },
  ]);
  const core = bibleRows(chapter, blockSegments, verses);

  test('the rows draw the same text and pieces', () => {
    assert.deepEqual(core.map(text), rows.map(text));
    assert.deepEqual(
      core.map((r) => r.pieces),
      rows.map((r) => r.pieces),
    );
  });

  test('a split verse’s later piece starts after the core’s space', () => {
    assert.deepEqual(core[2].textAt, [0]);
    assert.deepEqual(core[3].textAt, ['What the law '.length]);
  });

  test('a saved offset lands where the core’s text has it', () => {
    // "could" starts at 13 in the core's text: the later piece's start.
    assert.deepEqual(restorePosition(core, { key: 3, charOffset: 13 }), { row: 3, offset: 0 });
    assert.deepEqual(restorePosition(core, { key: 3, charOffset: 15 }), { row: 3, offset: 2 });
    // The core's joining space is the next piece's start.
    assert.deepEqual(restorePosition(core, { key: 3, charOffset: 12 }), { row: 3, offset: 0 });
    assert.deepEqual(restorePosition(core, { key: 3, charOffset: 99 }), { row: 3, offset: 13 });
  });

  test('and the anchor saved is the core’s offset', () => {
    assert.deepEqual(positionAt(core, { row: 3, offset: 2 }), { key: 3, charOffset: 15 });
    for (const p of [
      { key: 1, charOffset: 7 },
      { key: 3, charOffset: 5 },
      { key: 3, charOffset: 20 },
    ]) {
      assert.deepEqual(positionAt(core, restorePosition(core, p)), p);
    }
  });

  test('offsets count UTF-16 units, as the core does', () => {
    const [r] = bibleRows(
      [{ tag: 'Paragraph', inner: { paragraph: 1, style: 'Prose' as never, runs: [{ verse: 1, label: '1', text: '“Jehovah” 😀 is near.' }] } }],
      blockSegments,
      anchorTexts([{ verse: 1, text: '“Jehovah” 😀 is near.' }]),
    );
    // The emoji is two units: "is" starts at 13.
    assert.deepEqual(positionAt([r], { row: 0, offset: 2 + 13 }), { key: 1, charOffset: 13 });
  });

  test('a paragraph’s text is the core’s ParagraphAnchor.text', () => {
    const t = (s: string) => ({ tag: 'Common' as const, inner: { inline: { tag: 'Text' as const, inner: { text: s } } } });
    const doc = documentRows(
      [
        { tag: 'Heading', inner: { inlines: [t('Unnumbered heading')] } },
        { tag: 'Paragraph', inner: { paragraph: 2, number: '1', inlines: [t('First '), { tag: 'FootnoteRef' }, t('one.')] } },
      ],
      anchorTexts([{ paragraph: 2, text: 'First one.' }]),
    );
    assert.deepEqual(doc.map(text), ['Unnumbered heading', '1 First one.']);
    assert.deepEqual(doc[1].textAt, [0]);
    assert.deepEqual(restorePosition(doc, { key: 2, charOffset: 6 }), { row: 1, offset: 8 });
  });
});

describe('what a reader card reads (Reader.locate, #81)', () => {
  const span = { pubKey: 'nwtsty', book: 45, chapter: 8, verse: 1 };
  const card = { kind: 'passage' as const, start: span };
  const pub = { kind: 'publication' as const, location: { pubKey: 'w:0:20260800' } };

  test('it locates where its reader was left, else its own place', () => {
    const at = { pubKey: 'nwtsty', book: 45, chapter: 9, verse: 3 };
    assert.deepEqual(readerLocation(card, { at }), at);
    assert.deepEqual(readerLocation(card, undefined), span);
    assert.deepEqual(readerLocation(pub, undefined), { pubKey: 'w:0:20260800' });
  });

  test('found exactly: the saved verse and offset', () => {
    const located = { location: { pubKey: 'nwtsty', book: 45, chapter: 9, verse: 3 }, exact: true };
    assert.deepEqual(readerTarget('passage', located, { charOffset: 12 }), {
      kind: 'passage',
      book: 45,
      chapter: 9,
      wanted: { key: 3, charOffset: 12 },
      moved: false,
    });
  });

  test('moved: the core’s nearest verse, from its start, and noted', () => {
    const located = { location: { pubKey: 'nwtsty', book: 45, chapter: 9, verse: 2 }, exact: false };
    assert.deepEqual(readerTarget('passage', located, { charOffset: 12 }), {
      kind: 'passage',
      book: 45,
      chapter: 9,
      wanted: { key: 2, charOffset: 0 },
      moved: true,
    });
  });

  test('a whole chapter has no verse to start at', () => {
    const located = { location: { pubKey: 'nwtsty', book: 45, chapter: 9 }, exact: true };
    assert.equal(readerTarget('passage', located, undefined)?.wanted, undefined);
  });

  test('a passage whose book is gone has nothing to read', () => {
    assert.equal(readerTarget('passage', { location: { pubKey: 'nwtsty' }, exact: false }, undefined), undefined);
  });

  test('a whole-publication card reads the start document the core picks', () => {
    const located = { location: { pubKey: 'w:0:20260800', docId: 1102026201n }, exact: true };
    assert.deepEqual(readerTarget('publication', located, undefined), {
      kind: 'publication',
      docId: 1102026201n,
      wanted: undefined,
      moved: false,
    });
  });

  test('a gone paragraph: the core’s nearest one, from its start, noted', () => {
    const located = { location: { pubKey: 'w:0:20260800', docId: 9n, paragraph: 4 }, exact: false };
    assert.deepEqual(readerTarget('publication', located, { charOffset: 30 }), {
      kind: 'publication',
      docId: 9n,
      wanted: { key: 4, charOffset: 0 },
      moved: true,
    });
  });

  test('a publication the core gives no document for has nothing to read', () => {
    assert.equal(readerTarget('publication', { location: { pubKey: 'w:0:20260800' }, exact: true }, undefined), undefined);
  });

  test('the moved note says so plainly', () => {
    assert.match(MOVED_NOTE, /exact place/);
  });

  test('a card shows the moved caption over its live text only (#85 Q3)', () => {
    assert.equal(showsMovedCaption(true, 'live'), true);
    assert.equal(showsMovedCaption(true, 'snippet'), false);
    assert.equal(showsMovedCaption(true, 'none'), false);
    assert.equal(showsMovedCaption(false, 'live'), false);
    assert.ok(MOVED_CAPTION.length <= 24);
  });
});
