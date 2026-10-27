# Obsidian (core notes + Canvas core plugin)

- **Date checked:** 2026-10-26
- **Sources:**
  - Canvas help (raw source of https://obsidian.md/help/plugins/canvas): https://github.com/obsidianmd/obsidian-help/blob/master/en/Plugins/Canvas.md
  - JSON Canvas spec: https://jsoncanvas.org/spec/1.0/
  - Changelog v1.1 (snap to grid / snap to objects): https://obsidian.md/changelog/2023-02-22-desktop-v1.1/
  - Pricing: https://obsidian.md/pricing
  - Link CSS variables (resolved / unresolved / external): https://docs.obsidian.md/Reference/CSS+variables/Editor/Link
  - Forum threads:
    - https://forum.obsidian.md/t/since-last-update-link-colour-is-same-for-existing-and-non-existing-notes/109099
    - https://forum.obsidian.md/t/enable-grid-snapping/50517
    - https://forum.obsidian.md/t/snap-all-box-selected-items-to-grid/51037
    - https://forum.obsidian.md/t/how-to-temporarily-disable-snapping-in-1-1-15/55246
  - Excalidraw plugin: https://github.com/zsviczian/obsidian-excalidraw-plugin
  - Bible plugins: https://github.com/tim-hub/obsidian-bible-reference · https://github.com/kilrkrow/obsidian-bible-verse
  - Reddit, search-result titles only (Reddit blocked our fetches, so thread contents are unread): https://www.reddit.com/r/ObsidianMD/comments/1jj4doq/how_robust_are_canvas_pages/ · https://www.reddit.com/r/ObsidianMD/comments/1eassxi/what_do_you_guys_think_about_canvas_and_excalidraw/

## Who it's for
A local-first markdown vault for personal knowledge management. Canvas is a core plugin that stores boards as open JSON Canvas `.canvas` files ([Canvas help](https://github.com/obsidianmd/obsidian-help/blob/master/en/Plugins/Canvas.md)).

## Pricing (https://obsidian.md/pricing)
- The app is free.
- Sync: $4/user/month billed yearly, or $5 monthly.
- Publish: $8/site/month billed yearly, or $10 monthly.
- Catalyst (one-time supporter tier): from $25.
- Commercial license: $50/user/year.

## Core notes: linking, backlinks, citations
- **Links and backlinks.** Wikilinks connect notes, and a Backlinks view lists incoming links. Canvas help warns: "Text-only cards don't appear in Backlinks. To make them appear, you need to convert them to a file" ([Canvas help](https://github.com/obsidianmd/obsidian-help/blob/master/en/Plugins/Canvas.md)).
- **Citations.** There is no built-in citation feature. Bible and JW citations come from community plugins: see [jwl-linker.md](jwl-linker.md), [inrefens.md](inrefens.md), and below.

## Canvas focus areas
1. **Placement.**
   - Drag files from the File explorer onto the canvas, use "Add note from vault", or double-click empty space for a text card.
   - An embedded note can be narrowed to one heading or block. Web pages can be cards.
   - Dragging a connection onto empty space creates a new card at that point ([Canvas help](https://github.com/obsidianmd/obsidian-help/blob/master/en/Plugins/Canvas.md)).
2. **Citations back to source.** A file card *is* the note, so clicking through opens it. Heading/block narrowing keeps the card tied to a specific section. Ctrl/Cmd-clicking a web card label opens the page ([Canvas help](https://github.com/obsidianmd/obsidian-help/blob/master/en/Plugins/Canvas.md)).
3. **Snapping and edges.**
   - Snapping: hold Space while moving or resizing to turn snapping off, and Shift to lock an axis. Align (left, center, right, top, middle, bottom) and Arrange (row, column, grid) commands work on the selection ([Canvas help](https://github.com/obsidianmd/obsidian-help/blob/master/en/Plugins/Canvas.md)). Global "snap to grid" and "snap to objects" settings were added in 1.1 ([changelog](https://obsidian.md/changelog/2023-02-22-desktop-v1.1/)).
   - Edges: "Draw lines between cards to show relationships. Add colors and labels." Drag from the dot on a card's side. Edges can be directional, and "Follow connection" jumps along them ([Canvas help](https://github.com/obsidianmd/obsidian-help/blob/master/en/Plugins/Canvas.md)). In JSON Canvas, edges store `fromSide`/`toSide`, `fromEnd`/`toEnd` (`none` or `arrow`), `color`, and `label` ([spec](https://jsoncanvas.org/spec/1.0/)).

## Broken link display
- Obsidian styles three link types separately: resolved, unresolved, and external ([CSS variables](https://docs.obsidian.md/Reference/CSS+variables/Editor/Link)).
- A Dec 2025 forum thread reports that after an update, links to existing and non-existing notes looked the same. In reply, a user posted a CSS snippet targeting `.is-unresolved` that gives missing links a wavy underline ([forum 109099](https://forum.obsidian.md/t/since-last-update-link-colour-is-same-for-existing-and-non-existing-notes/109099)). We read the thread, but we didn't confirm the Source-mode exception noted in our working notes, so treat it as unverified.
- **Unverified:** what clicking an unresolved link does. The official Internal links help page is JS-rendered and we couldn't read it.

## Translation labeling (Bible clips and quotes)
Obsidian core has none. Plugins:
- **Bible Reference.** "add `@` and the version key: `--John1:1@esv`" ([README](https://github.com/tim-hub/obsidian-bible-reference)).
- **Bible Verse.** `{John 3:16, KJV}` overrides the translation, and `{John 3:16, KJV, DARBY}` gives "side-by-side comparison". When the text isn't plain King James, "its reference names the translation as **KJV-Strong's**: 'Proverbs 3:5 (KJV-Strong's)'… Undo every change and it reads '(KJV)' again." The ESV Crossway copyright notice "is shown automatically" ([README](https://github.com/kilrkrow/obsidian-bible-verse)). This is the clearest public example we found of a translation label put in the clip's reference line.

## Notes ↔ drawings
- Canvas has no freehand or drawing tool in its help page. It holds text, notes, media, and web pages ([Canvas help](https://github.com/obsidianmd/obsidian-help/blob/master/en/Plugins/Canvas.md)).
- Drawings come from the Excalidraw plugin: "you can embed drawings into your documents, and you can link to documents and other drawings to/and from Excalidraw" ([plugin README](https://github.com/zsviczian/obsidian-excalidraw-plugin)).
- A SilverBullet user suggests that Obsidian's Excalidraw can render pages inside a drawing ([SilverBullet #1840](https://github.com/silverbulletmd/silverbullet/issues/1840)). This is one user's claim and wasn't verified in the plugin docs.

## Parallel texts and snapping (user evidence)
- A grid-snapping thread explains the 1.1 snap settings and links an official video ([forum 50517](https://forum.obsidian.md/t/enable-grid-snapping/50517), [video](https://obsidian.md/videos/53-arrange-snap-to-grid.mp4)).
- Users asked to snap a whole box-selection to the grid at once ([forum 51037](https://forum.obsidian.md/t/snap-all-box-selected-items-to-grid/51037)). Another thread reports Space stopped disabling snapping in 1.1.15 ([forum 55246](https://forum.obsidian.md/t/how-to-temporarily-disable-snapping-in-1-1-15/55246)).
- We found no thread about lining up parallel Bible translations on Canvas. The Bible Verse plugin handles side-by-side as a compare block, not a manual layout (see above).

## Gaps
- No native drawing on Canvas.
- Text cards are invisible to backlinks.
- Reddit thread titles suggest worries about robustness and performance on large canvases ([1jj4doq](https://www.reddit.com/r/ObsidianMD/comments/1jj4doq/how_robust_are_canvas_pages/)). We couldn't read the content, so this is unverified.

## Worth screenshotting
1. https://obsidian.md/canvas
2. https://obsidian.md/help/plugins/canvas
3. https://jsoncanvas.org/
4. https://github.com/kilrkrow/obsidian-bible-verse (README comparison view)

## Screenshots (captured 2026-10-26)
- [`screenshots/obsidian-canvas-hero.png`](screenshots/obsidian-canvas-hero.png): Canvas landing page hero. Source: https://obsidian.md/canvas
- [`screenshots/obsidian-bible-verse-label.png`](screenshots/obsidian-bible-verse-label.png): README features list (does not show an image of the translation label). Source: https://github.com/kilrkrow/obsidian-bible-verse
