import { CoreError } from 'berean-ffi-rn';

/**
 * A readable message for an error thrown across the FFI. ubrn passes no
 * message to the Error constructor, so `e.message` is only "CoreError.Io";
 * every CoreError variant's `toString()` instead calls into Rust and returns
 * the core error's Display text, detail included.
 */
export function coreErrorMessage(e: unknown): string {
  // Not `instanceof`: Babel breaks Error subclassing (ubrn errors idiom).
  // CoreError.instanceOf indexes its argument, so rule out null first.
  if (typeof e !== 'object' || e === null || !CoreError.instanceOf(e)) {
    return `not a CoreError: ${String(e)}`;
  }
  return e.toString();
}
