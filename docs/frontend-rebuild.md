# Frontend rebuild on Expo UI

Status: **plan, pending Owen's go** (Nov 11, 2026). No code slice starts
until Owen or the coordinator says go.

Owen's ask (Nov 10): the app feels janky when running, Library has no
images, buttons don't always work, and spacing looks off. Redo the
frontend on Expo UI.

This plan covers the Expo app in `apps/mobile` on iOS and Android. The
native Apple targets in `apple/` stay paused.

## What Expo UI is, in the SDK we're on

- `@expo/ui` gives React components that render real SwiftUI on iOS and
  real Jetpack Compose on Android. It has three entry points:
  - `@expo/ui`: the universal layer, 18 components including `Host`,
    `List`/`ListItem`, `Button`, `Text`, `TextInput`, `Picker`, `Switch`,
    `Slider`, `BottomSheet`, `FieldGroup`, `Icon`, `Row`, `Column`,
    `ScrollView` and `RNHostView`.
  - `@expo/ui/swift-ui`: about 47 SwiftUI views and modifiers, among them
    `NavigationSplitView`, `ContextMenu`, `Menu`, `ConfirmationDialog`,
    `SwipeActions`, `Toolbar` and `LazyVStack`.
  - `@expo/ui/jetpack-compose`: about 50 Material 3 components, among them
    `ModalBottomSheet`, `AlertDialog`, `DropdownMenu`, `SearchBar`,
    `Carousel`, `LazyColumn`, `TopAppBar`, `SegmentedButton` and `Image`.
- It has been stable since SDK 56. SDK 58 made `List` virtualize and
  recycle rows, added the iOS navigation views, and made expo-router's
  native tabs and `Stack.Toolbar` stable (`Stack.Toolbar` needs
  `@expo/ui` on Android).
- **The repo is already on SDK 58** (`expo ~58.0.21`, React Native 0.88),
  so there is no SDK upgrade. We add `@expo/ui ~58.0.27` and take the
  patch bumps in Dependabot's #99.
- Every Expo UI tree sits inside a `Host`. Inside it there is no Yoga:
  layout is `Row`/`Column` (or `HStack`/`VStack`). React Native views can
  sit inside through `RNHostView`, and a screen can mix both, so the
  rebuild can go one screen at a time.

