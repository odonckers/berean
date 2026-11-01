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

/** §5 L2: a note's title wraps to 2 lines, then truncates. */
const MAX_TITLE_LINES = 2;

export type CardText = {
  /** Glyph only, or title only at L2 and up in this slice. */
  level: CardLevel;
  /** Whole title lines that fit; 0 at L1. */
  titleLines: number;
  /** Whether the one-line "missing" caption fits under the title. */
  caption: boolean;
};

/**
 * What a card can draw without slicing text (§5). Its text is laid out at
 * the card's frame / titleScale(zoom) and scaled back up, so in that layout
 * a line is the reader's line height (at any zoom). Only whole lines are
 * drawn, the last with an ellipsis; a card too short for one whole title
 * line, or too narrow (cardLevel), drops to L1. `lineHeight` and
 * `captionLineHeight` are already multiplied by the font scale.
 */
export function cardText(
  frame: { width: number; height: number },
  zoom: number,
  fontScale: number,
  text: { padding: number; gap: number; lineHeight: number; captionLineHeight: number },
  missing: boolean,
): CardText {
  const widthLevel = cardLevel(frame.width * zoom, fontScale);
  const room = frame.height / titleScale(zoom) - 2 * text.padding;
  // A hair of slack, so a height that is exactly n lines isn't floored to n − 1.
  const fits = (height: number) => Math.floor(height / text.lineHeight + 1e-6);
  const titleLines = Math.min(MAX_TITLE_LINES, Math.max(0, fits(room)));
  if (widthLevel === 1 || titleLines === 0) return { level: 1, titleLines: 0, caption: false };
  if (!missing) return { level: widthLevel, titleLines, caption: false };
  // The caption takes the last title line's room if it needs to; the title keeps at least one.
  const withCaption = Math.min(titleLines, fits(room - text.gap - text.captionLineHeight));
  return withCaption >= 1
    ? { level: widthLevel, titleLines: withCaption, caption: true }
    : { level: widthLevel, titleLines, caption: false };
}
