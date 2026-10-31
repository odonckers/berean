import { markdownSpans } from 'berean-ffi-rn';
import { useMemo } from 'react';

import { fromCoreSpans, type SourceSpan } from '@/notes/syntax-spans';

const NO_SPANS: readonly SourceSpan[] = [];

/**
 * The syntax ranges of a note's Markdown, from the core's markdown_spans
 * (docs/design/markdown-notes.md Q7), again only when the text changes. If
 * the call fails the body shows as plain text rather than taking the
 * editor down.
 */
export function useSyntaxSpans(markdown: string): readonly SourceSpan[] {
  return useMemo(() => {
    try {
      return fromCoreSpans(markdownSpans(markdown));
    } catch {
      return NO_SPANS;
    }
  }, [markdown]);
}
