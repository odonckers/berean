// What a tap on a document's link does (docs/design/document-blocks.md §3,
// Link targets): the block carries a parsed target, and only a tap calls
// the core's resolve. Structural types, so Node can test it without the
// native module; the generated DocLinkTarget, Resolved and CoreError are
// assignable to them.

export const CANT_OPEN = 'Can’t open this link';
export const NOT_DOWNLOADED = 'This publication isn’t downloaded';

type CoreLocation = {
  pubKey: string;
  docId?: bigint;
  book?: number;
  chapter?: number;
  verse?: number;
  paragraph?: number;
};

export type CoreResolved =
  | { tag: 'Span'; inner: Readonly<{ span: Readonly<{ start: CoreLocation; end: CoreLocation }> }> }
  | { tag: 'External'; inner: Readonly<{ url: string }> };

export type LinkAction =
  | { kind: 'passage'; span: Readonly<{ start: CoreLocation; end: CoreLocation }> }
  | { kind: 'publication'; location: CoreLocation }
  | { kind: 'external'; url: string }
  | { kind: 'cant-open'; message: string };

/**
 * Where a link goes: `resolve` is the core's (Reader.resolve), called only
 * for a target the scanner could parse; an Invalid one never reaches it.
 * Errors come back as the can't-open state, never thrown: NotFound (the
 * linked publication isn't installed) says so, anything else is
 * "Can't open this link".
 */
export function linkAction(
  targetTag: string,
  url: string,
  resolve: (url: string) => CoreResolved,
  errorTag: (e: unknown) => string | undefined,
): LinkAction {
  if (targetTag === 'Invalid') return { kind: 'cant-open', message: CANT_OPEN };
  let resolved: CoreResolved;
  try {
    resolved = resolve(url);
  } catch (e) {
    return { kind: 'cant-open', message: errorTag(e) === 'NotFound' ? NOT_DOWNLOADED : CANT_OPEN };
  }
  if (resolved.tag === 'External') return { kind: 'external', url: resolved.inner.url };
  const { span } = resolved.inner;
  // A Bible span names a book; a publication's names a document.
  if (span.start.book !== undefined) return { kind: 'passage', span };
  return { kind: 'publication', location: span.start };
}
