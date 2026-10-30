import * as Haptics from 'expo-haptics';
import type { SymbolViewProps } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type SectionListProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { FilterChip } from '@/components/filter-chip';
import { ScaledSymbol } from '@/components/scaled-symbol';
import { UIText } from '@/components/text';
import { useBerean } from '@/design/theme';
import { createPressGuard, type PressGuard } from '@/search/press-guard';
import { type ResultRow, useSearch } from '@/search/search-context';
import {
  formatCount,
  GROUP_LABELS,
  GROUP_ORDER,
  groupKey,
  resultsLabel,
  visibleGroups,
  type Group,
  type GroupKey,
  type Scope,
} from '@/search/results';

// The tab bar's Read and Library glyphs.
const ROW_GLYPHS: Record<GroupKey, SymbolViewProps['name']> = {
  verses: { ios: 'book', android: 'menu_book' },
  publications: { ios: 'books.vertical', android: 'library_books' },
};

const EMPTY_HINT =
  'Search the Bible and your installed publications by word. Put a phrase in quotes to match it exactly.';

/**
 * The rows a scope shows, grouped, in order: the shared scope's, or `scope`
 * where a view shows its own (the Material palette always shows All).
 */
export function useVisibleGroups(scope?: Scope): Group<ResultRow>[] {
  const search = useSearch();
  return visibleGroups(search.groups, scope ?? search.scope);
}

/** "All 54", "Verses 42", "Publications 6": the scope chips, with counts. */
export function SearchScopeChips({ style }: { style?: StyleProp<ViewStyle> }) {
  const { spacing } = useBerean();
  const { groups, total, truncated, scope, setScope } = useSearch();
  const chips: { scope: Scope; label: string; count: number }[] = [
    { scope: 'all', label: 'All', count: total },
    ...GROUP_ORDER.map((key) => ({
      scope: key,
      label: GROUP_LABELS[key],
      count: groups.find((g) => g.key === key)?.hits.length ?? 0,
    })),
  ];
  const choose = (next: Scope) => {
    if (next === scope) return;
    setScope(next);
    Haptics.selectionAsync().catch(() => {});
  };
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      style={styles.chipScroll}
      contentContainerStyle={[{ gap: spacing.sm }, style]}
    >
      {chips.map((chip) => {
        const count = formatCount(chip.count, truncated);
        return (
          <FilterChip
            key={chip.scope}
            label={`${chip.label} ${count}`}
            accessibilityLabel={`${chip.label}, ${resultsLabel(chip.count, truncated)}`}
            selected={scope === chip.scope}
            onPress={() => choose(chip.scope)}
          />
        );
      })}
    </ScrollView>
  );
}

function GroupHeader({ group }: { group: Group<ResultRow> }) {
  const { look, colors, spacing } = useBerean();
  const { truncated } = useSearch();
  const label = GROUP_LABELS[group.key];
  // The Material mocks draw the label (not the count) in the accent.
  const labelInk = look === 'material' && { color: colors.accent };
  return (
    <View
      accessible
      accessibilityRole="header"
      accessibilityLabel={`${label}, ${resultsLabel(group.hits.length, truncated)}`}
      style={[styles.groupHeader, { paddingTop: spacing.lg, paddingBottom: spacing.xs }]}
    >
      <UIText variant="caption" secondary style={[styles.groupLabel, labelInk]}>
        {label}
      </UIText>
      <UIText variant="caption" secondary>
        {formatCount(group.hits.length, truncated)}
      </UIText>
    </View>
  );
}

type ResultRowViewProps = {
  row: ResultRow;
  onOpen: (row: ResultRow) => void;
  /** The list's guard: a press opens only if it was a tap. */
  guard: PressGuard;
  /** Set only where rows can be selected (the palette): the keyboard's row. */
  selected?: boolean;
};

function ResultRowView({ row, onOpen, guard, selected }: ResultRowViewProps) {
  const { look, m3, colors, type, spacing, radii } = useBerean();
  const { fontScale } = useWindowDimensions();
  const selectable = selected !== undefined;
  // The guide's tinted row. The fill reaches a little past the text, which
  // stays where an unselectable row puts it.
  const fill = look === 'material' ? m3.secondaryContainer : m3.surfaceContainerHighest;
  const ink = selected && look === 'material' ? m3.onSecondaryContainer : undefined;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={row.accessibilityLabel}
      accessibilityState={selectable ? { selected } : undefined}
      onPressIn={(e) => guard.pressIn(e.nativeEvent.pageX, e.nativeEvent.pageY)}
      // Pressable alone can take a drag for a tap on Android: Pressability
      // ignores moves until the row's rect is measured (async after press-in),
      // so with a busy JS thread a whole down/move/up batch lands before it
      // and the release counts as a press. The guard checks scroll and slop.
      onPress={(e) => {
        if (guard.shouldOpen(e.nativeEvent.pageX, e.nativeEvent.pageY)) onOpen(row);
      }}
      style={({ pressed }) => [
        styles.row,
        { gap: spacing.md, paddingVertical: spacing.sm, opacity: pressed ? 0.6 : 1 },
        selectable && {
          marginHorizontal: -spacing.md,
          paddingHorizontal: spacing.md,
          borderRadius: radii.card,
        },
        selected && { backgroundColor: fill },
      ]}
    >
      {/* The type glyph, centered on the title line. Decorative: the row's label names the hit. */}
      <View
        style={[styles.glyph, { minHeight: (type.ui.body.lineHeight ?? 0) * fontScale }]}
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      >
        <ScaledSymbol
          name={ROW_GLYPHS[groupKey(row.hit)]}
          size={22}
          tintColor={ink ?? colors.textSecondary}
        />
      </View>
      <View style={styles.rowText}>
        <UIText numberOfLines={1} style={[styles.title, ink !== undefined && { color: ink }]}>
          {row.title}
        </UIText>
        <Text numberOfLines={2} style={[type.ui.caption, { color: ink ?? colors.textSecondary }]}>
          {row.runs.map((run, i) =>
            run.marked ? (
              <Text key={i} style={[styles.marked, { color: ink ?? colors.text }]}>
                {run.text}
              </Text>
            ) : (
              run.text
            ),
          )}
        </Text>
      </View>
    </Pressable>
  );
}

