import type { BibleBook } from 'berean-ffi-rn';
import { SymbolView } from 'expo-symbols';
import { type ComponentRef, useEffect, useRef, useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { UIText } from '@/components/text';
import { TextButton } from '@/components/text-button';
import { useBerean } from '@/design/theme';
import { hairline, radii, spacing } from '@/design/tokens';
import { type ChapterLocation, chapterCountLabel, chapterHeading } from '@/reader/bible-nav';
import { moveAccessibilityFocus } from '@/reader/study-pane';

type BiblePickerProps = {
  visible: boolean;
  /** The Bible's books, in the core's order. */
  books: readonly BibleBook[];
  /** The chapter being read. */
  at: ChapterLocation;
  onPick: (to: ChapterLocation) => void;
  onClose: () => void;
};

/**
 * The book and chapter picker: the Bible's books, then the chosen book's
 * chapters as a grid. The guide only describes the Android rail's drawer
 * "with books and recents"; for the picker opened from the chapter heading
 * it is silent, so each look uses its plainest platform container. iOS
 * look: a page sheet, swiped down or cancelled to close. Material: a
 * full-screen dialog with a close button; back steps from the chapters to
 * the books, then closes. Book rows follow the guide's list rows ("John ·
 * 21 chapters": inset grouped with a trailing count, an M3 two-line item).
 */
export function BiblePicker({ visible, books, at, onPick, onClose }: BiblePickerProps) {
  const { look, colors, m3, type } = useBerean();
  const material = look === 'material';
  const target = material ? 48 : 44;

  // The book whose chapters show; none shows the books. Each opening starts
  // on the books.
  const [shownBook, setShownBook] = useState<number>();
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) setShownBook(undefined);
  }
  const chosen = books.find((b) => b.book === shownBook);
  const back = () => setShownBook(undefined);

  // A screen reader lands on the title when the step changes.
  const titleRef = useRef<ComponentRef<typeof Text>>(null);
  useEffect(() => {
    if (!visible) return;
    const frame = requestAnimationFrame(() => moveAccessibilityFocus(titleRef.current));
    return () => cancelAnimationFrame(frame);
  }, [visible, shownBook]);

  const title = chosen?.name ?? 'Books';
  const background = material ? m3.surface : colors.surface;
  const iconProps = {
    accessible: false,
    importantForAccessibility: 'no-hide-descendants',
    accessibilityElementsHidden: true,
  } as const;

  const header = material ? (
    // M3 full-screen dialog header: a leading icon button and the title.
    <View style={styles.materialHeader}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={chosen === undefined ? 'Close' : 'Back to books'}
        onPress={chosen === undefined ? onClose : back}
        style={({ pressed }) => [styles.iconButton, { opacity: pressed ? 0.6 : 1 }]}
      >
        <SymbolView
          {...iconProps}
          name={
            chosen === undefined
              ? { ios: 'xmark', android: 'close' }
              : { ios: 'chevron.left', android: 'arrow_back' }
          }
          size={24}
          tintColor={m3.onSurface}
        />
      </Pressable>
      <Text
        ref={titleRef}
        accessibilityRole="header"
        numberOfLines={1}
        style={[styles.materialTitle, { fontSize: type.ui.title.fontSize, color: m3.onSurface }]}
      >
        {title}
      </Text>
    </View>
  ) : (
    // A sheet's navigation bar: back to the books on the leading side,
    // Cancel on the trailing side, the title centered.
    <View style={[styles.iosHeader, { borderBottomColor: colors.separator }]}>
      <View style={styles.iosHeaderSide}>
        {chosen !== undefined && <TextButton title="Books" align="leading" onPress={back} />}
      </View>
      <Text
        ref={titleRef}
        accessibilityRole="header"
        numberOfLines={1}
        style={[styles.iosTitle, { color: colors.text }]}
      >
        {title}
      </Text>
      <View style={[styles.iosHeaderSide, styles.iosHeaderTrailing]}>
        <TextButton title="Cancel" onPress={onClose} />
      </View>
    </View>
  );

  const bookList = (
    <FlatList
      data={books}
      keyExtractor={(item) => String(item.book)}
      contentContainerStyle={!material && styles.iosGroup}
      renderItem={({ item, index }) => {
        const count = chapterCountLabel(item.chapterCount);
        const current = item.book === at.book;
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${item.name}, ${count}`}
            accessibilityState={{ selected: current }}
            onPress={() => setShownBook(item.book)}
            style={({ pressed }) => [
              material ? styles.materialRow : styles.iosRow,
              !material && {
                backgroundColor: colors.surfaceRaised,
                borderTopColor: colors.separator,
                borderTopWidth: index === 0 ? 0 : hairline,
              },
              !material && index === 0 && styles.iosFirstRow,
              !material && index === books.length - 1 && styles.iosLastRow,
              { opacity: pressed ? 0.6 : 1 },
            ]}
          >
            {material ? (
              <>
                <UIText numberOfLines={1} style={{ color: m3.onSurface }}>
                  {item.name}
                </UIText>
                <UIText numberOfLines={1} style={[styles.supporting, { color: m3.onSurfaceVariant }]}>
                  {count}
                </UIText>
              </>
            ) : (
              <>
                <UIText numberOfLines={1} style={styles.iosRowName}>
                  {item.name}
                </UIText>
                <UIText numberOfLines={1} secondary>
                  {count}
                </UIText>
              </>
            )}
          </Pressable>
        );
      }}
    />
  );

  const chapterGrid = chosen !== undefined && (
    <ScrollView contentContainerStyle={styles.grid}>
      {Array.from({ length: chosen.chapterCount }, (_, i) => i + 1).map((chapter) => {
        const current = chosen.book === at.book && chapter === at.chapter;
        return (
          <Pressable
            key={chapter}
            accessibilityRole="button"
            accessibilityLabel={chapterHeading(chosen, chapter)}
            accessibilityState={{ selected: current }}
            onPress={() => onPick({ book: chosen.book, chapter })}
            style={({ pressed }) => [
              styles.cell,
              {
                minWidth: target,
                minHeight: target,
                borderRadius: material ? radii.materialChip : radii.chip,
                // The current chapter has the selected verse number's fill.
                backgroundColor: current ? colors.accent : 'transparent',
                opacity: pressed ? 0.6 : 1,
              },
            ]}
          >
            <UIText style={{ color: current ? colors.surfaceRaised : colors.text }}>{chapter}</UIText>
          </Pressable>
        );
      })}
    </ScrollView>
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle={material ? 'fullScreen' : 'pageSheet'}
      // iOS look: the sheet swipes down to close, as sheets do.
      allowSwipeDismissal={!material}
      // Android draws under the system bars; SafeAreaView pads for them.
      statusBarTranslucent
      navigationBarTranslucent
      // Back, the swipe down, or Escape: material steps back to the books
      // before closing; the sheet closes.
      onRequestClose={material && chosen !== undefined ? back : onClose}
    >
      <SafeAreaView style={[styles.root, { backgroundColor: background }]}>
        {header}
        {chosen === undefined ? bookList : chapterGrid}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  // M3 full-screen dialog header: 64dp, a 48dp icon button 4dp from the edge.
  materialHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 64,
    paddingHorizontal: spacing.xs,
    gap: spacing.xs,
  },
  iconButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  // M3 title large, as the look's top app bar title.
  materialTitle: { flex: 1, fontWeight: '400' },
  iosHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: hairline,
  },
  iosHeaderSide: { flex: 1, flexDirection: 'row' },
  iosHeaderTrailing: { justifyContent: 'flex-end' },
  // The iOS navigation bar title: 17pt semibold.
  iosTitle: { flexShrink: 1, fontSize: 17, lineHeight: 22, fontWeight: '600', textAlign: 'center' },
  // M3 two-line list item: 72dp, 16dp padding.
  materialRow: {
    minHeight: 72,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  supporting: { fontSize: 14, lineHeight: 20 },
  // Inset grouped rows: a rounded group inset from the edges.
  iosGroup: { padding: spacing.lg },
  iosRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  iosRowName: { flex: 1 },
  iosFirstRow: { borderTopLeftRadius: radii.card, borderTopRightRadius: radii.card },
  iosLastRow: { borderBottomLeftRadius: radii.card, borderBottomRightRadius: radii.card },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    padding: spacing.lg,
  },
  cell: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xs },
});
