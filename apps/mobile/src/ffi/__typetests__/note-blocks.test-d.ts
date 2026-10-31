// Compile-time checks for the Notes screens' structural shapes. Nothing
// runs: `npm run typecheck` fails if the generated values stop being
// accepted where the Notes screens read them, or a case is added in the core.
import type {
  Block,
  Block_Tags,
  Folder,
  Inline,
  Inline_Tags,
  LinkTarget,
  LinkTarget_Tags,
  Note,
} from 'berean-ffi-rn';

import type { FolderLike } from '../../notes/folders';
import type { ListNote } from '../../notes/note-list';
import type { NoteBlock, NoteInline, NoteLinkTarget } from '../../notes/note-text';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

export type NoteBlockChecks = [
  // The same cases as the binding.
  Expect<Equal<NoteBlock['tag'], `${Block_Tags}`>>,
  Expect<Equal<NoteInline['tag'], `${Inline_Tags}`>>,
  Expect<Equal<NoteLinkTarget['tag'], `${LinkTarget_Tags}`>>,
  // The generated values are accepted where the screens read them.
  Expect<Block extends NoteBlock ? true : false>,
  Expect<Inline extends NoteInline ? true : false>,
  Expect<LinkTarget extends NoteLinkTarget ? true : false>,
  Expect<Folder extends FolderLike ? true : false>,
  Expect<Note extends ListNote ? true : false>,
];
