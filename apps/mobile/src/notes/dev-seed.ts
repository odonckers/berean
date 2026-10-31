// Dev-only: the guide's sample notes (§7.1), made through the core API
// only. Imported solely from dev-look-menu.ts, inside `if (__DEV__)`.
import { passageUrl, publicationUrl, type Location } from 'berean-ffi-rn';

import { userdata } from '@/ffi/core';
import { notesChanged } from '@/notes/changes';
import { firstInstalledBible } from '@/notes/data';

const GENESIS = 1;
const EXODUS = 2;
const PSALMS = 19;
const JOHN = 43;

/** Seeds the sample notes; says what it did. Skips if "Gospel of John" exists. */
export function seedSampleNotes(): string {
  const ud = userdata();
  if (ud.folders().some((f) => f.name === 'Gospel of John')) return 'Sample notes are already there.';

  // The first installed Bible, so the links resolve and part B's reader
  // markers show; with none installed the links render as missing.
  const bible = firstInstalledBible()?.pubKey ?? 'nwtsty:0:0';
  const at = (book: number, chapter: number, verse: number): Location => ({ pubKey: bible, book, chapter, verse });
  const link = (text: string, book: number, chapter: number, verse: number) =>
    `[${text}](${passageUrl({ start: at(book, chapter, verse), end: at(book, chapter, verse) })})`;
  // Insight, Vol. 2 is not installed on a dev device, so this link is missing.
  const insight = `[Insight on the Scriptures, Vol. 2](${publicationUrl({ pubKey: 'it-2:0:0', docId: 1200002712n })})`;

  const john = ud.createFolder('Gospel of John', undefined);
  const prologue = ud.createFolder('Prologue', john.id);
  const signs = ud.createFolder('Signs', john.id);
  const witnesses = ud.createFolder('Witnesses', john.id);
  const psalms = ud.createFolder('Psalms', undefined);
  const sermons = ud.createFolder('Sermon prep', undefined);
  const words = ud.createFolder('Word studies', undefined);

  // Made first, so the Tags list keeps the guide's order.
  for (const name of ['prologue', 'light', 'witness', 'questions']) {
    try {
      ud.addTag(name);
    } catch {
      // Already a tag.
    }
  }

  const lightBeforeLaw = [
    '# Light before law',
    '',
    `The witness is **not** the light (v. 8). The true light is the one in ${link('John 1:9', JOHN, 1, 9)}, *coming into the world*.`,
    '',
    '## Threads to follow',
    '',
    `- Life and light pair up again in ${link('John 8:12', JOHN, 8, 12)}`,
    `- ${insight} has an entry under “Light.”`,
    '',
    '* [x] Compare Genesis 1:3',
    '* [ ] Read John 1:14 again',
    '',
    '> In thy light shall we see light.',
    '',
    link('Psalm 36:9', PSALMS, 36, 9),
    '',
    'Search my notes for `#light -#sermons`',
    '',
    '---',
    '',
    '#prologue #light',
  ].join('\n');

  const notes: [string, string, Location | undefined, bigint | undefined][] = [
    ['Light before law', lightBeforeLaw, at(GENESIS, 1, 3), prologue.id],
    [
      'Who are “his own”?',
      'Verse 11 could mean Israel, or the whole world he made … #questions #prologue',
      undefined,
      prologue.id,
    ],
    [
      'Grace and truth',
      `“Full of grace and truth” sounds like ${link('Exodus 34:6', EXODUS, 34, 6)}. #prologue`,
      undefined,
      prologue.id,
    ],
    [
      'In the beginning',
      `Compare ${link('Genesis 1:1', GENESIS, 1, 1)} with ${link('John 1:1', JOHN, 1, 1)}. #prologue`,
      at(GENESIS, 1, 1),
      words.id,
    ],
    [
      'Light called good',
      'God saw the light, that it was good, and divided it from the darkness. #light',
      at(GENESIS, 1, 4),
      sermons.id,
    ],
    ['Good, before anything else', 'What does “good” mean before there is anyone to see it? #questions', at(GENESIS, 1, 4), undefined],
    ['The first witness', 'John came to bear witness of the light (v. 7). #witness', undefined, witnesses.id],
    ['Water to wine', 'The first sign, at Cana. Why a wedding? #questions', undefined, signs.id],
    ['Fountain of life', `${link('Psalm 36:9', PSALMS, 36, 9)}\n\n#light`, undefined, psalms.id],
  ];
  for (const [title, content, location, folderId] of notes) {
    ud.addNote(title, content, location, undefined, folderId);
  }
  notesChanged();
  return `Seeded ${notes.length} notes in 7 folders.`;
}
