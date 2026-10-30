import {
  CoreError,
  CoreError_Tags,
  type BibleBook,
  type Hit,
  type SearchLike,
  type SearchScope,
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
  /** Opens the hit in the reader, collapsing the search view if it is open. */
  open: (hit: Hit) => void;
};

const DEBOUNCE_MS = 220;

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
  // The full-screen search view is the root route ['search-view']; the iOS
  // look's tab is ['(tabs)', 'search'].
  const segments = useSegments();
  const inSearchView = segments[0] === 'search-view';

  const session = useMemo(
    () =>
      createSearchSession<Hit>({
        query: (query, signal) => coreSearch().query(query, ALL, SEARCH_LIMIT, { signal }),
        classifyError,
        onChange: setState,
        debounceMs: DEBOUNCE_MS,
      }),
    [],
  );
  useEffect(() => () => session.dispose(), [session]);

  const setText = useCallback(
    (next: string) => {
      setTextState(next);
      session.setText(next);
    },
    [session],
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
    (hit: Hit) => {
      const { pubKey, docId, book, chapter, verse } = hit.location;
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
    () => ({ text, setText, state, groups, total, truncated: isTruncated(total), scope, setScope, open }),
    [text, setText, state, groups, total, scope, open],
  );
  return <SearchContext.Provider value={value}>{children}</SearchContext.Provider>;
}

export function useSearch(): SearchContextValue {
  const value = useContext(SearchContext);
  if (value === undefined) throw new Error('useSearch outside SearchProvider');
  return value;
}
