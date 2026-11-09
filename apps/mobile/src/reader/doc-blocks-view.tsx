import {
  CoreError,
  type DocBlock,
  type DocFootnote,
  type DocImage,
  type DocInline,
  type DocLinkTarget,
  type Inline,
  ParagraphRole,
} from 'berean-ffi-rn';
import { Fragment, type ReactNode, useMemo, useState } from 'react';
import { Image, StyleSheet, Text, type TextStyle, View } from 'react-native';

import { UIText } from '@/components/text';
import { TextButton } from '@/components/text-button';
import { useBerean } from '@/design/theme';
import { hairline, radii, spacing } from '@/design/tokens';
import { reader } from '@/ffi/core';
import { openExternal, openPassage, openPublication } from '@/notes/data';
import { linkAction } from '@/reader/doc-links';

// A publication document drawn natively from the core's blocks
// (docs/design/document-blocks.md): headings, paragraphs by role, study
// questions, figures, boxes, lists, tables and footnotes, in the reading
// serif. Links are resolved only on tap; a footnote marker opens its
// footnote under the block it sits in.

type DocBlocksProps = {
  blocks: readonly DocBlock[];
  /** Shows a short message: a link that couldn't open. */
  onNotice: (message: string) => void;
};

type Context = {
  onNotice: (message: string) => void;
  /** The footnote a marker was tapped for, by id. */
  footnotes: ReadonlyMap<number, DocFootnote>;
  onFootnote: (id: number) => void;
};

const hidden = {
  accessible: false,
  importantForAccessibility: 'no-hide-descendants',
  accessibilityElementsHidden: true,
} as const;

/** Every footnote in `blocks`, by id. */
function collectFootnotes(blocks: readonly DocBlock[], into = new Map<number, DocFootnote>()) {
  for (const block of blocks) {
    switch (block.tag) {
      case 'Footnotes':
        for (const item of block.inner.items) into.set(item.id, item);
        break;
      case 'Aside':
        collectFootnotes(block.inner.blocks, into);
        break;
      case 'List':
        for (const item of block.inner.items) collectFootnotes(item.blocks, into);
        break;
      case 'Table':
        for (const row of block.inner.rows) for (const cell of row.cells) collectFootnotes(cell.blocks, into);
        break;
      case 'Figure':
        collectFootnotes(block.inner.caption, into);
        break;
      default:
        break;
    }
  }
  return into;
}

export function DocBlocksView({ blocks, onNotice }: DocBlocksProps) {
  const footnotes = useMemo(() => collectFootnotes(blocks), [blocks]);
  // The footnote open under a top-level block: [block index, footnote id].
  const [open, setOpen] = useState<{ block: number; id: number } | undefined>();
  return blocks.map((block, i) => {
    const context: Context = {
      onNotice,
      footnotes,
      onFootnote: (id) =>
        setOpen((was) => (was?.block === i && was.id === id ? undefined : { block: i, id })),
    };
    const note = open?.block === i ? footnotes.get(open.id) : undefined;
    return (
      <Fragment key={i}>
        <BlockView block={block} context={context} />
        {open?.block === i && (
          <FootnoteCard footnote={note} context={context} onClose={() => setOpen(undefined)} />
        )}
      </Fragment>
    );
  });
}

function BlockView({ block, context }: { block: DocBlock; context: Context }): ReactNode {
  const { colors, type } = useBerean();
  switch (block.tag) {
    case 'Heading': {
      const { level, inlines } = block.inner;
      const role = level <= 1 ? type.reading.chapterHeading : level === 2 ? type.reading.sectionHeading : styles.minorHeading;
      const base = level <= 1 ? type.reading.chapterHeading : type.reading.sectionHeading;
      return (
        <Text accessibilityRole="header" style={[base, role, { color: colors.text }]}>
          <Inlines inlines={inlines} base={roleSize(role)} context={context} />
        </Text>
      );
    }
    case 'Paragraph':
      return <ParagraphView role={block.inner.role} number={block.inner.number} inlines={block.inner.inlines} context={context} />;
    case 'Question':
      return <QuestionView number={block.inner.number} inlines={block.inner.inlines} context={context} />;
    case 'AnswerField':
      // A place to type an answer in print; Berean's answers are notes.
      return null;
    case 'Figure':
      return <FigureView image={block.inner.image} caption={block.inner.caption} context={context} />;
    case 'Aside':
      return <AsideView title={block.inner.title?.inlines} blocks={block.inner.blocks} context={context} />;
    case 'List':
      return <ListView ordered={block.inner.ordered} items={block.inner.items.map((item) => item.blocks)} context={context} />;
    case 'Table':
      return <TableView rows={block.inner.rows} context={context} />;
    case 'Footnotes':
      return <FootnotesView items={block.inner.items} context={context} />;
    case 'Rule':
      return <View accessibilityRole="none" style={[styles.rule, { backgroundColor: colors.separator }]} />;
  }
}

