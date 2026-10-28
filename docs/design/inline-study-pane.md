# Inline study pane

**Status:** Direction decided. Owen chose **Direction B** (inline study pane on every device, plus a dockable, draggable side split when the reader is ≥ 1000 pt wide). Directions A and C are rejected, and all open questions are resolved (§10).
**Platforms:** iOS, iPadOS, macOS.
**Owner:** Design (Lumen).

## 1. Purpose

When you select a verse in the Bible reader, the chapter splits open at that verse. Study content (study notes, cross references, research guide, footnotes, and your own notes) appears directly below the verse, and the rest of the chapter moves down. Nothing slides over the text. You study the verse in place and never lose your spot.

### Principles

1. **Reading continuity.** The text stays where it is. The pane comes from the verse instead of covering it.
2. **Place-keeping.** The selected verse doesn't move on screen when the pane opens, closes, or changes tabs. Closing the pane returns you to exactly where you were.
3. **Content first.** The text and the study content are content. Only the controls are chrome.
4. **One gesture in, one gesture out.** Opening takes a single tap or click, and so does closing.
5. **Native on each device.** The pane stays inline on iPhone. On a large screen it can become a side split you can resize.

## 2. Behavior and states

| State | What you see | Notes |
| --- | --- | --- |
| **Closed** | Continuous chapter text. Verses that have study content show a subtle marker; no marker means the verse has none. | The default state. |
| **Opening** | The text splits below the selected verse and the pane grows to its starting height (about 40% of the viewport, at most). | You can interact during the animation. A second tap cancels the open. |
| **Open** | A header with the verse reference, content tabs (Study notes, Cross refs, Research, Footnotes), a close control, a scrollable body, and My notes pinned at the bottom of the pane (not a tab), visible on every tab. | Tabs with no content are hidden, not disabled. The last tab you used is remembered for each publication. |
| **Switching verse** | Selecting another verse moves the pane to the new verse. Above the pane this is a single re-anchor; below it, the pane collapses and re-opens at the new position. | The current tab carries over when the new verse has content for it. |
| **Multi-verse** | Drag across verses or Shift-click to select a range (for example, 3–5). The pane opens below the last verse in the range and merges the content, grouped by verse. | My notes attaches to the whole range. |
| **Collapsing** | Tap the selected verse again, use the close control, press Esc, or swipe down on the pane header. | Collapsing animates the pane to zero height while the verse holds still. |
| **Empty** | The verse has no study content. The pane shows a single line, "No study notes for this verse", and the My notes composer. | The pane stays short. |
| **Not downloaded** | The content lives in a publication that isn't on the device. The pane shows an inline row: "Study notes are in the Study Bible. Download (48 MB)". | A progress ring appears in place, and content fills in when the download finishes. The pane never blocks the reader. Auto-downloading study publications on Wi-Fi is deferred to a later release, as a setting. |
| **Loading** | Skeleton lines appear in the body at the final height, so there's no second layout jump. | Show nothing for the first 150 ms to avoid flicker. |
| **Error** | A one-line message ("Couldn't load study notes") with a Retry button. Other tabs still work. | Errors are per tab, not per pane. |

## 3. Gestures and input

| Input | iPhone | iPad | Mac |
| --- | --- | --- | --- |
| Tap / click a verse number | Opens or moves the pane | Same | Click opens or moves the pane |
| Tap / click / select verse text | Never opens the pane; stays free for highlighting and text selection | Same | Same |
| Tap / click the selected verse | Closes the pane | Same | Same |
| Long press / secondary click | Context menu: Highlight, Copy, Share, Add note, Open in Studyspace | Same; secondary click on trackpad | Right-click with the same menu |
| Drag across verses | Selects a range (after a long press) | Same; drag with the pointer | Click-drag or Shift-click |
| Pane header grabber, dragged vertically | Resizes the inline pane; a fast flick down dismisses it | Same | Drag the divider |
| Divider dragged horizontally (side split) | n/a | Resizes the split; snaps at 1/3, 1/2, 2/3 | Same, with a resize cursor |
| Pointer hover | n/a | Verses with content get a hover highlight; the divider shows a resize affordance | Same, plus tooltips on tab icons |
| Keyboard | Hardware keyboard support matches iPad | **Esc** closes. **↑/↓** move the selected verse (the pane follows). **Return** opens the pane for the focused verse. **⌘1–⌘4** switch tabs. **Tab** moves between the text and the pane. **⌘\\** toggles inline/side. | Same |
| VoiceOver | Each verse is one element with a "Study content available" hint. A custom rotor, "Verses with notes", jumps between verses that have content. | Same | Same, plus VO-key navigation |

## 4. Layout per size class

