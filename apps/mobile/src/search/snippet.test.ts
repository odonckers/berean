import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { snippetRuns, snippetText } from './snippet.ts';

describe('snippet runs', () => {
  test('splits on marks, in order', () => {
    assert.deepEqual(snippetRuns('In him was <mark>life</mark>; and the <mark>life</mark> was'), [
      { text: 'In him was ', marked: false },
      { text: 'life', marked: true },
      { text: '; and the ', marked: false },
      { text: 'life', marked: true },
      { text: ' was', marked: false },
    ]);
  });

  test('unescapes the entities the core emits', () => {
    assert.deepEqual(snippetRuns('&lt;a&gt; &amp; &quot;b&quot; &#39;c&#x27;'), [
      { text: '<a> & "b" \'c\'', marked: false },
    ]);
  });

  test('unescapes once: an escaped entity stays literal', () => {
    assert.equal(snippetText('&amp;lt;'), '&lt;');
  });

  test('an escaped tag inside a mark is text', () => {
    assert.deepEqual(snippetRuns('<mark>&lt;mark&gt;</mark>'), [{ text: '<mark>', marked: true }]);
  });

  test('adjacent marks merge and nothing is empty', () => {
    assert.deepEqual(snippetRuns('<mark>loved</mark><mark>the</mark>'), [
      { text: 'lovedthe', marked: true },
    ]);
    assert.deepEqual(snippetRuns(''), []);
  });

  test('plain text joins the runs', () => {
    assert.equal(snippetText('… the <mark>light</mark> of men.'), '… the light of men.');
  });
});
