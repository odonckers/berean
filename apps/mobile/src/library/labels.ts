import { PubKind, type PublicationSummary } from 'berean-ffi-rn';

/** The core's issue title for a dated periodical, else the catalog title. */
export function displayTitle(pub: PublicationSummary): string {
  return pub.issueTitle ?? pub.title;
}

export const KIND_LABELS: Record<PubKind, string> = {
  [PubKind.Bible]: 'Bible',
  [PubKind.Book]: 'Book',
  [PubKind.Brochure]: 'Brochure',
  [PubKind.Watchtower]: 'Watchtower',
  [PubKind.Awake]: 'Awake',
  [PubKind.MeetingWorkbook]: 'Meeting workbook',
  [PubKind.Index]: 'Index',
  [PubKind.Other]: 'Other',
};

/** The kind filter buttons, in display order; `undefined` is "All". */
export const KIND_FILTERS: readonly { kind: PubKind | undefined; label: string }[] = [
  { kind: undefined, label: 'All' },
  ...[
    PubKind.Bible,
    PubKind.Book,
    PubKind.Brochure,
    PubKind.Watchtower,
    PubKind.Awake,
    PubKind.MeetingWorkbook,
    PubKind.Index,
    PubKind.Other,
  ].map((kind) => ({ kind, label: KIND_LABELS[kind] })),
];
