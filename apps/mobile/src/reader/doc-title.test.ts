import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { CoreDocBlock } from '../studyspace/reader-state.ts';
import { withoutTitle } from './doc-title.ts';

const text = (t: string) => [{ tag: 'Common' as const, inner: { inline: { tag: 'Text' as const, inner: { text: t } } } }];
const paragraph = (paragraph: number, t: string): CoreDocBlock => ({ tag: 'Paragraph', inner: { paragraph, inlines: text(t) } });
const heading = (t: string): CoreDocBlock => ({ tag: 'Heading', inner: { paragraph: 1, inlines: text(t) } });

describe('withoutTitle', () => {
  test('drops the first block that repeats the title', () => {
    const blocks = [paragraph(1, 'STUDY ARTICLE 40'), heading('Resist  Satan’s Tactics'), paragraph(3, 'Body')];
    assert.deepEqual(withoutTitle(blocks, 'resist satan’s tactics'), [blocks[0], blocks[2]]);
  });

  test('keeps everything when the title is not repeated', () => {
    const blocks = [heading('October 5-11'), paragraph(2, 'Song 1')];
    assert.equal(withoutTitle(blocks, 'Another title'), blocks);
    assert.equal(withoutTitle(blocks, ''), blocks);
  });

  test('only one block goes', () => {
    const blocks = [heading('Title'), paragraph(2, 'Title')];
    assert.deepEqual(withoutTitle(blocks, 'Title'), [blocks[1]]);
  });
});
