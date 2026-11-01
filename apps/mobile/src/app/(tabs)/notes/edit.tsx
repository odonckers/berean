import { router, useLocalSearchParams } from 'expo-router';

import { useTopAppBarFill } from '@/design/use-top-app-bar-fill';
import { NoteEditor } from '@/notes/note-editor';

/**
 * A note, opened in Write: a new note, or one started at a verse. Leaving
 * goes back with the note saved; a new note left empty goes again.
 */
export default function EditNoteScreen() {
  const { id = '', fresh, stay } = useLocalSearchParams<{ id: string; fresh?: string; stay?: string }>();
  const fill = useTopAppBarFill();
  return (
    <NoteEditor
      id={id}
      initialMode="write"
      fresh={fresh === '1'}
      stay={stay === '1'}
      fill={fill}
      onDeleted={() => router.back()}
    />
  );
}
