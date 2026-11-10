import {
  CoreError,
  CoreError_Tags,
  type BibleBook,
  type Hit,
  type Location,
  type SearchLike,
  type SearchScope,
  type TopicSuggestion,
} from 'berean-ffi-rn';
import { router, useSegments } from 'expo-router';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { AccessibilityInfo } from 'react-native';

import { getCore, library, reader } from '@/ffi/core';
import { displayTitle } from '@/library/labels';
import { load, type Loaded } from '@/library/load';
import { chapterHeading, verseReference } from '@/reader/bible-nav';
import {
  groupHits,
  isTruncated,
  resultsLabel,
  SEARCH_LIMIT,
  type Group,
  type Scope,
} from '@/search/results';
import { createSearchSession, type QueryFailure, type SearchState } from '@/search/search-session';
import { snippetRuns, snippetText, type SnippetRun } from '@/search/snippet';
import {
  createSuggestSession,
  fillText,
  SUGGEST_LIMIT,
  type ShownSuggestions,
} from '@/search/suggestions';

/** A hit as rows show it. */
export type ResultRow = {
  key: string;
  hit: Hit;
  location: Hit['location'];
  /** "John 1:4", or the document title. */
  title: string;
  runs: SnippetRun[];
  /** "John 1:4, In him was life…" */
  accessibilityLabel: string;
};

export type SearchContextValue = {
  /** The field's text, shared by every entry so the query carries over. */
  text: string;
  setText: (text: string) => void;
  state: SearchState<Hit>;
  /** The settled or still-shown results, grouped in the guide's order. */
  groups: Group<ResultRow>[];
  total: number;
  truncated: boolean;
  scope: Scope;
  setScope: (scope: Scope) => void;
  /** Opens the hit (or a topic) in the reader, collapsing the search view if it is open. */
  open: (target: { location: Location }) => void;
  /** Suggestions for the text as typed: Insight topics and completed queries. */
  suggestions: ShownSuggestions<TopicSuggestion>;
  /**
   * Puts a suggested query in the field, with a space after it for the next
   * word. `fills` counts these, so an entry that keeps its own text (the
   * native iOS field) can take it.
   */
  choose: (query: string) => void;
  fills: number;
};

const DEBOUNCE_MS = 220;
// Suggestions are cheap and should keep up with typing.
const SUGGEST_DEBOUNCE_MS = 90;

// Every installed publication: an empty filter does not filter.
const ALL: SearchScope = { pubKeys: [], kinds: [], languages: [], offset: 0 };

const FAILED_MESSAGE = "Search isn't available right now. Try again.";

// The core's own Display text can carry paths, so the UI shows a fixed line.
function classifyError(e: unknown): QueryFailure {
  if (typeof e === 'object' && e !== null && CoreError.instanceOf(e) && e.tag === CoreError_Tags.Invalid) {
    return { kind: 'invalid' };
  }
  return { kind: 'failed', message: FAILED_MESSAGE };
}

let search: SearchLike | undefined;

function coreSearch(): SearchLike {
  search ??= getCore().search();
  return search;
}

// Book lists per Bible, read once each; a failed read is tried again.
const booksByBible = new Map<string, BibleBook[]>();

function books(pubKey: string): Loaded<BibleBook[]> {
  const cached = booksByBible.get(pubKey);
  if (cached !== undefined) return { ok: true, value: cached };
  const listed = load(() => reader().bibleBooks(pubKey));
  if (listed.ok) booksByBible.set(pubKey, listed.value);
  return listed;
}

// "John 1:4" from the Bible's book list; the hit's own "John 1" title with
// the verse if the books can't be read.
function rowTitle(hit: Hit): string {
  const { pubKey, book, chapter, verse } = hit.location;
  if (verse === undefined) return hit.title;
  const listed = books(pubKey);
  const entry = listed.ok ? listed.value.find((b) => b.book === book) : undefined;
  return entry === undefined || chapter === undefined
    ? verseReference(hit.title, verse)
    : verseReference(chapterHeading(entry, chapter), verse);
}

function rowKey({ location: l }: Hit, index: number): string {
  return `${index}:${l.pubKey}/${l.docId ?? ''}/${l.book ?? ''}/${l.chapter ?? ''}/${l.verse ?? ''}/${l.paragraph ?? ''}`;
}

function announcement(state: SearchState<Hit>): string | undefined {
  if (state.status === 'error') return state.message;
  if (state.status !== 'done') return undefined;
  if (state.hits.length === 0) return `No results for “${state.text}”`;
  return resultsLabel(state.hits.length, isTruncated(state.hits.length));
}

