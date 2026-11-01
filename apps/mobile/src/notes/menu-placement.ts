// Where the Material look's M3 menu opens at its anchor (action-sheet.tsx),
// kept free of React Native so Node can test it.

/** A rect in window coordinates, as measureInWindow gives it. */
export type MenuAnchor = { x: number; y: number; width: number; height: number };

/**
 * Which of the anchor's edges the menu lines up with: 'start' for a
 * dropdown under a title or field (M3's default), 'end' for an overflow ⋮
 * at the trailing edge of a row or bar.
 */
export type MenuEdge = 'start' | 'end';

export type MenuPlacementInput = {
  anchor: MenuAnchor;
  edge: MenuEdge;
  menu: { width: number; height: number };
  window: { width: number; height: number };
  insets: { top: number; bottom: number };
  /** Kept between the menu and the window's sides. */
  margin: number;
  rtl: boolean;
};

/**
 * The menu's top-left in the window: just below the anchor, or above it
 * when there's no room below; its `edge` lined up with the anchor's (start
 * is the right edge in right-to-left), then moved in to stay `margin` from
 * either side.
 */
export function menuPlacement({ anchor, edge, menu, window, insets, margin, rtl }: MenuPlacementInput): {
  top: number;
  left: number;
} {
  const below = anchor.y + anchor.height;
  const top = below + menu.height <= window.height - insets.bottom ? below : Math.max(insets.top, anchor.y - menu.height);
  const alignLeft = (edge === 'start') !== rtl;
  const wanted = alignLeft ? anchor.x : anchor.x + anchor.width - menu.width;
  const left = Math.max(margin, Math.min(wanted, window.width - menu.width - margin));
  return { top, left };
}
