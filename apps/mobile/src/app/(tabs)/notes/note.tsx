import { router, useLocalSearchParams } from 'expo-router';

import { useTopAppBarFill } from '@/design/use-top-app-bar-fill';
import { NoteEditor } from '@/notes/note-editor';

/** A note, opened in Read, full screen (phones, and narrow windows). */
export default function NoteScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const fill = useTopAppBarFill();
  return <NoteEditor id={id} initialMode="read" fill={fill} onDeleted={() => router.back()} />;
}
