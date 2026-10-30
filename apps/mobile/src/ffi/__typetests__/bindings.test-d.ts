// Compile-time checks on the generated berean-ffi bindings. Nothing runs:
// `npm run typecheck` fails if the binding shapes the app relies on drift
// (docs/design/mobile-bindings.md §3, §4, §7.2, §7.4).
import type {
  Catalog,
  Hit,
  Library,
  ProgressSink,
  PublicationSummary,
  Search,
  SearchScope,
} from 'berean-ffi-rn';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

export type BindingShapeChecks = [
  // The long calls are async at the FFI (§7.2).
  Expect<Equal<ReturnType<Catalog['ingestFile']>, Promise<void>>>,
  Expect<Equal<ReturnType<Library['install']>, Promise<void>>>,
  // Search runs off the JS thread and takes an abort signal (src/search).
  Expect<
    Equal<
      Parameters<Search['query']>,
      [text: string, scope: SearchScope, limit: number, asyncOpts_?: { signal: AbortSignal }]
    >
  >,
  Expect<Equal<ReturnType<Search['query']>, Promise<Hit[]>>>,
  // Short calls stay synchronous.
  Expect<Equal<ReturnType<Catalog['publications']>, PublicationSummary[]>>,
  // u64 progress counts arrive as bigint (§7.4).
  Expect<Equal<Parameters<ProgressSink['onProgress']>, [done: bigint, total: bigint]>>,
];
