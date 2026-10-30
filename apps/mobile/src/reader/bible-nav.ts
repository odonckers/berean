// Chapter headings and Previous/Next across books, kept free of React
// Native so Node can test them. The book shapes are the parts of the
// core's BibleBook these need; the order of books is always the core's.

export type BookName = { name: string; chapterName?: string };
export type BookSpan = { book: number; chapterCount: number };
export type ChapterLocation = { book: number; chapter: number };

/**
 * "Genesis 1", or "Psalm 23" where the book names its chapters. Without
 * the book (the core couldn't list them) it falls back to "Chapter 1".
 */
export function chapterHeading(book: BookName | undefined, chapter: number): string {
  return book === undefined ? `Chapter ${chapter}` : `${book.chapterName ?? book.name} ${chapter}`;
}

/** "Genesis 1:3": a chapter heading and a verse. */
export function verseReference(heading: string, verse: number): string {
  return `${heading}:${verse}`;
}

/** A Bible location, structurally: the parts of the core's Location these use. */
export type VerseLocation = { book?: number; chapter?: number; verse?: number };

/**
 * A span's reference, from the core's locations and the book list:
 * "Genesis 1:3", "Genesis 1:3–5", "Genesis 1:3–2:4", "Genesis 50:26–Exodus 1:2".
 * None for a book that isn't listed or a location without a chapter. An
 * end whose book isn't listed leaves just the start.
 */
export function spanReference(
  books: readonly (BookName & { book: number })[] | undefined,
  span: { start: VerseLocation; end: VerseLocation },
): string | undefined {
  const point = (at: VerseLocation) => {
    const book = books?.find((b) => b.book === at.book);
    if (book === undefined || at.chapter === undefined) return undefined;
    const heading = chapterHeading(book, at.chapter);
    return at.verse === undefined ? heading : verseReference(heading, at.verse);
  };
  const { start, end } = span;
  const first = point(start);
  if (first === undefined) return undefined;
  if (end.book !== start.book) {
    const last = point(end);
    return last === undefined ? first : `${first}–${last}`;
  }
  if (end.chapter === undefined) return first;
  if (end.chapter !== start.chapter) {
    const last = end.verse === undefined ? String(end.chapter) : verseReference(String(end.chapter), end.verse);
    return `${first}–${last}`;
  }
  return start.verse === undefined || end.verse === undefined || end.verse === start.verse
    ? first
    : `${first}–${end.verse}`;
}

/** "50 chapters", "1 chapter". */
export function chapterCountLabel(count: number): string {
  return count === 1 ? '1 chapter' : `${count} chapters`;
}

/**
 * The chapter before `at`: the previous chapter in the book, else the last
 * chapter of the book before it, else none (the first chapter of the first
 * book). Without the books, or for a book not among them, it stays in the
 * book.
 */
export function previousChapter(
  books: readonly BookSpan[] | undefined,
  at: ChapterLocation,
): ChapterLocation | undefined {
  if (at.chapter > 1) return { book: at.book, chapter: at.chapter - 1 };
  const index = books?.findIndex((b) => b.book === at.book) ?? -1;
  const before = index > 0 ? books?.[index - 1] : undefined;
  return before === undefined ? undefined : { book: before.book, chapter: before.chapterCount };
}

/**
 * The chapter after `at`: the next chapter in the book, else the first
 * chapter of the book after it, else none (the last chapter of the last
 * book). Without the books, or for a book not among them, it stays in the
 * book.
 */
export function nextChapter(
  books: readonly BookSpan[] | undefined,
  at: ChapterLocation,
): ChapterLocation | undefined {
  const index = books?.findIndex((b) => b.book === at.book) ?? -1;
  const current = index === -1 ? undefined : books?.[index];
  if (current === undefined || at.chapter < current.chapterCount) {
    return { book: at.book, chapter: at.chapter + 1 };
  }
  const after = books?.[index + 1];
  return after === undefined ? undefined : { book: after.book, chapter: 1 };
}

/**
 * The key a chapter's state lives under (the session's open pane, the
 * chapter's text tree): publication, book and chapter.
 */
export function keyForChapter(pubKey: string, at: ChapterLocation): string {
  return `${pubKey}/${at.book}/${at.chapter}`;
}

/**
 * Whether the chapter scroll goes back to the top: on every change of
 * chapter (Previous/Next, the picker, new route params), never on a mount
 * (no previous key), which is where a restored session keeps its place.
 */
export function shouldResetScroll(previous: string | undefined, next: string): boolean {
  return previous !== undefined && previous !== next;
}
