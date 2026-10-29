import { PubKind } from 'berean-ffi-rn';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';

import { Screen } from '@/components/screen';
import { UIText } from '@/components/text';
import { TextButton } from '@/components/text-button';
import { useBerean } from '@/design/theme';
import { useStackOptions } from '@/design/use-stack-options';
import { library } from '@/ffi/core';
import { displayTitle } from '@/library/labels';
import { load, type Loaded } from '@/library/load';
import { BibleChapterView } from '@/reader/bible-chapter';
import { type BibleLocation, rememberBible, rememberedBible } from '@/reader/session';

type ReadParams = { pubKey?: string; title?: string; book?: string; chapter?: string };

// The first installed Bible, at its first chapter.
function firstInstalledBible(): Loaded<BibleLocation | undefined> {
  return load(() => {
    const pub = library()
      .installed()
      .find((p) => p.kind === PubKind.Bible);
    return pub && { pubKey: pub.pubKey, title: displayTitle(pub), book: 1, chapter: 1 };
  });
}

// The Bible reader. With no params it shows the Bible last open this
// session, else the first installed one.
export default function ReadScreen() {
  const params = useLocalSearchParams<ReadParams>();
  const { look } = useBerean();
  const stackOptions = useStackOptions();
  const fromParams: BibleLocation | undefined =
    params.pubKey === undefined
      ? undefined
      : {
          pubKey: params.pubKey,
          title: params.title ?? '',
          book: Number(params.book ?? 1),
          chapter: Number(params.chapter ?? 1),
        };
  const fallsBack = fromParams === undefined && rememberedBible() === undefined;

  // Refreshed on focus while nothing else is shown, so a Bible installed
  // from Library appears on return.
  const [installed, setInstalled] = useState<Loaded<BibleLocation | undefined>>(() =>
    fallsBack ? firstInstalledBible() : { ok: true, value: undefined },
  );
  useFocusEffect(
    useCallback(() => {
      if (fallsBack) setInstalled(firstInstalledBible());
    }, [fallsBack]),
  );

  const bible = fromParams ?? rememberedBible() ?? (installed.ok ? installed.value : undefined);

  const { pubKey, title, book, chapter } = bible ?? {};
  useEffect(() => {
    if (pubKey !== undefined && title !== undefined && book !== undefined && chapter !== undefined)
      rememberBible({ pubKey, title, book, chapter });
  }, [pubKey, title, book, chapter]);

  if (bible === undefined) {
    // Titled like other tab roots: the material top app bar, the iOS
    // look's large title (drawn inline by Screen where the header is hidden).
    return (
      <>
        <Stack.Screen
          options={{ title: 'Read', headerLargeTitleEnabled: stackOptions.headerLargeTitleEnabled }}
        />
        <Screen title="Read">
          {installed.ok ? (
            <>
              <UIText>No Bible installed yet.</UIText>
              <TextButton
                title="Open Library"
                align="leading"
                onPress={() => router.navigate('/library')}
              />
            </>
          ) : (
            <UIText secondary>{installed.message}</UIText>
          )}
        </Screen>
      </>
    );
  }

  // Per the reader frames: the material top app bar is titled with the
  // chapter reference (the chapter heading's text); the iOS look has no
  // navigation title, the chapter heading in the content is the title.
  // Pending, as their features don't exist yet: Aa, bookmark, menu, overflow.
  return (
    <>
      <Stack.Screen
        options={{
          title: look === 'material' ? `Chapter ${bible.chapter}` : '',
          headerLargeTitleEnabled: false,
        }}
      />
      <BibleChapterView
        pubKey={bible.pubKey}
        title={bible.title}
        book={bible.book}
        chapter={bible.chapter}
      />
    </>
  );
}
