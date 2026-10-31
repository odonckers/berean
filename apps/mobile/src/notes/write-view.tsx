import { type Ref, type RefObject, useMemo, useState } from 'react';
import { Platform, StyleSheet, Text, TextInput, type TextInputInstance, type TextStyle, View } from 'react-native';

import { useBerean } from '@/design/theme';
import { spacing } from '@/design/tokens';
import { type Selection } from '@/notes/format-edits';
import { type Draft } from '@/notes/note-draft';
import {
  type HeadingLevel,
  segmentsBefore,
  type StyledSegment,
  type SyntaxKind,
  styledSegments,
} from '@/notes/syntax-spans';
import { useSyntaxSpans } from '@/notes/use-syntax-spans';

const mono = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

// A folded link target's size against the body's: the guide's ⋯ chip is
// 0.62em, and the target is longer than one ⋯, so it goes smaller.
const foldedScale = 0.4;

// The body's sides as Android's theme pads a TextInput given no padding
// (the EditText background's 4dp inset), for the caret mirror to wrap
// alike. iOS pads none.
const bodySide = Platform.OS === 'android' ? 4 : 0;

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
  /** The caret's line while the body has focus, in the body's coordinates. */
  onCaretLayout?: (caret: { top: number; bottom: number }) => void;
  /** The body's top within the view's parent. */
  onBodyLayout?: (y: number) => void;
};

/**
 * A note in Write (guide §7.1): the title as the first line, H1-like in the
 * reading serif, semibold (Lumen: Note.Title, plain text, no '#'), then the
 * Markdown source, its syntax styled from the core's spans: markers dimmed
 * but visible, headings at Read's sizes, bold, italic and struck text as
 * such, code in mono, #tags in the accent. A '# Title' heading the body
 * starts with stays as written; Read hides it.
 *
 * A link target folds while the selection is outside it. The field's
 * children are its text, so the target can't be swapped for the guide's ⋯
 * without changing the note: it stays, drawn small and dimmed, and the
 * reader reads the real Markdown.
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
  onCaretLayout,
  onBodyLayout,
}: WriteViewProps) {
  const { colors, m3, type } = useBerean();
  const spans = useSyntaxSpans(draft.content);
  // The body's selection while it has focus, for folding link targets.
  const [bodySelection, setBodySelection] = useState<Selection>();
  const segments = useMemo(
    () => styledSegments(draft.content, spans, bodySelection),
    [draft.content, spans, bodySelection],
  );

  // How each kind of syntax looks. Markers keep the body's weight and slant
  // inside bold or italic text, as in the guide.
  const kindStyles = useMemo((): Record<SyntaxKind, TextStyle | undefined> => {
    const dimmed: TextStyle = {
      color: colors.textSecondary,
      fontWeight: '400',
      fontStyle: 'normal',
      textDecorationLine: 'none',
    };
    return {
      headingMarker: dimmed,
      emphasisMarker: dimmed,
      strongMarker: dimmed,
      strikeMarker: dimmed,
      codeMarker: dimmed,
      code: { ...styles.code, backgroundColor: m3.surfaceContainer },
      linkBracket: dimmed,
      linkUrl: dimmed,
      listMarker: dimmed,
      taskMarker: dimmed,
      quoteMarker: dimmed,
      rule: dimmed,
      tag: { color: colors.accent },
    };
  }, [colors, m3]);

  const headingStyles: Record<HeadingLevel, TextStyle> = {
    1: type.reading.chapterHeading,
    2: type.reading.sectionHeading,
    3: styles.minorHeading,
  };
  const foldedStyle: TextStyle = { fontSize: (type.reading.noteBody.fontSize ?? 15) * foldedScale };

  const segmentStyle = (segment: StyledSegment) => [
    segment.heading && headingStyles[segment.heading],
    segment.strong && styles.strong,
    segment.emphasis && styles.emphasis,
    segment.strike && styles.strike,
    segment.kind && kindStyles[segment.kind],
    segment.folded && foldedStyle,
  ];

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
      <View onLayout={(e) => onBodyLayout?.(e.nativeEvent.layout.y)}>
        {/*
         * Where the caret's line is: the text before it, unseen behind the
         * field in its style and width. The zero-width space gives a caret
         * just after a newline a line of its own.
         */}
        {bodySelection && (
          <Text
            pointerEvents="none"
            importantForAccessibility="no-hide-descendants"
            accessibilityElementsHidden
            onTextLayout={(e) => {
              // A line's y is the text's, inside the padding.
              const line = e.nativeEvent.lines.at(-1);
              const top = styles.content.paddingVertical + (line?.y ?? 0);
              if (line) onCaretLayout?.({ top, bottom: top + line.height });
            }}
            style={[type.reading.noteBody, styles.content, styles.caretMirror]}
          >
            {segmentsBefore(segments, bodySelection.end).map((segment, i) => (
              <Text key={i} style={segmentStyle(segment)}>
                {segment.text}
              </Text>
            ))}
            {'​'}
          </Text>
        )}
        {/* The source as styled runs instead of a value. */}
        <TextInput
          ref={bodyRef}
          onChangeText={(content) => onChange({ ...draft, content })}
          onFocus={() => onFieldFocus?.('body', true)}
          onBlur={() => {
            setBodySelection(undefined);
            onFieldFocus?.('body', false);
          }}
          selection={selection}
          onSelectionChange={(e) => {
            setBodySelection(e.nativeEvent.selection);
            onSelectionChange?.(e.nativeEvent.selection);
          }}
          multiline
          placeholder="Write in Markdown"
          placeholderTextColor={colors.textSecondary}
          accessibilityLabel="Note, Markdown"
          textAlignVertical="top"
          autoCapitalize="sentences"
          style={[type.reading.noteBody, styles.content, { color: colors.text }]}
        >
          {segments.map((segment, i) => (
            <Text key={i} style={segmentStyle(segment)}>
              {segment.text}
            </Text>
          ))}
        </TextInput>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  // No rule under it: the first line of the note, not a form field.
  title: { minHeight: 48, paddingVertical: spacing.sm },
  content: { minHeight: 240, paddingVertical: spacing.sm },
  caretMirror: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    minHeight: 0,
    paddingHorizontal: bodySide,
    opacity: 0,
  },
  // As Read draws them (note-body).
  minorHeading: { fontWeight: '600', fontSize: 17, lineHeight: 24 },
  strong: { fontWeight: '700' },
  emphasis: { fontStyle: 'italic' },
  strike: { textDecorationLine: 'line-through' },
  code: { fontFamily: mono, fontSize: 14 },
});
