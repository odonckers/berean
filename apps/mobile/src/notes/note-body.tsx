import { isLoaded } from 'expo-font';
import { Fragment, type ReactNode, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, type TextStyle, View } from 'react-native';

import { ScaledSymbol } from '@/components/scaled-symbol';
import { UIText } from '@/components/text';
import { TextButton } from '@/components/text-button';
import { useBerean } from '@/design/theme';
import { radii, spacing } from '@/design/tokens';
import { installedPublication, openExternal, openPassage, openPublication, passageText } from '@/notes/data';
import {
  type NoteBlock,
  type NoteInline,
  type NoteLinkTarget,
  inlineText,
  isMissing,
  linkGlyph,
  linkUnderline,
  missingLine,
  tagLine,
} from '@/notes/note-text';

type NoteBodyProps = {
  blocks: readonly NoteBlock[];
  /** Check or uncheck task `index` (NoteTask.index); the core rewrites the marker. */
  onTask: (index: number, checked: boolean) => void;
};

const mono = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

const hidden = {
  accessible: false,
  importantForAccessibility: 'no-hide-descendants',
  accessibilityElementsHidden: true,
} as const;

/**
 * A note body as the core renders it, drawn in the reading serif (guide
 * §7.1 Read). Links keep the ink: a soft rust 1px underline (linkUnderline)
 * for passages and publications, dashed in the accent with a trailing
 * download glyph where the Bible or publication isn't on this device. Tapping one of those opens the
 * download row under its block, never a modal.
 */
export function NoteBody({ blocks, onTask }: NoteBodyProps) {
  // The block whose missing link was tapped, and the link's text.
  const [missing, setMissing] = useState<{ block: number; title: string } | undefined>();
  return (
    <View style={styles.body}>
      {blocks.map((block, i) => (
        <Fragment key={i}>
          <BlockView block={block} onTask={onTask} onMissing={(title) => setMissing({ block: i, title })} />
          {missing?.block === i && <DownloadRow title={missing.title} onClose={() => setMissing(undefined)} />}
        </Fragment>
      ))}
    </View>
  );
}

type BlockProps = {
  block: NoteBlock;
  onTask: NoteBodyProps['onTask'];
  onMissing: (title: string) => void;
};

function BlockView({ block, onTask, onMissing }: BlockProps): ReactNode {
  const { colors, m3, type, look } = useBerean();
  const body = [type.reading.noteBody, { color: colors.text }];
  switch (block.tag) {
    case 'Heading': {
      const level = block.inner.level;
      const role = level === 1 ? type.reading.chapterHeading : level === 2 ? type.reading.sectionHeading : styles.minorHeading;
      return (
        <Text accessibilityRole="header" style={[type.reading.noteBody, role, { color: colors.text }]}>
          <Inlines inlines={block.inner.inlines} onMissing={onMissing} />
        </Text>
      );
    }
    case 'Paragraph': {
      const tags = tagLine(block.inner.inlines);
      if (tags !== undefined) return <TagPills names={tags} />;
      return (
        <Text style={body}>
          <Inlines inlines={block.inner.inlines} onMissing={onMissing} />
        </Text>
      );
    }
    case 'PassageCard':
      return <PassageCard block={block} onMissing={onMissing} />;
    case 'List':
      return (
        <View style={styles.list}>
          {block.inner.items.map((item, i) => {
            const task = item.task;
            const marker =
              task !== undefined ? (
                <TaskBox
                  checked={task.checked}
                  label={item.blocks.map((b) => (b.tag === 'Paragraph' ? inlineText(b.inner.inlines) : '')).join(' ')}
                  onToggle={() => onTask(task.index, !task.checked)}
                />
              ) : (
                <Text style={[body, styles.bullet]} {...hidden}>
                  {block.inner.start === undefined ? '•' : `${block.inner.start + i}.`}
                </Text>
              );
            return (
              <View key={i} style={styles.item}>
                {marker}
                <View style={styles.itemBody}>
                  {item.blocks.map((child, j) => (
                    <BlockView key={j} block={child} onTask={onTask} onMissing={onMissing} />
                  ))}
                </View>
              </View>
            );
          })}
        </View>
      );
    case 'Quote':
      return (
        <View style={[styles.quote, { borderStartColor: look === 'material' ? m3.outlineVariant : colors.separator }]}>
          {block.inner.blocks.map((child, j) => (
            <BlockView key={j} block={child} onTask={onTask} onMissing={onMissing} />
          ))}
        </View>
      );
    case 'CodeBlock':
      return (
        <ScrollView horizontal style={[styles.codeBlock, { backgroundColor: m3.surfaceContainer }]}>
          <Text style={[styles.code, { color: colors.text }]}>{block.inner.text.replace(/\n$/, '')}</Text>
        </ScrollView>
      );
    case 'Rule':
      return <View accessibilityRole="none" style={[styles.rule, { backgroundColor: colors.separator }]} />;
  }
}

