# Frontend rebuild on Exact

Status: **slice 1, the test build, merged (#118); slice 2, CI, in review** (Owen said go on Nov 11, 2026). The app is in
`apps/berean`; what the test build found is under [Test build findings](#test-build-findings).
Nothing merges without Owen's yes.

Owen's ask (Nov 10): the app feels janky when running, Library has no
images, buttons don't always work, and spacing looks off. Redo the
frontend on Expo's Exact. On Nov 11 he confirmed Exact (`github.com/expo/exact`),
knowing it isn't React Native and is pre-1.0. An earlier draft of this plan was written for
Expo UI; this version replaces it.

Facts about Exact below come from its repository at commit `db72e04f`
(Nov 11, 2026): its README, `docs/reference.md`, `docs/start-here.md` and
`host/android/README.md`. Exact changes daily, so the first slice checks
them again.

## What Exact is

- A cross-platform app runtime from Expo, MIT licensed. The interface is
  written in **Contract**, a small declarative language with CSS layout and
  CSS names. Data logic is written in **TypeScript or Rust**.
- The Contract compiler turns the view into a *plan*. On the web the plan
  runs on a ~20 KB runtime over the browser's DOM. On iOS, macOS and Linux
  a Rust runner executes it, a Rust layout kernel (Taffy) computes every
  box, and the platform draws: **UIKit on iOS, AppKit on macOS**. There is
  no webview, no JavaScript bridge in the UI and no React.
- What the app doesn't style comes out as the platform's own: system
  controls, text sizes, tab bar, Back, keyboard and accessibility.
- Lists are virtualized and use the platform's own rows. Images, video,
  complete SVG, Canvas 2D on every host, a WYSIWYG Markdown editor (web,
  macOS, iOS), transitions, springs, pan/swipe/pinch gestures, a router
  with a stack per tab, and native modules (a platform widget as a tag).
- Agents can build, run, screenshot, tap, type and test the app on every
  host through one script (`scripts/agent.mjs`), and `app.test.contract`
  tests run unchanged on each host.

### Platforms, as Exact describes them today

| Platform | Status in Exact | Drawn with |
| --- | --- | --- |
| iOS and iPadOS (Simulator and devices) | Working | UIKit and CoreText |
| macOS | Working | AppKit and CoreText |
| Web | Working; also Exact's development loop | The browser's DOM and CSS |
| Linux | Working; reads but doesn't edit text | Its own painter (GPU or CPU), headless too |
| **Android** | **"Admitted and early"** since Oct 7: builds and runs on an emulator or phone, has tests and the agent, TalkBack through its own accessibility provider. **No delivery or store packaging yet** | **Its own pixels** replayed onto Android's Canvas: no Material or Compose controls |
| Windows | Unfinished | Its own painter |

### What it costs

- **Pre-1.0, no API stability, no migration guides.** We pin one Exact
  commit, and each bump is its own pull request with screenshots.
- **No packaged CLI.** Apps build from a source checkout of Exact. The
  toolchain is Rust, Bun 1.4.2, Chrome for the web driver, Xcode 27.1 or
  later for Apple hosts, and pinned Hermes bundles (TypeScript only).
- **It doesn't mix with React Native.** Nothing from the Expo app is
  reused on screen, so this is a new app beside the Expo app, not a
  screen-by-screen swap inside it.
- **Our cloud sessions run on Linux** and can't build for iOS. They can run
  Exact's web loop and its headless Linux host. iOS builds happen in CI on
  macOS runners. Exact's own CI uses GitHub's `macos-26` runners but
  doesn't build for iOS there; Berean's iOS job needs the `xcode-27`
  image (see [Test build findings](#test-build-findings)).

## Platforms: what this targets first

- **First: iOS and iPadOS** (decided by Owen, Nov 11), the platform Exact supports best among the two
  Berean ships today.
- **Android: kept, but behind.** Exact's Android runs and has TalkBack, but
  it draws its own controls (it won't look like a Material app) and can't
  be packaged for the Play Store yet. Until it can, Android users keep the
  Expo app. This is a step back from Owen's Nov 8 hand-off ("native for iOS
  and Android"), and it is called out here on purpose.
- **macOS comes nearly free** because the same Contract runs on AppKit. The
  native Apple targets in `apple/` (the Swift apps, paused since Nov 8) stay
  paused; whether Exact's macOS build later replaces them is Owen's call.
- **Web** is Exact's development loop and could become a shipped target,
  but only after the Rust core builds for WebAssembly (below).

## The Rust core

- **Berean's core links directly, with no bindings layer.** Exact's Rust
  data sources are crates that implement its `DataSource` trait
  (`query`, `answer`, `parse`). A data crate (`apps/berean/data`, `berean-data`) wraps
  `berean-core` and answers the view's resources with its records, so the
  uniffi bindings (`berean-ffi`, `modules/berean-ffi-rn`) aren't needed by
  the new app. The Expo app keeps them until it's retired.
- **Reads run off the UI thread.** Exact can place a Rust source on a
  worker (`rust.placement: worker`), so loading a chapter or the catalog
  doesn't hold the screen. That is the background loading the Expo app
  never had.
- **Storage.** The core owns its own SQLite files and unpacked
  publications. Decided in the test build: the data crate opens the core
  itself, in the directory the host hands every data source through
  `configure_storage` (on iOS, `Application Support/exact/<app id>/data`).
  No native module shim is needed, because the crate is linked natively
  (`app.json` turns Rust live replacement off, so nothing tries to run the
  core as Wasm on iOS).
- **Downloads.** Today the Expo app downloads from the JW CDN and hands
  files to the core. Under Exact, downloads go through Exact's
  grant-checked `fetch` (declared grants), and the core opens the files.
- **Web needs the core on WebAssembly.** The browser runs Rust as Wasm.
  The core's bundled SQLite, zip, AES and zlib have to build for
  `wasm32`, and the core would use Exact's browser SQLite. That is real
  work, so web is not a first target.

## What Exact covers for Berean, and what it doesn't yet

| Need | Exact today | Plan |
| --- | --- | --- |
| Tabs, per-tab stacks, sheets, alerts, menus, search fields, settings forms | Platform controls and a router | Use as is |
| Library lists and covers | Virtualized platform lists, remote and local images | Use; covers need the core (slice 3) |
| Tablet cover grid | Grid virtualization is out for v1 | Rows in Library; a small unvirtualized grid only on What's New |
| Bible chapter: per-verse and per-word taps, highlight backgrounds, margin markers | Text runs exist (with links); a press and a background per run, and line positions for markers, aren't documented | **Prove in the spike**; this decides whether Read ports |
| Word highlighting and text selection | Text fields have selection ranges; selection in read-only text isn't documented | Prove in the spike, with #116's word tokens |
| Studyspace infinite canvas | Canvas 2D on every host; pan, swipe, pinch with velocity; no gesture arena (out for v1) | Port after the spike shows tap and pan can share a card |
| Map and timeline (#115) | Complete SVG on every host | #115's offline SVG basemap ports as SVG |
| Note editor with live Markdown | WYSIWYG Markdown editor on web, macOS and iOS | Decide in the Notes slice: Exact's editor, or a plain field with the core's styling |
| VoiceOver, TalkBack, largest text, light and dark | UIKit and AppKit accessibility; Android through its own provider; `light-dark()` | Check in every slice's screenshots |

## Why the app feels the way it does

This holds whatever the framework. A survey of the Expo app found:

- **Library has no images because covers were never built.** No layer has
  them: `PublicationSummary` has no image field
  (`core/berean-ffi/src/lib.rs:260`), catalog ingest never reads the
  catalog's image tables, the jwpub manifest parser skips images, and no
  Library row draws one. This needs core work in any framework.
- **Jank comes from synchronous core calls on the JS thread.** Almost every
  read runs during render: the Bible chapter
  (`apps/mobile/src/reader/bible-chapter.tsx:169`), the Library's installed
  list on every focus, catalog queries per keystroke, one notes query per
  tag, a whole chapter per Studyspace card. Exact's worker-placed Rust
  source removes this by design.
- **Buttons don't always respond, for five reasons.**
  - Library › Catalog's list doesn't keep taps while the keyboard is up.
  - Verse numbers are 11pt text spans that can't take a larger target.
  - The study pane's close button sits inside its resize drag.
  - Custom sheets chain on a fixed 350 ms timer on iOS.
  - On Studyspace, tap, double-tap, pan, pinch and long-press compete.
  
  Each one is designed out in its slice: native sheets and alerts,
  verse targets at least 44 points, no press inside a drag area.
- **Spacing looks off because the chrome is hand-drawn.** Sheets, alerts,
  action sheets, dialogs and the iPad tab bar are React Native imitations,
  and some screens use sizes outside the type scale. Exact leaves unsaid
  presentation to the platform, so the rebuild writes less styling, not
  more.

## Screenshots for UI pull requests

UI pull requests still need reviewed screenshots (`CLAUDE.md`,
`docs/screenshots.md`). Exact's agent can screenshot every host, so:

1. **iOS, from the first app PR:** a workflow on GitHub's `xcode-27`
   runners (`.github/workflows/exact.yml`) builds the Exact app for the iOS Simulator and captures each
   screen on iPhone and iPad, light and dark, and the largest text size,
   with `scripts/agent.mjs ios … screenshot`. It posts to the PR through
   the same comment workflow the Android job uses today. It also runs the
   app's `app.test.contract` tests.
2. **Android, once Android work starts:** the existing emulator job builds
   Exact's Android app and captures it with `agent android`.
3. **Web, once the core runs on Wasm:** the fastest loop, with no macOS
   runner needed.

The existing Android screenshot workflow keeps covering the Expo app until
it is retired.

## Principles for every slice

- One screen (or one piece of plumbing) per pull request, each with
  reviewed iOS screenshots (iPhone, iPad, light, dark, largest text) and
  `app.test.contract` tests for what the screen does.
- Phone, tablet and landscape layouts; VoiceOver labels, headings and focus
  order; hardware keyboard where it exists today.
- No core read on the UI thread. The core is reached only through the
  worker-placed data source.
- Platform controls first; Berean's themes come in through CSS custom
  properties and `light-dark()`, not hand-drawn controls.
- Merging waits for Owen's yes in the slice's thread.
- The Expo app keeps shipping and gets only fixes for real breakage until
  the switch.

## Test build findings

Slice 1 (`apps/berean`, PR #118), Nov 11, 2026, at Exact `db72e04f`. The
iOS results are from the `exact` workflow on the iOS 27.2 Simulator
(iPhone 17 Pro and iPad Pro 11-inch), reading John 3 from the real Study
Bible (`nwtsty_E.jwpub`) through `berean-core`.

**Verdict: go.** The Bible chapter draws the way Berean needs.

| Question | Answer |
| --- | --- |
| Per-verse taps | Work. Each verse number is an inline text run with `press=`; iOS delivers the tap as a native inline-text activation, with no overlay views. |
| Per-word and per-verse highlights | Work. A run takes its own `background-color`: a word (green) and a whole verse (yellow) in the same paragraph, and the tapped verse (blue), in light and dark. |
| Per-word taps | Not tried at scale. The mechanism is the same run with a `press`, so a word tap means a run per word (about 900 in John 3); slice 7 measures that before relying on it. |
| Margin markers | Still open. Exact documents no line positions for a run, so markers wait for slice 7, or sit at the start of a paragraph. |
| Text selection | Not checked yet; the chapter list sets `user-select="text"`. |
| Storage | The data crate opens the core itself from the directories Exact passes to `configure_storage`; no native module. Rust runs on a worker (`rust.mode` off), so iOS runs the core natively, not as Wasm. |
| Accessibility | Exact's `check both` on the iPhone finds nothing in light or dark: text fits, nothing covered, targets 44 points or more, contrast passes. Verse numbers read as "Verse N". VoiceOver itself wasn't driven. |
| Largest text | The Library and the chapter grow with Dynamic Type and nothing clips. The chapter's line spacing gets loose at the largest size, and the header title stays at its size. Both are styling for slice 7. |
| iPad | Works. On the 11-inch iPad Pro the chapter keeps a centered reading column of at most 42rem, and `check` finds nothing in light or dark. The Library's one row stretches across the screen, which the Library slice changes. |
| Builds | Exact's iOS host needs the iOS 27.1 SDK or later. GitHub's `macos-26` image stops at Xcode 26.6, so the job runs on the `xcode-27` image (a public preview) with Xcode 27.2. A cold build takes about 25 minutes and the whole job under an hour, most of the rest being two simulators' first launches. With Rust's cache warm the build takes about 15 minutes and the job about 50. |
| Linux | The same app builds and its Contract test passes on the headless Linux host in a cloud session, which is the fast loop for Contract changes. |

What the test build leaves for later slices: covers (slice 3), a download
screen (it reads `.jwpub` files dropped into `inbox/`), and the web build,
which needs the core on WebAssembly.

## Slices

### 0. This plan (docs only)

### 1. Spike: go or no-go

- Pin an Exact commit and add `apps/berean` (Exact refuses an app folder
  named `exact`) with a `berean-data` crate over `berean-core`, placed on a worker.
- Two real screens: Library (installed publications from the core) and
  one Bible chapter with tappable verse numbers, a highlighted verse and a
  highlighted word.
- Build for the iOS Simulator in CI and capture screenshots; build the
  Linux headless host in a cloud session to check the loop works there.
- Answer in this doc: per-word taps and highlight backgrounds in text,
  margin note positions, storage route (data crate or native module),
  VoiceOver and largest text, and how long builds take in CI.
- **If the Bible text can't be drawn the way Berean needs, stop here** and
  bring Owen the options before any more is built.

### 2. CI

- The iOS screenshot and Contract-test workflow, on `xcode-27`, with the
  Exact checkout and Rust, Bun and Hermes caches. Its screenshots post on
  the PR as their own comment (docs/screenshots.md).
- A Linux job that builds the data crate and runs the core's tests with it:
  `exact-linux.yml` runs the data crate's tests over the real core, with
  the Study Bible fixture installed through the inbox, and the Contract
  tests on Exact's headless Linux host.

### 3. Core: covers

- Read the catalog's image rows and expose a cover on the publication
  summary: a CDN address for catalog entries, the unpacked file for
  installed ones. Which tables and sizes is checked against the real
  catalog. Shared by both apps.
- One core change at a time, after #116 merges.

### 4. Shell, theme and Appearance

- Tabs (Read, Studyspace, Notes, Library, Search) with a stack each; iPad
  layout; Berean's four themes and accents as tokens; Appearance as the
  first settings screen.

### 5. Library

- Library, Catalog, Languages, What's New, Find and import, with covers,
  downloads through Exact's `fetch`, and per-row progress.

### 6. Today and publications

- Today, publication and article screens, and article Languages.

### 7. Read

- Bible chapter, book and chapter picker, highlights, bookmarks, the
  study pane, and the ports of map and timeline (#115) and word
  highlighting.

### 8. Notes

- Folders, tags, the list and the editor.

### 9. Studyspace

- The canvas, cards and reader cards. The queued canvas and Markdown work
  follows this slice.

### 10. Search

- Search screen, suggestions and the keyboard palette.

### 11. Ship and switch

- TestFlight and App Store packaging for the Exact iOS app.
- Owen decides when iOS users move to it. The Expo iOS build stops then.
- Android stays on the Expo app until Exact's Android can be packaged and
  passes the same screenshot review.

## Work in flight

- **Map and timeline (#115)** and **word highlighting** (core #116; its
  app part opens after #116 merges) finish on the Expo app and merge as
  they are. Users get them now, and the Expo app is what ships until the
  switch.
- Their core parts carry over unchanged: the atlas data (#112) and word
  tokens (#116) are in `berean-core`, which the Exact app links.
- Their screens are rebuilt in slice 7. #115's basemap is generated SVG
  (`apps/mobile/scripts/gen-basemap.ts`), which Exact draws natively.
- Slice 3 waits for #116 because both change the core's public types.

## Not in this plan

- The Swift apps in `apple/`, which stay paused.
- New features. Each slice keeps today's behavior.

## Decided

- **iOS first** (Owen, Nov 11, 2026). Android users stay on the Expo app
  until Exact's Android can be packaged for the Play Store.
