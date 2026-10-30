// Note lists as the Notes screens show them, kept free of React Native so
// Node can test it. The core selects the notes (notes(filter)); this only
// orders, counts and words what it returns. The shape is structural: the
// generated Note is assignable to it.

export type ListNote = {
  id: string;
  title: string;
  /** ISO-8601 UTC, as the core stamps it. */
  created: string;
  modified: string;
  tagIds: readonly bigint[];
};

/** How many notes Recents shows. */
export const RECENTS_LIMIT = 20;

/**
 * Most recently modified first; ties by most recently made, then id, so
 * the order is stable. The core's ISO-8601 UTC stamps sort as text.
 */
export function byModified<N extends ListNote>(notes: readonly N[]): N[] {
  const desc = (a: string, b: string) => (a < b ? 1 : a > b ? -1 : 0);
  return [...notes].sort(
    (a, b) => desc(a.modified, b.modified) || desc(a.created, b.created) || desc(a.id, b.id),
  );
}

/** Recents: the RECENTS_LIMIT most recently modified notes. */
export function recentNotes<N extends ListNote>(notes: readonly N[]): N[] {
  return byModified(notes).slice(0, RECENTS_LIMIT);
}

/** `notes` in their order, keeping only those whose id is in `ids` (another core read's notes). */
export function keepIds<N extends ListNote>(notes: readonly N[], ids: Iterable<string>): N[] {
  const keep = new Set(ids);
  return notes.filter((n) => keep.has(n.id));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * A note's date, short, in local time: "Oct 28" this year, "Oct 28, 2025"
 * otherwise. Empty for a stamp that doesn't parse.
 */
export function shortDate(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const day = `${MONTHS[date.getMonth()]} ${date.getDate()}`;
  return date.getFullYear() === now.getFullYear() ? day : `${day}, ${date.getFullYear()}`;
}

/** "1 note", "6 notes". */
export function noteCount(n: number): string {
  return `${n} ${n === 1 ? 'note' : 'notes'}`;
}

/** The count line over a filtered list: "2 of 6 notes". */
export function countLine(shown: number, total: number): string {
  return `${shown} of ${noteCount(total)}`;
}

/** A title to show: the note's, or "Untitled" for a blank one. */
export function noteTitle(note: { title: string }): string {
  const title = note.title.trim();
  return title === '' ? 'Untitled' : title;
}

/** A note row's accessibility label: "Light before law, Oct 28, The witness is not the light…". */
export function noteAccessibilityLabel(title: string, date: string, snippet: string): string {
  return [title, date, snippet].filter((part) => part !== '').join(', ');
}

/** A note row's quiet metadata: its location's reference and its folder, whichever it has. */
export function noteMeta(reference: string | undefined, folder: string | undefined): string[] {
  return [reference, folder].filter((part): part is string => part !== undefined && part !== '');
}

/**
 * The tag chips over a list: the tags, in the core's order, that any of
 * the listed notes has, and any already selected (so a chip never vanishes
 * while on). `locked` (the tag a tag list is for) is left out.
 */
export function chipTags<T extends { id: bigint }>(
  tags: readonly T[],
  notes: readonly ListNote[],
  selected: readonly bigint[],
  locked?: bigint,
): T[] {
  const used = new Set<bigint>(selected);
  for (const note of notes) for (const id of note.tagIds) used.add(id);
  return tags.filter((t) => t.id !== locked && used.has(t.id));
}

/** Turn a chip on or off; selected tags combine with AND in the core's filter. */
export function toggleTag(selected: readonly bigint[], id: bigint): bigint[] {
  return selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id];
}

/** Delete note's confirmation. */
export function deleteNotePrompt(title: string): { title: string; message: string } {
  return { title: `Delete “${title}”?`, message: 'This note will be deleted. This can’t be undone.' };
}
