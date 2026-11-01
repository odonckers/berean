// Studyspace wording and card levels: the workspace announcement and
// delete prompt, card labels, and which semantic zoom level (§5) a card
// draws at. Kept free of React Native for the tests.

export type CardKind = 'note' | 'passage' | 'publication';

/** "1 card", "14 cards". */
export function cardCount(n: number): string {
  return n === 1 ? '1 card' : `${n} cards`;
}

/** Said on opening or switching to a workspace (§7.3): "Workspace 2, 14 cards". */
export function workspaceAnnouncement(name: string, cards: number): string {
  return `${name}, ${cardCount(cards)}`;
}

/** Delete Workspace's confirmation. The core keeps the notes; the prompt says so. */
export function deleteWorkspacePrompt(name: string, cards: number): { title: string; message: string } {
  const what = cards === 0 ? 'It has no cards.' : `Its ${cardCount(cards)} come off the canvas.`;
  return {
    title: `Delete “${name}”?`,
    message: `${what} Your notes are kept, in Notes. This can’t be undone.`,
  };
}

/** A card's spoken label (§9): "Note, Hope in Romans 8"; "Romans 8, publication". */
export function cardAccessibilityLabel(kind: CardKind, title: string, missing: boolean): string {
  const label = kind === 'note' ? `Note, ${title}` : `${title}, ${kind}`;
  return missing ? `${label}, missing` : label;
}

/**
 * The open workspace: `wanted` if it is still there, else the first. None
 * when there are no workspaces.
 */
export function pickWorkspace<T extends { id: bigint }>(workspaces: readonly T[], wanted: bigint | undefined): T | undefined {
  return workspaces.find((w) => w.id === wanted) ?? workspaces[0];
}

/** §5's breakpoints at 17 pt text, in on-screen points; they scale with the text size. */
const LEVEL_BREAKPOINTS = [48, 160, 320] as const;

export type CardLevel = 1 | 2 | 3 | 4;

/** A card's semantic zoom level from its on-screen width (§5), not the zoom. */
export function cardLevel(widthOnScreen: number, fontScale: number): CardLevel {
  const [l2, l3, l4] = LEVEL_BREAKPOINTS.map((b) => b * fontScale);
  if (widthOnScreen < l2) return 1;
  if (widthOnScreen < l3) return 2;
  if (widthOnScreen < l4) return 3;
  return 4;
}

/**
 * How much a card's title is scaled up inside the zoomed canvas so it
 * never shrinks below the reader's text size (§5): 1 / zoom below 100%,
 * 1 at 100% and above (where it grows with the zoom).
 */
export function titleScale(zoom: number): number {
  return 1 / Math.min(zoom, 1);
}