The breakpoints below are proposals, measured as the reader's own width (not the screen's), so they hold in Split View, Stage Manager, and resized Mac windows.

| Reader width | Typical context | Pane form |
| --- | --- | --- |
| **< 600 pt** | iPhone (any orientation), narrow iPad Split View or Slide Over, narrow Mac window | **Inline only.** The pane is full column width, starts at 40% of the viewport, and can be dragged from 25% to 85%. |
| **600–999 pt** | iPad portrait, half-screen Split View, medium Stage Manager or Mac windows | **Inline.** The pane matches the text measure (max ~680 pt reading column), centered. |
| **≥ 1000 pt** | iPad landscape full screen, large Stage Manager windows, Mac | **Inline by default, with a side split available.** The pane always opens inline; it moves to the side split only when you drag its header to the trailing side (⌘\\ is the keyboard and accessibility equivalent of that drag). The divider is draggable, and each pane has a minimum width of 320 pt. The text column keeps the selected verse highlighted, and the side pane follows the selection unless you pin it: a pin control in the side pane's header keeps that verse's content in place while you select and read other verses; unpinning resumes following. |

- **Side split rules.** The side split never hides the text. If the reader shrinks below 1000 pt while docked, the pane returns to inline below the selected verse, and it docks again when the reader grows back.
- **The pane is part of the chapter's scroll content.** It is not an overlay, so it scrolls away with the text above it. Scrolling the pane's body until it hits an edge hands scrolling off to the chapter.

## 5. Motion

| Moment | Proposal | Reduce Motion |
| --- | --- | --- |
| Open (height grow) | Spring with response 0.38 s and damping 0.9 (≈ SwiftUI `.smooth(duration: 0.38)`) | 0.2 s cross-fade at the final height, with no movement |
| Close | Spring with response 0.30 s and damping 1.0 | 0.15 s fade |
| Tab switch | Content cross-fade of 0.15 s. Height animates with the open spring only when the change is more than 20% of the viewport. | Cross-fade only |
| Docking from inline to side | Matched-geometry move of the header with the open spring | Cross-fade |
| Drag to resize | Tracks the finger 1:1. On release, a short spring settles it on the nearest snap point. | Same, with no overshoot |

**Scroll anchoring.** The selected verse's top edge is the anchor. While the pane opens, closes, or resizes, its on-screen position doesn't change, and only the content below it moves. Exception: if the verse sits in the bottom 35% of the viewport, the reader scrolls in the same animation so the verse lands about 20% from the top and the pane fits. Closing never scrolls.

## 6. Materials and typography

- **Liquid Glass goes on controls only.** The pane header controls (tab picker, close, dock) and any floating toolbar use system Liquid Glass components. The verse text and the pane body sit in the content layer on an opaque, standard background. They are never glass, as Apple's materials guidance directs.
- **Separation without chrome.** The pane body uses a slightly offset background (secondary system grouped background) with hairline separators above and below. There are no shadows over the text.
- **Typography.** The reader font and size carry into the pane. Study content is one step smaller than body text, and every style scales with Dynamic Type. Verse references in the pane are tappable links.
- **Contrast.** Text meets at least 4.5:1 against the pane background in light, dark, and sepia themes, and at least 7:1 with Increase Contrast.

## 7. Accessibility

- **VoiceOver order.** Verse → pane header (reference, then tabs) → pane body → next verse. When the pane opens, VoiceOver announces "Study pane, John 3:16, Study notes" and moves focus to the header. When it closes, focus returns to the verse.
- **Dynamic Type at accessibility sizes.** Tabs become a menu button. The pane's starting height grows to 60% of the viewport, and the side split turns off below 1200 pt, because columns get too narrow at those sizes.
- **Keyboard focus.** The focus ring stays visible on the verse and in the pane, Tab cycles between them, and Esc always returns focus to the verse.
- **Increase Contrast.** Separators are stronger and the pane background is solid.
- **Reduce Transparency.** Glass controls fall back to opaque (the system handles this), and no custom blur is used.
- **Reduce Motion.** Use the fallbacks in §5.

## 8. Edge cases

- **Last verse of a chapter.** The pane opens above the chapter footer. Moving to the next chapter closes the pane.
- **Very long notes.** The pane caps at 85% of the viewport and its body scrolls. An "Expand" control docks the pane to the side split on wide layouts, or opens a full-height reading view on compact ones.
- **Rotating or resizing while open.** The anchor verse and the tab are kept. If the reader drops below 1000 pt, a docked side split returns inline (pin is cleared); if it grows back, the pane stays inline until you drag it to the side again. The verse never moves.
- **Deep links** (`berean://bible/nwtsty/43/3/16?pane=crossrefs`). The reader opens scrolled to the verse with the pane already open on that tab, without an opening animation.
- **Verse selected from search.** The reader lands on the verse, highlights the search term, and opens the pane on the tab containing the match.
- **State restoration.** Save the open verse or range, the tab, the pane height or split fraction, whether the pane is docked and pinned, and the pane's scroll offset for each window or scene. On Mac, each window restores its own state.