function Inlines({ inlines, onMissing }: { inlines: readonly NoteInline[]; onMissing: (title: string) => void }) {
  const { colors, m3 } = useBerean();
  return inlines.map((inline, i) => {
    switch (inline.tag) {
      case 'Text':
        return inline.inner.text;
      case 'Emphasis':
        return (
          <Text key={i} style={styles.emphasis}>
            <Inlines inlines={inline.inner.children} onMissing={onMissing} />
          </Text>
        );
      case 'Strong':
        return (
          <Text key={i} style={styles.strong}>
            <Inlines inlines={inline.inner.children} onMissing={onMissing} />
          </Text>
        );
      case 'Strikethrough':
        return (
          <Text key={i} style={styles.strike}>
            <Inlines inlines={inline.inner.children} onMissing={onMissing} />
          </Text>
        );
      case 'Code':
        return (
          <Text key={i} style={[styles.code, { backgroundColor: m3.surfaceContainer }]}>
            {inline.inner.text}
          </Text>
        );
      case 'Link':
        return (
          <LinkText key={i} target={inline.inner.target} title={inlineText(inline.inner.children)} onMissing={onMissing}>
            <Inlines inlines={inline.inner.children} onMissing={onMissing} />
          </LinkText>
        );
      case 'Tag':
        return (
          <Text key={i} style={{ color: colors.accent }}>
            #{inline.inner.name}
          </Text>
        );
      case 'LineBreak':
        return '\n';
    }
  });
}

function linkPress(target: NoteLinkTarget, title: string, onMissing: (title: string) => void): (() => void) | undefined {
  if (isMissing(target)) return () => onMissing(title);
  switch (target.tag) {
    case 'Passage':
      return () => openPassage(target.inner.span);
    case 'Publication':
      return () => openPublication(target.inner.location);
    case 'External':
      return () => openExternal(target.inner.url);
    case 'Invalid':
      return undefined;
  }
}

// The link glyphs. On Android, Material Symbols' format_paragraph and
// menu_book, from the font expo-symbols registers (by this family name)
// before any symbol draws; on iOS, or before that font is in, a pilcrow and
// a book in the system fonts.
const symbolsFont = 'MaterialSymbols_400Regular';

function materialGlyphs(): boolean {
  return Platform.OS === 'android' && isLoaded(symbolsFont);
}

function glyphFont(): string | undefined {
  return materialGlyphs() ? symbolsFont : undefined;
}

function glyphText(kind: 'passage' | 'publication'): string {
  if (materialGlyphs()) return kind === 'passage' ? '' : '';
  return kind === 'passage' ? '¶' : '\u{1F56E}';
}

function LinkText({
  target,
  title,
  onMissing,
  children,
}: {
  target: NoteLinkTarget;
  title: string;
  onMissing: (title: string) => void;
  children: ReactNode;
}) {
  const { colors, type } = useBerean();
  const onPress = linkPress(target, title, onMissing);
  const missing = isMissing(target);
  // Every link is underlined, pressable or not: the underline marks it as a
  // link, not as tappable. React Native draws textDecorationColor and
  // textDecorationStyle on both platforms (Android API 29+), so the dash
  // and the color say "missing"; the glyph repeats it.
  const underline = linkUnderline(target, colors);
  const style: TextStyle = {
    color: colors.text,
    textDecorationLine: 'underline',
    textDecorationColor: underline.color,
    textDecorationStyle: underline.style,
  };
  // The leading glyph is drawn as text, so it paints with the words. On
  // RN 0.88 Android (Fabric, prebuilt AAR) a post-mount Fabric state update
  // re-sets a Text's spannable (ReactTextViewManager.updateExtraData ->
  // ReactTextView.setText -> TextView.nullLayouts), and ReactTextView.onDraw
  // skips CanvasEffectSpans (ReactUnderlineSpan) while getLayout() is null,
  // so the underline can be missing on first paint; the glyph is the link
  // cue that doesn't depend on it. See /workspace/expo6b-findings.md
  // (upstream issue pending). External and invalid links have no glyph.
  const glyph = linkGlyph(target, colors);
  return (
    <Text
      accessibilityRole={onPress ? 'link' : undefined}
      accessibilityLabel={glyph ? title : undefined}
      accessibilityHint={missing ? 'Not on this device' : undefined}
      onPress={onPress}
      suppressHighlighting={false}
      style={style}
    >
      {glyph && (
        <Text
          style={{
            fontFamily: glyphFont(),
            fontSize: 0.7 * (type.reading.noteBody.fontSize ?? 15),
            color: glyph.color,
            textDecorationLine: 'none',
          }}
        >
          {/* A narrow no-break space at the glyph's size: a gap of about
              3px that never breaks the glyph from the first word. */}
          {glyphText(glyph.kind) + ' '}
        </Text>
      )}
      {children}
      {missing && <Text style={{ color: colors.accent, textDecorationLine: 'none' }}>{' ↓'}</Text>}
    </Text>
  );
}

