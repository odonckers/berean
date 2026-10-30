# Bookmarks

**Status:** Draft. Kerning & Co. recommendation (Iris, with Pebble and Hinge), written up by Lumen. The direction is **pending Owen, through Wren**.
**Board row:** Expo 6d (…E3AK8), bookmarks and `.jwlibrary` import/export designs. The backup half is [jwlibrary-backup.md](jwlibrary-backup.md).
**Platforms:** SwiftUI on iOS, iPadOS and macOS. Expo (`apps/mobile`) on iOS and Android, in both looks: Material 3 and the iOS look (dev-only Look toggle).
**Owner:** Design (Lumen). **Core:** done in #20 (`UserData::bookmarks`, `set_bookmark`, `remove_bookmark`; parity row UD-5). **Build:** Kiwi and Moss (SwiftUI), Otter (Expo).

## 1. Purpose

A bookmark is a ribbon: it saves your place in a publication so you can return to it with one tap. Bookmarks open from a button in the reader toolbar under **Read**. They never take a gesture from the text. Tapping verse text stays free for highlighting, and only the verse number opens study (Owen's Decision 3, [inline-study-pane.md](inline-study-pane.md) §10.3).

## 2. Parity: how JW Library scopes bookmarks (verified)

| Fact | Source |
| --- | --- |
| "Each publication in JW Library has its own set of 10 bookmarks." | JW Library help, iOS: https://www.jw.org/en/online-help/jw-library/apple/bookmarks/ and Android: https://www.jw.org/en/online-help/jw-library/android/bookmarks/ (both read Oct 30, 2026; the page dates the feature to JW Library 1.2, May 2014) |
| The Bookmark button opens "a list … showing bookmarks for the current publication". Tapping an empty item bookmarks the current article or chapter. | Same pages |
| To bookmark a specific paragraph or verse, "tap the text, then tap the Bookmark button on the context menu". | Same pages |
| Going to a bookmark means opening its publication first, then the Bookmark button. | Same pages |
| You can delete or replace a bookmark. On iOS you do it with a swipe, and on Android with a More button. Replace saves "your current place" into that slot. | Same pages |
| Storage: `Bookmark.Slot` 0–9, `UNIQUE(PublicationLocationId, Slot)`. The publication key is `KeySymbol` + `MepsLanguage` + `IssueTagNumber`. | [userdata.md](userdata.md) §1; core `userdata.rs` (`MAX_SLOT = 9`) |

**Design consequence.** The picker is scoped to the **open publication**, with 10 slots shown as 1–10 (stored as 0–9). It never shows bookmarks from other publications.

**Not verified: do Bibles share slots?** The help pages don't say. In the data model, slots are per publication key, so `nwtsty` (English), `nwt` (English) and `nwtsty` (Spanish) each get their own 10. This spec follows the data model. **Open question for Echo (Parity):** check on a device whether JW Library shows the same bookmarks across Bible editions or languages. If it does, the picker scope becomes "all Bibles", and §9 records the change.

**Board row and plan.** The Expo board row text isn't in the repo. The repo only records the toolbar slot: `apps/mobile/src/reader/bible-chapter.tsx` lists "Aa, bookmark, menu, overflow" as pending toolbar items. Nothing else is decided yet.

## 3. Behavior and states

### 3.1 What gets saved

| Entry point | Saves | Notes |
| --- | --- | --- |
| Toolbar bookmark button, then an empty slot | The current chapter or article (block 0), or the selected verse if the study pane is open | The picker header says what it will save: "Save John 3" or "Save John 3:16". |
| Long press (secondary click on Mac), context menu **Bookmark…** on a verse or paragraph | That verse or paragraph | This adds one item to the existing context menu (inline-study-pane §3). It opens the same picker in save mode for that block. |
| Mac **Bookmarks › Add Bookmark** (⌘D) | Same as the toolbar button | Saves to the first empty slot without opening the picker, and the toolbar button briefly confirms "Saved to slot 4". If every slot is full, it opens the popover. |

Title and snippet are what `set_bookmark` stores: the title is the reference ("John 3:16", or the article title plus "¶ 4"), and the snippet is the first line of the block.

### 3.2 The picker is the list

There's no separate bookmarks screen. The picker is a single list of exactly 10 rows.

| Row state | Shows | Tap | Other actions |
| --- | --- | --- | --- |
| **Empty** | "Slot 4" in textSecondary, plus a "+ Save here" affordance | Saves the current place, then dismisses | None |
| **Filled** | The slot number, the reference (body), and a one-line snippet in textSecondary (two lines at large type) | Jumps there, then dismisses | A trailing menu button (⋯ in the iOS look, ⋮ in Material) with **Replace with John 3:16** and **Delete**. The same actions are in the context menu (long press or secondary click) and, in the iOS look and iOS, as a trailing swipe. Swiping is never the only way. |
| **Filled, current place** | The same, with a filled bookmark glyph marking it | Jumps there (a no-op scroll if you're already there) | Same |

- **Header:** the publication title, plus what will be saved ("Save John 3:16"). When all 10 slots are full, it says "All 10 slots are in use. Replace one to save John 3:16."
- **Delete and Replace** take effect at once and show an Undo snackbar (Material) or toast (iOS look and iOS) for 6 s, following the guide's folder-undo pattern. There's no confirmation dialog.
- **Toolbar button state:** an outline glyph by default. It turns filled when the current chapter, or the selected verse, is saved in any slot. Use the system glyphs: SF Symbol `bookmark` and `bookmark.fill`, and Material Symbols `bookmark` (outlined and filled). Only original or system assets.

### 3.3 Jumping

- The reader opens the location in the same publication. A verse or paragraph lands **20% from the top**, matching the pane's landing rule.
- **Landing marker:** the same as Search. The verse number gets the accent pill, and the paragraph or verse gets a tinted wash that fades out after 2 s, or clears on the next scroll or tap. The study pane does **not** open, because only a tap on a verse number opens it.
- A chapter or article bookmark lands at the top with no marker.
- Focus moves to the landed verse, and VoiceOver or TalkBack announces "Bookmark 3, John 3:16".

## 4. Presentation per platform and look

| Context | Form | Notes |
| --- | --- | --- |
| iPhone (SwiftUI) | A sheet with medium and large detents and a grabber | Rows are an inset-grouped `List`. |
| iPad, Mac (SwiftUI) | A popover anchored to the toolbar button, about 360 pt wide, sized to its 10 rows | In compact width (Slide Over, narrow Split View), the same view adapts to the sheet. |
| Mac menu bar | **Bookmarks** menu: Add Bookmark ⌘D, a separator, slots 1–10 of the open publication (⌥⌘1 to ⌥⌘9, and ⌥⌘0 for slot 10), then Show Bookmarks | The items are disabled when no publication is open. ⌥⌘-number is Hinge's suggestion, not a HIG rule; plain ⌘-number is taken by the tab shortcuts. Kiwi should check ⌘D against existing commands. |
| Expo iOS look, phone (< 600 dp) | A bottom sheet styled as an iOS medium detent: a grabber, 10 pt top corners, and surfaceRaised | It can be dragged to full height, and dragging down dismisses it. |
| Expo iOS look, tablet (≥ 600 dp) | An anchored card under the toolbar button, approximating the iPad popover (12 pt corners, a shadow, max width 360 dp) | Tapping outside or pressing Esc dismisses it. |
| Expo Material, phone and tablet | An M3 **modal bottom sheet** with a drag handle and a scrim. On ≥ 600 dp it's capped at 640 dp wide and centered | Pebble's call over Hinge's anchored menu: a menu is too thin for a reference plus a snippet. |
| Any platform | **Never a plain menu** | Each row needs a reference and a snippet. |

Hardware keyboard (iPad, Android): Ctrl+D (⌘D on iPad) opens the picker in save mode. ↑/↓ move between rows, Return activates, and Esc closes.

## 5. Motion

| Moment | Proposal | Reduce Motion |
| --- | --- | --- |
| Open or close the sheet or popover | The platform default (iOS sheet spring, M3 bottom sheet standard easing of about 300 ms) | Cross-fade, 0.2 s |
| Save into an empty slot | The row content cross-fades from empty to filled (0.15 s), then the picker dismisses after about 0.3 s, so the save is seen | The same cross-fade, with no movement |
| Jump | The reader scrolls, or the publication opens, without animated travel across chapters. The landing wash fades out after 2 s | Static wash, cleared on the next scroll or tap. No flash, no fade |
| Delete or Replace | The row cross-fades, and the snackbar or toast slides in | Cross-fade |

## 6. Accessibility

- **Each slot is one element.** Filled: "Slot 3, John 3:16, For God loved the world so much…", with **Jump** as the default action and custom actions **Replace with John 3:16** and **Delete**. Empty: "Slot 4, empty", with the default action "Save John 3:16 here". TalkBack uses `accessibilityActions` with the same labels.
- **Toolbar button:** labelled "Bookmarks". When the current place is saved, its value is "John 3 is in slot 2".
- **Announcements:** "Saved to slot 4" after a save, and "Bookmark 3, John 3:16" after a jump, with focus on the landed verse.
- **Text at 2×:** references and snippets wrap and never truncate the reference. Slot numbers stay at the leading edge.
- **Targets:** rows are at least 48 dp (Material) or 44 pt (iOS), and the trailing menu button has its own full-size target.
- **Contrast** (computed, WCAG 2.x): textSecondary #5C544A on #FFFCF5 is 7.26:1, and #A39A8B on #211D18 is 6.02:1. The accent glyph #9B3F2A on #FFFCF5 is 6.53:1, and #E59A7C on #211D18 is 7.38:1.
- **Reduce Motion:** see §5. **Differentiate Without Color:** a filled slot shows a glyph as well as text, never color alone.

## 7. Edge cases

- **Publication removed or not downloaded.** The picker only ever opens inside a downloaded publication, so v1 has no list of bookmarks for missing publications. Bookmarks for a removed publication stay in the data and reappear when it's downloaded again. Any future cross-publication view (see §8) uses the note-hyperlink download row: "John 3:16 is in the Study Bible. Download (48 MB)", with a progress ring in place.
- **Location no longer exists** (an updated publication with a different `doc_id`, or a verse not in this edition). The row still shows its stored title and snippet, with "Not found in this edition" in textSecondary. Tapping it opens the nearest place (the chapter, then the publication start) and a toast says "Couldn't find the exact place. Opened John 3." The slot stays until you replace or delete it.
- **All 10 slots full.** Covered by the header message in §3.2. Saving takes Replace or Delete, and nothing is overwritten silently.
- **Import collisions.** A `.jwlibrary` import can bring bookmarks into slots that are already filled:
  - **Replace import:** the backup's bookmarks replace all of yours, as the counts on the review screen say.
  - **Merge import** (if Owen approves it; see [jwlibrary-backup.md](jwlibrary-backup.md) §3.3): the same publication, slot and location is a silent duplicate. The same publication and slot with a different location is a collision, summarized as "3 bookmark slots are used in both", with **Keep mine** (default), **Use backup's**, or **Keep both**. Keep both moves the backup's bookmark into a free slot in that publication. If none is free, it's listed in the success summary as "2 bookmarks didn't fit".
- **Watchtower and other issues:** each issue is its own publication key, so it has its own 10 slots.
- **Multiple Mac windows:** each window's popover and menu reflect that window's publication.
- **Undo after leaving the reader:** the snackbar or toast goes away with the picker's screen. Nothing else undoes it.

## 8. Future option (Hinge's dissent, recorded, not in v1)

If bookmarks ever get search, folders, or a cross-publication view, give them a sidebar section on iPad and Mac, and a Library-tab entry on phones. That is when the download row in §7 applies. Not for v1, because 10 fixed slots per publication don't need a second screen.

## 9. Open decisions for Owen

1. **Approve the direction:** the picker is the list, scoped to the open publication. That's a popover on iPad and Mac, a sheet on iPhone and in the Expo iOS look, and an M3 modal bottom sheet in Material.
2. **What the toolbar button saves when a verse is selected:** the verse (proposed) or always the chapter (closer to JW Library).
3. **Mac shortcuts:** ⌘D, plus ⌥⌘1 to ⌥⌘9 and ⌥⌘0 (Hinge's suggestion, not a HIG rule).
4. **Delete and Replace with Undo, no confirmation dialog** (proposed).
5. **Bible scoping:** per edition and language (the current data model) unless Echo finds that JW Library shares slots across Bibles. This needs Echo's check first.

## 10. References

- JW Library help (parity facts only, no assets or wording copied): [iOS](https://www.jw.org/en/online-help/jw-library/apple/bookmarks/), [Android](https://www.jw.org/en/online-help/jw-library/android/bookmarks/)
- HIG: [Popovers](https://developer.apple.com/design/human-interface-guidelines/popovers), [Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets), [The menu bar](https://developer.apple.com/design/human-interface-guidelines/the-menu-bar), [Keyboards](https://developer.apple.com/design/human-interface-guidelines/keyboards)
- Material 3: [Bottom sheets](https://m3.material.io/components/bottom-sheets/overview), [Snackbar](https://m3.material.io/components/snackbar/overview), [Lists](https://m3.material.io/components/lists/overview)
- Berean: [inline-study-pane.md](inline-study-pane.md) (Decision 3, the 20% landing, the context menu), [userdata.md](userdata.md) (the Bookmark table), [berean-design-guide.md](berean-design-guide.md)
