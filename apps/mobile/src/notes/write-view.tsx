import { type Ref, type RefObject, useMemo } from 'react';
import { StyleSheet, Text, TextInput, type TextInputInstance, type TextStyle } from 'react-native';

import { useBerean } from '@/design/theme';
import { spacing } from '@/design/tokens';
import { type Selection } from '@/notes/format-edits';
import { type Draft } from '@/notes/note-draft';
import { type SyntaxKind, styledSegments, useSyntaxSpans } from '@/notes/syntax-spans';

type WriteViewProps = {
  draft: Draft;
  onChange: (draft: Draft) => void;
  /** A note just made: the title takes the keyboard. */
  autoFocus?: boolean;
  /** The body field, for the formatting bar to focus again. */
  bodyRef?: RefObject<TextInputInstance | null>;
  /** The title field, to let go of the keyboard. */
  titleRef?: Ref<TextInputInstance>;
  /** The title or the body gains (true) or loses (false) focus. */
  onFieldFocus?: (field: 'title' | 'body', focused: boolean) => void;
  /** Set only after an edit made outside typing; otherwise the field keeps its own. */
  selection?: Selection;
  onSelectionChange?: (selection: Selection) => void;
};

/**
 * A note in Write (guide §7.1): the title as the first line, H1-like in the
 * reading serif, semibold (Lumen: Note.Title, plain text, no '#'), then the
 * Markdown source, its syntax styled from the core's spans: markers dimmed
 * but visible. Plain until the core reports spans. A '# Title' heading the
 * body starts with stays as written; Read hides it.
 */
export function WriteView({
  draft,
  onChange,
  autoFocus = false,
  bodyRef,
  titleRef,
  onFieldFocus,
  selection,
  onSelectionChange,
}: WriteViewProps) {
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
      {/* Wraps like a heading; Return goes on to the body. */}
      <TextInput
        ref={titleRef}
        value={draft.title}
        onChangeText={(title) => onChange({ ...draft, title })}
        autoFocus={autoFocus}
        multiline
        submitBehavior="submit"
        onSubmitEditing={() => bodyRef?.current?.focus()}
        onFocus={() => onFieldFocus?.('title', true)}
        onBlur={() => onFieldFocus?.('title', false)}
        placeholder="Title"
        placeholderTextColor={colors.textSecondary}
        accessibilityLabel="Title"
        returnKeyType="next"
        textAlignVertical="top"
        style={[type.reading.chapterHeading, styles.title, { color: colors.text }]}
      />
      {/* The source as styled runs instead of a value. */}
      <TextInput
        ref={bodyRef}
        onChangeText={(content) => onChange({ ...draft, content })}
        onFocus={() => onFieldFocus?.('body', true)}
        onBlur={() => onFieldFocus?.('body', false)}
        selection={selection}
        onSelectionChange={(e) => onSelectionChange?.(e.nativeEvent.selection)}
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
  // No rule under it: the first line of the note, not a form field.
  title: { minHeight: 48, paddingVertical: spacing.sm },
  content: { minHeight: 240, paddingVertical: spacing.sm },
});
