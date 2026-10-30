// Notes in the reader (guide §7.2), kept free of React Native so Node can
// test it. The core picks the chapter's notes (notes({ location })); this
// only groups them by the verse each is at and words the markers.

// Self-contained (no value imports), so both the app and `node --test` load it.

const noteCount = (n: number) => `${n} ${n === 1 ? 'note' : 'notes'}`;

type VerseNote = { location?: { book?: number; chapter?: number; verse?: number } };

/** The chapter's notes by the verse each is at, in the order given; notes on no verse are left out. */
export function notesByVerse<N extends VerseNote>(
  notes: readonly N[],
  at: { book: number; chapter: number },
): ReadonlyMap<number, N[]> {
  const byVerse = new Map<number, N[]>();
  for (const note of notes) {
    const loc = note.location;
    if (loc?.verse === undefined || loc.book !== at.book || loc.chapter !== at.chapter) continue;
    const list = byVerse.get(loc.verse);
    if (list) list.push(note);
    else byVerse.set(loc.verse, [note]);
  }
  return byVerse;
}

/** Below this window width (dp/pt) the reader has no margin for markers. */
export const MARKER_MIN_WIDTH = 400;

/**
 * Margin markers where the reader has a margin; a count badge on the verse
 * number on narrow windows and at accessibility text sizes, from
 * `largeTextScale` (the reader passes pane-snap's LARGE_TEXT_SCALE, where
 * the study pane switches to its large-text detents).
 */
export function noteMarkerMode(windowWidth: number, fontScale: number, largeTextScale: number): 'margin' | 'badge' {
  return windowWidth >= MARKER_MIN_WIDTH && fontScale < largeTextScale ? 'margin' : 'badge';
}

/** One margin marker: the verses whose first lines share a line, and their notes' total. */
export type MarkerGroup = { verses: number[]; count: number; line: string };

/**
 * Markers, one per line: verses (in order) whose first lines fall on the
 * same line merge into one marker, as the guide merges adjacent verses.
 */
export function mergeMarkers(entries: readonly { verse: number; line: string; count: number }[]): MarkerGroup[] {
  const groups: MarkerGroup[] = [];
  for (const entry of entries) {
    const last = groups.at(-1);
    if (last !== undefined && last.line === entry.line) {
      last.verses.push(entry.verse);
      last.count += entry.count;
    } else {
      groups.push({ verses: [entry.verse], count: entry.count, line: entry.line });
    }
  }
  return groups;
}

/** A margin marker's label: "Genesis 1:4, 2 notes"; merged, "Genesis 1:4 to 6, 3 notes". */
export function markerLabel(heading: string, verses: readonly number[], count: number): string {
  const first = verses[0];
  const last = verses.at(-1);
  const range = last === undefined || last === first ? `${first}` : `${first} to ${last}`;
  return `${heading}:${range}, ${noteCount(count)}`;
}

/** The marker's visible count: none for a single note. */
export function markerCount(count: number): string | undefined {
  return count > 1 ? String(count) : undefined;
}

/**
 * A verse as screen readers name it in its actions: "Verse 4, 2 notes",
 * with its highlight after: "Verse 4, 2 notes, highlighted, yellow".
 */
export function verseNotesSubject(verse: number, notes: number, spokenColor: string | undefined): string {
  const parts = [`Verse ${verse}`];
  if (notes > 0) parts.push(noteCount(notes));
  if (spokenColor !== undefined) parts.push('highlighted', spokenColor);
  return parts.join(', ');
}

export function showNotesLabel(verse: number): string {
  return `Verse ${verse}, show notes`;
}

export function addNoteLabel(verse: number): string {
  return `Verse ${verse}, add note`;
}

/** The study pane's My notes header: "My notes · 2", or "My notes" with none. */
export function myNotesHeader(count: number): string {
  return count > 0 ? `My notes · ${count}` : 'My notes';
}

/**
 * The Notes columns for a window width (guide §7.1): three (folders, list,
 * note) from 1000, two (list, note) from 640, else one, drilling in.
 */
export function notesColumns(windowWidth: number): 1 | 2 | 3 {
  return windowWidth >= 1000 ? 3 : windowWidth >= 640 ? 2 : 1;
}
