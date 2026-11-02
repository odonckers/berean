// Dev-only: sample workspaces made through the core API only. Imported solely
// from dev-look-menu.ts, inside `if (__DEV__)`.
import { CardRef, type Frame, type Location } from 'berean-ffi-rn';

import { library, userdata } from '@/ffi/core';
import { displayTitle } from '@/library/labels';
import { notesChanged } from '@/notes/changes';
import { allNotes, firstInstalledBible } from '@/notes/data';

const NAME = 'Sample workspace';

// Spread around (0,0) so fit-all, panning and the double tap have room to show.
const FRAMES: Frame[] = [
  { x: -620, y: -380, width: 260, height: 180 },
  { x: 140, y: -300, width: 300, height: 200 },
  { x: -420, y: 260, width: 260, height: 160 },
  { x: 520, y: 340, width: 280, height: 220 },
];

const FALLBACK_NOTES: [string, string][] = [
  ['Light before law', 'The witness is not the light (v. 8).'],
  ['Grace and truth', '“Full of grace and truth” sounds like Exodus 34:6.'],
  ['Water to wine', 'The first sign, at Cana. Why a wedding?'],
  ['Fountain of life', 'Psalm 36:9'],
];

/** Seeds the sample workspace; says what it did. Skips if it exists. */
export function seedSampleWorkspace(): string {
  const ud = userdata();
  if (ud.workspaces().some((w) => w.name === NAME)) return `“${NAME}” is already there.`;

  // The sample notes if they're seeded, else four of its own.
  let notes = allNotes().slice(0, FRAMES.length);
  if (notes.length < FRAMES.length) {
    for (const [title, content] of FALLBACK_NOTES.slice(notes.length)) {
      ud.addNote(title, content, undefined, undefined, undefined);
    }
    notes = allNotes().slice(0, FRAMES.length);
  }

  const workspace = ud.createWorkspace(NAME);
  notes.forEach((note, i) => ud.addItem(workspace.id, CardRef.Note.new({ noteId: note.id }), FRAMES[i]));
  // Studyspace reads again when the notes change.
  notesChanged();
  return `Seeded “${NAME}” with ${notes.length} note cards.`;
}

const READER_NAME = 'Reader workspace';
const JOHN = 43;

/** Seeds two reader cards (a passage, a publication) and a note; says what it did. Skips if it exists. */
export function seedReaderWorkspace(): string {
  const ud = userdata();
  if (ud.workspaces().some((w) => w.name === READER_NAME)) return `“${READER_NAME}” is already there.`;

  const said: string[] = [];
  const workspace = ud.createWorkspace(READER_NAME);

  // §6.2's default reader size, side by side.
  const bible = firstInstalledBible();
  if (bible) {
    const at = (verse: number): Location => ({ pubKey: bible.pubKey, book: JOHN, chapter: 1, verse });
    const card = CardRef.Passage.new({ span: { start: at(1), end: at(14) }, missing: false });
    ud.addItem(workspace.id, card, { x: 0, y: 0, width: 634, height: 568 });
    said.push(`John 1:1–14 in ${displayTitle(bible)}`);
  } else {
    said.push('no passage card (no Bible installed)');
  }

  const pub = library()
    .installed()
    .find((p) => p.pubKey !== bible?.pubKey);
  if (pub) {
    const card = CardRef.Publication.new({ location: { pubKey: pub.pubKey }, missing: false });
    ud.addItem(workspace.id, card, { x: 700, y: 0, width: 634, height: 568 });
    said.push(displayTitle(pub));
  } else {
    said.push('no publication card (no other publication installed)');
  }

  if (allNotes().length === 0) ud.addNote('Reading notes', '', undefined, undefined, undefined);
  const note = allNotes()[0];
  ud.addItem(workspace.id, CardRef.Note.new({ noteId: note.id }), { x: -320, y: 0, width: 260, height: 180 });
  said.push('a note card');

  notesChanged();
  return `Seeded “${READER_NAME}”: ${said.join('; ')}.`;
}
