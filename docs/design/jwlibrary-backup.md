# `.jwlibrary` backup: import and export

**Status:** Draft. Kerning & Co. recommendation (Iris, with Pebble and Hinge), written up by Lumen. **Direction approved Oct 30 2026; parity questions pending Echo.**
**Board row:** Expo 6d (…E3AK8), bookmarks and `.jwlibrary` import/export designs. The bookmarks half is [bookmarks.md](bookmarks.md).
**Platforms:** SwiftUI on iOS, iPadOS and macOS. Expo (`apps/mobile`) on iOS and Android, in both looks: Material 3 and the iOS look.
**Owner:** Design (Lumen). **Core:** #20 ([userdata.md](userdata.md), parity rows BK-1, BK-2 and UD-8). **Build:** Kiwi and Moss (SwiftUI), Otter (Expo).

## 1. Constraint: what the core does today

Kerning's recommended default, **Merge**, is not built. Wren approved [userdata.md](userdata.md) on Oct 28 with **import = Replace** and merge as "a separate later row". The UI below must be honest about that.

| Core today (`origin/main`) | Consequence for this spec |
| --- | --- |
| `import_preview(path, progress, cancel)` → `ImportPreview { backup, current, folders, filed_notes, device_name, created }`. The counts are highlights, notes, tags, bookmarks and favorites. | The review screen can show real counts for both sides, before anything changes. |
| `import_backup` **replaces everything** atomically. Cancel is honoured until the final swap. | Replace works now. All-or-nothing is guaranteed. |
| One undo copy (`userData.prev.db`), via `undo_import() -> Bool` | "Restore previous library" already exists, after a Replace and for the most recent import only. S2 (keep two, Decision 2) needs a core change (Echo). |
| Import **clears Berean note folders**, which a JW backup doesn't have. Export **drops** them. | Both have to be said on screen (§3.4, §6). |
| No per-category include, no merge, no duplicate policy | Merge, include toggles and the duplicates drill-in need a core row (Echo). See Decision 1. |
| Playlists, media and `InputField` round-trip but aren't counted | No "Playlists" row; one static line instead (§3.2). |
| Progress is in coarse steps (5 for preview, 6 for import, 5 for export) | Show a determinate bar from the steps, plus a status line. Don't promise a smooth percentage. |

This spec covers both phases. **Phase 1** is the review screen in Replace mode only, which ships on today's core. **Phase 2** adds the Merge mode, include toggles and duplicates. It lands when the merge core row does. Everything else (states, errors, export, form factors, accessibility) is the same in both.

## 2. Directions considered

| | **A. One review screen** (recommended) | B. Five-step wizard | C. Side-by-side comparison |
| --- | --- | --- | --- |
| Flow | Counts, then mode, then duplicates, then one button | Pick, preview, mode, duplicates, confirm | Your library and the backup side by side, per conflict |
| Verdict | **Recommended.** Most imports are a single action, so the safe path is one screen and one press. | Rejected: five screens for a rare task makes the safe path longer. | Rejected as the main flow. It's reused as A's duplicates drill-in and as "Show details" on wide layouts. |

## 3. Import

### 3.1 Entry points

| Platform | Where |
| --- | --- |
| Mac | **File › Import Backup…** (⇧⌘I, proposed). Dropping a `.jwlibrary` on the window or the Dock icon. Double-clicking the file in Finder. |
| iPad | The Library tab's toolbar overflow menu. Drag and drop from Files (Split View). Opening the file from Files, Mail or AirDrop. |
| iPhone, and Expo in both looks | The Library tab's overflow menu: **Import Backup…** and **Export Backup…**. Opening the file from another app. |
| All | Settings › Backup, once a Settings screen exists. The Expo app has none yet; see Decision 4. |

Opening a file from outside goes straight to **Reading** (§3.2), skipping the picker.

### 3.2 States

