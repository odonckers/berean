# Mobile bindings: berean-ffi in the Expo app

**Status:** Decided. Owen approved the decisions in §7 (relayed by Wren and Echo). The app wires in the core once the items in §8 land.
**Platforms:** Android and iOS, through an Expo dev build (React Native New Architecture).
**Owner:** Mobile (Otter). Echo owns the core and reviews this note.

## 1. Goal and scope

The Expo app in `apps/mobile` reads publications, the catalog, and the library through the same Rust core as the Apple apps. It reaches that core through [uniffi-bindgen-react-native][ubrn] (ubrn).

### Principles

1. **One UniFFI surface.** `core/berean-ffi` is the only crate that exports to foreign code. There is no React Native crate and no second FFI crate.
2. **No core logic in JS.** Parsing, the catalog, the library, the reader, and the user DB stay in Rust. The app's TypeScript does UI, navigation, and networking only.
3. **The core stays platform-free.** `berean-core` gets no React Native or Expo types, `cfg`s, names, or paths. As on Apple, the shell does its own networking and hands files to the core (`download_request` → fetch → `plan_download` → download → `install`).
4. **Generated code is not committed.** This matches the Apple shell, where the Swift bindings and the xcframework are gitignored.

### In scope

The berean-ffi surface as it stands at the top of the core stack (#12 → #14–#19): `Core`, `Library`, `Catalog`, `Reader`, `CancelToken`, `ProgressSink`, and their records (§3).

### Out of scope

- **Search** (#19) and the **Research Guide** (#18). Both are Rust-only until Owen approves their FFI record shapes. The app picks them up once they're exported, with no binding work beyond regeneration.
- **Userdata** (#20). It's still a design.
- Any UI. This note covers only the binding layer and the build.

> The README puts future shells beside `apple/` (for example `android/`). This note follows the board's `apps/mobile` path. If Owen prefers a top-level `mobile/`, only paths change.

## 2. Integration: two ubrn flavours

ubrn offers two ways to load Rust into React Native.

| | **`jsi`**: local TurboModule package | **`jsi2`**: `@ubjs/react-native` player |
| --- | --- | --- |
| Shape | A library made with `create-react-native-library` (builder-bob, "Turbo module", "C++ for Android & iOS"). ubrn generates TypeScript plus JSI C++ and the Android/iOS installer glue, and links the Rust as a static or shared library ([getting started][ubrn-start]). | The app installs `@ubjs/react-native` once as a direct dependency. Our library ships only TypeScript, one `.so` per Android ABI, and an iOS dynamic framework. Calls go through a prebuilt libffi/`dlopen` player ([jsi2 reference][ubrn-jsi2]). |
| Native code we own | Generated C++, CMake, a podspec, and Codegen spec files | None |
| Crate requirement | `staticlib` or `cdylib` | `cdylib` (berean-ffi already builds one) |
| Default ABIs | arm64-v8a, armeabi-v7a, x86, x86_64 ([config-yaml][ubrn-config]) | arm64-v8a, x86_64 |
| Maturity | The documented path. Used in shipping apps. Expo 54 and RN 0.80+ fixed in [#295][ubrn-295]. Expo monorepo notes in [#195][ubrn-195]. | New in [0.31.0-6][ubrn-rel] (Sep 2026). The release notes say it reached fixture parity, and that "distribution packaging and the `gen_cpp` cutover are separate later plans". |
| Expo fit | A local package in the workspace, autolinked on `expo prebuild` | One autolinked npm module. Our package carries prebuilt binaries |

**Choice: `jsi`, the local TurboModule package**, at `apps/mobile/modules/berean-ffi-rn`. Expo autolinks it into the dev build on `expo prebuild`. Reasons:

- It's the path ubrn documents end to end. It also has Expo field reports and fixes behind it.
- `jsi2` is one release old, and its packaging story is explicitly unfinished.
- Both flavours read the same berean-ffi metadata. Switching to `jsi2` later changes only the module package, not the core or the app's TypeScript.

Revisit `jsi2` when its packaging lands. Its "no native code of our own" model fits Expo better in the long run.

Expo Go can't load native modules, so the app always runs as a [development build][expo-dev-build].

### Generated code

- `ubrn.config.yaml` points at the core in place (`rust.directory: ../../../../core`, `manifestPath: berean-ffi/Cargo.toml`). There is no `ubrn checkout` and no copy of the core.
- **Gitignored:** the generated TypeScript (`src/generated/`), the generated C++ (`cpp/generated/`), the Rust build output, and the xcframework/jniLibs.
- **Generated in CI:** a job builds berean-ffi and runs `ubrn build android|ios --and-generate` against it.
- **Checked-in glue:** some files may have to be committed, such as the TurboModule installer or Codegen spec, since builder-bob expects them. In that case a CI step regenerates them and fails on `git diff --exit-code`, so they can't drift from the core.

## 3. Surface the app sees

Every method throws `CoreError` on failure. All of them are synchronous except `ingestFile` and `install`, which return `Promise`s once the async FFI change lands (§7.2).

| Object | Methods |
| --- | --- |
| `Core` | `Core.open(dataDir, cacheDir)` (constructor), `dbVersion()`, `library()`, `catalog()`, `reader()` |
| `Library` | `install(pubKey, filePath, progress, cancel)` → `Promise<void>`, `installed()`, `remove(pubKey)`, `downloadRequest(pubKey)` → `HttpRequest`, `planDownload(pubKey, response: ArrayBuffer)` → `DownloadPlan` |
| `Catalog` | `ingestFile(path, progress, cancel)` → `Promise<void>`, `publications(filter)`, `languages()` |
| `Reader` | `toc(pubKey)`, `document(pubKey, docId)`, `bibleChapter(bible, book, chapter)`, `resolve(reference)` → `LocationSpan` |
| `CancelToken` | `new CancelToken()`, `cancel()`, `isCancelled()` |
| `ProgressSink` | Foreign trait (`#[uniffi::export(with_foreign)]`). The app implements `onProgress(done: bigint, total: bigint)` ([callback interfaces][ubrn-callbacks]). |

Free functions: `coreVersion()` and `userDbSchema()`.

**Records:** `PublicationSummary`, `DownloadPlan`, `HttpRequest`, `CatalogFilter`, `Language`, `TocEntry`, `ParagraphAnchor`, `Document`, `VerseAnchor`, `BibleChapter`, `Location`, `LocationSpan`.
**Enums:** `PubKind` (Bible, Book, Brochure, Watchtower, Awake, Index, MeetingWorkbook, Other) and `CoreError` (NotFound, Corrupt, Io, Cancelled, Migration, Invalid).

## 4. Type mapping

From ubrn's [common types][ubrn-types] and [errors][ubrn-errors]:

| Rust (berean-ffi) | TypeScript | Where it shows up |
| --- | --- | --- |
| `u32`, `i32` | `number` | `book`, `chapter`, `verse`, `paragraph`, `meps_language`, `year`, `depth` |
| `u64`, `i64` | `bigint` | `DownloadPlan.size`, `doc_id`, `on_progress(done, total)` |
| `String` | `string` | |
| `Vec<u8>` | `ArrayBuffer` | `plan_download(response)`: pass `await res.arrayBuffer()` |
| `Option<T>` | `T \| undefined` | `CatalogFilter` fields, `Location` fields, `TocEntry.doc_id` |
| `Vec<T>` | `Array<T>` | |
| `uniffi::Record` | plain object type (`type Location = {…}`) | all records |
| `uniffi::Object` | class with methods | `Core`, `Library`, `Catalog`, `Reader`, `CancelToken` |
| flat `uniffi::Enum` | TS `enum` | `PubKind` |
| `uniffi::Error` enum | `Error` subclass per variant, plus `CoreError_Tags` | `CoreError` |
| `with_foreign` trait | TS interface the app implements | `ProgressSink` |

Because of a Babel limitation, the app matches errors with `CoreError.instanceOf(e)`, `CoreError.Cancelled.instanceOf(e)`, or a `switch` on `e.tag`, never with `instanceof` ([errors][ubrn-errors]).

## 5. Threading

- **Sync exports run on the JS thread.** ubrn doesn't move work off it. "Dispatching to a background thread is an exercise for the developer on the Rust side" ([threading][ubrn-threading]).
- **`forceAsync` moves no work off the main thread.** It only changes the TypeScript signature ([uniffi.toml][ubrn-toml]).
- **Real off-main-thread support is only a proposal** ([#412][ubrn-412]).
- **`async fn` exports become `Promise`s** ([promises][ubrn-promises]). ubrn recommends library-level cancellation over future cancellation, which matches our `CancelToken`.
- **Callbacks from a background thread block that thread.** A `ProgressSink` call from a Rust thread goes through `UniffiCallInvoker::invokeBlocking`, which posts to the JS thread and waits for it to finish ([source][ubrn-invoker]). If Rust holds a lock while it waits, and JS calls back into Rust for that same lock, both threads deadlock ([#243][ubrn-243], [#157][ubrn-157]).

Short calls (`toc`, `document`, `bible_chapter`, `resolve`, `installed`, `publications`) stay synchronous. The two long calls become async at the FFI (§7.2), so they never block the JS thread.

## 6. Build

| | Android | iOS |
| --- | --- | --- |
| Rust targets | `aarch64-linux-android` (arm64-v8a, devices) and `x86_64-linux-android` (emulator) | `aarch64-apple-ios` and `aarch64-apple-ios-sim` |
| Tooling | `cargo-ndk` with the NDK. ubrn passes `apiLevel` as `--platform` ([config-yaml][ubrn-config]) | `ubrn build ios` makes an xcframework. Xcode only, so no Linux build |
| Where | The shared Linux box (NDK r30, JDK 17, and the SDK command-line tools are under `/home/box/android`). An emulator AVD still needs a system image | [EAS Build][eas-build] on the **free plan only** ([pricing][expo-pricing]). Nothing paid. Rust isn't on the EAS image, so an `eas-build-pre-install` hook installs rustup and the two targets |
| Note | rusqlite `bundled` compiles SQLite's C with the NDK's clang. `cargo-ndk` sets `CC`/`AR` per target, so the NDK must be installed, not only the SDK | Owen's Mac (the self-hosted runner) stays an option for local iOS builds, but this note doesn't depend on it |

- Android limits ubrn to the two 64-bit targets (`android.targets: [arm64-v8a, x86_64]`). That keeps the edit-compile-run loop short.
- A mobile CI workflow is separate from `apps.yml`, which runs only on the Mac. It would build Android and regenerate the bindings on `ubuntu-latest`.

### Android build check (Echo's verification)

Echo built berean-ffi for Android on the shared Linux box from `echo/core-search` at `ce8d1a6`, with no repo changes:

- **Toolchain:** rustc 1.99.1, cargo-ndk 4.1.2, and NDK r30 (clang 21) at `~/android/android-ndk-r30` (`ANDROID_NDK_HOME`).
- **Command:** `cargo ndk -t arm64-v8a -t x86_64 build -p berean-ffi --release`, about 56 s from clean.
- **Output:** the `.so` is 3.6 MiB for arm64-v8a and 3.5 MiB for x86_64. The `.a` is about 32 MiB for each.
- **Bundled SQLite:** builds with NDK clang, FTS5 included.
- **Exports and linking:** each `.so` has 59 `uniffi_berean_ffi` symbols. It depends only on libc, libm, and libdl, with no `libc++_shared`.
- **Alignment:** load segments are 16 KB aligned, which meets Google Play's requirement.
- **Metadata:** Kotlin bindings generated in library mode from the arm64 `.so` contain every type. This proves bindgen can read the metadata from Android builds.

**Action item:** pass `-P <minSdk>` to cargo-ndk (ubrn's `android.apiLevel`) to match the Expo app's minSdk. It defaulted to 21.

iOS targets are unverified. They go through EAS.

## 7. Decisions

### 7.1 UniFFI version: the whole workspace moves to 0.31 (owner: Echo)

- The repo pins `uniffi = "0.32"` (0.32.2 in `Cargo.lock`).
- The latest ubrn release, [0.31.0-6][ubrn-rel], pins `uniffi = "=0.31"`, and so does ubrn `main`.
- Two PRs move ubrn to 0.32 and are still open: [#468][ubrn-468] and [#409][ubrn-409].

**Decision:** the whole core workspace moves to uniffi 0.31, so mobile uses the released ubrn 0.31.x. This depends on Echo's scratch-branch trial coming back clean. If it doesn't, the workspace stays on 0.32 and mobile waits for a ubrn release that includes #468. Either way there are no forks, no vendoring, and no split pin: Swift and TypeScript always bind the same uniffi version.

### 7.2 Long calls are async at the FFI (owner: Echo)

**Decision:** `Catalog::ingest_file` and `Library::install` become **async-only at the FFI** on every platform. They're `Promise`s in TypeScript and `async` in Swift.

- They keep the `(…, progress, cancel)` argument order, and `CancelToken` stays the cancellation channel. That matches ubrn's advice to cancel through the library, not the future ([promises][ubrn-promises]).
- `berean-core` stays synchronous.
- Inside `berean-ffi`, each call runs the existing synchronous body on a dedicated thread behind a small hand-written future. No new crates and no async runtime.

### 7.3 No core lock held during `on_progress` (owner: Echo)

**Rule:** `ProgressSink::on_progress` never fires while a core lock is held (the DB connection or the publication cache). This prevents the `invokeBlocking` deadlock in §5.

- Echo confirms `Library::install` and `Catalog::ingest_file` already follow the rule.
- The search index builder (#19) reports progress while holding a lock. It's Rust-only today. **Fixing it is a precondition for search crossing the FFI.**

### 7.4 `bigint` for `u64`/`i64` (owner: Otter)

**Decision:** accepted on the React Native side. The app takes `bigint` for `doc_id`, `DownloadPlan.size`, and progress counts, and converts to `number` only for display. No core change.

## 8. Status / pending

These must land before the app wires in the core:

| Item | Owner | State |
| --- | --- | --- |
| uniffi 0.31 trial on a scratch branch, then the workspace pin change (§7.1) | Echo | Pending |
| Async FFI for `ingest_file` and `install` (§7.2) | Echo | Pending |
| Search progress outside the lock (§7.3) | Echo | Pending; a precondition for search, not for the first wiring |

Until then, the app scaffold and the Android dev build proceed with no generated bindings.

[ubrn]: https://jhugman.github.io/uniffi-bindgen-react-native/
[ubrn-start]: https://jhugman.github.io/uniffi-bindgen-react-native/guides/rn/getting-started.html
[ubrn-jsi2]: https://jhugman.github.io/uniffi-bindgen-react-native/reference/jsi2.html
[ubrn-config]: https://jhugman.github.io/uniffi-bindgen-react-native/reference/config-yaml.html
[ubrn-toml]: https://jhugman.github.io/uniffi-bindgen-react-native/reference/uniffi-toml.html
[ubrn-types]: https://jhugman.github.io/uniffi-bindgen-react-native/idioms/common-types.html
[ubrn-errors]: https://jhugman.github.io/uniffi-bindgen-react-native/idioms/errors.html
[ubrn-callbacks]: https://jhugman.github.io/uniffi-bindgen-react-native/idioms/callback-interfaces.html
[ubrn-promises]: https://jhugman.github.io/uniffi-bindgen-react-native/idioms/promises.html
[ubrn-threading]: https://jhugman.github.io/uniffi-bindgen-react-native/idioms/threading.html
[ubrn-invoker]: https://github.com/jhugman/uniffi-bindgen-react-native/blob/main/cpp/includes/UniffiCallInvoker.h
[ubrn-rel]: https://github.com/jhugman/uniffi-bindgen-react-native/releases/tag/0.31.0-6
[ubrn-468]: https://github.com/jhugman/uniffi-bindgen-react-native/pull/468
[ubrn-409]: https://github.com/jhugman/uniffi-bindgen-react-native/pull/409
[ubrn-412]: https://github.com/jhugman/uniffi-bindgen-react-native/issues/412
[ubrn-243]: https://github.com/jhugman/uniffi-bindgen-react-native/issues/243
[ubrn-157]: https://github.com/jhugman/uniffi-bindgen-react-native/issues/157
[ubrn-295]: https://github.com/jhugman/uniffi-bindgen-react-native/issues/295
[ubrn-195]: https://github.com/jhugman/uniffi-bindgen-react-native/issues/195
[expo-dev-build]: https://docs.expo.dev/develop/development-builds/introduction/
[eas-build]: https://docs.expo.dev/build/introduction/
[expo-pricing]: https://expo.dev/pricing