## 9. Directions compared (decided: B)

There is no direct Apple precedent for this interaction, so three concrete directions were compared. Owen chose B; A and C are rejected and kept here only for the record.

| | **A. Pure inline everywhere** (rejected) | **B. Inline first, dockable side split on wide layouts** (chosen) | **C. Inline peek card that expands to a split** (rejected) |
| --- | --- | --- | --- |
| How it works | The pane always splits the text column, at every width | Same as A, plus docking to a resizable side split when the reader is ≥ 1000 pt | A short card (2–3 lines) under the verse; tapping Expand opens the full pane or split |
| Reading continuity | Strong | Strong | Strongest at first (small push), then weaker (two steps) |
| Big-screen use | Wastes width and makes long-form study cramped | Uses width well, and you can study and read side by side | Good once expanded |
| Complexity | Lowest | Medium: one extra mode plus breakpoint handling | Highest: two surfaces and two transitions |
| Consistency across devices | Identical everywhere | One mental model (inline), with an extra on big screens | Different first step on each device |
| Risk | Feels limited on Mac | Mode switching while resizing needs care | Extra tap for every deep study session |

**Decision: Direction B, chosen by Owen.** It keeps the signature inline split as the one model on every device and adds a draggable side split only where the screen is wide enough to earn it. C is rejected as the main flow; its peek may come back after v1 only as a hover preview in the Closed state on iPad and Mac.

## 10. Decisions (resolved open questions)

All open questions are resolved by Owen and reflected in the sections above.

1. **Direction:** B.
2. **Wide layouts:** the pane defaults to inline; it moves to the side split only when the user drags it there.
3. **Opening:** tapping the verse number opens the pane; tapping or selecting verse text stays free for highlighting.
4. **Multi-verse selection:** content merges into one pane, grouped by verse.
5. **My notes:** pinned at the bottom of the pane, not a tab.
6. **Not downloaded:** inline download suggestion in v1; auto-download of study publications on Wi-Fi comes later as a setting.
7. **Pinning:** the side split can pin a verse so its pane stays put while you read on.
8. **Hover preview:** later, not in v1.

## 11. References

Apple Human Interface Guidelines:

- [Layout](https://developer.apple.com/design/human-interface-guidelines/layout)
- [Split views](https://developer.apple.com/design/human-interface-guidelines/split-views)
- [Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets), for contrast: this is the pattern the pane deliberately avoids.
- [Scroll views](https://developer.apple.com/design/human-interface-guidelines/scroll-views)
- [Multitasking](https://developer.apple.com/design/human-interface-guidelines/multitasking) · [Windows](https://developer.apple.com/design/human-interface-guidelines/windows)
- [Motion](https://developer.apple.com/design/human-interface-guidelines/motion)
- [Materials](https://developer.apple.com/design/human-interface-guidelines/materials), including Liquid Glass: controls and navigation only, not the content layer.
- [Typography](https://developer.apple.com/design/human-interface-guidelines/typography) · [Color](https://developer.apple.com/design/human-interface-guidelines/color) · [Dark Mode](https://developer.apple.com/design/human-interface-guidelines/dark-mode)
- [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility) · [VoiceOver](https://developer.apple.com/design/human-interface-guidelines/voiceover)
- [Gestures](https://developer.apple.com/design/human-interface-guidelines/gestures) · [Pointing devices](https://developer.apple.com/design/human-interface-guidelines/pointing-devices) · [Keyboards](https://developer.apple.com/design/human-interface-guidelines/keyboards) · [Focus and selection](https://developer.apple.com/design/human-interface-guidelines/focus-and-selection)
- [Segmented controls](https://developer.apple.com/design/human-interface-guidelines/segmented-controls) · [Disclosure controls](https://developer.apple.com/design/human-interface-guidelines/disclosure-controls)
- [Designing for iOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-ios) · [iPadOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-ipados) · [macOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-macos)

Liquid Glass developer documentation:

- [Liquid Glass overview](https://developer.apple.com/documentation/technologyoverviews/liquid-glass)
- [Adopting Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass)
- [Applying Liquid Glass to custom views (SwiftUI)](https://developer.apple.com/documentation/SwiftUI/Applying-Liquid-Glass-to-custom-views)

All wording and any future assets in this spec are original to Berean.