function PassageCard({
  block,
  onMissing,
}: {
  block: Extract<NoteBlock, { tag: 'PassageCard' }>;
  onMissing: (title: string) => void;
}) {
  const { look, colors, m3, type } = useBerean();
  const material = look === 'material';
  const { span, missing } = block.inner;
  const pub = missing ? undefined : installedPublication(span.start.pubKey);
  // The version label is the Bible's symbol as the library lists it, pending Lumen.
  const version = pub?.symbol.toUpperCase();
  const heading = [block.inner.text, version].filter((s) => s !== undefined && s !== '').join(' · ');
  const text = missing ? '' : passageText(span);
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={[heading, text].filter((s) => s !== '').join(', ')}
      accessibilityHint={missing ? 'Not on this device' : 'Opens the passage in the reader'}
      onPress={missing ? () => onMissing(block.inner.text) : () => openPassage(span)}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: material ? m3.surfaceContainerLow : colors.surfaceRaised,
          borderColor: material ? m3.outlineVariant : colors.separator,
          borderStyle: missing ? 'dashed' : 'solid',
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <View style={styles.cardHeading}>
        <UIText variant="caption" style={[styles.cardReference, { color: colors.accent }]}>
          {heading}
        </UIText>
        <ScaledSymbol
          name={missing ? { ios: 'arrow.down.circle', android: 'download' } : { ios: 'chevron.right', android: 'chevron_right' }}
          size={14}
          tintColor={colors.textSecondary}
          {...hidden}
        />
      </View>
      {text !== '' && <Text style={[type.reading.noteBody, { color: colors.text }]}>{text}</Text>}
    </Pressable>
  );
}

function TaskBox({ checked, label, onToggle }: { checked: boolean; label: string; onToggle: () => void }) {
  const { look, colors, m3 } = useBerean();
  const material = look === 'material';
  const target = material ? 48 : 44;
  const on = material ? m3.primary : colors.accent;
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      onPress={onToggle}
      hitSlop={0}
      style={({ pressed }) => [styles.taskTarget, { minWidth: target, minHeight: target, opacity: pressed ? 0.6 : 1 }]}
    >
      <ScaledSymbol
        name={
          checked
            ? { ios: 'checkmark.square.fill', android: 'check_box' }
            : { ios: 'square', android: 'check_box_outline_blank' }
        }
        size={20}
        tintColor={checked ? on : colors.textSecondary}
        {...hidden}
      />
    </Pressable>
  );
}

function TagPills({ names }: { names: readonly string[] }) {
  const { look, colors, m3 } = useBerean();
  const material = look === 'material';
  return (
    <View style={styles.pills} accessibilityRole="text" accessibilityLabel={`Tags: ${names.join(', ')}`}>
      {names.map((name) => (
        <View
          key={name}
          {...hidden}
          style={[
            styles.pill,
            material
              ? { backgroundColor: m3.secondaryContainer, borderRadius: radii.materialChip }
              : { backgroundColor: m3.surfaceContainer, borderRadius: radii.capsule },
          ]}
        >
          <UIText variant="caption" style={{ color: material ? m3.onSecondaryContainer : colors.text }}>
            #{name}
          </UIText>
        </View>
      ))}
    </View>
  );
}

/**
 * "<Title> is not on this device." with Not now and Download, directly
 * under the block that holds the tapped link.
 */
function DownloadRow({ title, onClose }: { title: string; onClose: () => void }) {
  const { look, colors, m3 } = useBerean();
  const material = look === 'material';
  return (
    <View
      accessibilityLiveRegion="polite"
      style={[
        styles.downloadRow,
        material
          ? { backgroundColor: m3.surfaceContainerHigh, borderRadius: radii.card }
          : { backgroundColor: colors.surfaceRaised, borderRadius: radii.card },
      ]}
    >
      <UIText>{missingLine(title)}</UIText>
      <View style={styles.downloadButtons}>
        <TextButton title="Not now" onPress={onClose} />
        {/* TODO(6b): Download needs the catalog entry for the link's pub key
            (startInstall takes a PublicationSummary); the core has no lookup
            by key yet. Inert until it does. */}
        <TextButton title="Download" disabled onPress={() => {}} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.md },
  minorHeading: { fontWeight: '600', fontSize: 17, lineHeight: 24 },
  emphasis: { fontStyle: 'italic' },
  strong: { fontWeight: '700' },
  strike: { textDecorationLine: 'line-through' },
  code: { fontFamily: mono, fontSize: 14 },
  list: { gap: spacing.xs },
  item: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
  bullet: { minWidth: 20, textAlign: 'center' },
  itemBody: { flex: 1, gap: spacing.xs, justifyContent: 'center' },
  taskTarget: { alignItems: 'center', justifyContent: 'center', marginTop: -spacing.md, marginStart: -spacing.md },
  quote: { borderStartWidth: 3, paddingStart: spacing.md, gap: spacing.sm },
  codeBlock: { borderRadius: radii.chip, padding: spacing.md },
  rule: { height: 1, marginVertical: spacing.sm },
  card: { borderWidth: 1, borderRadius: radii.card, padding: spacing.md, gap: spacing.xs },
  cardHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  cardReference: { flex: 1, fontWeight: '600' },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  pill: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  downloadRow: { padding: spacing.md, gap: spacing.xs },
  downloadButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
});
