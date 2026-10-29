# Berean design guide

**Status:** v3 approved by Owen (Oct 28, 2026), including Omnisearch as one search with two ways in. This refresh applies Owen's two Notes corrections: highlights are colors only (no category names), and notes are Markdown with folders and tags. This is the reference that every platform builds against: SwiftUI on iOS, iPadOS, and macOS (Kiwi, Moss), and the Expo app on iOS and Android (Otter).

- [berean-design-guide.pdf](berean-design-guide/berean-design-guide.pdf): an instant PDF export, three very tall pages.
- [berean-design-guide.html](berean-design-guide/berean-design-guide.html): a standalone HTML export. Open it in Safari on a Mac to see New York render; other browsers fall back to Georgia.
- Source: a Claude Design project in Owen's account (private). Claude Design moves to Artifacts in the Claude app, and this version runs until Dec 14, 2026, so these exports are the durable copy.

Built with Kerning & Co. (Iris, Nova, Hinge, Pebble).

## Sections
1. **Foundations:** type, color tokens, spacing, and the material rule.
   - Type: system UI fonts. The reading serif is New York on Apple and bundled Literata on Android, with Noto Serif Hebrew one step larger for Hebrew.
   - Color: tokens for light, dark, sepia, and Increase Contrast, with six highlight colors at equal OKLCH lightness, named only by color. Text on highlights is at least 4.5:1. VoiceOver and TalkBack say "Highlighted, yellow", and with Differentiate Without Color each color also gets a margin shape (circle, square, triangle, diamond, bar, ring).
   - Spacing: a 4 pt grid.
   - Liquid Glass goes only on controls. Content always sits on solid surfaces.
2. **Core components.**
3. **Reader with the inline study pane:** iPhone and Android phone inline; Mac and iPad docked side split with snaps at 1/3, 1/2, and 2/3, pin, and dock (⌘\); Android tablet in Material's supporting-pane layout at 840 dp and wider, with secondary tabs that become a menu at large font scales; Android foldable in book posture. See [inline-study-pane.md](inline-study-pane.md).
4. **Studyspace:** the full canvas on iPad and Mac, fit-all with an Add sheet on iPhone, and a List view on every platform.
5. **Omnisearch and note hyperlinks:** one search with two ways in. The main way in is the platform's native search: a search tab at the trailing end of the glass tab bar on iPhone, a toolbar search field on iPad and Mac, and a Material 3 search bar on Android (docked above the navigation bar on phones, in the top app bar on tablets). ⌘K or Ctrl+K opens the same search as a palette, carrying over the query. Previews open on long press on iPhone, iPad and Android, and as a popover on Mac, with a "Download this publication" variant that announces progress and offers Retry.
6. **Adaptation and accessibility:** a matrix across iPhone, iPad, Mac, Android phone, Android tablet, and foldable, plus Dynamic Type, Reduce Transparency, Increase Contrast, VoiceOver and TalkBack, keyboard, and Reduce Motion. The matrix includes a Notes row.
7. **Notes:**
   - 7.1, the list and editor: notes are Markdown, organized in nested folders, with tags from inline #tags or the note's info. On Mac and iPad, there's a sidebar folder tree with All Notes, Recents and Tags, and tag search tokens; drag a note onto a folder to move it. iPhone and Android phone drill in from a Folders list, with filter chips (M3 filter chips on Android). Android tablet has a navigation rail plus a drawer. The column widths are three at 1000 pt and wider and two at 640 to 999 pt. The editor has a Read view (fully rendered) and a Write view (styled live, with syntax dimmed but visible), a formatting bar, and ⌘1 and ⌘2 (Ctrl+1 and Ctrl+2 on Android) to switch views. Passage and publication links are typed or picked through Omnisearch and stored as standard Markdown links. A Markdown source sample sits next to its rendered view. Folder actions with an undo, and download-row states.
   - 7.2, notes in the reader: margin markers where there's room. Below about 400 pt, a count badge sits on the verse number, and markers on one line merge. Tapping the verse number opens the last-used tab. Tapping a margin marker opens My notes. VoiceOver and TalkBack read "Verse 4, 2 notes", with Study and Show notes actions. It uses custom shared marker glyphs. Underlines are only for links; highlights use a fill and a spoken color name.
   - 7.3, Studyspace notes: opening a note in Studyspace from the reader, Show in reader, and an arrival highlight.
   - The 640 and 1000 pt column widths are placeholders.

## Not yet committed scope
- The fonts (New York on Apple, Literata on Android) and the foldable book-posture layout are drafted as shown, pending explicit confirmation through Wren. Treat foldables as planning only for now.
