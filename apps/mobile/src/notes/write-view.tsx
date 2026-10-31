import { useMemo } from 'react';
import { StyleSheet, Text, TextInput, type TextStyle } from 'react-native';

import { useBerean } from '@/design/theme';
import { hairline, spacing } from '@/design/tokens';
import { type Draft } from '@/notes/note-draft';
import { type SyntaxKind, styledSegments, useSyntaxSpans } from '@/notes/syntax-spans';

type WriteViewProps = {
  draft: Draft;
  onChange: (draft: Draft) => void;
  /** A note just made: the title takes the keyboard. */
  autoFocus?: boolean;
};

/**
 * A note in Write (guide §7.1): the title, then the Markdown source in the
 * reading serif, its syntax styled from the core's spans: markers dimmed
 * but visible. Plain until the core reports spans.
 */
export function WriteView({ draft, onChange, autoFocus = false }: WriteViewProps) {
  const { colors, type } = useBerean();
  const spans = useSyntaxSpans(draft.content);
  const segments = useMemo(() => styledSegments(draft.content, spans), [draft.content, spans]);

  // How each kind of syntax looks.
  const kindStyles = useMemo((): Record<SyntaxKind, TextStyle | undefined> => {
    const dimmed = { color: colors.textSecondary };
    return {
      headingMarker: dimmed,
      emphasisMarker: dimmed,
      strongMarker: dimmed,
      strikeMarker: dimmed,
      codeMarker: dimmed,
      code: undefined,
      linkBracket: dimmed,
      linkUrl: dimmed,
      listMarker: dimmed,
      taskMarker: dimmed,
      quoteMarker: dimmed,
      rule: dimmed,
      tag: undefined,
    };
  }, [colors]);

  return (
    <>
      <TextInput
        value={draft.title}
        onChangeText={(title) => onChange({ ...draft, title })}
        autoFocus={autoFocus}
        placeholder="Title"
        placeholderTextColor={colors.textSecondary}
        accessibilityLabel="Title"
        returnKeyType="next"
        style={[type.reading.sectionHeading, styles.title, { color: colors.text, borderBottomColor: colors.separator }]}
      />
      {/* The source as styled runs instead of a value. */}
      <TextInput
        onChangeText={(content) => onChange({ ...draft, content })}
        multiline
        placeholder="Write in Markdown"
        placeholderTextColor={colors.textSecondary}
        accessibilityLabel="Note, Markdown"
        textAlignVertical="top"
        autoCapitalize="sentences"
        style={[type.reading.noteBody, styles.content, { color: colors.text }]}
      >
        {segments.map((segment, i) => (
          <Text key={i} style={segment.kind && kindStyles[segment.kind]}>
            {segment.text}
          </Text>
        ))}
      </TextInput>
    </>
  );
}

const styles = StyleSheet.create({
  title: { minHeight: 48, borderBottomWidth: hairline, paddingVertical: spacing.sm },
  content: { minHeight: 240, paddingVertical: spacing.sm },
});
