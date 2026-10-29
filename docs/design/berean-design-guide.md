# Berean design guide

**Status:** Direction approved by Owen (Oct 28, 2026). This is the reference that every platform builds against: SwiftUI on iOS, iPadOS, and macOS (Kiwi, Moss), and the Expo app on iOS and Android (Otter).

- [berean-design-guide.pdf](berean-design-guide/berean-design-guide.pdf): an instant PDF export, two very tall pages.
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
3. **Reader with the inline study pane:** iPhone and Android phone inline; Mac and iPad docked side split with snaps at 1/3, 1/2, and 2/3, pin, and dock (⌘\); Android tablet with a navigation rail at 840 dp and wider; Android foldable in book posture. See [inline-study-pane.md](inline-study-pane.md).
4. **Studyspace:** the full canvas on iPad and Mac, fit-all with an Add sheet on iPhone, and a List view on every platform.
5. **Omnisearch and note hyperlinks:** a ⌘K or Ctrl+K palette with a keyboard, a full-screen search view from the bottom bar on phones, and hover or long-press previews with a "Download this publication" variant.
6. **Adaptation and accessibility:** a matrix across iPhone, iPad, Mac, Android phone, Android tablet, and foldable, plus Dynamic Type, Reduce Transparency, Increase Contrast, VoiceOver and TalkBack, keyboard, and Reduce Motion.

## Not yet committed scope
- The fonts (New York on Apple, Literata on Android) and the foldable book-posture layout are drafted as shown, pending explicit confirmation through Wren. Treat foldables as planning only for now.
