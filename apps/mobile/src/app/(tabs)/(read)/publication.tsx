import { Stack, useLocalSearchParams } from 'expo-router';

import { DocumentView, TocView } from '@/reader/publication';

type PublicationParams = { pubKey: string; title?: string; docId?: string };

// A non-Bible publication: its table of contents, or one document.
export default function PublicationScreen() {
  const params = useLocalSearchParams<PublicationParams>();
  return (
    <>
      <Stack.Screen options={{ title: params.title ?? '' }} />
      {params.docId === undefined ? (
        <TocView pubKey={params.pubKey} title={params.title ?? ''} />
      ) : (
        <DocumentView pubKey={params.pubKey} docId={params.docId} />
      )}
    </>
  );
}
