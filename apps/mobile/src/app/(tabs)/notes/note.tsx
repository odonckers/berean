import { router, useLocalSearchParams } from 'expo-router';

import { useTopAppBarFill } from '@/design/use-top-app-bar-fill';
import { NoteReader } from '@/notes/note-reader';

/** A note in Read, full screen (phones, and narrow windows). */
export default function NoteScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const fill = useTopAppBarFill();
  return <NoteReader id={id} fill={fill} onDeleted={() => router.back()} />;
}
