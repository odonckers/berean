// A rendered note body (the core's renderMarkdown tree) shaped for display,
// kept free of React Native so Node can test it. Nothing here reads
// Markdown: the core parses it, finds the links, tags and tasks; this only
// walks the tree it returns. The shapes are structural, each case a plain
// { tag, inner } with the tag as its string, which object literals (the
// tests) can build; the generated Block and Inline are assignable to them
// (src/ffi/__typetests__/note-blocks.test-d.ts).

export type NoteLocation = {
  pubKey: string;
  docId?: bigint;
  book?: number;
  chapter?: number;
  verse?: number;
  paragraph?: number;
};

export type NoteSpan = { start: NoteLocation; end: NoteLocation };

export type NoteLinkTarget =
  | { tag: 'Passage'; inner: { span: NoteSpan; missing: boolean } }
  | { tag: 'Publication'; inner: { location: NoteLocation; missing: boolean } }
  | { tag: 'External'; inner: { url: string } }
  | { tag: 'Invalid' };

export type NoteInline =
  | { tag: 'Text' | 'Code'; inner: { text: string } }
  | { tag: 'Emphasis' | 'Strong' | 'Strikethrough'; inner: { children: readonly NoteInline[] } }
  | { tag: 'Link'; inner: { children: readonly NoteInline[]; url: string; target: NoteLinkTarget } }
  | { tag: 'Tag'; inner: { name: string } }
  | { tag: 'LineBreak' };

export type NoteListItem = {
  task?: { index: number; checked: boolean };
  blocks: readonly NoteBlock[];
};

export type NoteBlock =
  | { tag: 'Heading'; inner: { level: number; inlines: readonly NoteInline[] } }
  | { tag: 'Paragraph'; inner: { inlines: readonly NoteInline[] } }
  | { tag: 'PassageCard'; inner: { text: string; span: NoteSpan; missing: boolean } }
  | { tag: 'List'; inner: { start?: number; items: readonly NoteListItem[] } }
  | { tag: 'Quote'; inner: { blocks: readonly NoteBlock[] } }
  | { tag: 'CodeBlock'; inner: { text: string } }
  | { tag: 'Rule' };

/** Inline content as plain text: tags as "#name", line breaks as spaces. */
export function inlineText(inlines: readonly NoteInline[]): string {
  return inlines
    .map((inline) => {
      switch (inline.tag) {
        case 'Text':
        case 'Code':
          return inline.inner.text;
        case 'Emphasis':
        case 'Strong':
        case 'Strikethrough':
        case 'Link':
          return inlineText(inline.inner.children);
        case 'Tag':
          return `#${inline.inner.name}`;
        case 'LineBreak':
          return ' ';
      }
    })
    .join('');
}

/** A block as plain text, its parts joined with spaces. */
export function blockText(block: NoteBlock): string {
  switch (block.tag) {
    case 'Heading':
    case 'Paragraph':
      return inlineText(block.inner.inlines);
    case 'PassageCard':
    case 'CodeBlock':
      return block.inner.text;
    case 'List':
      return block.inner.items.map((item) => item.blocks.map(blockText).join(' ')).join(' ');
    case 'Quote':
      return block.inner.blocks.map(blockText).join(' ');
    case 'Rule':
      return '';
  }
}

const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();

/**
 * The body without a leading level-1 heading that repeats the note's
 * title: the Read view shows the title above the body already.
 */
export function withoutTitleHeading<B extends NoteBlock>(blocks: readonly B[], title: string): B[] {
  const [first, ...rest] = blocks;
  if (
    first !== undefined &&
    first.tag === 'Heading' &&
    first.inner.level === 1 &&
    collapse(inlineText(first.inner.inlines)) === collapse(title)
  ) {
    return rest;
  }
  return [...blocks];
}

/** How long a snippet runs before the row's one line truncates it anyway. */
const SNIPPET_CHARS = 160;

/** A note row's one-line snippet: the body's text after any title heading, whitespace collapsed. */
export function noteSnippet(blocks: readonly NoteBlock[], title: string): string {
  return collapse(withoutTitleHeading(blocks, title).map(blockText).join(' ')).slice(0, SNIPPET_CHARS);
}

/**
 * The tag names of a paragraph that holds only #tags (and the spaces and
 * line breaks between them), drawn as a row of tag pills; none for any
 * other paragraph.
 */
export function tagLine(inlines: readonly NoteInline[]): string[] | undefined {
  const names: string[] = [];
  for (const inline of inlines) {
    if (inline.tag === 'Tag') names.push(inline.inner.name);
    else if (inline.tag === 'LineBreak') continue;
    else if (inline.tag === 'Text' && inline.inner.text.trim() === '') continue;
    else return undefined;
  }
  return names.length > 0 ? names : undefined;
}

/** Whether a link points at something not on this device (its Bible or publication). */
export function isMissing(target: NoteLinkTarget): boolean {
  return (target.tag === 'Passage' || target.tag === 'Publication') && target.inner.missing;
}

/** The single verse a passage span starts at, as the reader opens it. */
export function spanStart(span: NoteSpan): { pubKey: string; book: number; chapter: number; verse?: number } | undefined {
  const { pubKey, book, chapter, verse } = span.start;
  if (book === undefined || chapter === undefined) return undefined;
  return verse === undefined ? { pubKey, book, chapter } : { pubKey, book, chapter, verse };
}

/**
 * The verses of a span within one chapter, for a passage card's text; none
 * for a span over chapters or without verses (the card shows only its
 * reference then).
 */
export function spanVerses(span: NoteSpan): number[] | undefined {
  const { start, end } = span;
  if (start.verse === undefined || start.book !== end.book || start.chapter !== end.chapter) return undefined;
  const last = end.verse ?? start.verse;
  if (last < start.verse) return undefined;
  return Array.from({ length: last - start.verse + 1 }, (_, i) => start.verse! + i);
}

/** The missing-publication row's line: "Insight on the Scriptures, Vol. 2 is not on this device." */
export function missingLine(title: string): string {
  return `${title} is not on this device.`;
}
