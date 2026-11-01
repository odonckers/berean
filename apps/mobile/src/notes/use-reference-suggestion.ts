import { passageUrl, Resolved } from 'berean-ffi-rn';
import { useEffect, useState } from 'react';

import { reader } from '@/ffi/core';
import { REFERENCE_SUGGESTION_MAX_WORDS } from '@/notes/format-bar-config';
import { referenceCandidates, type Selection } from '@/notes/format-edits';

/** "Link John 1:14": the words before the cursor as a link to the passage. */
export type ReferenceSuggestion = { label: string; range: Selection; markdown: string };

// A pause in typing or moving the cursor before the core is asked.
const SUGGEST_DELAY_MS = 150;

/**
 * The core's link to the passage `reference` names (its resolve, then
 * passageUrl), or none when it isn't one or can't be read. Never throws.
 */
export function passageLink(reference: string): string | undefined {
  try {
    const resolved = reader().resolve(reference);
    return Resolved.Span.instanceOf(resolved) ? passageUrl(resolved.inner.span) : undefined;
  } catch {
    return undefined;
  }
}

/** The longest run of words before the cursor the core resolves to a passage, as a link. */
function suggestAt(text: string, cursor: number): ReferenceSuggestion | undefined {
  for (const candidate of referenceCandidates(text, cursor, REFERENCE_SUGGESTION_MAX_WORDS)) {
    const url = passageLink(candidate);
    if (url === undefined) continue;
    return {
      label: `Link ${candidate}`,
      range: { start: cursor - candidate.length, end: cursor },
      markdown: `[${candidate}](${url})`,
    };
  }
  return undefined;
}

/**
 * The Write view's "Link John 1:14" suggestion (guide §7.1): when the
 * words just before the cursor are a passage the core's resolve() knows,
 * a Markdown link to it made with the core's passageUrl. Asked again a
 * moment after the text or the cursor changes; none with a selection.
 */
export function useReferenceSuggestion(text: string, selection: Selection): ReferenceSuggestion | undefined {
  // What was asked for, so a suggestion for older text or another cursor never shows.
  const [found, setFound] = useState<{ text: string; cursor: number; suggestion?: ReferenceSuggestion }>();
  const cursor = selection.start === selection.end ? selection.end : undefined;

  useEffect(() => {
    if (cursor === undefined) return;
    const timer = setTimeout(() => setFound({ text, cursor, suggestion: suggestAt(text, cursor) }), SUGGEST_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text, cursor]);

  return found !== undefined && found.text === text && found.cursor === cursor ? found.suggestion : undefined;
}
