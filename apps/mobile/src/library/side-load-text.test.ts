import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { fileLabel, fileNameFromUrl, isFileUrl, sideLoadFailure } from './side-load-text.ts';

describe('opening a .jwpub from the device', () => {
  test('a file is named by its name, or as this file', () => {
    assert.equal(fileLabel('w_E_202608.jwpub'), '“w_E_202608.jwpub”');
    assert.equal(fileLabel('  '), 'this file');
    assert.equal(fileLabel(undefined, true), 'This file');
  });

  test('failures say what happened and what to do', () => {
    assert.equal(
      sideLoadFailure('Corrupt', 'notes.pdf', 'data is corrupt'),
      '“notes.pdf” isn’t a publication Berean can open. It may be damaged, or not a .jwpub file.',
    );
    assert.equal(
      sideLoadFailure('Corrupt', undefined, 'data is corrupt'),
      'This file isn’t a publication Berean can open. It may be damaged, or not a .jwpub file.',
    );
    assert.equal(
      sideLoadFailure('StorageFull', undefined, 'storage is full'),
      'There isn’t enough space on this device to add this file. Free up some space and try again.',
    );
    assert.equal(
      sideLoadFailure('Io', 'a.jwpub', 'io error: denied'),
      'Berean couldn’t read “a.jwpub”. Try opening it again.',
    );
    assert.equal(
      sideLoadFailure('Invalid', 'a.jwpub', 'invalid: locked'),
      'Couldn’t add “a.jwpub”: invalid: locked',
    );
    assert.equal(sideLoadFailure(undefined, 'a.jwpub', 'Out of memory'), 'Out of memory');
  });

  test('only file and content URLs are files to open', () => {
    assert.ok(isFileUrl('file:///private/var/mobile/Inbox/w.jwpub'));
    assert.ok(isFileUrl('content://com.android.providers.downloads.documents/document/42'));
    assert.ok(!isFileUrl('berean:///library'));
    assert.ok(!isFileUrl('/library/find'));
    assert.ok(!isFileUrl('https://example.org/w.jwpub'));
  });

  test('a file name comes from the URL only when it has one', () => {
    assert.equal(fileNameFromUrl('file:///a/Inbox/w_E_202608.jwpub'), 'w_E_202608.jwpub');
    assert.equal(fileNameFromUrl('file:///a/Inbox/My%20Book.jwpub'), 'My Book.jwpub');
    assert.equal(
      fileNameFromUrl('content://com.android.externalstorage.documents/document/primary%3ADownload%2Fll_E.jwpub'),
      'll_E.jwpub',
    );
    assert.equal(fileNameFromUrl('content://com.android.providers.downloads.documents/document/42'), undefined);
    assert.equal(fileNameFromUrl('file:///a/%E0%A4%A.jwpub?x=1'), '%E0%A4%A.jwpub');
  });
});
