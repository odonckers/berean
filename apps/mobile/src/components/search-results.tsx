import * as Haptics from 'expo-haptics';
import type { ReactElement } from 'react';
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

function ResultRowView({ row, onOpen }: { row: ResultRow; onOpen: (row: ResultRow) => void }) {
  const { colors, type, spacing } = useBerean();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={row.accessibilityLabel}
      onPress={() => onOpen(row)}
      style={({ pressed }) => [{ paddingVertical: spacing.sm, opacity: pressed ? 0.6 : 1 }]}
    >
      <UIText numberOfLines={1} style={styles.title}>
        {row.title}
      </UIText>
      <Text numberOfLines={2} style={[type.ui.caption, { color: colors.textSecondary }]}>
        {row.runs.map((run, i) =>
          run.marked ? (
            <Text key={i} style={[styles.marked, { color: colors.text }]}>
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
} & Pick<
  SectionListProps<ResultRow, Group<ResultRow>>,
  'style' | 'contentContainerStyle' | 'contentInsetAdjustmentBehavior'
>;

/** The grouped results on a solid surface, or the state in their place. */
export function SearchResults({ header, onOpened, ...listProps }: SearchResultsProps) {
  const { state, total, open } = useSearch();
  const groups = useVisibleGroups();
  const onOpen = (row: ResultRow) => {
    onOpened?.();
    open(row.hit);
  };
  return (
    <SectionList
      {...listProps}
      sections={groups.map((g) => ({ ...g, data: g.hits }))}
      keyExtractor={(row) => row.key}
      renderItem={({ item }) => <ResultRowView row={item} onOpen={onOpen} />}
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

const styles = StyleSheet.create({
  chipScroll: { flexGrow: 0 },
  groupHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  groupLabel: { fontWeight: '600' },
  title: { fontWeight: '600' },
  marked: { fontWeight: '700' },
  stale: { opacity: 0.6 },
});