| State | What you see | Notes |
| --- | --- | --- |
| **Picking a file** | The system document picker (`UIDocumentPicker` or `fileImporter`, an `NSOpenPanel` sheet on Mac, `ACTION_OPEN_DOCUMENT` on Android), filtered to `.jwlibrary` where the platform allows | Cancelling returns you to where you were, with no sheet left behind. |
| **Reading** | The review layout, with skeleton counts and the status "Checking backup…" | Runs `import_preview`. Show nothing for 150 ms, then the skeletons. Cancel is available. |
| **Review** | A source line ("From *Owen's iPhone*, Oct 28, 2026"), category rows with counts, the mode control, and the footer button | See §3.3 and §3.4. |
| **Duplicates drill-in** (Phase 2) | A per-category list of conflicting items with the policy override per item. On wide layouts it's "Show details", a side-by-side view (Direction C) | Pushes on phones. It's the detail pane on tablets and Mac. |
| **Replace confirmation** | A system alert or confirmation dialog (§3.4) | Destructive role. |
| **Progress** | "Importing…", a determinate bar from the core's steps, and Cancel until the swap starts | Once the swap begins, the sheet can't be dismissed: interactive dismiss is off, Esc and back are ignored, and Cancel is hidden. It then finishes or rolls back. |
| **Success** | "Imported", a summary of what was added (or replaced), and **Done** | Done dismisses the sheet. Then the restore entry appears (§3.5). |
| **Error** | A message that says what happened and what to do (§3.6) | Nothing changed, in every case. |

**Category rows**, one per category: **Notes, Highlights, Tags, Bookmarks, Favorites**. Each shows the backup count, plus an **include** switch in Phase 2. Below them, one static textSecondary line: "Playlists and other JW Library data are kept as they are in the backup." (Kerning listed Playlists as a row. Berean doesn't surface playlists and the core doesn't count them.)

### 3.3 Merge mode (Phase 2, Kerning's default)

- **Mode control:** a segmented control in the iOS look and on iOS, and M3 segmented buttons in Material: **Merge** | **Replace**. It defaults to **Merge** every time the sheet opens. Replace is never remembered.
- **Include switches** per category. Turning one off removes its count from the button total.
- **Duplicates** collapse into one summary row per category, each with a policy menu. The duplicate keys come from the JW schema; Echo confirms them in the merge row:
  - **Notes** (same `Guid`): "14 notes already exist", with **Keep both** / **Keep newer** (by `LastModified`, the default) / **Keep mine**.
  - **Highlights** (same `UserMarkGuid`): **Keep mine** (default) / **Use backup's**.
  - **Tags** (same name): merged silently into one tag. There's no row.
  - **Favorites** (same location): deduplicated silently.
  - **Bookmarks:** slot collisions, as in [bookmarks.md](bookmarks.md) §7.
  - A **drill-in** chevron opens the per-item override.
- **Footer button:** filled, accent, "**Merge 1,340 items**". The number is what will be added or updated. Return triggers it, and Esc or Cancel closes.

### 3.4 Replace mode (Phase 1's only mode; Phase 2 when chosen)

