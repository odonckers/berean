// A trailing debounce with flush and cancel, for writes that should land
// once a burst settles: the camera's setViewport, and later a reader card's
// setReaderState. The timer is injectable so tests run without waiting.
// Kept free of React Native.

export type Timer = {
  set: (run: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
};

const systemTimer: Timer = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export type Debounced<T> = {
  /** Remember `value`, and run with it `ms` after the last call. */
  call: (value: T) => void;
  /** Run now with the pending value, if there is one. */
  flush: () => void;
  /** Drop the pending value. */
  cancel: () => void;
  pending: () => boolean;
};

export function debounce<T>(run: (value: T) => void, ms: number, timer: Timer = systemTimer): Debounced<T> {
  let handle: unknown;
  let waiting: { value: T } | undefined;

  const cancel = () => {
    if (waiting !== undefined) timer.clear(handle);
    waiting = undefined;
    handle = undefined;
  };

  const flush = () => {
    const due = waiting;
    cancel();
    if (due !== undefined) run(due.value);
  };

  return {
    call: (value) => {
      if (waiting !== undefined) timer.clear(handle);
      waiting = { value };
      handle = timer.set(flush, ms);
    },
    flush,
    cancel,
    pending: () => waiting !== undefined,
  };
}
