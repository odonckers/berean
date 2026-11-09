import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { ScaledSymbol } from '@/components/scaled-symbol';
import { UIText } from '@/components/text';
import { useBerean } from '@/design/theme';
import { spacing } from '@/design/tokens';
import { load } from '@/library/load';
import { IosBackButton } from '@/notes/back-button';
import { backAccessibilityLabel } from '@/notes/back-label';
import { readCards, touchCard } from '@/studyspace/data';
import { parseReaderParams } from '@/studyspace/open';
import { LiveReader, useReaderPlace } from '@/studyspace/reader-card';
import { MOVED_NOTE } from '@/studyspace/reader-state';

const BACK_TITLE = 'Studyspace';

/**
 * A reader card full screen, on a phone (findings §8): its live text at the
 * reader's size and measure, from its saved place, saving where it settles
 * as the card does (useReaderPlace), and touched once on opening (§6.6).
 * Back reads "Back to Studyspace", and returns to the canvas as it was.
 */
export default function StudyspaceReadScreen() {
  const { look, colors } = useBerean();
  const material = look === 'material';
  const params = useLocalSearchParams<{ workspace?: string; item?: string }>();
  const { workspace, item } = params;
  const ids = useMemo(() => parseReaderParams({ workspace, item }), [workspace, item]);
  // Core ask (Echo): no read of one canvas item by id; it is found among its workspace's.
  const card = useMemo(
    () =>
      ids === undefined
        ? undefined
        : load(() => readCards(ids.workspace).find((c) => c.id === ids.item)),
    [ids],
  );
  const found = card?.ok === true ? card.value : undefined;
  const reader = found?.reader;
  const itemId = found?.id;
  const place = useReaderPlace(itemId ?? 0n, reader, true);

  useEffect(() => {
    if (itemId !== undefined) touchCard(itemId);
  }, [itemId]);

  // The place is saved as the screen loses focus (Back, a swipe, the system
  // back), before the canvas's screen draws its cards read again on focus.
  const { saver } = place;
  useFocusEffect(useCallback(() => () => saver.flush(), [saver]));

  // Back to Studyspace (§8): the iOS look's native back titled Studyspace
  // (drawn on Android, whose native one is the arrow, as Notes does);
  // Material's arrow, labelled for screen readers.
  const back = material
    ? { headerBackVisible: false, headerLeft: () => <MaterialBack /> }
    : Platform.OS === 'android'
      ? {
          headerBackVisible: false,
          headerTitleAlign: 'center' as const,
          headerLeft: () => <IosBackButton label={BACK_TITLE} />,
        }
      : { headerBackTitle: BACK_TITLE };

  const message =
    ids === undefined || (card?.ok === true && found === undefined)
      ? 'This card is no longer on the workspace.'
      : card?.ok === false
        ? card.message
        : place.read?.ok === false
          ? place.read.message
          : undefined;

  return (
    <>
      <Stack.Screen options={{ title: found?.title ?? '', ...back }} />
      <View style={[styles.root, { backgroundColor: colors.surface }]}>
        {message !== undefined ? (
          <UIText secondary style={styles.message}>
            {message}
          </UIText>
        ) : (
          place.shown !== undefined &&
          place.at !== undefined && (
            <>
              {/* The core couldn't find the exact place: the text opens at the nearest one. */}
              {place.shown.moved && (
                <UIText secondary style={styles.note}>
                  {MOVED_NOTE}
                </UIText>
              )}
              <LiveReader
                key={place.key}
                rows={place.shown.rows}
                start={place.at}
                scale={1}
                contentStyle={styles.content}
                onMoving={saver.cancel}
                onSettle={place.settled}
              />
            </>
          )
        )}
      </View>
    </>
  );
}

/** Material's back arrow, 48 dp, read as "Back to Studyspace". */
function MaterialBack() {
  const { colors, m3 } = useBerean();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={backAccessibilityLabel(BACK_TITLE)}
      onPress={() => router.back()}
      android_ripple={{ color: colors.separator, borderless: true }}
      style={styles.icon}
    >
      <ScaledSymbol
        name={{ ios: 'chevron.backward', android: 'arrow_back' }}
        size={24}
        tintColor={m3.onSurface}
        accessible={false}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { width: '100%', alignSelf: 'center', padding: spacing.lg },
  message: { padding: spacing.lg },
  note: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  icon: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
});
