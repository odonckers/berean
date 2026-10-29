// Compile-time checks on the generated berean-ffi bindings. Nothing runs:
// `npm run typecheck` fails if the binding shapes the app relies on drift
// (docs/design/mobile-bindings.md §3, §4, §7.2, §7.4).
import type {
  Catalog,
  Library,
  ProgressSink,
  PublicationSummary,
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
  // Short calls stay synchronous.
  Expect<Equal<ReturnType<Catalog['publications']>, PublicationSummary[]>>,
  // u64 progress counts arrive as bigint (§7.4).
  Expect<Equal<Parameters<ProgressSink['onProgress']>, [done: bigint, total: bigint]>>,
];
