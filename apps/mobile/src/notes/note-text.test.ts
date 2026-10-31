import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  type NoteBlock,
  type NoteInline,
  type NoteLinkTarget,
  blockText,
  inlineText,
  isMissing,
  linkUnderline,
  missingLine,
  noteSnippet,
  spanStart,
  spanVerses,
  tagLine,
  withoutTitleHeading,
} from './note-text.ts';

const text = (t: string): NoteInline => ({ tag: 'Text', inner: { text: t } });
const tag = (name: string): NoteInline => ({ tag: 'Tag', inner: { name } });
const verse = (book: number, chapter: number, v?: number) =>
  v === undefined ? { pubKey: 'nwtsty:0:0', book, chapter } : { pubKey: 'nwtsty:0:0', book, chapter, verse: v };
const passage = (missing: boolean): NoteLinkTarget => ({
  tag: 'Passage',
  inner: { span: { start: verse(43, 1, 9), end: verse(43, 1, 9) }, missing },
});
const paragraph = (...inlines: NoteInline[]): NoteBlock => ({ tag: 'Paragraph', inner: { inlines } });

// The guide's "Light before law", as the core renders it (abridged).
const body: NoteBlock[] = [
  { tag: 'Heading', inner: { level: 1, inlines: [text('Light before law')] } },
  paragraph(
    text('The witness is '),
    { tag: 'Strong', inner: { children: [text('not')] } },
    text(' the light. See '),
    { tag: 'Link', inner: { children: [text('John 1:9')], url: 'berean://bible/x/43/1/9', target: passage(false) } },
    text(','),
    { tag: 'LineBreak' },
    { tag: 'Emphasis', inner: { children: [text('coming into the world')] } },
    text('.'),
  ),
  {
    tag: 'List',
    inner: {
      items: [
        { task: { index: 0, checked: true }, blocks: [paragraph(text('Compare Genesis 1:3'))] },
        { task: { index: 1, checked: false }, blocks: [paragraph(text('Read John 1:14 again'))] },
      ],
    },
  },
  { tag: 'Quote', inner: { blocks: [paragraph(text('In thy light shall we see light.'))] } },
  { tag: 'PassageCard', inner: { text: 'Psalm 36:9', span: { start: verse(19, 36, 9), end: verse(19, 36, 9) }, missing: false } },
  paragraph(text('Search for '), { tag: 'Code', inner: { text: '#light' } }),
  { tag: 'Rule' },
  paragraph(tag('prologue'), text(' '), tag('light')),
];

describe('plain text', () => {
  test('inlines flatten, tags keep their #, breaks become spaces', () => {
    assert.equal(
      inlineText((body[1] as Extract<NoteBlock, { tag: 'Paragraph' }>).inner.inlines),
      'The witness is not the light. See John 1:9, coming into the world.',
    );
    assert.equal(blockText(body[2]), 'Compare Genesis 1:3 Read John 1:14 again');
    assert.equal(blockText(body[4]), 'Psalm 36:9');
    assert.equal(blockText({ tag: 'Rule' }), '');
  });

  test('the snippet skips the title heading and runs on one line', () => {
    const snippet = noteSnippet(body, 'Light before law');
    assert.ok(snippet.startsWith('The witness is not the light. See John 1:9, coming'));
    assert.ok(!snippet.includes('\n'));
    assert.ok(snippet.length <= 160);
  });

  test('a heading that differs from the title stays', () => {
    assert.equal(withoutTitleHeading(body, 'Light before law').length, body.length - 1);
    assert.equal(withoutTitleHeading(body, 'Another title').length, body.length);
    const h2: NoteBlock[] = [{ tag: 'Heading', inner: { level: 2, inlines: [text('T')] } }];
    assert.equal(withoutTitleHeading(h2, 'T').length, 1);
    assert.deepEqual(withoutTitleHeading([], 'T'), []);
  });
});

describe('tags and links', () => {
  test('a paragraph of only tags is a tag line', () => {
    const last = body.at(-1) as Extract<NoteBlock, { tag: 'Paragraph' }>;
    assert.deepEqual(tagLine(last.inner.inlines), ['prologue', 'light']);
    assert.equal(tagLine([text('See '), tag('light')]), undefined);
    assert.equal(tagLine([text(' ')]), undefined);
  });

  test('missing follows the core flag on Bible and publication links', () => {
    assert.equal(isMissing(passage(true)), true);
    assert.equal(isMissing(passage(false)), false);
    assert.equal(isMissing({ tag: 'Publication', inner: { location: { pubKey: 'it:0:0' }, missing: true } }), true);
    assert.equal(isMissing({ tag: 'External', inner: { url: 'https://example.com' } }), false);
    assert.equal(isMissing({ tag: 'Invalid' }), false);
    assert.equal(
      missingLine('Insight on the Scriptures, Vol. 2'),
      'Insight on the Scriptures, Vol. 2 is not on this device.',
    );
  });

  test('every link is underlined: solid in linkUnderline, dashed accent when missing', () => {
    const colors = { linkUnderline: '#C9A493', accent: '#9B3F2A' };
    const solid = { color: '#C9A493', style: 'solid' };
    assert.deepEqual(linkUnderline(passage(false), colors), solid);
    assert.deepEqual(linkUnderline(passage(true), colors), { color: '#9B3F2A', style: 'dashed' });
    assert.deepEqual(
      linkUnderline({ tag: 'Publication', inner: { location: { pubKey: 'it:0:0' }, missing: true } }, colors),
      { color: '#9B3F2A', style: 'dashed' },
    );
    assert.deepEqual(linkUnderline({ tag: 'External', inner: { url: 'https://example.com' } }, colors), solid);
    assert.deepEqual(linkUnderline({ tag: 'Invalid' }, colors), solid);
  });

  test('a span opens at its start', () => {
    assert.deepEqual(spanStart({ start: verse(43, 1, 9), end: verse(43, 1, 12) }), verse(43, 1, 9));
    assert.deepEqual(spanStart({ start: verse(43, 1), end: verse(43, 1) }), verse(43, 1));
    assert.equal(spanStart({ start: { pubKey: 'x' }, end: { pubKey: 'x' } }), undefined);
  });

  test("a card's verses lie within one chapter", () => {
    assert.deepEqual(spanVerses({ start: verse(19, 36, 9), end: verse(19, 36, 9) }), [9]);
    assert.deepEqual(spanVerses({ start: verse(43, 1, 1), end: verse(43, 1, 3) }), [1, 2, 3]);
    assert.equal(spanVerses({ start: verse(43, 1, 51), end: verse(43, 2, 3) }), undefined);
    assert.equal(spanVerses({ start: verse(19, 36), end: verse(19, 36) }), undefined);
  });
});