function roleSize(style: TextStyle | null | undefined): number {
  return style?.fontSize ?? 17;
}

function ParagraphView({
  role,
  number,
  inlines,
  context,
}: {
  role: ParagraphRole;
  number: string | undefined;
  inlines: readonly DocInline[];
  context: Context;
}) {
  const { colors, type } = useBerean();
  const scripture = type.reading.scripture;
  let style: TextStyle[];
  let header = false;
  switch (role) {
    case ParagraphRole.Title:
      style = [type.reading.chapterHeading, { color: colors.text }];
      header = true;
      break;
    case ParagraphRole.ContextTitle:
      style = [type.ui.caption, styles.contextTitle, { color: colors.textSecondary }];
      break;
    case ParagraphRole.ThemeScripture:
      style = [scripture, styles.themeScripture, { color: colors.text }];
      break;
    case ParagraphRole.Summary:
      style = [type.reading.noteBody, { color: colors.textSecondary }];
      break;
    case ParagraphRole.PublicationReference:
    case ParagraphRole.Byline:
      style = [type.ui.caption, { color: colors.textSecondary }];
      break;
    default:
      style = [scripture, { color: colors.text }];
      break;
  }
  const base = roleSize(StyleSheet.flatten(style));
  return (
    <Text accessibilityRole={header ? 'header' : undefined} style={style}>
      {number !== undefined && (
        <Text style={[type.verseNumber, { color: colors.textSecondary }]}>
          {number}
          {' '}
        </Text>
      )}
      <Inlines inlines={inlines} base={base} context={context} />
    </Text>
  );
}

// A study question: the UI font, set apart from the paragraphs it asks about.
function QuestionView({ number, inlines, context }: { number: string; inlines: readonly DocInline[]; context: Context }) {
  const { colors, type, look, m3 } = useBerean();
  const body = type.ui.body;
  return (
    <View style={[styles.question, { borderStartColor: look === 'material' ? m3.outlineVariant : colors.separator }]}>
      <Text style={[body, { color: colors.textSecondary }]}>
        <Text style={styles.strong}>{number}. </Text>
        <Inlines inlines={inlines} base={body.fontSize ?? 17} context={context} />
      </Text>
    </View>
  );
}

function FigureView({ image, caption, context }: { image: DocImage; caption: readonly DocBlock[]; context: Context }) {
  const { colors, type } = useBerean();
  const [failed, setFailed] = useState(false);
  const ratio = image.width && image.height ? image.width / image.height : 16 / 9;
  return (
    <View style={styles.figure}>
      {failed ? (
        <View
          accessible
          accessibilityLabel={image.alt || 'Image'}
          style={[styles.image, styles.missingImage, { aspectRatio: ratio, backgroundColor: colors.surfaceRaised }]}
        >
          <UIText secondary variant="caption">
            {image.alt || 'Image'}
          </UIText>
        </View>
      ) : (
        <Image
          // An image without alt text is decoration: no unlabeled stop.
          accessible={image.alt !== ''}
          accessibilityRole={image.alt !== '' ? 'image' : undefined}
          accessibilityLabel={image.alt || undefined}
          accessibilityIgnoresInvertColors
          source={{ uri: `file://${image.path}` }}
          resizeMode="cover"
          onError={() => setFailed(true)}
          style={[styles.image, { aspectRatio: ratio, backgroundColor: colors.surfaceRaised }]}
        />
      )}
      {caption.map((block, i) =>
        block.tag === 'Paragraph' ? (
          <Text key={i} style={[type.ui.caption, { color: colors.textSecondary }]}>
            <Inlines inlines={block.inner.inlines} base={type.ui.caption.fontSize ?? 13} context={context} />
          </Text>
        ) : (
          <BlockView key={i} block={block} context={context} />
        ),
      )}
    </View>
  );
}

