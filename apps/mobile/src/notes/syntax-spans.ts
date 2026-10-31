// The Write view's syntax ranges: where the Markdown source has a heading
// marker, emphasis markers, a link's brackets and target, a #tag. The core
// reports them (markdown_spans) from the same parser that renders Read;
// nothing here reads Markdown. Kept free of React Native so Node can test
// it: the core is only named in types here, and called in use-syntax-spans.
import type { SourceSpan as CoreSpan, SpanKind } from 'berean-ffi-rn';

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

/** The body field's selection, in UTF-16 offsets; start may be after end. */
export type Selection = { start: number; end: number };

/** A heading's level as Read draws it: 1, 2, or 3 and deeper. */
export type HeadingLevel = 1 | 2 | 3;

/**
 * A run of the source to draw: its syntax kind, if any, and what it sits
 * inside (a heading's line, between strong, emphasis or strike markers).
 * A folded run is a link target the selection is outside of.
 */
export type StyledSegment = {
  text: string;
  kind?: SyntaxKind;
  heading?: HeadingLevel;
  strong?: true;
  emphasis?: true;
  strike?: true;
  folded?: true;
};

// The core's SpanKind is a number, its place in the enum. Keyed by that
// number, each value must be the kind's own name, camel-cased, and a
// SyntaxKind: typecheck fails if the core adds, drops or reorders a kind.
type SyntaxKindByCore = {
  [Name in keyof typeof SpanKind as Name extends string ? `${(typeof SpanKind)[Name]}` : never]: Name extends string
    ? Uncapitalize<Name> & SyntaxKind
    : never;
};

const syntaxKindByCore = {
  0: 'headingMarker',
  1: 'emphasisMarker',
  2: 'strongMarker',
  3: 'strikeMarker',
  4: 'codeMarker',
  5: 'code',
  6: 'linkBracket',
  7: 'linkUrl',
  8: 'listMarker',
  9: 'taskMarker',
  10: 'quoteMarker',
  11: 'rule',
  12: 'tag',
} as const satisfies SyntaxKindByCore;

/** The Write view's name for a core SpanKind; none for one it doesn't know. */
export function syntaxKind(kind: SpanKind | number): SyntaxKind | undefined {
  return Object.hasOwn(syntaxKindByCore, kind) ? syntaxKindByCore[kind as SpanKind] : undefined;
}

/** The core's spans in the Write view's names, dropping any kind it doesn't know. */
export function fromCoreSpans(spans: readonly CoreSpan[]): SourceSpan[] {
  return spans.flatMap(({ start, end, kind }) => {
    const name = syntaxKind(kind);
    return name === undefined ? [] : [{ start, end, kind: name }];
  });
}

/** Spans sorted by start, clipped to the text, each after the one before; empty or invalid ones dropped. */
function normalized(text: string, spans: readonly SourceSpan[]): SourceSpan[] {
  const clamp = (n: number) => Math.min(Math.max(Math.trunc(n), 0), text.length);
  const sorted = spans
    .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const out: SourceSpan[] = [];
  let at = 0;
  for (const span of sorted) {
    const start = Math.max(clamp(span.start), at);
    const end = clamp(span.end);
    if (end <= start) continue;
    out.push({ start, end, kind: span.kind });
    at = end;
  }
  return out;
}

type Content = { start: number; end: number } & (
  | { heading: HeadingLevel }
  | { mark: 'strong' | 'emphasis' | 'strike' }
);

const pairedMarks = { strongMarker: 'strong', emphasisMarker: 'emphasis', strikeMarker: 'strike' } as const;

/**
 * What lies between markers, from the markers alone. The core marks only
 * delimiters that matched, so a kind's markers pair up in order: first with
 * second, third with fourth. (Strong inside strong pairs wrongly, as two
 * runs with a plain middle; nothing else of the text changes.) A heading
 * marker with words after it on its line opens an ATX heading, its length
 * the level; a setext underline or closing run has nothing after it.
 */
function contentRanges(text: string, spans: readonly SourceSpan[]): Content[] {
  const ranges: Content[] = [];
  const open = new Map<SyntaxKind, SourceSpan>();
  for (const span of spans) {
    if (span.kind === 'headingMarker') {
      const newline = text.indexOf('\n', span.end);
      const lineEnd = newline === -1 ? text.length : newline;
      if (text.slice(span.end, lineEnd).trim() !== '') {
        const level = Math.min(span.end - span.start, 3) as HeadingLevel;
        ranges.push({ start: span.start, end: lineEnd, heading: level });
      }
      continue;
    }
    if (span.kind !== 'strongMarker' && span.kind !== 'emphasisMarker' && span.kind !== 'strikeMarker') continue;
    const opener = open.get(span.kind);
    if (opener === undefined) {
      open.set(span.kind, span);
    } else {
      open.delete(span.kind);
      ranges.push({ start: opener.end, end: span.start, mark: pairedMarks[span.kind] });
    }
  }
  return ranges;
}

/**
 * Where a link target unfolds: from the bracket just before it ("](") to the
 * one just after (")"), or the target alone without them.
 */
function revealRange(spans: readonly SourceSpan[], i: number): { start: number; end: number } {
  const before = spans[i - 1];
  const after = spans[i + 1];
  return {
    start: before?.kind === 'linkBracket' ? before.start : spans[i].start,
    end: after?.kind === 'linkBracket' ? after.end : spans[i].end,
  };
}

/**
 * The text cut into runs that cover it exactly once, in order: each span's
 * run with its kind, plain runs between, each marked with the heading,
 * strong, emphasis or strike it sits inside. Spans are taken by start; a
 * span past the text is clipped to it, one overlapping an earlier span
 * keeps only its part after it, and an empty or invalid span is dropped.
 *
 * A link target is folded unless the selection is inside its reveal range
 * (an edge doesn't count, so a caret just after the link keeps it folded).
 * Without a selection (the field isn't focused) every target is folded.
 */
export function styledSegments(
  text: string,
  spans: readonly SourceSpan[],
  selection?: Selection,
): StyledSegment[] {
  const sorted = normalized(text, spans);
  const content = contentRanges(text, sorted);

  const unfolded = new Set<SourceSpan>();
  if (selection !== undefined) {
    const lo = Math.min(selection.start, selection.end);
    const hi = Math.max(selection.start, selection.end);
    sorted.forEach((span, i) => {
      if (span.kind !== 'linkUrl') return;
      const reveal = revealRange(sorted, i);
      if (lo < reveal.end && hi > reveal.start) unfolded.add(span);
    });
  }

  const cuts = new Set([0, text.length]);
  for (const r of [...sorted, ...content]) {
    cuts.add(r.start);
    cuts.add(r.end);
  }
  const points = [...cuts].sort((a, b) => a - b);

  const segments: StyledSegment[] = [];
  let next = 0;
  for (let p = 0; p + 1 < points.length; p++) {
    const start = points[p];
    const end = points[p + 1];
    if (end <= start) continue;
    while (next < sorted.length && sorted[next].end <= start) next++;
    const span = sorted[next] !== undefined && sorted[next].start <= start ? sorted[next] : undefined;
    const segment: StyledSegment = { text: text.slice(start, end) };
    if (span !== undefined) segment.kind = span.kind;
    for (const r of content) {
      if (r.start > start || r.end < end) continue;
      if ('heading' in r) segment.heading = r.heading;
      else segment[r.mark] = true;
    }
    if (span?.kind === 'linkUrl' && !unfolded.has(span)) segment.folded = true;
    segments.push(segment);
  }
  return segments;
}
