import { useLocalSearchParams } from 'expo-router';

import { AtlasView } from '@/atlas/atlas-view';

// The Bible map and timeline, inside Read. It opens at an event, a place,
// or the first event in a chapter (from the reader's toolbar).
type Params = { event?: string; place?: string; book?: string; chapter?: string };

export default function AtlasScreen() {
  const params = useLocalSearchParams<Params>();
  const number = (s: string | undefined) => (s === undefined || Number.isNaN(Number(s)) ? undefined : Number(s));
  return (
    <AtlasView
      params={{ event: params.event, place: params.place, book: number(params.book), chapter: number(params.chapter) }}
    />
  );
}
