import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, BackHandler, ScrollView, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';

import { UIText } from '@/components/text';
import { TextButton } from '@/components/text-button';
import { useContentInsets } from '@/design/tab-chrome';
import { useBerean } from '@/design/theme';
import { hairline, readingMeasure, spacing } from '@/design/tokens';
import { useKeyboardHeight } from '@/design/use-keyboard-height';
import { userdata } from '@/ffi/core';
import { changeNotes, findNote } from '@/notes/data';
import { openNote } from '@/notes/routes';

/**
 * Plain-text editing until Write mode (6c, which waits on the core's
 * markdown_spans): the title and the raw Markdown, unstyled, in the
 * reading serif. Save hands both to the core, which re-syncs inline #tags.
 */
export default function EditNoteScreen() {
  const { id = '', fresh, stay } = useLocalSearchParams<{ id: string; fresh?: string; stay?: string }>();
  const isFresh = fresh === '1';
  // Started in the reader: Save goes back to the verse, not to the note.
  const staysPut = stay === '1';
  const { colors, type } = useBerean();
  const insets = useContentInsets();
  const keyboard = useKeyboardHeight();
  const { fontScale } = useWindowDimensions();
  // Read once: the fields own the text from here.
  const [initial] = useState(() => {
    try {
      return findNote(id);
    } catch {
      return undefined;
    }
  });
  const [title, setTitle] = useState(initial?.title ?? '');
  const [content, setContent] = useState(initial?.content ?? '');

  const save = () => {
    const error = changeNotes(() => userdata().updateNote(id, title, content));
    if (error !== undefined) {
      Alert.alert('Couldn’t save the note', error);
      return;
    }
    if (isFresh && !staysPut) {
      router.back();
      openNote(id);
    } else {
      router.back();
    }
  };

  const cancel = () => {
    // A note made for this editor and never saved goes again.
    if (isFresh) changeNotes(() => userdata().removeNote(id));
    router.back();
  };

  // Android's Back is Cancel, so a fresh note isn't left behind.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      cancel();
      return true;
    });
    return () => sub.remove();
  });

  return (
    <>
      <Stack.Screen
        options={{
          title: isFresh ? 'New Note' : 'Edit Note',
          headerBackVisible: false,
          headerLeft: () => <TextButton title="Cancel" onPress={cancel} />,
          headerRight: () => <TextButton title="Save" onPress={save} disabled={initial === undefined} />,
        }}
      />
      <ScrollView
        style={{ backgroundColor: colors.surface }}
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          paddingTop: insets.top + spacing.lg,
          paddingBottom: insets.bottom + keyboard + spacing.xl,
          paddingLeft: insets.left + spacing.lg,
          paddingRight: insets.right + spacing.lg,
        }}
      >
        <View style={[styles.column, { maxWidth: readingMeasure * fontScale }]}>
          {initial === undefined ? (
            <UIText secondary>This note is no longer here.</UIText>
          ) : (
            <>
              <TextInput
                value={title}
                onChangeText={setTitle}
                autoFocus={isFresh}
                placeholder="Title"
                placeholderTextColor={colors.textSecondary}
                accessibilityLabel="Title"
                returnKeyType="next"
                style={[
                  type.reading.sectionHeading,
                  styles.title,
                  { color: colors.text, borderBottomColor: colors.separator },
                ]}
              />
              <TextInput
                value={content}
                onChangeText={setContent}
                multiline
                placeholder="Write in Markdown"
                placeholderTextColor={colors.textSecondary}
                accessibilityLabel="Note, Markdown"
                textAlignVertical="top"
                autoCapitalize="sentences"
                style={[type.reading.noteBody, styles.content, { color: colors.text }]}
              />
            </>
          )}
        </View>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  column: { width: '100%', alignSelf: 'center', gap: spacing.md },
  title: { minHeight: 48, borderBottomWidth: hairline, paddingVertical: spacing.sm },
  content: { minHeight: 240, paddingVertical: spacing.sm },
});