- The summary switches to what will be **removed**, from `ImportPreview.current`: "Removes 214 notes, 1,032 highlights, 12 tags, 8 bookmarks and 30 favorites from this device." When `folders > 0`, it adds: "Removes 6 folders (40 of your notes are filed in them). JW Library backups have no folders." (from `folders` and `filed_notes`) Then: "Adds 82 notes, 640 highlights…" from `backup`.
- **Footer button:** "**Replace Library…**", in the destructive style, **not filled and not in the primary filled slot**: a bordered or outlined button in the destructive color. Return does nothing in Replace mode.
- **Confirmation:** an iOS alert or Mac confirmation dialog: "Replace your library?" / "Your notes, highlights, tags, bookmarks and favorites on this device will be replaced by the backup." with **Replace** (`.destructive`) and **Cancel** (`.cancel`, the default). On Material, an M3 basic dialog with the same text, Cancel, and **Replace** in the error color, trailing as M3 places the confirming action. Dialogs follow each platform's placement. The "never in the primary position" rule applies to the sheet footer.
- **Color:** Replace uses the system red, never the accent (#9B3F2A reads red-brown). The accent goes on Merge. The numbers in §7 change how this is done.

### 3.5 Snapshot and restore — **Decided (Owen): S2**

Berean takes a snapshot of the current library before **every** import (Replace now, Merge in Phase 2) and keeps the **last two**. When a third would be made, the oldest is pruned. Storage: up to two copies of `userData.db` and its media.

**Core change for Echo:** the core today keeps only **one** undo copy (`userData.prev.db`, restored by `undo_import() -> Bool`). Keeping two snapshots, pruning the oldest, and restoring a chosen one is a core change, and Merge must snapshot too.

The restore UI:
- After a successful import, a banner at the top of the Library tab says "Library replaced from backup" (or "Backup merged"), with **Restore Previous Library** and a close button. It stays until it's closed or the next import.
- The same action lives under Library overflow (and Settings later), and is disabled when there's no snapshot to restore.
- Restoring asks for confirmation: "Restore this library?" / "Your current library will be saved as a snapshot first, so you can switch back." with **Restore** and **Cancel** (the default). Nothing is lost, because a restore first keeps the current library as a `Restore` snapshot.
- The action opens a two-row chooser of the snapshots, newest first. Each row names why it was taken, with when it was taken as the secondary line:
  - `Replace`: "Before importing a backup". If the snapshot has the source backup's device name and date, add them: "Before importing a backup from Owen's iPhone (Oct 30, 2026)". Either part can be missing; leave out whatever isn't there.
  - `Merge`: "Before merging a backup" (Phase 2), with the same optional source.
  - `Restore`: "Before restoring a snapshot".
  - Secondary line: "Saved Oct 31, 2026 at 11:15 AM", from `taken_at` in the device's time zone and format.
- With one snapshot, the chooser shows one row.

### 3.6 Errors (core error, then message)

| Case | Core | Message | Action |
| --- | --- | --- | --- |
| Corrupt zip, missing member, hash mismatch, failed integrity check | `Corrupt` | "This file isn't a readable backup." | OK |
| Schema newer than 16 | `Invalid` | "This backup is from a newer version. Update Berean to import it." | OK (and Open App Store / Play Store in release builds) |
| Schema older than 14 | `Invalid` | "This backup is from an older version of JW Library. Back up again from an updated JW Library, then import that file." | OK |
| Interrupted or cancelled before the swap, or an I/O failure | `Cancelled` / `Io` | "Import stopped. Nothing was changed." | **Retry**, Close |
| Out of storage | `StorageFull` | "Not enough storage to import this backup. Free up about 120 MB and try again." | Retry, Close |

The core reports out of storage as `StorageFull` for both import and export, whether it comes from a full disk during extract, SQLite's `SQLITE_FULL`, the zip write, or the final rename.

## 4. Export

| Platform | Flow |
| --- | --- |
| Mac | **File › Export Backup…** (⇧⌘E, proposed) opens an `NSSavePanel` sheet with the default name "Berean backup 2026-10-30.jwlibrary". **Share…** is the secondary item in the same menu. |
| iPhone, iPad | Export writes to a temp file, then opens the share sheet (which includes **Save to Files**). On iPad it's anchored to the menu item's source. |
| Android (Expo, both looks) | A short chooser: **Share…** (the Android share sheet) or **Save to…** (`ACTION_CREATE_DOCUMENT` through the system file picker). The iOS look uses the same two options in an action-sheet style. |

- **Progress:** a small sheet (a dialog in Material) with "Creating backup…", a determinate bar from `EXPORT_STEPS`, and **Cancel**. Cancel removes the partial file, since the core writes the file whole or not at all.
- **Before sharing:** one footnote line under the progress or success: "Folders aren't included. JW Library doesn't have folders." It shows only when the user has folders.
- **Errors:** "Couldn't create the backup." with **Retry**. Out of storage (`StorageFull`) gets its own message: "Not enough storage to create the backup. Free up about 40 MB and try again."
- **Success:** on Mac, the save panel closing is the success, plus a "Backup saved" toast. On mobile, the share sheet is the success, with no extra screen.

## 5. Form factors

| Context | Import presentation |
| --- | --- |
| iPhone (SwiftUI) | A full-height sheet (`.large`) with its own `NavigationStack`. The drill-in pushes. |
| iPad (SwiftUI) | One large sheet (`.presentationSizing(.page)`), split: categories on the left; mode, duplicates and the button on the right. |
| Mac | A window sheet, at least 640 × 520 pt, with the same split. Return and Esc are bound as in §3.3. |
| Expo iOS look, phone | A full-height sheet with a navigation header (Cancel leading, title "Import Backup"). The drill-in pushes inside the sheet. |
| Expo iOS look, tablet (≥ 600 dp) | A centered large sheet, 720 dp maximum width, with the two-pane split. |
| Expo Material, phone | An **M3 full-screen dialog**: a close (×) icon and the title "Import backup" in the top app bar, with the filled action pinned at the bottom for reach. |
| Expo Material, tablet (≥ 600 dp) | A large dialog, at most 840 dp wide, in the **list-detail** layout: categories as the list, mode and duplicates as the detail. |

**File types** (Kiwi, Moss and Otter):
- **iOS, iPadOS and macOS:** declare `.jwlibrary` as an **imported** type (`UTImportedTypeDeclarations`), not an exported one, because Berean doesn't own the format. It conforms to `public.zip-archive` and `public.data`. Add a `CFBundleDocumentTypes` entry with the Viewer role, so it opens from Files, Mail, AirDrop and a Finder double-click. The UTI identifier should match JW Library's own declaration if it has one, so the two don't conflict; **Echo to verify** (see Decision 5).
- **Expo iOS:** the same keys through `app.json` `ios.infoPlist`.
- **Android:** an intent filter for `ACTION_VIEW` and `ACTION_SEND` on `content:` URIs. MIME types are unreliable for this extension (often `application/octet-stream` or `application/zip`), so accept both and check the extension and the zip's `manifest.json` in the app. In Expo it goes through `android.intentFilters` or a config plugin.

## 6. Accessibility

- **Category rows are one element:** "Notes, 82, included" (Phase 2), or "Notes, 82" (Phase 1). The include switch is the row's toggle action.
- **The mode control** reads "Import mode, Merge, 1 of 2". Switching to Replace announces the new summary's first line.
- **Text at 2×:** counts and labels wrap, never truncate. On tablets at 2×, the split stacks into one column.
- **The destructive button never sits in the footer's primary filled slot**, and Return never triggers it.
- **Progress** exposes a value ("40 percent") to VoiceOver and TalkBack, and the app announces "Import finished. 1,340 items added." or "Import failed. Nothing was changed."
- **Reduce Motion:** the sheet and dialog springs become 0.2 s cross-fades, and the drill-in push becomes a cross-fade.
- **Focus:** when the sheet opens, focus goes to the title. After an error, focus goes to the message. After success, focus goes to Done.

## 7. Contrast (computed, WCAG 2.x relative luminance)

| Pair | Ratio | Iris's figure | Use |
| --- | --- | --- | --- |
| Accent #9B3F2A on surfaceRaised #FFFCF5 | **6.53:1** | 6.5 ✓ | Accent text and icons, light |
| Accent #E59A7C on surfaceRaised #211D18 | **7.38:1** | 7.4 ✓ | Accent text and icons, dark |
| #FFFFFF on accent #9B3F2A | **6.69:1** | 6.7 ✓ | Filled Merge label, light (Material `onPrimary`) |
| #FFFCF5 on #9B3F2A | **6.53:1** | — | Filled Merge label, light, in the iOS look if it uses surfaceRaised |
| #211D18 on accent #E59A7C | **7.38:1** | not given | Filled Merge label, dark, in the iOS look |
| #3A140A on #E59A7C | **7.20:1** | — | Filled Merge label, dark, Material (`m3Roles.dark.onPrimary`) |
| #FFFFFF on #E59A7C | **2.27:1 ✗** | — | **Never** use white on the dark accent |

Iris's three figures check out to one decimal place.

**Destructive red: a finding that changes §3.4.**

| Pair | Ratio | Verdict |
| --- | --- | --- |
| iOS systemRed #FF3B30 on #FFFCF5 | **3.46:1** | ✗ Fails 4.5:1 for body-size text in light mode |
| #FFFFFF on #FF3B30 (filled) | **3.55:1** | ✗ Fails |
| systemRed, Increase Contrast variant, #D70015 on #FFFCF5 / #FBF7EC | **5.25 / 5.03:1** | ✓ |
| systemRed dark #FF453A on #211D18 / #15120E | **4.92 / 5.48:1** | ✓ |
| M3 baseline error #B3261E on #FFFCF5; #FFFFFF on #B3261E | **6.38 / 6.54:1** | ✓ |
| M3 baseline dark error #F2B8B5 on #211D18 | **9.81:1** | ✓ |
| M3 error #B3261E vs accent #9B3F2A | **1.02:1** | Same lightness, and a very close hue |

What this means:
1. In the Expo iOS look, and in SwiftUI wherever Berean draws the label itself (the sheet footer), use **#D70015 in light** and **#FF453A in dark** for destructive text, not #FF3B30. Native SwiftUI alerts and confirmation dialogs keep the system styling.
2. In Material, the M3 error role is almost indistinguishable from Berean's accent. So Replace must **not rely on color**. It's set apart by its label ("Replace Library…"), a warning icon, its unfilled style, the non-primary position, and the confirmation dialog.
3. `tokens.ts` has **no destructive or error role** yet. Add `destructive` per look and scheme (proposed: iOS look #D70015 / #FF453A; Material `error` #B3261E / #F2B8B5, with `onError` #FFFFFF / #601410, which is 7.66:1).

## 8. Decisions

1. **Merge.** **Decided (Owen):** ship import as **Replace-only now** (Phase 1, on today's core), then add Merge as the default once Echo's merge import lands (Phase 2). Merge needs a new core row: include filters, duplicate policies, per-item overrides, snapshots.
2. **Snapshot policy.** **Decided (Owen):** S2, a snapshot before every import, keeping the last two (§3.5). A core change for Echo.
3. **Destructive color.** **Decided (Wren):** the `destructive` token, #D70015 light and #FF453A dark, and Replace set apart in Material by its label, a warning icon and the confirmation step, not color (§7).
4. **Where Import and Export live on phones and tablets.** **Decided (Wren):** the Library tab's overflow menu until Settings exists, then Settings › Backup.
5. **The `.jwlibrary` UTI identifier:** match JW Library's declaration or use a Berean-namespaced imported identifier. **Pending Echo** (parity check).
6. **Keyboard.** **Decided (Wren):** ⇧⌘I and ⇧⌘E for Import and Export on Mac.

## 9. References

- HIG: [Alerts](https://developer.apple.com/design/human-interface-guidelines/alerts), [Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets), [Drag and drop](https://developer.apple.com/design/human-interface-guidelines/drag-and-drop), [File management](https://developer.apple.com/design/human-interface-guidelines/file-management), [Progress indicators](https://developer.apple.com/design/human-interface-guidelines/progress-indicators)
- Apple: [Defining file and data types](https://developer.apple.com/documentation/uniformtypeidentifiers/defining-file-and-data-types-for-your-app). Calm review-then-merge precedent: [Photos duplicate merge](https://support.apple.com/guide/photos/find-and-merge-duplicates-pht0b46c8b3e/mac)
- Material 3: [Dialogs](https://m3.material.io/components/dialogs/overview) (full-screen and basic), [Segmented buttons](https://m3.material.io/components/segmented-buttons/overview), [Progress indicators](https://m3.material.io/components/progress-indicators/overview). Android: [list-detail layout](https://developer.android.com/develop/ui/compose/layouts/adaptive/list-detail), [Storage Access Framework](https://developer.android.com/training/data-storage/shared/documents-files)
- WCAG 2.2: [1.4.3 Contrast (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html), [1.4.11 Non-text Contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)
- Berean: [userdata.md](userdata.md), [bookmarks.md](bookmarks.md), [docs/parity.md](../parity.md) rows BK-1, BK-2 and UD-8
