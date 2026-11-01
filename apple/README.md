# Apple apps

Two thin app shells — iOS and macOS — over the Rust core in `core/`.

## Layout

```
apple/
  Apps/
    iOS/            Berean-iOS: @main BereanApp
    Shared/         temporary scaffold, owned by the macOS work
  Cupertino/        SwiftPM package shared by both apps
    Sources/
      CupertinoCore/          thin Swift façade over the generated bindings
        Generated/            UniFFI output (not committed)
      CupertinoUI/            SwiftUI views shared by iOS and macOS
    Tests/CupertinoCoreTests/ Swift Testing tests for CupertinoCore
    BereanCoreFFI.xcframework the built Rust core (not committed)
  project.yml       XcodeGen spec (Berean-iOS, Berean-macOS)
  scripts/          build-xcframework.sh, test.sh
```

Each app target owns nothing but its `@main`; everything real lives in
`Cupertino`.

`Apps/Shared` and the `Berean-macOS` target belong to the macOS work. They are
temporary scaffold that only exists so the macOS target keeps building, and
the macOS branch replaces them — don't build on them from the iOS side. The
iOS app is `Apps/iOS` only.

## Requirements

Xcode 27 (iOS 27 SDK) on Apple silicon, rustup, and
[XcodeGen](https://github.com/yonaskolb/XcodeGen). We build with the Xcode 27
SDK but target iOS 26.0 / macOS 26.0.

```sh
rustup target add aarch64-apple-ios aarch64-apple-ios-sim aarch64-apple-darwin x86_64-apple-darwin
brew install xcodegen
```

## Build

```sh
# The Rust core as an XCFramework + its Swift bindings, into Cupertino/.
apple/scripts/build-xcframework.sh                     # all platforms
apple/scripts/build-xcframework.sh --platforms ios     # iOS device + simulator
apple/scripts/build-xcframework.sh --platforms macos   # universal macOS slice
apple/scripts/build-xcframework.sh --help

xcodegen generate --spec apple/project.yml
```

Only the chosen platforms' Rust targets are installed and built, and the
XCFramework holds exactly those slices — so a missing iOS target never blocks
a macOS-only build. Scratch files stay inside the repo (`apple/build/`, which
is gitignored) and are removed on exit.

Re-run both commands after changing the core's FFI surface or `project.yml`.
Then either `open apple/Berean.xcodeproj`, or from the repo root:

```sh
xcodebuild build -project apple/Berean.xcodeproj -scheme Berean-iOS \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath ./build/DerivedData CODE_SIGNING_ALLOWED=NO

xcodebuild build -project apple/Berean.xcodeproj -scheme Berean-macOS \
  -destination 'platform=macOS' \
  -derivedDataPath ./build/DerivedData CODE_SIGNING_ALLOWED=NO
```

`-derivedDataPath ./build/DerivedData` keeps build products in the repo's
gitignored `build/` instead of `~/Library/Developer/Xcode`.

## Tests

```sh
apple/scripts/test.sh        # same as: test.sh ios
```

The tests live in the `Cupertino` package, so they run from the package rather
than from an app scheme — XcodeGen can only put project targets in a scheme's
test action, and a SwiftPM test target is not one. `test.sh` picks an available
iPhone simulator on an iOS 26.x runtime and addresses it by UDID: a package
scheme resolves neither a missing `OS=` nor `OS=latest`, and a runtime's `OS=`
value isn't its marketing version (the iOS 26.0 runtime is 26.0.1). Set
`DESTINATION` to override the destination. Run `build-xcframework.sh` first —
the package links the XCFramework as a binary target, so there is nothing to
test until it exists.
