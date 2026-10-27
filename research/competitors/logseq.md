# Logseq (markdown outliner + Whiteboards)

- **Date checked:** 2026-10-26
- **Sources:**
  - Whiteboard docs: https://raw.githubusercontent.com/logseq/docs/master/pages/Whiteboard.md
  - Snap-to-grid PR #9654: https://github.com/logseq/logseq/pull/9654
  - Connector layout issue #9511: https://github.com/logseq/logseq/issues/9511
  - DB-version changes: https://github.com/logseq/docs/blob/master/db-version-changes.md
  - Re-enable whiteboards issue: https://github.com/logseq/logseq/issues/11877
  - Reddit, title only (blocked): https://www.reddit.com/r/logseq/comments/1i3k5je/whiteboards_disabled_in_db/

## Who it's for
Outliner-style note-takers who use block references. A SilverBullet feature request (#1840) specifically cites Logseq whiteboards as the model ([SB #1840](https://github.com/silverbulletmd/silverbullet/issues/1840)).

## Pricing
Not checked on an official page.

## Linking, backlinks, citations
Block-level outliner with page and block references and embeds ([Whiteboard docs](https://raw.githubusercontent.com/logseq/docs/master/pages/Whiteboard.md)). We found no citation feature.

## Whiteboard focus areas ([Whiteboard docs](https://raw.githubusercontent.com/logseq/docs/master/pages/Whiteboard.md))
1. **Placement.**
   - "You can drag and drop Pages and Blocks from both sidebars to the canvas to create Page embeds and Block embeds."
   - "You can also select a particular block of text, and then drag it to the canvas to create a new block."
   - Pasting block references and URLs also creates embeds.

   This is the closest public precedent for Berean's reader-pane-to-canvas clipping.
2. **Back to source.** Portals are live embeds of the original block or page ("Logseq Portals… visually group and link different blocks and pages").
3. **Snapping and edges.**
   - Connector tool.
   - Snap to grid (PR #9654, merged June 2023): "creating/translating/scaling should follow the grid. Draw and highlight tools should not be affected… helpful when we want to align shapes without using guides". The step is `GRID_SIZE` (8 pixels) ([PR](https://github.com/logseq/logseq/pull/9654)).
   - Connector layout problems are tracked in [#9511](https://github.com/logseq/logseq/issues/9511).

## Broken link display
Not verified.

## Notes ↔ drawings
The Pencil tool draws on the same whiteboard as the portals, so drawings sit next to live note embeds ([Whiteboard docs](https://raw.githubusercontent.com/logseq/docs/master/pages/Whiteboard.md)).

## Status warning
In the new DB version, "Whiteboards have been removed as a feature and will hopefully be available as a plugin," and `/draw` (Excalidraw) is no longer built in ([db-version-changes](https://github.com/logseq/docs/blob/master/db-version-changes.md)). An issue asks to re-enable them ([#11877](https://github.com/logseq/logseq/issues/11877)).

## Parallel texts
No evidence found.

## Worth screenshotting
1. https://github.com/logseq/logseq/pull/9654 (includes a demo)
2. https://docs.logseq.com/#/page/whiteboard
3. https://github.com/logseq/docs/blob/master/db-version-changes.md
