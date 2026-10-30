// How hits are grouped and counted for display, kept free of React Native so
// Node can test it. The order and membership are the core's; this only sorts
// hits into the guide's groups.

/** The most hits one query loads. The core gives no total. */
export const SEARCH_LIMIT = 100;

// The guide's groups, in its order: Verses, Publications, Notes, Studyspace.
// The core has no Notes or Studyspace search yet, so those groups are left
// out rather than faked; they slot in after Publications once it does.
export type GroupKey = 'verses' | 'publications';
export const GROUP_ORDER: readonly GroupKey[] = ['verses', 'publications'];

export const GROUP_LABELS: Record<GroupKey, string> = {
  verses: 'Verses',
  publications: 'Publications',
};

export type Scope = 'all' | GroupKey;

/** The parts of the core's Hit grouping reads. */
export type GroupableHit = { location: { verse?: number } };

export type Group<H> = { key: GroupKey; hits: H[] };

/** Verses are hits at a verse; every other hit is a publication paragraph. */
export function groupKey(hit: GroupableHit): GroupKey {
  return hit.location.verse === undefined ? 'publications' : 'verses';
}

/** Every group in order, empty ones included, each in the core's order. */
export function groupHits<H extends GroupableHit>(hits: readonly H[]): Group<H>[] {
  const groups = GROUP_ORDER.map((key): Group<H> => ({ key, hits: [] }));
  for (const hit of hits) {
    groups[GROUP_ORDER.indexOf(groupKey(hit))].hits.push(hit);
  }
  return groups;
}

/** The groups a scope chip shows, without empty ones. */
export function visibleGroups<H>(groups: readonly Group<H>[], scope: Scope): Group<H>[] {
  return groups.filter((g) => g.hits.length > 0 && (scope === 'all' || g.key === scope));
}

/** Whether the core may have had more hits than were loaded. */
export function isTruncated(total: number, limit: number = SEARCH_LIMIT): boolean {
  return total >= limit;
}

/** "42", or "42+" when the results were cut off at the limit. */
export function formatCount(count: number, truncated: boolean): string {
  return truncated ? `${count}+` : String(count);
}

/** "1 result", "42 results", "100+ results". */
export function resultsLabel(count: number, truncated: boolean): string {
  return `${formatCount(count, truncated)} ${count === 1 && !truncated ? 'result' : 'results'}`;
}
