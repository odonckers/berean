import { Stack, useLocalSearchParams } from 'expo-router';

import { DocumentView, TocView } from '@/reader/publication';

// notFound: a bookmark jump that couldn't find its exact place opened this
// screen (publication.tsx's NOT_FOUND_PARAM); it toasts once.
type PublicationParams = { pubKey: string; title?: string; docId?: string; notFound?: string };

// A non-Bible publication: its table of contents, or one document.
export default function PublicationScreen() {
  const params = useLocalSearchParams<PublicationParams>();
  const notFound = params.notFound !== undefined;
  return (
    <>
      <Stack.Screen options={{ title: params.title ?? '' }} />
      {params.docId === undefined ? (
        <TocView pubKey={params.pubKey} title={params.title ?? ''} notFound={notFound} />
      ) : (
        <DocumentView pubKey={params.pubKey} title={params.title ?? ''} docId={params.docId} notFound={notFound} />
      )}
    </>
  );
}
