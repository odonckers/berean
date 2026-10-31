// The Write view's syntax ranges: where the Markdown source has a heading
// marker, emphasis markers, a link's brackets and target, a #tag. The core
// reports them from the same parser that renders Read; nothing here reads
// Markdown. Kept free of React Native so Node can test it.

/** What a range of source is, as the core's markdown_spans names it. */
export type SyntaxKind =
  | 'headingMarker'
  | 'emphasisMarker'
  | 'strongMarker'
  | 'strikeMarker'
  | 'codeMarker'
  | 'code'
  | 'linkBracket'
  | 'linkUrl'
  | 'listMarker'
  | 'taskMarker'
  | 'quoteMarker'
  | 'rule'
  | 'tag';

/** A range of the source, in UTF-16 offsets (what JS strings index by), end exclusive. */
export type SourceSpan = { start: number; end: number; kind: SyntaxKind };

/** A run of the source to draw, styled by its kind, or plain without one. */
export type StyledSegment = { text: string; kind?: SyntaxKind };

const NO_SPANS: readonly SourceSpan[] = [];

/**
 * The syntax ranges of a note's Markdown. None until the core's
 * markdown_spans lands (docs/design/markdown-notes.md Q7, Echo's Holding
 * row); then this calls it and nothing else changes.
 */
export function useSyntaxSpans(markdown: string): readonly SourceSpan[] {
  return NO_SPANS;
}

/**
 * The text cut into runs that cover it exactly once, in order: each span's
 * run with its kind, plain runs between. Spans are taken by start; a span
 * past the text is clipped to it, one overlapping an earlier span keeps
 * only its part after it, and an empty or invalid span is dropped.
 */
export function styledSegments(text: string, spans: readonly SourceSpan[]): StyledSegment[] {
  const clamp = (n: number) => Math.min(Math.max(Math.trunc(n), 0), text.length);
  const sorted = spans
    .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const segments: StyledSegment[] = [];
  let at = 0;
  for (const span of sorted) {
    const start = Math.max(clamp(span.start), at);
    const end = clamp(span.end);
    if (end <= start) continue;
    if (start > at) segments.push({ text: text.slice(at, start) });
    segments.push({ text: text.slice(start, end), kind: span.kind });
    at = end;
  }
  if (at < text.length) segments.push({ text: text.slice(at) });
  return segments;
}
