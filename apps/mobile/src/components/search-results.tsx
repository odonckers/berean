import * as Haptics from 'expo-haptics';
import type { SymbolViewProps } from 'expo-symbols';
import type { TopicSuggestion } from 'berean-ffi-rn';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
import { library } from '@/ffi/core';
import { displayTitle } from '@/library/labels';
import { load } from '@/library/load';
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
import { completionParts } from '@/search/suggestions';

// The tab bar's Read and Library glyphs.
const ROW_GLYPHS: Record<GroupKey, SymbolViewProps['name']> = {
  verses: { ios: 'book', android: 'menu_book' },
  publications: { ios: 'books.vertical', android: 'library_books' },
};

const SUGGESTION_GLYPHS: Record<'query' | 'topic' | 'fill', SymbolViewProps['name']> = {
  query: { ios: 'magnifyingglass', android: 'search' },
  topic: { ios: 'text.book.closed', android: 'article' },
  // Fills the field, as in Safari's and the M3 search view's rows.
  fill: { ios: 'arrow.up.left', android: 'north_west' },
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

type SuggestionRowProps = {
  glyph: SymbolViewProps['name'];
  accessibilityLabel: string;
  accessibilityHint: string;
  onPress: () => void;
  guard: PressGuard;
  /** Shown with the fill arrow: a query, which goes into the field. */
  fills: boolean;
  children: ReactNode;
};

function SuggestionRow({ glyph, accessibilityLabel, accessibilityHint, onPress, guard, fills, children }: SuggestionRowProps) {
  const { colors, type, spacing } = useBerean();
  const { fontScale } = useWindowDimensions();
  const lineHeight = (type.ui.body.lineHeight ?? 0) * fontScale;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      onPressIn={(e) => guard.pressIn(e.nativeEvent.pageX, e.nativeEvent.pageY)}
      onPress={(e) => {
        if (guard.shouldOpen(e.nativeEvent.pageX, e.nativeEvent.pageY)) onPress();
      }}
      style={({ pressed }) => [
        styles.row,
        styles.suggestion,
        { gap: spacing.md, paddingVertical: spacing.sm, opacity: pressed ? 0.6 : 1 },
      ]}
    >
      <View
        style={[styles.glyph, { minHeight: lineHeight }]}
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      >
        <ScaledSymbol name={glyph} size={22} tintColor={colors.textSecondary} />
      </View>
      <View style={styles.rowText}>{children}</View>
      {fills && (
        <View
          style={[styles.glyph, { minHeight: lineHeight }]}
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
        >
          <ScaledSymbol name={SUGGESTION_GLYPHS.fill} size={18} tintColor={colors.textSecondary} />
        </View>
      )}
    </Pressable>
  );
}

// Installed publications' titles by key, for a topic's caption.
function usePublicationTitles(topics: readonly TopicSuggestion[]): Map<string, string> {
  const keys = topics.map((t) => t.location.pubKey).join('\n');
  return useMemo(() => {
    const titles = new Map<string, string>();
    if (keys === '') return titles;
    const installed = load(() => library().installed());
    if (installed.ok) for (const p of installed.value) titles.set(p.pubKey, displayTitle(p));
    return titles;
  }, [keys]);
}

/**
 * Suggestions while typing, above the results: Insight articles to open
 * directly, then the query with its last word completed, which goes into
 * the field (with a space, ready for the next word).
 */
