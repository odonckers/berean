// Compile-time checks for coreErrorMessage. Nothing runs: `npm run typecheck`
// fails if the CoreError tuple variants stop carrying their detail string in
// `inner[0]`, which coreErrorMessage reads.
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
  // The tuple variants carry their detail as a string at inner[0].
  Expect<Equal<Variant<CoreError_Tags.Io>['inner'][0], string>>,
  Expect<Equal<Variant<CoreError_Tags.Migration>['inner'][0], string>>,
  Expect<Equal<Variant<CoreError_Tags.Invalid>['inner'][0], string>>,
];