function AsideView({
  title,
  blocks,
  context,
}: {
  title: readonly DocInline[] | undefined;
  blocks: readonly DocBlock[];
  context: Context;
}) {
  const { colors, type, look, m3 } = useBerean();
  const fill = look === 'material' ? m3.surfaceContainerLow : colors.surfaceRaised;
  return (
    <View style={[styles.aside, { backgroundColor: fill }]}>
      {title !== undefined && (
        <Text accessibilityRole="header" style={[type.reading.sectionHeading, styles.asideTitle, { color: colors.text }]}>
          <Inlines inlines={title} base={18} context={context} />
        </Text>
      )}
      {blocks.map((block, i) => (
        <BlockView key={i} block={block} context={context} />
      ))}
    </View>
  );
}

function ListView({
  ordered,
  items,
  context,
}: {
  ordered: boolean;
  items: readonly (readonly DocBlock[])[];
  context: Context;
}) {
  const { colors, type } = useBerean();
  return (
    <View style={styles.list}>
      {items.map((blocks, i) => (
        <View key={i} style={styles.item}>
          {/* A bullet is decoration; a number gives the order, so it is read. */}
          <Text
            style={[type.reading.scripture, styles.bullet, { color: colors.textSecondary }]}
            {...(ordered ? {} : hidden)}
          >
            {ordered ? `${i + 1}.` : '•'}
          </Text>
          <View style={styles.itemBody}>
            {blocks.map((block, j) => (
              <BlockView key={j} block={block} context={context} />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

function TableView({
  rows,
  context,
}: {
  rows: readonly { cells: readonly { header: boolean; colspan: number; blocks: readonly DocBlock[] }[] }[];
  context: Context;
}) {
  const { colors } = useBerean();
  return (
    <View style={[styles.table, { borderColor: colors.separator }]}>
      {rows.map((row, i) => (
        <View key={i} style={[styles.tableRow, i > 0 && { borderTopWidth: hairline, borderColor: colors.separator }]}>
          {row.cells.map((cell, j) => (
            <View
              key={j}
              style={[
                styles.cell,
                { flex: Math.max(1, cell.colspan) },
                j > 0 && { borderStartWidth: hairline, borderColor: colors.separator },
                cell.header && { backgroundColor: colors.surfaceRaised },
              ]}
            >
              {cell.blocks.map((block, k) => (
                <BlockView key={k} block={block} context={context} />
              ))}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

function FootnotesView({ items, context }: { items: readonly DocFootnote[]; context: Context }) {
  const { colors, type } = useBerean();
  return (
    <View style={styles.footnotes}>
      <View accessibilityRole="none" style={[styles.rule, { backgroundColor: colors.separator }]} />
      {items.map((item) => (
        <Text key={item.id} style={[type.reading.noteBody, { color: colors.textSecondary }]}>
          <Text style={styles.strong}>{item.marker}</Text>
          {' '}
          <Inlines inlines={item.inlines} base={type.reading.noteBody.fontSize ?? 15} context={context} />
        </Text>
      ))}
    </View>
  );
}

/** A footnote opened from its marker, under the block that holds the marker. */
function FootnoteCard({
  footnote,
  context,
  onClose,
}: {
  footnote: DocFootnote | undefined;
  context: Context;
  onClose: () => void;
}) {
  const { colors, type, look, m3 } = useBerean();
  const fill = look === 'material' ? m3.surfaceContainer : colors.surfaceRaised;
  return (
    <View accessibilityLiveRegion="polite" style={[styles.footnoteCard, { backgroundColor: fill }]}>
      <Text style={[type.reading.noteBody, { color: colors.text }]}>
        {footnote === undefined ? (
          'This footnote isn’t in the document.'
        ) : (
          <>
            <Text style={styles.strong}>{footnote.marker}</Text>
            {' '}
            <Inlines inlines={footnote.inlines} base={type.reading.noteBody.fontSize ?? 15} context={context} />
          </>
        )}
      </Text>
      <TextButton title="Close" accessibilityLabel="Close footnote" onPress={onClose} />
    </View>
  );
}

function errorTag(e: unknown): string | undefined {
  // Not `instanceof` (see ffi/errors.ts); instanceOf indexes its argument.
  return typeof e === 'object' && e !== null && CoreError.instanceOf(e) ? e.tag : undefined;
}

function follow(target: DocLinkTarget, url: string, onNotice: (message: string) => void) {
  const action = linkAction(target.tag, url, (href) => reader().resolve(href), errorTag);
  switch (action.kind) {
    case 'passage':
      openPassage(action.span);
      return;
    case 'publication':
      openPublication(action.location);
      return;
    case 'external':
      openExternal(action.url);
      return;
    case 'cant-open':
      onNotice(action.message);
  }
}

/** Inline runs as nested Text spans; `base` is the enclosing font size. */
function Inlines({ inlines, base, context }: { inlines: readonly DocInline[]; base: number; context: Context }): ReactNode {
  const { colors } = useBerean();
  return inlines.map((inline, i) => {
    switch (inline.tag) {
      case 'Common':
        return <CommonInline key={i} inline={inline.inner.inline} />;
      case 'Superscript':
      case 'Subscript':
        return (
          <Text key={i} style={{ fontSize: base * 0.7 }}>
            <Inlines inlines={inline.inner.children} base={base * 0.7} context={context} />
          </Text>
        );
      case 'SmallCaps':
        return (
          <Text key={i} style={[styles.smallCaps, { fontSize: base * 0.8 }]}>
            <Inlines inlines={inline.inner.children} base={base * 0.8} context={context} />
          </Text>
        );
      case 'Link': {
        const { target, url, children } = inline.inner;
        return (
          <Text
            key={i}
            accessibilityRole="link"
            onPress={() => follow(target, url, context.onNotice)}
            suppressHighlighting={false}
            style={{
              textDecorationLine: 'underline',
              textDecorationColor: colors.linkUnderline,
              textDecorationStyle: 'solid',
            }}
          >
            <Inlines inlines={children} base={base} context={context} />
          </Text>
        );
      }
      case 'FootnoteRef': {
        const { id, marker } = inline.inner;
        return (
          // Nested Text exposes only the link role to TalkBack and
          // VoiceOver, and both read a fragment's own text, never its
          // label: so a link, whose text names it.
          <Text
            key={i}
            accessibilityRole="link"
            onPress={() => context.onFootnote(id)}
            suppressHighlighting={false}
            style={[styles.footnoteRef, { color: colors.accent, fontSize: base * 0.75 }]}
          >
            {` ${marker} `}
          </Text>
        );
      }
      case 'PageMarker':
        return null;
    }
  });
}

/** The cases notes share. Documents emit only Text, Emphasis and Strong. */
function CommonInline({ inline }: { inline: Inline }): ReactNode {
  switch (inline.tag) {
    case 'Text':
      return inline.inner.text;
    case 'Code':
      return inline.inner.text;
    case 'LineBreak':
      return '\n';
    case 'Tag':
      return `#${inline.inner.name}`;
    case 'Emphasis':
      return <Text style={styles.emphasis}>{inline.inner.children.map((c, i) => <CommonInline key={i} inline={c} />)}</Text>;
    case 'Strong':
      return <Text style={styles.strong}>{inline.inner.children.map((c, i) => <CommonInline key={i} inline={c} />)}</Text>;
    case 'Strikethrough':
      return <Text style={styles.strike}>{inline.inner.children.map((c, i) => <CommonInline key={i} inline={c} />)}</Text>;
    case 'Link':
      return inline.inner.children.map((c, i) => <CommonInline key={i} inline={c} />);
  }
}

const styles = StyleSheet.create({
  minorHeading: { fontSize: 18, lineHeight: 24, fontWeight: '600' },
  contextTitle: { textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: '600' },
  themeScripture: { fontStyle: 'italic' },
  emphasis: { fontStyle: 'italic' },
  strong: { fontWeight: '700' },
  strike: { textDecorationLine: 'line-through' },
  smallCaps: { textTransform: 'uppercase' },
  footnoteRef: { fontWeight: '600' },
  question: { borderStartWidth: 3, paddingStart: spacing.md },
  figure: { gap: spacing.sm },
  image: { width: '100%', borderRadius: radii.card },
  missingImage: { alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  aside: { borderRadius: radii.card, padding: spacing.lg, gap: spacing.md },
  asideTitle: { fontSize: 18, lineHeight: 24 },
  list: { gap: spacing.sm },
  item: { flexDirection: 'row', gap: spacing.sm },
  bullet: { minWidth: 18 },
  itemBody: { flex: 1, gap: spacing.sm },
  table: { borderWidth: hairline, borderRadius: radii.chip, overflow: 'hidden' },
  tableRow: { flexDirection: 'row' },
  cell: { padding: spacing.sm, gap: spacing.xs },
  footnotes: { gap: spacing.sm },
  rule: { height: hairline, marginVertical: spacing.sm },
  footnoteCard: { borderRadius: radii.card, padding: spacing.md, gap: spacing.xs },
});