const SearchContext = createContext<SearchContextValue | undefined>(undefined);

// Mounted once at the root, so the native entry and the Ctrl+K palette show
// one query and one set of results.
export function SearchProvider({ children }: { children: ReactNode }) {
  const [text, setTextState] = useState('');
  const [state, setState] = useState<SearchState<Hit>>({ status: 'empty' });
  const [scope, setScope] = useState<Scope>('all');
  const [suggestions, setSuggestions] = useState<ShownSuggestions<TopicSuggestion>>({
    text: '',
    topics: [],
    queries: [],
  });
  const [fills, setFills] = useState(0);
  // The full-screen search view is the root route ['search-view']; the iOS
  // look's tab is ['(tabs)', 'search'].
  const segments = useSegments();
  const inSearchView = segments[0] === 'search-view';

  const session = useMemo(
    () =>
      createSearchSession<Hit>({
        query: (query, signal) => {
          const run = () => coreSearch().query(query, ALL, SEARCH_LIMIT, { signal });
          // Dev menu toggle; inside `if (__DEV__)` so release bundles drop it.
          if (__DEV__) {
            return import('./dev-fault').then(({ simulatingCoreFailure }) =>
              simulatingCoreFailure() ? Promise.reject(new Error('Simulated core failure (dev menu)')) : run(),
            );
          }
          return run();
        },
        classifyError,
        onChange: setState,
        debounceMs: DEBOUNCE_MS,
      }),
    [],
  );
  useEffect(() => () => session.dispose(), [session]);

  const suggester = useMemo(
    () =>
      createSuggestSession<TopicSuggestion>({
        suggest: (query, signal) => coreSearch().suggest(query, ALL, SUGGEST_LIMIT, { signal }),
        onChange: setSuggestions,
        debounceMs: SUGGEST_DEBOUNCE_MS,
      }),
    [],
  );
  useEffect(() => () => suggester.dispose(), [suggester]);

  const setText = useCallback(
    (next: string) => {
      setTextState(next);
      session.setText(next);
      suggester.setText(next);
    },
    [session, suggester],
  );

  const choose = useCallback(
    (query: string) => {
      setText(fillText(query));
      setFills((n) => n + 1);
    },
    [setText],
  );

  const hits = state.status === 'done' || state.status === 'loading' ? state.hits : undefined;
  const groups = useMemo(
    () =>
      groupHits(
        (hits ?? []).map((hit, index) => {
          const title = rowTitle(hit);
          return {
            key: rowKey(hit, index),
            hit,
            location: hit.location,
            title,
            runs: snippetRuns(hit.snippet),
            accessibilityLabel: `${title}, ${snippetText(hit.snippet)}`,
          };
        }),
      ),
    [hits],
  );
  const total = hits?.length ?? 0;

  useEffect(() => {
    const message = announcement(state);
    if (message !== undefined) {
      AccessibilityInfo.announceForAccessibilityWithOptions(message, { queue: true });
    }
  }, [state]);

  const open = useCallback(
    ({ location }: { location: Location }) => {
      const { pubKey, docId, book, chapter, verse } = location;
      const pub = load(() => library().installed().find((p) => p.pubKey === pubKey));
      const title = pub.ok && pub.value !== undefined ? displayTitle(pub.value) : '';
      // Collapse the full-screen search view first, so the reader isn't
      // opened underneath it.
      if (inSearchView) router.back();
      if (verse !== undefined && book !== undefined && chapter !== undefined) {
        // The Bible route opens the chapter scrolled to the verse.
        router.navigate({
          pathname: '/',
          params: {
            pubKey,
            title,
            book: String(book),
            chapter: String(chapter),
            verse: String(verse),
          },
        });
      } else if (docId !== undefined) {
        router.navigate({ pathname: '/publication', params: { pubKey, title, docId: String(docId) } });
      }
    },
    [inSearchView],
  );

  const value = useMemo(
    () => ({
      text,
      setText,
      state,
      groups,
      total,
      truncated: isTruncated(total),
      scope,
      setScope,
      open,
      suggestions,
      choose,
      fills,
    }),
    [text, setText, state, groups, total, scope, open, suggestions, choose, fills],
  );
  return <SearchContext.Provider value={value}>{children}</SearchContext.Provider>;
}

export function useSearch(): SearchContextValue {
  const value = useContext(SearchContext);
  if (value === undefined) throw new Error('useSearch outside SearchProvider');
  return value;
}
