# Expo 6d handoff: bookmarks and `.jwlibrary` backup (for Otter)

**Status:** Direction approved Oct 30 2026; parity questions pending Echo. Build after the highlights and notes rows; Bible slot sharing and the `.jwlibrary` type identifier stay **Pending Echo**. Specs: [bookmarks.md](bookmarks.md) and [jwlibrary-backup.md](jwlibrary-backup.md).
**Board row:** Expo 6d (…E3AK8). **Order:** after the highlights and notes rows.

Everything below is built in **both looks** (Material, and the iOS look via the dev Look toggle), at phone (< 600 dp) and tablet (≥ 600 dp) widths.

## Build checklist

### Bookmarks
- [ ] Reader toolbar bookmark button (replaces the "bookmark" pending item in `bible-chapter.tsx`), with outline and filled states.
- [ ] Picker: an iOS-look phone sheet (medium detent, grabber), an iOS-look tablet anchored card, and a Material modal bottom sheet (640 dp max on tablet).
- [ ] Rows: empty, filled, and filled at the current place. A header with a save target, and the all-10-full message.
- [ ] Trailing menu (⋯ / ⋮): Replace with …, Delete. Plus a long-press context menu, and a trailing swipe in the iOS look only.
- [ ] Undo snackbar (Material) or toast (iOS look) after Delete and Replace.
- [ ] A **Bookmark…** item in the verse long-press context menu. A **tap on verse text must still do nothing** (Decision 3).
- [ ] Jump: lands at 20%, with the verse-number accent pill plus a 2 s wash. The study pane stays closed. Reduce Motion: a static wash that clears on the next scroll or tap.
- [ ] Edge cases: location not found (row note, nearest place, toast), chapter-level bookmark (top, no marker).
- [ ] Accessibility: one element per slot, Jump as the default action, Replace and Delete as custom actions, announcements.
- [ ] Hardware keyboard: Ctrl+D opens the picker in save mode; ↑/↓, Return and Esc.

### Import (Phase 1 = Replace only, on today's core)
- [ ] Library overflow: Import Backup…, Export Backup…, Restore Previous Library… (disabled when there's no snapshot; opens a two-row chooser of the last two snapshots, with date and source).
- [ ] The system picker (`ACTION_OPEN_DOCUMENT`), and the intent filter for opening `.jwlibrary` from other apps (VIEW and SEND, `application/zip` + `application/octet-stream`, checked in the app).
- [ ] Presentation: iOS-look phone full-height sheet, iOS-look tablet large two-pane sheet, Material phone full-screen dialog, Material tablet list-detail dialog.
- [ ] States: reading (150 ms delay, then skeleton counts), review (source line, 5 category rows, the playlists line), the Replace summary (removes, the folders line, adds), the "Replace Library…" outlined destructive button, the confirmation dialog, progress (Cancel until the swap, then not dismissible), success + Done, and each error in spec §3.6.
- [ ] The "Library replaced from backup" banner on the Library tab, plus the restore confirmation.
- [ ] Snapshots (S2): a snapshot before every import, the last two kept, the oldest pruned when a third is made. Needs Echo's core change (today's core keeps one undo copy); until it lands, the chooser shows one row.
- [ ] Add a `destructive` token per look and scheme (spec §7). **No #FF3B30 for text, and no white on #E59A7C.**
- [ ] Phase 2 (only after Echo's merge row): Merge | Replace segmented control, include switches, duplicate summary rows, the drill-in, and "Merge N items".

### Export
- [ ] Share… / Save to… chooser (`ACTION_CREATE_DOCUMENT`), a progress dialog or sheet with Cancel, and the folders footnote when the user has folders.
- [ ] Errors: "Couldn't create the backup." + Retry, and the out-of-storage message.

## Proof I'll require (real emulator output, no mockups or captions)

Each set of screenshots is in **both looks × light and dark × 1× and 2× text**, unless noted. Phone on berean31. Tablet on a ≥ 600 dp emulator.

| # | Proof | Covers |
| --- | --- | --- |
| 1 | Picker, empty publication (all slots empty), phone + tablet | Layout and header |
| 2 | Picker with mixed slots, including one at the current place, phone + tablet | Row states and the filled glyph |
| 3 | Picker with all 10 full | Header message, wrapping at 2× |
| 4 | Trailing menu open, and the iOS-look swipe revealed | Replace and Delete |
| 5 | Undo snackbar and toast after Delete | Undo |
| 6 | Verse long-press menu with Bookmark… | The context entry |
| 7 | Reader just after a jump (pill + wash), and the location-not-found toast | Landing, edge case |
| 8 | Import: reading (skeleton), review, the Replace summary with the folders line, confirmation dialog, progress, success, phone + tablet | Every import state |
| 9 | Import errors: corrupt, newer version, older version, interrupted, out of storage | Copy and actions |
| 10 | The restore banner, the two-snapshot chooser (one and two snapshots), and the restore confirmation | Snapshot UI |
| 11 | Export chooser, progress, error | Export |
| 12 | Opening a `.jwlibrary` from the Files app or a share target lands on Reading | The intent filter |

**Recordings** (screen recordings, both looks, one scheme is fine):
- R1: picker open, save to an empty slot, auto-dismiss. R2: jump and wash fade. R3: Delete + Undo.
- R4: import through to success, including the sheet becoming non-dismissible after the swap starts (try back and swipe-down during progress).
- R5 and R6: R1 and R2 again with **Reduce Motion on** (Android: Remove animations), showing the cross-fades and the static wash.
- R7: TalkBack walking a filled slot (default action + custom actions) and the import-finished announcement.

I'll check the PNG bytes from the branch, not the PR captions. Contrast is checked against spec §7. Real iOS, Mac shortcuts and file-type registration on iOS stay as follow-ups until we have iOS builds.
