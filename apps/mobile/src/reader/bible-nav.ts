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
