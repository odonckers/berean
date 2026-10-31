import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  type Draft,
  SAVE_DELAY_MS,
  createDraftSession,
  isEmptyDraft,
  leaveStep,
  openingMode,
  shouldSave,
} from './note-draft.ts';

const draft = (title: string, content: string) => ({ title, content });

// A session over a fake core and a scheduler run by hand, as React would
// mount and unmount the editor.
function harness(initial: Draft | undefined, fresh: boolean, opts: { saveFails?: boolean } = {}) {
  const saves: Draft[] = [];
  let removed = 0;
  let exists = initial !== undefined;
  let pending: (() => void)[] = [];
  const session = createDraftSession({
    initial,
    fresh,
    save: (d) => {
      if (opts.saveFails) return false;
      saves.push(d);
      return true;
    },
    remove: () => {
      removed += 1;
      exists = false;
    },
    exists: () => exists,
    schedule: (task) => {
      pending.push(task);
      return () => {
        pending = pending.filter((t) => t !== task);
      };
    },
  });
  return {
    session,
    saves,
    removed: () => removed,
    deleteElsewhere: () => {
      exists = false;
    },
    // The event loop's next turn.
    runPending: () => {
      const tasks = pending;
      pending = [];
      for (const task of tasks) task();
    },
    pendingCount: () => pending.length,
  };
}

describe('note draft', () => {
  test('saves about 800 ms after typing stops', () => {
    assert.equal(SAVE_DELAY_MS, 800);
  });

  test('empty: title and body blank, whitespace included', () => {
    assert.equal(isEmptyDraft(draft('', '')), true);
    assert.equal(isEmptyDraft(draft('  ', '\n\t ')), true);
    assert.equal(isEmptyDraft(draft('Light', '')), false);
    assert.equal(isEmptyDraft(draft('', '#grace')), false);
  });

  test('saves only a change', () => {
    const saved = draft('Light before law', 'The witness');
    assert.equal(shouldSave(draft('Light before law', 'The witness'), saved), false);
    assert.equal(shouldSave(draft('Light before law ', 'The witness'), saved), true);
    assert.equal(shouldSave(draft('Light before law', 'The witness is'), saved), true);
  });

  test('leaving: a fresh empty note goes, else a change saves', () => {
    const blank = draft('', '');
    assert.equal(leaveStep(blank, blank, true), 'remove');
    assert.equal(leaveStep(draft(' ', ''), draft('Light', ''), true), 'remove');
    assert.equal(leaveStep(draft('Light', ''), blank, true), 'save');
    assert.equal(leaveStep(draft('Light', ''), draft('Light', ''), true), 'none');
    // An existing note left empty is saved empty, not removed.
    assert.equal(leaveStep(blank, draft('Light', ''), false), 'save');
    assert.equal(leaveStep(blank, blank, false), 'none');
  });

  test('opening mode: as asked, but Write for an empty body', () => {
    assert.equal(openingMode('read', 'The witness'), 'read');
    assert.equal(openingMode('write', 'The witness'), 'write');
    assert.equal(openingMode('read', ''), 'write');
    assert.equal(openingMode('read', ' \n\t'), 'write');
    assert.equal(openingMode('write', ''), 'write');
  });
});

describe('draft session', () => {
  test('StrictMode mount, unmount, mount keeps a fresh empty note; the real unmount removes it', () => {
    const h = harness(draft('', ''), true);
    // StrictMode (dev): mount, a simulated unmount, and the remount, all
    // before the event loop turns.
    h.session.mount();
    h.session.unmount();
    h.session.mount();
    h.runPending();
    assert.equal(h.removed(), 0);
    assert.equal(h.pendingCount(), 0);

    // Leaving for real.
    h.session.unmount();
    assert.equal(h.removed(), 0, 'not during the unmount itself');
    h.runPending();
    assert.equal(h.removed(), 1);
    assert.deepEqual(h.saves, []);
  });

  test('the real unmount saves unsaved edits; a StrictMode remount loses none', () => {
    const h = harness(draft('', ''), true);
    h.session.mount();
    h.session.unmount();
    h.session.mount();
    h.runPending();
    // Typed after the remount: the draft is still live.
    h.session.update(draft('Light before law', 'The witness'));
    assert.equal(h.session.dirty(), true);
    h.session.unmount();
    h.runPending();
    assert.deepEqual(h.saves, [draft('Light before law', 'The witness')]);
    assert.equal(h.removed(), 0);
  });

  test('edits before a StrictMode remount still save on the real unmount', () => {
    const h = harness(draft('Light', 'old'), false);
    h.session.mount();
    h.session.update(draft('Light', 'new'));
    h.session.unmount();
    h.session.mount();
    h.runPending();
    assert.deepEqual(h.saves, []);
    h.session.unmount();
    h.runPending();
    assert.deepEqual(h.saves, [draft('Light', 'new')]);
  });

  test('a fresh note emptied again before leaving goes', () => {
    const h = harness(draft('', ''), true);
    h.session.mount();
    h.session.update(draft('Light', ''));
    h.session.flush();
    h.session.update(draft(' ', ''));
    h.session.unmount();
    h.runPending();
    assert.equal(h.removed(), 1);
  });

  test('flush saves only a change, and keeps the draft when the save fails', () => {
    const h = harness(draft('Light', ''), false);
    h.session.flush();
    assert.deepEqual(h.saves, []);
    h.session.update(draft('Light', 'more'));
    h.session.flush();
    h.session.flush();
    assert.deepEqual(h.saves, [draft('Light', 'more')]);
    assert.equal(h.session.dirty(), false);

    const failing = harness(draft('Light', ''), false, { saveFails: true });
    failing.session.update(draft('Light', 'more'));
    failing.session.flush();
    assert.equal(failing.session.dirty(), true);
    assert.deepEqual(failing.session.draft(), draft('Light', 'more'));
  });

  test('a deleted note never saves again', () => {
    const h = harness(draft('Light', ''), false);
    h.session.mount();
    h.session.update(draft('Light', 'more'));
    h.session.forget();
    h.session.flush();
    h.session.unmount();
    h.runPending();
    assert.deepEqual(h.saves, []);
    assert.equal(h.removed(), 0);
  });

  test('deleted elsewhere meanwhile: leaving saves nothing', () => {
    const h = harness(draft('Light', ''), false);
    h.session.mount();
    h.session.update(draft('Light', 'more'));
    h.deleteElsewhere();
    h.session.unmount();
    h.runPending();
    assert.deepEqual(h.saves, []);
  });

  test('a note that was never there saves and removes nothing', () => {
    const h = harness(undefined, true);
    h.session.mount();
    h.session.unmount();
    h.runPending();
    assert.equal(h.removed(), 0);
    assert.deepEqual(h.saves, []);
  });

  test('reload takes the core text as saved', () => {
    const h = harness(draft('Light', '- [ ] a'), false);
    h.session.reload(draft('Light', '- [x] a'));
    assert.equal(h.session.dirty(), false);
    h.session.unmount();
    h.runPending();
    assert.deepEqual(h.saves, []);
  });

  test('the default scheduler waits a turn and can be cancelled', async () => {
    let removed = 0;
    const session = createDraftSession({
      initial: draft('', ''),
      fresh: true,
      save: () => true,
      remove: () => {
        removed += 1;
      },
      exists: () => true,
    });
    session.mount();
    session.unmount();
    session.mount();
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(removed, 0);
    session.unmount();
    assert.equal(removed, 0);
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(removed, 1);
  });
});
