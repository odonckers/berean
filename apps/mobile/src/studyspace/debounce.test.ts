import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { debounce, type Timer } from './debounce.ts';

// A hand-wound clock: advance(ms) runs whatever falls due.
function fakeTimer() {
  let now = 0;
  let next = 0;
  const due = new Map<number, { at: number; run: () => void }>();
  const timer: Timer = {
    set: (run, ms) => {
      const id = next++;
      due.set(id, { at: now + ms, run });
      return id;
    },
    clear: (handle) => {
      due.delete(handle as number);
    },
  };
  const advance = (ms: number) => {
    now += ms;
    for (const [id, t] of [...due].sort((a, b) => a[1].at - b[1].at)) {
      if (t.at <= now) {
        due.delete(id);
        t.run();
      }
    }
  };
  return { timer, advance, scheduled: () => due.size };
}

describe('debounce', () => {
  test('runs once, with the last value, after the burst goes quiet', () => {
    const clock = fakeTimer();
    const seen: number[] = [];
    const d = debounce((v: number) => seen.push(v), 300, clock.timer);
    d.call(1);
    clock.advance(200);
    d.call(2);
    clock.advance(200);
    d.call(3);
    clock.advance(299);
    assert.deepEqual(seen, []);
    assert.equal(d.pending(), true);
    clock.advance(1);
    assert.deepEqual(seen, [3]);
    assert.equal(d.pending(), false);
    assert.equal(clock.scheduled(), 0);
  });

  test('flush runs the pending value now, once', () => {
    const clock = fakeTimer();
    const seen: string[] = [];
    const d = debounce((v: string) => seen.push(v), 300, clock.timer);
    d.call('a');
    d.flush();
    assert.deepEqual(seen, ['a']);
    clock.advance(1000);
    assert.deepEqual(seen, ['a']);
    assert.equal(clock.scheduled(), 0);
  });

  test('flush with nothing pending does nothing', () => {
    const clock = fakeTimer();
    const seen: number[] = [];
    const d = debounce((v: number) => seen.push(v), 300, clock.timer);
    d.flush();
    d.call(1);
    clock.advance(300);
    d.flush();
    assert.deepEqual(seen, [1]);
  });

  test('cancel drops the pending value', () => {
    const clock = fakeTimer();
    const seen: number[] = [];
    const d = debounce((v: number) => seen.push(v), 300, clock.timer);
    d.call(1);
    d.cancel();
    clock.advance(1000);
    d.flush();
    assert.deepEqual(seen, []);
    assert.equal(d.pending(), false);
    assert.equal(clock.scheduled(), 0);
  });

  test('a call after cancel starts afresh', () => {
    const clock = fakeTimer();
    const seen: number[] = [];
    const d = debounce((v: number) => seen.push(v), 300, clock.timer);
    d.call(1);
    d.cancel();
    d.call(2);
    clock.advance(300);
    assert.deepEqual(seen, [2]);
  });
});
