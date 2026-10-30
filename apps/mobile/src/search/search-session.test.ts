import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  createSearchSession,
  type QueryFailure,
  type SearchState,
  type Timers,
} from './search-session.ts';

// Hand-driven timers: `flush` fires whatever is due.
function fakeTimers() {
  let next = 0;
  const pending = new Map<number, { at: number; callback: () => void }>();
  let now = 0;
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
    get pending() {
      return pending.size;
    },
  };
}

type Call = {
  text: string;
  signal: AbortSignal;
  resolve: (hits: string[]) => void;
  reject: (error: unknown) => void;
};

const INVALID = { invalid: true };

function setup() {
  const clock = fakeTimers();
  const calls: Call[] = [];
  const states: SearchState<string>[] = [];
  const session = createSearchSession<string>({
    query: (text, signal) =>
      new Promise((resolve, reject) => calls.push({ text, signal, resolve, reject })),
    classifyError: (e): QueryFailure =>
      e === INVALID ? { kind: 'invalid' } : { kind: 'failed', message: 'Search failed.' },
    onChange: (s) => states.push(s),
    debounceMs: 200,
    timers: clock.timers,
  });
  const last = () => states.at(-1);
  return { clock, calls, states, session, last };
}

// Lets the session's promise callbacks run.
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('search session', () => {
  test('debounce coalesces rapid typing into one call', async () => {
    const { clock, calls, session, last } = setup();
    for (const text of ['l', 'li', 'lig', 'ligh', 'light']) {
      session.setText(text);
      clock.advance(50);
    }
    await settle();
    assert.equal(calls.length, 0);
    assert.deepEqual(last(), { status: 'loading', text: 'light', hits: [] });
    clock.advance(200);
    await settle();
    assert.deepEqual(
      calls.map((c) => c.text),
      ['light'],
    );
    calls[0].resolve(['John 1:4']);
    await settle();
    assert.deepEqual(last(), { status: 'done', text: 'light', hits: ['John 1:4'] });
  });

  test('a slower earlier query never overwrites a newer one', async () => {
    const { clock, calls, session, last } = setup();
    session.setText('light');
    clock.advance(200);
    await settle();
    session.setText('life');
    clock.advance(200);
    await settle();
    assert.equal(calls.length, 2);
    assert.equal(calls[0].signal.aborted, true);
    assert.equal(calls[1].signal.aborted, false);

    calls[1].resolve(['life hit']);
    await settle();
    calls[0].resolve(['light hit']);
    await settle();
    assert.deepEqual(last(), { status: 'done', text: 'life', hits: ['life hit'] });

    // A late rejection from the superseded query is dropped too.
    calls[0].reject(new Error('aborted'));
    await settle();
    assert.deepEqual(last(), { status: 'done', text: 'life', hits: ['life hit'] });
  });

  test('loading keeps the last results on screen', async () => {
    const { clock, calls, session, last } = setup();
    session.setText('light');
    clock.advance(200);
    await settle();
    calls[0].resolve(['a']);
    await settle();
    session.setText('lights');
    assert.deepEqual(last(), { status: 'loading', text: 'lights', hits: ['a'] });
  });

  test('an empty or whitespace query is the empty state, without the core', async () => {
    const { clock, calls, session, states } = setup();
    session.setText('   ');
    clock.advance(1000);
    await settle();
    assert.equal(calls.length, 0);
    // Already empty: nothing to report.
    assert.deepEqual(states, []);

    session.setText('light');
    session.setText(' \t');
    clock.advance(1000);
    await settle();
    assert.equal(calls.length, 0);
    assert.deepEqual(states.at(-1), { status: 'empty' });
  });

  test('clearing cancels a running query and drops its result', async () => {
    const { clock, calls, session, last } = setup();
    session.setText('light');
    clock.advance(200);
    await settle();
    session.setText('');
    assert.equal(calls[0].signal.aborted, true);
    calls[0].resolve(['late']);
    await settle();
    assert.deepEqual(last(), { status: 'empty' });
  });

  test('trailing whitespace does not search again', async () => {
    const { clock, calls, session } = setup();
    session.setText('light');
    clock.advance(200);
    session.setText('light ');
    clock.advance(200);
    await settle();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].text, 'light');
  });

  test('Invalid from the core means no results', async () => {
    const { clock, calls, session, last } = setup();
    session.setText('""');
    clock.advance(200);
    await settle();
    calls[0].reject(INVALID);
    await settle();
    assert.deepEqual(last(), { status: 'done', text: '""', hits: [] });
  });

  test('other errors are an error state with the short message', async () => {
    const { clock, calls, session, last } = setup();
    session.setText('light');
    clock.advance(200);
    await settle();
    calls[0].reject(new Error('Io: /data/user/0/secret/berean.db'));
    await settle();
    assert.deepEqual(last(), { status: 'error', text: 'light', message: 'Search failed.' });
  });

  test('a query that throws synchronously is an error state', async () => {
    const clock = fakeTimers();
    let state: SearchState<string> | undefined;
    const session = createSearchSession<string>({
      query: () => {
        throw new Error('no core');
      },
      classifyError: () => ({ kind: 'failed', message: 'Search failed.' }),
      onChange: (s) => (state = s),
      debounceMs: 200,
      timers: clock.timers,
    });
    session.setText('light');
    clock.advance(200);
    await settle();
    assert.deepEqual(state, { status: 'error', text: 'light', message: 'Search failed.' });
  });

  test('dispose cancels the pending debounce', async () => {
    const { clock, calls, session } = setup();
    session.setText('light');
    session.dispose();
    assert.equal(clock.pending, 0);
    clock.advance(1000);
    await settle();
    assert.equal(calls.length, 0);
  });
});