Sources: [Expo UI reference (SDK 58)](https://docs.expo.dev/versions/v58.0.0/sdk/ui/),
[universal components](https://docs.expo.dev/versions/v58.0.0/sdk/ui/universal/),
[SDK 58 changelog](https://expo.dev/changelog/sdk-58),
[Expo UI stable in SDK 56](https://expo.dev/blog/expo-ui-stable-sdk-56).

### What Expo UI does not cover

| Need | Expo UI today | What we use |
| --- | --- | --- |
| Bible chapter text: per-verse and per-word taps, highlight backgrounds, landing wash, line metrics for margin markers | `Text` has no spans with their own press, no selection, no line metrics | Keep React Native `Text`, rebuilt for speed (Read slice) |
| Word highlighting and text selection | No text selection API documented | React Native text plus the core's word tokens from #116 |
| Studyspace infinite canvas | Nothing | Keep Gesture Handler and Reanimated; Skia only if profiling asks for it |
| Map | Nothing; expo-maps shows real-world tiles, not the Bible atlas | Keep #115's offline `react-native-svg` map inside `RNHostView` |
| Note editor with live Markdown styling | `TextInput` has no styled spans | Keep the React Native `TextInput` |
| Remote and file images in rows | SwiftUI `Image` is SF Symbols only | `expo-image` inside list rows |
| Android navigation rail | No rail component | Keep our rail, restyled to the tokens |
| Accessibility props, Dynamic Type | Not documented per component | Proved in the first slice before anything else moves |

So the rebuild moves the app's chrome to native controls: tab bars,
toolbars, lists, rows, buttons, menus, sheets, dialogs, pickers, search
fields and settings. The reading surfaces stay React Native, made fast.

## Why the app feels the way it does

A survey of `apps/mobile` found that most of what Owen sees is not about
the UI framework. Moving to Expo UI fixes the visual and touch problems
in the chrome. The rest needs its own fixes, which this plan puts first.

- **Library has no images because covers were never built.** No layer
  has them: `PublicationSummary` in the FFI has no image field
  (`core/berean-ffi/src/lib.rs:260`), catalog ingest never reads the
  catalog's image tables, the jwpub manifest parser skips images, and no
  Library row draws one. `expo-image` isn't installed. This needs core
  work first.
- **Jank comes from synchronous core calls on the JS thread.** Almost
  every read is synchronous, and many run during render: the Bible
  chapter (`src/reader/bible-chapter.tsx:169`), the Library's installed
  list and languages on every focus, catalog queries of up to 200 rows
  per keystroke, What's New, one notes query per tag, and a whole chapter
  per Studyspace reader card. There is also no memoization anywhere and
  no React Compiler, the chapter is one unvirtualized ScrollView, and
  each download progress tick re-renders the whole Library.
- **Buttons don't always respond, for five reasons.**
  - Library › Catalog's list has no `keyboardShouldPersistTaps`, so the
    first tap on Download only closes the keyboard.
  - Verse numbers are 11pt nested text spans that can't take a hit slop.
  - The study pane's close button sits inside its resize drag, so a press
    that moves 10px turns into a drag.
  - Custom sheets chain on a fixed 350 ms timer on iOS, so a second
    action can be lost.
  - On Studyspace, tap, double-tap, pan, pinch and long-press compete,
    and a fading canvas layer can sit over the new one.
  - All of these get worse while a synchronous core call holds the JS
    thread.
- **Spacing looks off because the chrome is hand-drawn.** There is a 4pt
  spacing scale, but sheets, alerts, action sheets and dialogs are custom
  React Native imitations, the iPad tab bar is an approximation, some
  screens use sizes outside the type scale (`fontSize: 15` in nine
  files), and the iOS Library header crowds four text buttons beside a
  large title. Native controls bring the platforms' own spacing and
  touch targets.

## Principles for every slice

- **Native chrome, Berean's colors.** Controls follow the platform: SwiftUI
  on iOS (Liquid Glass on iOS 26), Material 3 on Android. Berean's four
  themes and accents tint them (SwiftUI tint, Compose color roles), so
  nothing is recolored by the system. The dev-menu switch that previews
  the other platform's look goes away, and so do the `look` branches.
- **One screen per pull request**, each reviewable on its own and each
  with screenshots from the emulator workflow (and the iOS simulator once
  slice 1b lands). The PR says the screenshots were reviewed.
- **Every slice keeps:** phone, tablet portrait and landscape layouts;
  light and dark; the largest text size; VoiceOver and TalkBack labels,
  actions and focus order; and hardware keyboard shortcuts where they
  exist today.
- **No synchronous core call during render.** Reads go through the async
  bindings from slice 2 and a small cache hook.
- **Merging waits for Owen's yes** in the slice's thread.

## Slices

### 0. This plan (docs only)

### 1a. Foundation

- Add `@expo/ui` and `expo-image`; take #99's SDK 58 patch bumps.
- Turn on the React Compiler and fix what it flags.
- A `Host` wrapper that passes Berean's theme to SwiftUI and Compose, and
  a short token map (spacing, type roles, colors) for Expo UI modifiers.
- Rebuild **Appearance** on Expo UI as the proving screen: it is a
  settings form, the best fit for `FieldGroup`, `Picker` and `Switch`.
- Prove, before anything else moves, and write the results into this
  doc: Dynamic Type and Android's 2× font scale, VoiceOver and TalkBack
  labels and actions, `Host` sizing inside scroll views, a React Native
  `expo-image` inside a `ListItem`, and theme switching without a flash.
  If one of these fails, the plan changes here, not five screens later.

### 1b. iOS screenshots

- Half of the rebuild renders SwiftUI, and CI captures only Android today.
- Add an iOS simulator job on GitHub-hosted macOS runners (free for a
  public repo) that captures the same `SCREENS` on iPhone and iPad, light,
  dark and largest text, into the same PR comment.
- This uses GitHub's runners, not the self-hosted Mac, so it doesn't
  touch the paused Apple targets.

### 2. Core: covers and async reads

One core package at a time, after #116 merges, since both change the
shared bindings.

- **Covers:** read the catalog's image rows and expose a cover on
  `PublicationSummary` (a CDN address for catalog entries, the unpacked
  file for installed ones). Which image tables and sizes to use is
  checked against the real catalog in this slice.
- **Async reads:** async variants of the heavy reads (Bible chapter and
  books, installed list, catalog query, What's New, notes by tag or
  folder, Studyspace documents), so they run on the core's threads. Small
  lookups stay synchronous.

### 3. Shell and navigation

- `NativeTabs` on phones and on iPad, where iPadOS draws its own tab bar
  and sidebar; this removes `floating-tab-bar.tsx`. Android tablets keep
  a navigation rail, restyled to the tokens, since Expo UI has none.
- Header buttons move to `Stack.Toolbar`; crowded headers fold into a
  native menu.
- Replace the React Native `Modal` imitations (confirm dialog, action
  sheet, name dialog, `sheet.tsx`) with native sheets, alerts,
  confirmation dialogs and context menus. Each later slice uses these.

### 4. Library (first screen, since images are broken)

- Library, Catalog, Languages, What's New and Find on Expo UI lists, with
  covers through `expo-image` (cached, with a placeholder by publication
  kind).
- Download progress isolated per row, so a tick redraws one row.
- Catalog and Find search fields that keep the first tap.
- Import states and the What's New shelf (a carousel on both platforms).
- Tablet: a cover grid in wide windows.

### 5. Today and publications

- Today, the publication and article screens' chrome, and article
  Languages. Document text stays React Native.

### 6. Read

- Chapter chrome: book and chapter picker, toolbar, highlight sheet and
  bookmark picker as native sheets and menus.
- The chapter text stays React Native, rebuilt for speed: loaded through
  the async read, split into virtualized paragraphs, memoized blocks,
  and larger verse targets.
- The study pane's close button moves out of the resize drag.
- Ports the map and timeline (#115) and word highlighting (after #116)
  into the new chrome.

### 7. Notes

- Notes, folders, tags and the list on Expo UI lists with native swipe
  actions and context menus.
- The editor keeps its React Native `TextInput`; Markdown styling moves
  off the keystroke path.

### 8. Studyspace

- Toolbars, menus and card actions on Expo UI. The canvas stays Gesture
  Handler and Reanimated, with its gesture conflicts fixed (taps win over
  pans that haven't moved, no layer left over the live one).
- The queued canvas and Markdown work comes after this slice.

### 9. Search

- The search screen and the Ctrl+K palette on native search fields and
  lists.

### 10. Cleanup

- Remove the `look` switch, the old sheet and dialog components and
  unused tokens; update `docs/design` and the screenshot list.

## Work in flight

- **Map and timeline (#115)** and **word highlighting** (its core part
  is #116, its app part opens after #116 merges) finish on the current
  frontend and merge as they are.
- The rebuild ports their screens in slice 6. #115's map is a
  `react-native-svg` view and moves over unchanged inside `RNHostView`;
  only its chrome is rebuilt.
- Slices 1 to 5 don't touch the reader files those two change, so they
  can run alongside. Slice 2 waits for #116 because of the shared
  bindings file.

## Not in this plan

- The native Apple targets (`apple/`), which stay paused.
- New features. Each slice keeps today's behavior; the queued Studyspace
  canvas and Markdown work follows the rebuild.
