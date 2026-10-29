// Compile-time checks for coreErrorMessage. Nothing runs: `npm run typecheck`
// fails if a CoreError variant stops exposing the Display-backed `toString()`
// that coreErrorMessage returns.
import type { CoreError, CoreError_Tags } from 'berean-ffi-rn';

import type { coreErrorMessage } from '../errors';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

type Variant<Tag extends CoreError_Tags> = Extract<CoreError, { tag: Tag }>;

export type CoreErrorMessageChecks = [
  Expect<Equal<typeof coreErrorMessage, (e: unknown) => string>>,
  // Every variant's toString() returns Rust's Display text as a string.
  Expect<Equal<ReturnType<CoreError['toString']>, string>>,
  Expect<Equal<ReturnType<Variant<CoreError_Tags.NotFound>['toString']>, string>>,
  Expect<Equal<ReturnType<Variant<CoreError_Tags.Io>['toString']>, string>>,
];
