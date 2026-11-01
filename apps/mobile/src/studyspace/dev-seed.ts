// Dev-only: a sample workspace of note cards spread over the canvas, made
// through the core API only. Imported solely from dev-look-menu.ts, inside
// `if (__DEV__)`.
import { CardRef, type Frame } from 'berean-ffi-rn';

import { userdata } from '@/ffi/core';
import { notesChanged } from '@/notes/changes';
import { allNotes } from '@/notes/data';

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