function Suggestions({ guard, onOpened }: { guard: PressGuard; onOpened?: () => void }) {
  const { look, colors, spacing } = useBerean();
  const { text, suggestions, choose, open } = useSearch();
  const titles = usePublicationTitles(suggestions.topics);
  // Only those for the text in the field.
  if (suggestions.text !== text) return null;
  const { topics, queries } = suggestions;
  if (topics.length === 0 && queries.length === 0) return null;
  const labelInk = look === 'material' && { color: colors.accent };
  return (
    <View>
      <View
        accessible
        accessibilityRole="header"
        style={[styles.groupHeader, { paddingTop: spacing.lg, paddingBottom: spacing.xs }]}
      >
        <UIText variant="caption" secondary style={[styles.groupLabel, labelInk]}>
          Suggestions
        </UIText>
      </View>
      {topics.map((topic) => {
        const publication = titles.get(topic.location.pubKey);
        return (
          <SuggestionRow
            key={`topic:${topic.location.pubKey}/${topic.location.docId ?? ''}`}
            glyph={SUGGESTION_GLYPHS.topic}
            accessibilityLabel={publication === undefined ? topic.title : `${topic.title}, ${publication}`}
            accessibilityHint="Opens the article"
            guard={guard}
            fills={false}
            onPress={() => {
              onOpened?.();
              open(topic);
            }}
          >
            <UIText numberOfLines={1} style={styles.title}>
              {topic.title}
            </UIText>
            {publication !== undefined && (
              <UIText variant="caption" secondary numberOfLines={1}>
                {publication}
              </UIText>
            )}
          </SuggestionRow>
        );
      })}
      {queries.map((query) => {
        const parts = completionParts(query, text);
        return (
          <SuggestionRow
            key={`query:${query}`}
            glyph={SUGGESTION_GLYPHS.query}
            accessibilityLabel={query}
            accessibilityHint="Searches for this"
            guard={guard}
            fills
            onPress={() => choose(query)}
          >
            <UIText numberOfLines={1}>
              {parts.typed}
              <UIText style={styles.title}>{parts.completion}</UIText>
            </UIText>
          </SuggestionRow>
        );
      })}
    </View>
  );
}

// The line shown in place of results: the hint, searching, no results, or
// the error.
function StatusLine() {
  const { state, text, suggestions } = useSearch();
  const { spacing } = useBerean();
  // A word still being typed rarely finds anything yet; the suggestions
  // above say more than "No results".
  const suggested =
    suggestions.text === text && suggestions.topics.length + suggestions.queries.length > 0;
  if (suggested && state.status === 'done') return null;
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
  // Results from the last query stay while the next one runs, dimmed, so
  // the list doesn't jump; suggestions above them never dim.
  const stale = state.status === 'loading' && total > 0;
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
        <View style={stale && styles.stale}>
          <ResultRowView
            row={item}
            onOpen={onOpen}
            guard={guard}
            selected={selectedKey === undefined ? undefined : item.key === selectedKey}
          />
        </View>
      )}
      ListHeaderComponent={<Suggestions guard={guard} onOpened={onOpened} />}
      viewabilityConfig={viewabilityConfig}
      onViewableItemsChanged={onViewableItemsChanged}
      // A row not laid out yet; rows are a step apart, so the next lands.
      onScrollToIndexFailed={() => {}}
      onScrollBeginDrag={guard.scrolled}
      onMomentumScrollBegin={guard.scrolled}
      // A row's onPress fires before the list's onTouchEnd, so this only forgets presses that never reached it.
      onTouchEnd={guard.end}
      onTouchCancel={guard.end}
      renderSectionHeader={({ section }) => (
        <View style={stale && styles.stale}>
          <GroupHeader group={section} />
        </View>
      )}
      ListEmptyComponent={<StatusLine />}
      stickySectionHeadersEnabled={false}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
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
  // Every user stacks the chips in a column above the results. ScrollView's
  // base style shrinks, so without flexShrink: 0 an overflowing list squeezes
  // the row below its (font-scaled) chip height and clips the chips.
  chipScroll: { flexGrow: 0, flexShrink: 0 },
  groupHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  groupLabel: { fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  glyph: { justifyContent: 'center' },
  rowText: { flex: 1 },
  // A touch target at least 44 pt tall, whatever the text size.
  suggestion: { minHeight: 44, alignItems: 'center' },
  title: { fontWeight: '600' },
  marked: { fontWeight: '700' },
  stale: { opacity: 0.6 },
});