// The line shown in place of results: the hint, searching, no results, or
// the error.
function StatusLine() {
  const { state } = useSearch();
  const { spacing } = useBerean();
  let message: string;
  switch (state.status) {
    case 'empty':
      message = EMPTY_HINT;
      break;
    case 'loading':
      message = 'Searching…';
      break;
    case 'done':
      message = `No results for “${state.text}”`;
      break;
    case 'error':
      message = state.message;
      break;
  }
  return (
    <UIText secondary style={{ paddingVertical: spacing.lg }}>
      {message}
    </UIText>
  );
}

type SearchResultsProps = {
  /** The scope shown, where it isn't the shared one. */
  scope?: Scope;
  /** Runs after the hit opens, e.g. to close the palette. */
  onOpened?: () => void;
  /**
   * The keyboard-selected row's key (the palette). Rows are selectable only
   * when this is passed; the list scrolls to keep the selected row in view.
   */
  selectedKey?: string;
} & Pick<
  SectionListProps<ResultRow, Group<ResultRow>>,
  'style' | 'contentContainerStyle' | 'contentInsetAdjustmentBehavior'
>;

/** The grouped results on a solid surface, or the state in their place. */
export function SearchResults({
  scope,
  onOpened,
  selectedKey,
  ...listProps
}: SearchResultsProps) {
  const { state, total, open } = useSearch();
  const groups = useVisibleGroups(scope);
  // One for the list: its scrolling cancels the press of whichever row.
  const [guard] = useState(createPressGuard);
  const onOpen = (row: ResultRow) => {
    onOpened?.();
    open(row.hit);
  };
  const { listRef, viewabilityConfig, onViewableItemsChanged } = useKeepInView(
    groups,
    selectedKey,
  );
  return (
    <SectionList
      {...listProps}
      ref={listRef}
      sections={groups.map((g) => ({ ...g, data: g.hits }))}
      keyExtractor={(row) => row.key}
      renderItem={({ item }) => (
        <ResultRowView
          row={item}
          onOpen={onOpen}
          guard={guard}
          selected={selectedKey === undefined ? undefined : item.key === selectedKey}
        />
      )}
      viewabilityConfig={viewabilityConfig}
      onViewableItemsChanged={onViewableItemsChanged}
      // A row not laid out yet; rows are a step apart, so the next lands.
      onScrollToIndexFailed={() => {}}
      onScrollBeginDrag={guard.scrolled}
      onMomentumScrollBegin={guard.scrolled}
      // A row's onPress fires before the list's onTouchEnd, so this only forgets presses that never reached it.
      onTouchEnd={guard.end}
      onTouchCancel={guard.end}
      renderSectionHeader={({ section }) => <GroupHeader group={section} />}
      ListEmptyComponent={<StatusLine />}
      stickySectionHeadersEnabled={false}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      // Results from the last query stay while the next one runs, dimmed,
      // so the list doesn't jump.
      style={[listProps.style, state.status === 'loading' && total > 0 && styles.stale]}
    />
  );
}

type ListProps = SectionListProps<ResultRow, Group<ResultRow>>;

// Scrolls the selected row back into view when it moves out of it: to the
// top edge moving up (to its group's header for a group's first row, so the
// label shows), to the bottom edge moving down.
function useKeepInView(groups: Group<ResultRow>[], selectedKey: string | undefined) {
  const listRef = useRef<SectionList<ResultRow, Group<ResultRow>>>(null);
  const fullyVisible = useRef(new Set<string>());
  const previous = useRef<{ key: string; flat: number }>(undefined);
  // Stable for the list's lifetime, as SectionList requires. Headers have
  // a null index.
  const [onViewableItemsChanged] = useState(
    (): ListProps['onViewableItemsChanged'] =>
      ({ viewableItems }) => {
        fullyVisible.current = new Set(
          viewableItems.flatMap((v) => (v.index === null ? [] : [v.key])),
        );
      },
  );

  useEffect(() => {
    if (selectedKey === undefined || previous.current?.key === selectedKey) return;
    let flat = 0;
    for (const [sectionIndex, group] of groups.entries()) {
      const index = group.hits.findIndex((row) => row.key === selectedKey);
      if (index === -1) {
        flat += group.hits.length;
        continue;
      }
      flat += index;
      const up = previous.current === undefined || flat < previous.current.flat;
      previous.current = { key: selectedKey, flat };
      if (fullyVisible.current.has(selectedKey)) return;
      // itemIndex 0 is the group's header, so a row is its index + 1.
      listRef.current?.scrollToLocation({
        sectionIndex,
        itemIndex: up && index === 0 ? 0 : index + 1,
        viewPosition: up ? 0 : 1,
      });
      return;
    }
  }, [groups, selectedKey]);

  return { listRef, viewabilityConfig: FULLY_VISIBLE, onViewableItemsChanged };
}

const FULLY_VISIBLE = { itemVisiblePercentThreshold: 100 };

const styles = StyleSheet.create({
  chipScroll: { flexGrow: 0 },
  groupHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  groupLabel: { fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  glyph: { justifyContent: 'center' },
  rowText: { flex: 1 },
  title: { fontWeight: '600' },
  marked: { fontWeight: '700' },
  stale: { opacity: 0.6 },
});
