import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  carryOver,
  completionParts,
  createSuggestSession,
  fillText,
  MAX_QUERIES,
  MAX_TOPICS,
  type CoreSuggestions,
  type ShownSuggestions,
  type Timers,
} from './suggestions.ts';

type Topic = { title: string };

function fakeTimers() {
  let next = 0;
  let now = 0;
  const pending = new Map<number, { at: number; callback: () => void }>();
  const timers: Timers = {
    setTimeout(callback, ms) {
      next += 1;
      pending.set(next, { at: now + ms, callback });
      return next;
    },
    clearTimeout(handle) {
      pending.delete(handle as number);
    },
  };
  return {
    timers,
    advance(ms: number) {
      now += ms;
      for (const [id, t] of [...pending]) {
        if (t.at <= now) {
          pending.delete(id);
          t.callback();
        }
      }
    },
  };
}

type Call = {
  text: string;
  signal: AbortSignal;
  resolve: (found: CoreSuggestions<Topic>) => void;
  reject: (error: unknown) => void;
};

function setup() {
  const clock = fakeTimers();
  const calls: Call[] = [];
  const shown: ShownSuggestions<Topic>[] = [];
  const session = createSuggestSession<Topic>({
    suggest: (text, signal) => new Promise((resolve, reject) => calls.push({ text, signal, resolve, reject })),
    onChange: (s) => shown.push(s),
    debounceMs: 100,
    timers: clock.timers,
  });
  const last = () => shown[shown.length - 1];
  return { clock, calls, shown, session, last };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

const found = (queries: string[], topics: string[] = []): CoreSuggestions<Topic> => ({
  queries,
  topics: topics.map((title) => ({ title })),
});

describe('createSuggestSession', () => {
  test('asks once typing pauses and shows a few of each', async () => {
    const { clock, calls, session, last } = setup();
    session.setText('l');
    session.setText('lo');
    clock.advance(99);
    assert.equal(calls.length, 0);
    clock.advance(1);
    assert.deepEqual(
      calls.map((c) => c.text),
      ['lo'],
    );
    calls[0].resolve(found(['love', 'lord', 'lot', 'Lotan', 'loved'], ['Lot', 'Love', 'Lotan']));
    await settle();
    assert.deepEqual(last(), {
      text: 'lo',
      queries: ['love', 'lord', 'lot'].slice(0, MAX_QUERIES),
      topics: [{ title: 'Lot' }, { title: 'Love' }].slice(0, MAX_TOPICS),
    });
  });

  test('keeps the ones that still fit while the next are found', async () => {
    const { clock, calls, session, last } = setup();
    session.setText('lo');
    clock.advance(100);
    calls[0].resolve(found(['love', 'lord', 'loved'], ['Love', 'Lot']));
    await settle();
    session.setText('lov');
    assert.deepEqual(last(), { text: 'lov', queries: ['love', 'loved'], topics: [{ title: 'Love' }] });
    // The older request is dropped once the text moved on.
    assert.equal(calls[0].signal.aborted, false);
    clock.advance(100);
    calls[1].resolve(found(['love', 'loved', 'loving']));
    await settle();
    assert.deepEqual(last().queries, ['love', 'loved', 'loving']);
  });

  test('drops stale answers and asks nothing for a finished word', async () => {
    const { clock, calls, session, last } = setup();
    session.setText('lo');
    clock.advance(100);
    session.setText('love ');
    assert.equal(calls[0].signal.aborted, true);
    calls[0].resolve(found(['love']));
    await settle();
    assert.deepEqual(last(), { text: 'love ', queries: [], topics: [] });
    clock.advance(1000);
    assert.equal(calls.length, 1);
    session.setText('');
    assert.deepEqual(last(), { text: '', queries: [], topics: [] });
  });

  test('a failure shows none', async () => {
    const { clock, calls, session, last } = setup();
    session.setText('lo');
    clock.advance(100);
    calls[0].reject(new Error('core'));
    await settle();
    assert.deepEqual(last(), { text: 'lo', queries: [], topics: [] });
  });

  test('dispose cancels what is pending', () => {
    const { clock, calls, session } = setup();
    session.setText('lo');
    session.dispose();
    clock.advance(1000);
    assert.equal(calls.length, 0);
  });
});

describe('carryOver', () => {
  const previous = { text: 'jeho', queries: ['Jehovah', 'Jehová', 'Jehovah'], topics: [{ title: 'Jehovah' }] };

  test('keeps what extends the text, ignoring case', () => {
    assert.deepEqual(carryOver(previous, 'JEHOV'), {
      text: 'JEHOV',
      queries: ['Jehovah', 'Jehová', 'Jehovah'],
      topics: [{ title: 'Jehovah' }],
    });
    assert.deepEqual(carryOver(previous, 'jehovah').queries, []);
  });

  test('clears on a deletion or a finished word', () => {
    assert.deepEqual(carryOver(previous, 'jeh').queries, []);
    assert.deepEqual(carryOver(previous, 'jehov ').topics, []);
    assert.deepEqual(carryOver(previous, '').queries, []);
  });
});

describe('completionParts', () => {
  test('splits what was typed from the completion', () => {
    assert.deepEqual(completionParts('God loved', 'God lo'), { typed: 'God lo', completion: 'ved' });
    assert.deepEqual(completionParts('Jehovah', 'jeho'), { typed: 'Jeho', completion: 'vah' });
    assert.deepEqual(completionParts('"loved the world"', '"loved the wo'), {
      typed: '"loved the wo',
      completion: 'rld"',
    });
    assert.deepEqual(completionParts('love', 'other'), { typed: '', completion: 'love' });
  });

  test('a chosen query leaves room for the next word', () => {
    assert.equal(fillText('God loved'), 'God loved ');
  });
});
