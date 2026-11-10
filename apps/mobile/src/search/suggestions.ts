// Suggestions while typing, kept free of React Native so Node can test it:
// typing is debounced, only the latest request's suggestions are shown, and
// until they arrive the last ones that still fit the text stay on screen so
// the list doesn't flicker with every keystroke. The suggestions themselves
// are the core's (the injected `suggest`).

/** The parts of the core's Suggestions the app reads. */
export type CoreSuggestions<T> = { topics: readonly T[]; queries: readonly string[] };

export type TopicLike = { title: string };

/** What the list shows for some text. */
export type ShownSuggestions<T> = { text: string; topics: T[]; queries: string[] };

/** How many of each the list shows: enough to help, few enough to keep results in view. */
export const MAX_TOPICS = 2;
export const MAX_QUERIES = 3;

/** Asked of the core: a little more than shown, so carried-over ones can be cut. */
export const SUGGEST_LIMIT = 5;

export type Timers = {
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

export type SuggestSessionOptions<T> = {
  /** Asks the core. `signal` aborts once the text has changed again. */
  suggest: (text: string, signal: AbortSignal) => Promise<CoreSuggestions<T>>;
  onChange: (shown: ShownSuggestions<T>) => void;
  debounceMs: number;
  timers?: Timers;
};

export type SuggestSession = {
  /** The field's text, as typed: a trailing space means the word is done. */
  setText: (text: string) => void;
  dispose: () => void;
};

const defaultTimers: Timers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

const lower = (s: string) => s.toLocaleLowerCase();

/**
 * The suggestions for `previous.text` that still fit `text`, which was typed
 * after them: queries that extend it, topics whose title starts with it.
 * None once the text no longer extends the old text (a deletion, a space).
 */
export function carryOver<T extends TopicLike>(previous: ShownSuggestions<T>, text: string): ShownSuggestions<T> {
  const typed = lower(text);
  const extends_ = typed.startsWith(lower(previous.text)) && !/\s$/.test(text);
  if (!extends_ || text.trim() === '') return { text, topics: [], queries: [] };
  const topicText = lower(text.replace(/"/g, ' ').trim().replace(/\s+/g, ' '));
  return {
    text,
    topics: previous.topics.filter((t) => lower(t.title).startsWith(topicText)),
    queries: previous.queries.filter((q) => lower(q).startsWith(typed) && lower(q) !== typed),
  };
}

/** The core's answer cut to what the list shows. */
export function shown<T>(text: string, found: CoreSuggestions<T>): ShownSuggestions<T> {
  return {
    text,
    topics: found.topics.slice(0, MAX_TOPICS),
    queries: found.queries.slice(0, MAX_QUERIES),
  };
}

export function createSuggestSession<T extends TopicLike>(options: SuggestSessionOptions<T>): SuggestSession {
  const { suggest, onChange, debounceMs } = options;
  const timers = options.timers ?? defaultTimers;
  let current: ShownSuggestions<T> = { text: '', topics: [], queries: [] };
  let requestId = 0;
  let timer: unknown;
  let inFlight: AbortController | undefined;

  const set = (next: ShownSuggestions<T>) => {
    current = next;
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
    // Asked at once; a synchronous throw is handled like a rejection.
    let answer: Promise<CoreSuggestions<T>>;
    try {
      answer = suggest(text, controller.signal);
    } catch (error) {
      answer = Promise.reject(error);
    }
    answer.then(
        (found) => {
          if (id !== requestId) return;
          inFlight = undefined;
          set(shown(text, found));
        },
        // Suggestions are a help, not the search: a failure shows none.
        () => {
          if (id !== requestId) return;
          inFlight = undefined;
          set({ text, topics: [], queries: [] });
        },
      );
  };

  return {
    setText(text) {
      if (text === current.text) return;
      cancelPending();
      set(carryOver(current, text));
      // Nothing to complete: empty, or the word is done.
      if (text.trim() === '' || /\s$/.test(text)) return;
      timer = timers.setTimeout(() => run(text), debounceMs);
    },
    dispose() {
      cancelPending();
    },
  };
}

/** A query suggestion split for display: what was typed, then the completion. */
export function completionParts(query: string, typed: string): { typed: string; completion: string } {
  // The core keeps the typed text and completes its last word, possibly in
  // another case ("jeho" -> "Jehovah"), so the split is by length.
  const head = query.slice(0, typed.length);
  if (lower(head) !== lower(typed)) return { typed: '', completion: query };
  return { typed: head, completion: query.slice(typed.length) };
}

/** The text a chosen query puts in the field: the query and a space, so the next word can follow. */
export function fillText(query: string): string {
  return `${query} `;
}
