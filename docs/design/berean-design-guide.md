# Berean design guide

**Status:** v2 direction approved by Owen (Oct 28, 2026). This is v3, which adds the Notes section (07) and the studio's refinements. One change from v2 needs Owen's look: Omnisearch is now one search with two ways in (see section 5). This is the reference that every platform builds against: SwiftUI on iOS, iPadOS, and macOS (Kiwi, Moss), and the Expo app on iOS and Android (Otter).

- [berean-design-guide.pdf](berean-design-guide/berean-design-guide.pdf): an instant PDF export, three very tall pages.
- [berean-design-guide.html](berean-design-guide/berean-design-guide.html): a standalone HTML export. Open it in Safari on a Mac to see New York render; other browsers fall back to Georgia.
- Source: a Claude Design project in Owen's account (private). Claude Design moves to Artifacts in the Claude app, and this version runs until Dec 14, 2026, so these exports are the durable copy.

Built with Kerning & Co. (Iris, Nova, Hinge, Pebble).

## Sections
1. **Foundations:** type, color tokens, spacing, and the material rule.
   - Type: system UI fonts. The reading serif is New York on Apple and bundled Literata on Android, with Noto Serif Hebrew one step larger for Hebrew.
   - Color: tokens for light, dark, sepia, and Increase Contrast, with six highlight colors at equal OKLCH lightness. Text on highlights is at least 4.5:1, and every highlight has a non-color cue.
   - Spacing: a 4 pt grid.
   - Liquid Glass goes only on controls. Content always sits on solid surfaces.
2. **Core components.**
3. **Reader with the inline study pane:** iPhone and Android phone inline; Mac and iPad docked side split with snaps at 1/3, 1/2, and 2/3, pin, and dock (⌘\); Android tablet in Material's supporting-pane layout at 840 dp and wider, with secondary tabs that become a menu at large font scales; Android foldable in book posture. See [inline-study-pane.md](inline-study-pane.md).
4. **Studyspace:** the full canvas on iPad and Mac, fit-all with an Add sheet on iPhone, and a List view on every platform.
5. **Omnisearch and note hyperlinks:** one search with two ways in. The main way in is the platform's native search: a search tab at the trailing end of the glass tab bar on iPhone, a toolbar search field on iPad and Mac, and a Material 3 search bar on Android (docked above the navigation bar on phones, in the top app bar on tablets). ⌘K or Ctrl+K opens the same search as a palette, carrying over the query. Previews open on long press on iPhone, iPad and Android, and as a popover on Mac, with a "Download this publication" variant that announces progress and offers Retry.
6. **Adaptation and accessibility:** a matrix across iPhone, iPad, Mac, Android phone, Android tablet, and foldable, plus Dynamic Type, Reduce Transparency, Increase Contrast, VoiceOver and TalkBack, keyboard, and Reduce Motion. The matrix includes a Notes row.
7. **Notes:**
   - 7.1, the list and editor: three columns at 1000 pt and wider, two at 640 to 999 pt, and one below 640 pt. Write and Read views, ⌘1 and ⌘2 (Ctrl+1 and Ctrl+2 on Android) while the editor has focus, the link style, and download-row states.
   - 7.2, notes in the reader: margin markers where there's room. Below about 400 pt, a count badge sits on the verse number, and markers on one line merge. Tapping the verse number opens the last-used tab. Tapping a margin marker opens My notes. VoiceOver and TalkBack read "Verse 4, 2 notes", with Study and Show notes actions. It uses custom shared marker glyphs. Underlines are only for links; highlights use a fill, a spoken category name, and a margin glyph.
   - 7.3, Studyspace notes: opening a note in Studyspace from the reader, Show in reader, and an arrival highlight.
   - The six highlight category names (Key idea, Promise, Question, Person, Prayer, Command) and the 640 and 1000 pt breakpoints are placeholders.

## Not yet committed scope
- The fonts (New York on Apple, Literata on Android) and the foldable book-posture layout are drafted as shown, pending explicit confirmation through Wren. Treat foldables as planning only for now.
