# Berean competitor scan: canvas study and note tools

- **Date checked:** 2026-10-26
- **Method:** public pages only (official docs and pricing, public forums and GitHub). No sign-ups. Screenshots are of public pages only (see Screenshots below). Reddit blocked our fetches, so Reddit threads are cited by title only and not quoted.
- Each product has its own file in this folder with full sources and screenshot candidates.

## Squad questions: direct answers

**1. How does a Bible clip or quote label its translation?**
- **Logos Canvas:** it doesn't. Inserting a passage gives verse numbers only, and users type the reference into a text box. One user called it "a little cumbersome" ([Logos thread 187006](https://community.logos.com/discussion/187006/adding-scripture-references-in-canvas)).
- **Logos Copy Bible Verses:** a separate feature that labels quotes through an opt-in template token, `[Version]`, e.g. a footer like `([FullPassageRef], [Version])` ([wiki](https://community.logos.com/kb/articles/863-copy-bible-verses)). → [logos.md](logos.md)
- **Obsidian core:** nothing built in.
- **Obsidian plugins:**
  - Bible Verse names the translation in the reference line, as in "Proverbs 3:5 (KJV)" or "(KJV-Strong's)" when the text was altered. It adds ESV copyright attribution automatically, and `{John 3:16, KJV, DARBY}` gives a side-by-side comparison ([README](https://github.com/kilrkrow/obsidian-bible-verse)).
  - Bible Reference picks a version with `--John1:1@esv` ([README](https://github.com/tim-hub/obsidian-bible-reference)).
  - JWL Linker's "Cite verses" doesn't document which edition it fetches or whether it labels it (**unverified**) ([README](https://github.com/MrBertie/jwl-linker)).
  - → [obsidian.md](obsidian.md), [jwl-linker.md](jwl-linker.md)
- **Implication for Berean:** Juno's finding that Bible clip headers omit the translation matches the Logos Canvas gap. The Bible Verse plugin's "Book c:v (CODE)" header is the public precedent to copy.

**2. How is a broken citation or link shown?**

| Tool | Display | Source |
|---|---|---|
| SilverBullet | Missing-page links get a distinct color (`--link-missing-color`). Dangling targets become "aspiring pages" with a `Create` chip and can be queried. Ambiguous links are highlighted and open a chooser. Anchor lint flags broken links. A Health tab lists broken links (main-branch docs, may be unreleased). | [Aspiring Pages](https://docs.silverbullet.md/Aspiring%20Pages), [Link](https://docs.silverbullet.md/Link), [theme.scss](https://github.com/silverbulletmd/silverbullet/blob/main/client/styles/theme.scss), [Workbench.md](https://github.com/silverbulletmd/silverbullet/blob/main/docs/Workbench.md) |
| Obsidian | Resolved, unresolved, and external links are styled separately. A Dec 2025 thread complained that missing links looked like real ones after an update, and users fix it with CSS on `.is-unresolved`. | [CSS vars](https://docs.obsidian.md/Reference/CSS+variables/Editor/Link), [forum](https://forum.obsidian.md/t/since-last-update-link-colour-is-same-for-existing-and-non-existing-notes/109099) |
| JWL Linker | "Invalid scripture references will be ignored": stays plain text, no warning. | [README](https://github.com/MrBertie/jwl-linker) |
| inREFens | Undetected citations (e.g. a bare `it`) stay unlinked, no warning. Links point to a WOL search, not a deep link. | [plugin](https://community.obsidian.md/plugins/inrefens) |
| JW Library | Silent. Research Guide references just don't appear until the guide is installed. Per a user guide, a shared link to an undownloaded publication prompts a download. | [JWTalk](https://jwtalk.net/topic/46302-technical-problemplease-help/), [curiousnetentity](https://curiousnetentity.com/JWLibrary/context-menu/) |
| Typora | An error dialog on click: "Cannot open location file.md, would you want to create file…" | [Links](https://support.typora.io/Links/) |
| Heptabase | The CLI can report "Invalid card". In-app display not documented. | [CLI](https://support.heptabase.com/en/articles/14715462-heptabase-cli) |
| Logos, Muse, Kinopio, Scrintal, Logseq, Bear, iA Writer, tldraw | Not found or unverified. | (per-product files) |

**3. How do notes link to drawings or sketches?**
- **Same surface (drawing next to text):**
  - Logos Canvas: freehand drawing on the passage canvas ([help](https://support.logos.com/hc/en-us/articles/360018175571-Visually-Engage-the-Biblical-Text-Using-the-Canvas-Tool)).
  - Logseq whiteboards: Pencil next to live page and block portals. But whiteboards were removed in the new DB version ([docs](https://raw.githubusercontent.com/logseq/docs/master/pages/Whiteboard.md), [db changes](https://github.com/logseq/docs/blob/master/db-version-changes.md)).
  - Muse: Pencil ink on boards, though Allume now says "Drawing brushes? No" ([memo](https://allume.com/memos/2022-03-muse-for-mac/), [pricing](https://allume.com/pricing)).
  - tldraw: draw tool on the canvas.
- **Separate drawing file, linked or embedded:**
  - Obsidian + Excalidraw: "embed drawings into your documents, and… link to documents and other drawings to/and from Excalidraw" ([plugin](https://github.com/zsviczian/obsidian-excalidraw-plugin)). Canvas itself has no drawing tool.
  - SilverBullet + Excalidraw plugs: a diagram is embedded in a page via a code widget ([plug](https://github.com/LogeshG5/silverbullet-excalidraw)). A user says it "does not have drag-and-drop for pages (rendering a page in-diagram within a frame)" ([#1840](https://github.com/silverbulletmd/silverbullet/issues/1840)).
- **None yet:** Heptabase (handwriting is on the roadmap: [nextup](https://wiki.heptabase.com/roadmap/nextup)). JW Library (Windows pen highlighting only: [help](https://www.jw.org/en/online-help/jw-library/windows/highlight-text/)). Bear, Typora, iA Writer, Scrintal: not found. Kinopio has a freehand page, but its content is unverified.
- **For Owen:** today his drawings live on paper because SilverBullet has no canvas. The #1840 request describes his gap exactly: "draw, write text, and even drop existing pages/files in as movable blocks."

**4. Does snapping/alignment help line up parallel texts side by side?**
- **No public evidence either way specifically about parallel translations.** We searched Logos, Obsidian, Heptabase, Kinopio, and Logseq sources.
- **Closest evidence:**
  - Logos users fought the line-spacing snap when dragging Bible text lines, and "distribute vertically" didn't work inside a Text Flow group ([177810](https://community.logos.com/discussion/177810/canvas-struggling-with-line-spacing-snap/p1)).
  - Another Logos user wanted snapping *off* so cards could float free ([225386](https://community.logos.com/discussion/225386/canvas-turn-off-snap-to-grid/p1)).
  - Obsidian users asked to snap a whole selection to the grid at once ([51037](https://forum.obsidian.md/t/snap-all-box-selected-items-to-grid/51037)).
  - Kinopio pitches Shift-snap for when "you want to line things up perfectly" ([bulletin 36](https://kinopio.club/blog/posts/36/)).
- **Tools that skip manual layout:** the Obsidian Bible Verse compare block ([README](https://github.com/kilrkrow/obsidian-bible-verse)) and JW Library's Parallel Translations in the Study pane, which is single-verse only per a user guide ([curiousnetentity](https://curiousnetentity.com/JWLibrary/context-menu/)).
- **Primary evidence will be Berean's own Step 4 nudge log** (test-task-sovereignty.md).

## Comparison table

| Product | Who it's for | Price (official) | Clip placement | Back to source | Snapping | Edges | Drawing | Broken links shown? |
|---|---|---|---|---|---|---|---|---|
| [JW Library](jw-library.md) | JW Bible study | not on official pages | none (no canvas); notes attach to text | citation → Study pane → verse | n/a | n/a | none (Win pen highlight) | silent |
| [Logos Canvas](logos.md) | Bible scholars, pastors | unverified (pricing 404; tier conflict) | insert passage, drag text parts | info cards; **no auto reference label** | Guides (toggle) | shapes; connectors unverified | freehand on canvas | not found |
| [Heptabase](heptabase.md) | researchers | Pro $8.99, Premium $17.99/mo yearly | drag PDF highlights from sidebar | locate highlight in PDF | Shift extends alignment guides | Connect tool (C) | none (roadmap) | CLI "Invalid card" |
| [Obsidian + Canvas](obsidian.md) | PKM, local markdown | free; Sync $4–5, Publish $8–10 | drag file, block/heading narrow, drag-edge-to-empty creates card | card *is* the note | snap grid/objects; Space off; align/arrange | labeled, colored, directional; Follow | via Excalidraw plugin | unresolved styling |
| [JWL Linker](jwl-linker.md) | JW users of Obsidian | free | inline cite | JW Library links | n/a | n/a | none | ignored (plain) |
| [inREFens](inrefens.md) | JW users of Obsidian | free (MIT) | inline auto-link | WOL search link | n/a | n/a | none | unlinked (plain) |
| [Muse/Allume](muse-allume.md) | spatial thinkers (Apple) | free tier; Pro $9.99/mo, $99.99/yr | excerpt from PDF/image/video | **Source Peek** | not found | connections | Pencil ink (brushes: no) | not found |
| [Kinopio](kinopio.md) | freeform brainstorming | free ≤100 cards; $8/mo, $80/yr, $250 life | cards on canvas; auto-align below | not found | Shift-snap grid + guide lines; box snap | labeled connections | freehand (unverified) | not found |
| [Scrintal](scrintal.md) | visual note-takers | unverified | docs on boards | global links vs local connectors | not found | board-local connectors | not found | not found |
| [tldraw](tldraw.md) | developers (SDK) | SDK license, 100-day trial, hobby free | n/a | n/a | bounds/gap/handle; Ctrl to snap; 8px threshold | arrows snap to edges | draw tool | n/a |
| [Logseq](logseq.md) | outliners | not checked | drag page/block from sidebar → portal | live portal | 8px snap-to-grid toggle | Connector | Pencil | not verified; whiteboards removed in DB version |
| [SilverBullet](silverbullet.md) | programmable notes (Owen's tool) | server free; Desktop Pro $50/yr | none (no canvas); transclusion | links, line refs | n/a | n/a | Excalidraw plugs | **best**: color, aspiring pages, Health |
| [Bear](bear.md) | Apple writers | unverified | none | `[[`, heading links | n/a | n/a | not found | unverified |
| [Typora](typora.md) | markdown writers | $14.99 one-time | none | md links | n/a | n/a | none | error dialog on click |
| [iA Writer](ia-writer.md) | focused writers | Mac $49.99; iOS $29.99 | none | wikilinks (hidden on export) | n/a | n/a | none | not documented |

## Owen's current workflow vs. the field
Owen works through a study from the Research Guide, takes notes in SilverBullet, and draws on paper.
- SilverBullet has the strongest broken-link handling in this scan, but no canvas.
- JW Library has the Research Guide, but notes are plain text and can't be synced.
- Only Logos (freehand on the passage canvas) and the Logseq whiteboards (Pencil next to live portals; now removed in DB) put drawing next to source text on one surface. That is the gap Berean's sketch cards would fill.

## Takeaways for edges, sketch cards, and snapping
1. **Edges: make dragging from a card side the creation gesture, and let a drop on empty space create a card.** Store side, ends, color, and label per edge (**Obsidian Canvas** [help](https://github.com/obsidianmd/obsidian-help/blob/master/en/Plugins/Canvas.md); [JSON Canvas spec](https://jsoncanvas.org/spec/1.0/)). Keep visual connectors board-local and separate from semantic `jwcite:` links (**Scrintal** [links vs connectors](https://scrintal.gitbook.io/scrintal-support-docs/working-with-links-and-connectors)).
2. **Snapping should be a modifier or toggle, not forced.** Pair it with explicit Align/Arrange commands for side-by-side translation clips.
   - tldraw has it off by default with Ctrl to snap ([docs](https://tldraw.dev/sdk-features/snapping)). Heptabase uses Shift to extend guides ([shortcuts](https://wiki.heptabase.com/keyboard-shortcuts)). Obsidian uses Space to disable, plus align/arrange ([help](https://github.com/obsidianmd/obsidian-help/blob/master/en/Plugins/Canvas.md)).
   - **Logos** users fought forced snapping on text lines ([177810](https://community.logos.com/discussion/177810/canvas-struggling-with-line-spacing-snap/p1), [225386](https://community.logos.com/discussion/225386/canvas-turn-off-snap-to-grid/p1)).
   - Let Step 4's nudge count decide whether snapping beyond "Align top / distribute" is needed.
3. **Sketch cards should be canvas citizens next to the clips, not separate embedded files.** Users say the file-embed route misses "drag-and-drop for pages… within a frame" (**SilverBullet #1840** [issue](https://github.com/silverbulletmd/silverbullet/issues/1840)). Same-surface drawing is what Logos Canvas and Logseq whiteboards offer ([Logos help](https://support.logos.com/hc/en-us/articles/360018175571-Visually-Engage-the-Biblical-Text-Using-the-Canvas-Tool), [Logseq docs](https://raw.githubusercontent.com/logseq/docs/master/pages/Whiteboard.md)). Keep snapping off for ink, as Logseq does ("Draw and highlight tools should not be affected," [PR 9654](https://github.com/logseq/logseq/pull/9654)).
4. **Put the translation code in every Bible clip header, and offer a one-tap "peek source."** Logos Canvas lacks the label and users type it by hand ([187006](https://community.logos.com/discussion/187006/adding-scripture-references-in-canvas)). The **Obsidian Bible Verse** plugin puts "(KJV)" in the reference ([README](https://github.com/kilrkrow/obsidian-bible-verse)). **Muse**'s Source Peek circle shows the excerpt's context in place ([memo](https://allume.com/memos/2022-03-muse-for-mac/)).
5. **Show broken `jwcite:` chips visibly and list them somewhere, instead of failing silently.** **SilverBullet** uses a missing-link color, aspiring pages, and a Health list ([Aspiring Pages](https://docs.silverbullet.md/Aspiring%20Pages), [Workbench.md](https://github.com/silverbulletmd/silverbullet/blob/main/docs/Workbench.md)). By contrast, JWL Linker and inREFens silently leave bad references unlinked ([JWL Linker](https://github.com/MrBertie/jwl-linker), [inREFens](https://community.obsidian.md/plugins/inrefens)), and JW Library hides content until the Research Guide is installed ([JWTalk](https://jwtalk.net/topic/46302-technical-problemplease-help/)).

## Screenshots
These are screenshots of public pages, kept for internal research only. They show each page as it appeared when captured; notes record any loading or redirect quirks.

| File | Product | Screen | Date captured | Source URL (as shown) |
|---|---|---|---|---|
| [`silverbullet-aspiring-pages.png`](screenshots/silverbullet-aspiring-pages.png) | SilverBullet | Aspiring Pages docs page (query embed still loading) | 2026-10-26 | https://docs.silverbullet.md/Aspiring%20Pages |
| [`silverbullet-issue-1840.png`](screenshots/silverbullet-issue-1840.png) | SilverBullet | GitHub issue #1840, whiteboard request | 2026-10-26 | https://github.com/silverbulletmd/silverbullet/issues/1840 |
| [`obsidian-canvas-hero.png`](screenshots/obsidian-canvas-hero.png) | Obsidian Canvas | Canvas landing page hero | 2026-10-26 | https://obsidian.md/canvas |
| [`obsidian-bible-verse-label.png`](screenshots/obsidian-bible-verse-label.png) | Obsidian Bible Verse plugin | README features list (does not show an image of the translation label) | 2026-10-26 | https://github.com/kilrkrow/obsidian-bible-verse |
| [`jwl-linker-readme.png`](screenshots/jwl-linker-readme.png) | JWL Linker | GitHub README | 2026-10-26 | https://github.com/MrBertie/jwl-linker |
| [`logos-canvas.png`](screenshots/logos-canvas.png) | Logos Canvas | Canvas help article (redirected from logos.com/features/canvas; cookie banner partly visible) | 2026-10-26 | https://support.logos.com/hc/en-us/articles/360018175571-Visually-Engage-the-Biblical-Text-Using-the-Canvas-Tool |
| [`tldraw-snapping.png`](screenshots/tldraw-snapping.png) | tldraw | SDK snapping docs | 2026-10-26 | https://tldraw.dev/sdk-features/snapping |
| [`kinopio-auto-align.png`](screenshots/kinopio-auto-align.png) | Kinopio | Bulletin 36 (Auto Align Cards Below, Shift-snap) | 2026-10-26 | https://kinopio.club/blog/bulletin-36 |
| [`heptabase-pdf-highlights.png`](screenshots/heptabase-pdf-highlights.png) | Heptabase | PDF annotation / highlight cards wiki page | 2026-10-26 | https://wiki.heptabase.com/pdf-annotation |
| [`jw-library-features.png`](screenshots/jw-library-features.png) | JW Library | iOS "Start Using" features help (notes/tags sections collapsed) | 2026-10-26 | https://www.jw.org/en/online-help/jw-library/apple/features/ |

## Unverified or not found (flagged)
- **Prices not captured:** Logos (pricing 404; Bronze vs Premium conflict between official pages), Bear, Scrintal, Logseq, JW Library (no price on official pages).
- **JWL Linker:** translation labeling.
- **Obsidian:** what clicking an unresolved link does; whether unresolved styling applies in Source mode.
- **Kinopio:** how freehand drawing relates to cards.
- **iA Writer:** absence of backlinks.
- **Muse:** current ink status.
- **JW Library:** official Mac help; the exact UI for links to missing publications.
- **Reddit:** thread contents (blocked).
