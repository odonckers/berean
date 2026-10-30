// The search query lifecycle, kept free of React Native so Node can test it:
// typing is debounced, each query the core runs gets a request id, and only
// the latest request's outcome is ever shown. Searching itself is the core's
// (the injected `query`); nothing here matches or ranks.

/** What the core reported for a failed query. */
export type QueryFailure = { kind: 'invalid' } | { kind: 'failed'; message: string };

export type SearchState<H> =
  // No query: nothing has been asked of the core.
  | { status: 'empty' }
  // A query is pending or running. `hits` are the last settled results, kept
  // on screen so loading doesn't jump the layout.
  | { status: 'loading'; text: string; hits: readonly H[] }
  | { status: 'done'; text: string; hits: readonly H[] }
  | { status: 'error'; text: string; message: string };

export type Timers = {
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

export type SearchSessionOptions<H> = {
  /** Runs `text` in the core. `signal` aborts once the query is superseded. */
  query: (text: string, signal: AbortSignal) => Promise<readonly H[]>;
  /** Sorts a rejection into the core's `Invalid` (no results) or a failure. */
  classifyError: (error: unknown) => QueryFailure;
  onChange: (state: SearchState<H>) => void;
  debounceMs: number;
  timers?: Timers;
};

export type SearchSession = {
  /** The field's text, on every keystroke. */
  setText: (text: string) => void;
  /** Cancels anything pending; later outcomes are dropped. */
  dispose: () => void;
};

const defaultTimers: Timers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createSearchSession<H>(options: SearchSessionOptions<H>): SearchSession {
  const { query, classifyError, onChange, debounceMs } = options;
  const timers = options.timers ?? defaultTimers;

  let state: SearchState<H> = { status: 'empty' };
  // Bumped by every query started and every clear: an outcome whose id is no
  // longer current belongs to a superseded query and is dropped.
  let requestId = 0;
  let timer: unknown;
  let inFlight: AbortController | undefined;
  // The text of the query pending or shown, so whitespace-only edits
  // ("light" -> "light ") don't search again.
  let current = '';

  const set = (next: SearchState<H>) => {
    state = next;
    onChange(next);
  };

  const cancelPending = () => {
    if (timer !== undefined) {
      timers.clearTimeout(timer);
      timer = undefined;
    }
    inFlight?.abort();
    inFlight = undefined;
    requestId += 1;
  };

  const run = (text: string) => {
    timer = undefined;
    const id = ++requestId;
    const controller = new AbortController();
    inFlight = controller;
    // A synchronous throw in `query` is handled like a rejection.
    Promise.resolve()
      .then(() => query(text, controller.signal))
      .then(
        (hits) => {
          if (id !== requestId) return;
          inFlight = undefined;
          set({ status: 'done', text, hits });
        },
        (error: unknown) => {
          if (id !== requestId) return;
          inFlight = undefined;
          const failure = classifyError(error);
          set(
            failure.kind === 'invalid'
              ? { status: 'done', text, hits: [] }
              : { status: 'error', text, message: failure.message },
          );
        },
      );
  };

  return {
    setText(raw) {
      const text = raw.trim();
      if (text === current) return;
      current = text;
      cancelPending();
      if (text === '') {
        set({ status: 'empty' });
        return;
      }
      const hits = state.status === 'loading' || state.status === 'done' ? state.hits : [];
      set({ status: 'loading', text, hits });
      timer = timers.setTimeout(() => run(text), debounceMs);
    },
    dispose() {
      cancelPending();
      current = '';
    },
  };
}
