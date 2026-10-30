import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import {
  Pressable,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  View,
  type SectionListProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { FilterChip } from '@/components/filter-chip';
import { UIText } from '@/components/text';
import { useBerean } from '@/design/theme';
import { type ResultRow, useSearch } from '@/search/search-context';
import {
  formatCount,
  GROUP_LABELS,
  GROUP_ORDER,
  resultsLabel,
  visibleGroups,
  type Group,
  type Scope,
} from '@/search/results';

const EMPTY_HINT =
  'Search the Bible and your installed publications by word. Put a phrase in quotes to match it exactly.';

/** The rows a scope shows, grouped, in order. */
export function useVisibleGroups(): Group<ResultRow>[] {
  const { groups, scope } = useSearch();
  return visibleGroups(groups, scope);
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
  const { spacing } = useBerean();
  const { truncated } = useSearch();
  const label = GROUP_LABELS[group.key];
  return (
    <View
      accessible
      accessibilityRole="header"
      accessibilityLabel={`${label}, ${resultsLabel(group.hits.length, truncated)}`}
      style={[styles.groupHeader, { paddingTop: spacing.lg, paddingBottom: spacing.xs }]}
    >
      <UIText variant="caption" secondary style={styles.groupLabel}>
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
  /** Set only where rows can be selected (the palette): the keyboard's row. */
  selected?: boolean;
};

function ResultRowView({ row, onOpen, selected }: ResultRowViewProps) {
  const { look, m3, colors, type, spacing, radii } = useBerean();
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
      onPress={() => onOpen(row)}
      style={({ pressed }) => [
        { paddingVertical: spacing.sm, opacity: pressed ? 0.6 : 1 },
        selectable && {
          marginHorizontal: -spacing.md,
          paddingHorizontal: spacing.md,
          borderRadius: radii.card,
        },
        selected && { backgroundColor: fill },
      ]}
    >
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
  /** Above the results, e.g. the scope chips; shown once there are results. */
  header?: ReactElement;
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
  header,
  onOpened,
  selectedKey,
  ...listProps
}: SearchResultsProps) {
  const { state, total, open } = useSearch();
  const groups = useVisibleGroups();
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
          selected={selectedKey === undefined ? undefined : item.key === selectedKey}
        />
      )}
      viewabilityConfig={viewabilityConfig}
      onViewableItemsChanged={onViewableItemsChanged}
      // A row not laid out yet; rows are a step apart, so the next lands.
      onScrollToIndexFailed={() => {}}
      renderSectionHeader={({ section }) => <GroupHeader group={section} />}
      ListHeaderComponent={total > 0 ? header : undefined}
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
  title: { fontWeight: '600' },
  marked: { fontWeight: '700' },
  stale: { opacity: 0.6 },
});
