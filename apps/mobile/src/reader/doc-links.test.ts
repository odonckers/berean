import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { CANT_OPEN, type CoreResolved, NOT_DOWNLOADED, linkAction } from './doc-links.ts';

const never = () => {
  throw new Error('resolve must not be called');
};
const tagOf = (e: unknown) => (e as { tag?: string }).tag;

describe('document links', () => {
  test('an invalid target never calls resolve', () => {
    assert.deepEqual(linkAction('Invalid', '#x', never, tagOf), { kind: 'cant-open', message: CANT_OPEN });
  });

  test('a Bible span opens the passage', () => {
    const span = {
      start: { pubKey: 'nwtsty:0:0', book: 43, chapter: 3, verse: 16 },
      end: { pubKey: 'nwtsty:0:0', book: 43, chapter: 3, verse: 16 },
    };
    const resolved: CoreResolved = { tag: 'Span', inner: { span } };
    assert.deepEqual(linkAction('Bible', 'jwpub://b/NWTR/43:3:16-43:3:16', () => resolved, tagOf), {
      kind: 'passage',
      span,
    });
  });

  test('a document span opens the publication', () => {
    const start = { pubKey: 'w26:0:20260800', docId: 2026520n, paragraph: 3 };
    const resolved: CoreResolved = { tag: 'Span', inner: { span: { start, end: start } } };
    assert.deepEqual(linkAction('Document', 'jwpub://p/E:2026520/3', () => resolved, tagOf), {
      kind: 'publication',
      location: start,
    });
  });

  test('external links go to the system', () => {
    const resolved: CoreResolved = { tag: 'External', inner: { url: 'https://www.jw.org' } };
    assert.deepEqual(linkAction('External', 'https://www.jw.org', () => resolved, tagOf), {
      kind: 'external',
      url: 'https://www.jw.org',
    });
  });

  test('errors are the can’t-open state', () => {
    const throwing = (tag: string) => () => {
      throw { tag };
    };
    assert.deepEqual(linkAction('Document', 'jwpub://p/E:9/', throwing('NotFound'), tagOf), {
      kind: 'cant-open',
      message: NOT_DOWNLOADED,
    });
    assert.deepEqual(linkAction('StudyNote', 'jwpub://c/E:1/1:1', throwing('Invalid'), tagOf), {
      kind: 'cant-open',
      message: CANT_OPEN,
    });
  });
});
