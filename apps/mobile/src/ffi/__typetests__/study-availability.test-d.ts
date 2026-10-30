// Compile-time checks for the pane's CoreAvailability. Nothing runs: `npm run
// typecheck` fails if it stops covering every case of the generated
// StudyAvailability, or stops accepting the generated value.
import type { StudyAvailability, StudyAvailability_Tags } from 'berean-ffi-rn';

import type { CoreAvailability } from '../../reader/verse-study';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

export type StudyAvailabilityChecks = [
  // The same tags as the binding, Unavailable included.
  Expect<Equal<CoreAvailability['tag'], `${StudyAvailability_Tags}`>>,
  Expect<Equal<CoreAvailability['tag'], 'Installed' | 'NotInstalled' | 'Unavailable'>>,
  // The generated value is accepted where the pane reads it.
  Expect<StudyAvailability extends CoreAvailability ? true : false>,
];
