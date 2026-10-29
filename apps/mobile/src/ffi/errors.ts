import { CoreError } from 'berean-ffi-rn';

/**
 * A readable message for an error thrown across the FFI. ubrn passes no
 * message to the Error constructor, so `e.message` is only "CoreError.Io";
 * the detail of the tuple variants lives in `inner[0]`.
 */
export function coreErrorMessage(e: unknown): string {
  // Not `instanceof`: Babel breaks Error subclassing (ubrn errors idiom).
  // CoreError.instanceOf indexes its argument, so rule out null first.
  if (typeof e !== 'object' || e === null || !CoreError.instanceOf(e)) {
    return `not a CoreError: ${String(e)}`;
  }
  if ('inner' in e && typeof e.inner[0] === 'string') {
    return `CoreError.${e.tag}: ${e.inner[0]}`;
  }
  return `CoreError.${e.tag}`;
}
