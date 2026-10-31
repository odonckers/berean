// A verse's study content as the pane shows it, kept free of React Native
// so Node can test it. The shapes are structural: the generated VerseStudy
// and VerseStudyCounts are assignable to them.

import type { StudyAvailability } from 'berean-ffi-rn';

export type PaneTab = 'studyNotes' | 'crossRefs' | 'research' | 'footnotes';

type CoreSpan = {
  start: { book?: number; chapter?: number; verse?: number };
  end: { book?: number; chapter?: number; verse?: number };
};
// The generated StudyAvailability's cases, derived from the binding so they
// can't drift from the core: each case as a plain { tag, inner? } with the
// tag as its string, which object literals (the tests) can build. A new
// case in the core lands here and fails the exhaustive switch in paneStudy
// until it is handled there.
type Structural<A> = A extends { tag: infer Tag }
  ? A extends { inner: infer Inner }
    ? { tag: `${Tag & string}`; inner: Inner }
    : { tag: `${Tag & string}` }
  : never;
export type CoreAvailability = Structural<StudyAvailability>;
export type CoreVerseStudy = {
  studyNotes: readonly { label: string; text: string }[];
  crossRefs: readonly { label: string; target: CoreSpan; snippet?: string }[];
  footnotes: readonly { marker: string; text: string }[];
  availability: CoreAvailability;
};
export type CoreStudyCounts = {
  verse: number;
  studyNotes: number;
  crossRefs: number;
  footnotes: number;
};

/** One cross reference: its marker letter, the reference it names, its snippet. */
export type CrossRefItem = { label: string; reference?: string; snippet?: string };

/**
 * What the pane shows for a verse: the tabs with content, in the pane's
 * order, and each tab's items as the core gives them.
 */
export type PaneStudy = {
  tabs: PaneTab[];
  studyNotes: readonly { label: string; text: string }[];
  crossRefs: CrossRefItem[];
  footnotes: readonly { marker: string; text: string }[];
};

export const NO_STUDY: PaneStudy = { tabs: [], studyNotes: [], crossRefs: [], footnotes: [] };

/**
 * The pane's content for a verse's study. None (the core's verseStudy threw:
 * a Bible, chapter or verse it can't find, or another error) is the Empty
 * state. `reference` names a cross reference's target, or none.
 */
export function paneStudy(
  study: CoreVerseStudy | undefined,
  reference: (span: CoreSpan) => string | undefined,
): PaneStudy {
  if (study === undefined) return NO_STUDY;
  // The one place availability is read.
  let studyNotes: PaneStudy['studyNotes'];
  switch (study.availability.tag) {
    case 'Installed':
      studyNotes = study.studyNotes;
      break;
    case 'NotInstalled':
      // The notes are in a Study Edition that isn't installed. The pane
      // has no Not downloaded row yet, so they are hidden.
      studyNotes = [];
      break;
    case 'Unavailable':
      // No Study Edition to install: no catalog, or none for the Bible's
      // language. The notes section is hidden and nothing offers a
      // download; the Bible's own footnotes and cross refs still show.
      studyNotes = [];
      break;
    default: {
      const unhandled: never = study.availability;
      return unhandled;
    }
  }
  const crossRefs = study.crossRefs.map(({ label, target, snippet }) => {
    const item: CrossRefItem = { label };
    const named = reference(target);
    if (named !== undefined) item.reference = named;
    if (snippet !== undefined) item.snippet = snippet;
    return item;
  });
  const tabs: PaneTab[] = [];
  if (studyNotes.length > 0) tabs.push('studyNotes');
  if (crossRefs.length > 0) tabs.push('crossRefs');
  if (study.footnotes.length > 0) tabs.push('footnotes');
  return { tabs, studyNotes, crossRefs, footnotes: study.footnotes };
}

/**
 * The pane's tab row, in the spec's order: Study notes, Cross refs,
 * Research, Footnotes. While the study guide isn't installed, Research
 * offers it, before Footnotes; Research alone never counts as content, so
 * a verse with none has no tabs.
 */
export function shownTabs(tabs: readonly PaneTab[], guideInstalled: boolean): PaneTab[] {
  const content = tabs.filter((key) => key !== 'research');
  if (content.length === 0 || guideInstalled) return content;
  const footnotes = content.indexOf('footnotes');
  return footnotes === -1
    ? [...content, 'research']
    : [...content.slice(0, footnotes), 'research', ...content.slice(footnotes)];
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * A verse's study action, for screen readers: "Verse 3, opens study", with
 * what the core's markers count for it ("Verse 3, opens study, 2 cross
 * references, 1 footnote"); "Verse 3, closes study" while its study is open.
 * `subject` names the verse where it says more than its number: "Verse 3,
 * highlighted, yellow, opens study".
 */
export function studyActionLabel(
  verse: number,
  counts: CoreStudyCounts | undefined,
  open: boolean,
  subject = `Verse ${verse}`,
): string {
  if (open) return `${subject}, closes study`;
  const parts = [`${subject}, opens study`];
  if (counts !== undefined) {
    if (counts.studyNotes > 0) parts.push(count(counts.studyNotes, 'study note', 'study notes'));
    if (counts.crossRefs > 0) parts.push(count(counts.crossRefs, 'cross reference', 'cross references'));
    if (counts.footnotes > 0) parts.push(count(counts.footnotes, 'footnote', 'footnotes'));
  }
  return parts.join(', ');
}

/** The markers by verse; none if the core gave none. */
export function markersByVerse(
  markers: readonly CoreStudyCounts[] | undefined,
): ReadonlyMap<number, CoreStudyCounts> {
  return new Map((markers ?? []).map((m) => [m.verse, m]));
}
