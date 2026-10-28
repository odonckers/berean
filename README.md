Berean

## Building

Layout:

```
core/            Rust workspace, platform-neutral
                   berean-core    library: catalog, library, jwpub, search, userdata
                   berean-ffi     thin UniFFI surface over berean-core
                   uniffi-bindgen tiny bin that generates the foreign-language bindings
apple/           Apple platform shell
                   Cupertino/     SwiftPM package (CupertinoCore + CupertinoUI)
                   Apps/          Berean-iOS and Berean-macOS app sources
                   project.yml    XcodeGen project spec
                   scripts/       build-xcframework.sh
```

The Rust core is platform-neutral and knows nothing about Apple. Other platform
shells (e.g. `android/` or `windows/`) will sit beside `apple/` later, each
binding to `core/` in its own way.

### Core

Requires Rust 1.95 or newer (`rust-version` in `core/Cargo.toml`); `core/rust-toolchain.toml` selects the stable toolchain with rustfmt and clippy.

```sh
cd core
cargo test --workspace
```

### Apple apps (on a Mac)

Requires Xcode 26 and [XcodeGen](https://github.com/yonaskolb/XcodeGen):

```sh
rustup target add aarch64-apple-ios aarch64-apple-ios-sim aarch64-apple-darwin x86_64-apple-darwin
brew install xcodegen

apple/scripts/build-xcframework.sh      # builds BereanCoreFFI.xcframework + Swift bindings
xcodegen generate --spec apple/project.yml
open apple/Berean.xcodeproj
```
