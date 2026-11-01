import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { UIText } from '@/components/text';
import { useBerean } from '@/design/theme';
import { spacing } from '@/design/tokens';
import { userdata } from '@/ffi/core';
import { load } from '@/library/load';
import { NoteBody } from '@/notes/note-body';
import { noteTitle } from '@/notes/note-list';
import { withoutTitleHeading } from '@/notes/note-text';

type NoteReadViewProps = {
  title: string;
  /** The Markdown to render: the editor's draft, so Read shows it as written. */
  content: string;
  /** "Folder › Subfolder · Oct 28", or empty. */
  meta: string;
  /** The verse or publication the note was made at, worded. */
  reference?: string;
  onTask: (index: number, checked: boolean) => void;
};

/**
 * A note in Read (guide §7.1): its title, "Folder › Subfolder · Oct 28",
 * then the core's rendering of the body in the reading serif. The note
 * editor shows it for its Read mode.
 */
export function NoteReadView({ title, content, meta, reference, onTask }: NoteReadViewProps) {
  const { colors, type } = useBerean();
  const blocks = useMemo(
    () => load(() => withoutTitleHeading(userdata().renderMarkdown(content), title)),
    [content, title],
  );
  return (
    <>
      <View style={styles.titleBlock}>
        <Text accessibilityRole="header" style={[type.reading.chapterHeading, { color: colors.text }]}>
          {noteTitle({ title })}
        </Text>
        {meta !== '' && <UIText variant="caption" secondary>{meta}</UIText>}
        {reference !== undefined && (
          <UIText variant="caption" secondary>
            {reference}
          </UIText>
        )}
      </View>
      {!blocks.ok ? (
        <UIText style={{ color: colors.accent }}>{blocks.message}</UIText>
      ) : blocks.value.length > 0 ? (
        <NoteBody blocks={blocks.value} onTask={onTask} />
      ) : (
        <UIText secondary>Empty note. Switch to Write to start.</UIText>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  titleBlock: { gap: spacing.xs },
});
