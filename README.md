# Berean

[![core](https://github.com/odonckers/berean/actions/workflows/core.yml/badge.svg?branch=main)](https://github.com/odonckers/berean/actions/workflows/core.yml)
[![mobile](https://github.com/odonckers/berean/actions/workflows/mobile.yml/badge.svg?branch=main)](https://github.com/odonckers/berean/actions/workflows/mobile.yml)
[![License: MIT OR Apache-2.0](https://img.shields.io/badge/license-MIT%20OR%20Apache--2.0-blue.svg)](#license)

Berean is an open-source Bible study app. It starts from what JW Library does, reading the publication catalog and `.jwpub` files, and adds deeper study tools: Markdown notes, and a Studyspace with an infinite canvas for laying out research. It runs on Android and iOS (an Expo app) and natively on Apple platforms, all on a shared Rust core.

> **Independent project.** Berean is not affiliated with, endorsed by, or sponsored by Watch Tower Bible and Tract Society of Pennsylvania, the publisher of JW Library. The apps download publications from the publisher's official sources when a user asks for them; this repository doesn't include or redistribute publication content. JW Library is a trademark of its owner.

## Contributing

Contributions are welcome: bug reports, ideas, design feedback, docs and code. Start with [CONTRIBUTING.md](CONTRIBUTING.md), which covers setup, checks and pull requests. Please follow the [Code of Conduct](CODE_OF_CONDUCT.md), report security problems as [SECURITY.md](SECURITY.md) describes, and ask questions in [Discussions](https://github.com/odonckers/berean/discussions).

## Building

Layout:

```
core/            Rust workspace, platform-neutral
                   berean-core    library: catalog, library, jwpub, search, userdata
                   berean-ffi     thin UniFFI surface over berean-core
                   uniffi-bindgen tiny bin that generates the foreign-language bindings
apps/mobile/     Expo (React Native) app for Android and iOS
apple/           Apple platform shell
                   Cupertino/     SwiftPM package (CupertinoCore + CupertinoUI)
                   Apps/          Berean-iOS and Berean-macOS app sources
                   project.yml    XcodeGen project spec
                   scripts/       build-xcframework.sh
```

The Rust core is platform-neutral and knows nothing about any platform. Each
app binds to `core/` through `berean-ffi` in its own way: the Expo app through
the `berean-ffi-rn` module, the Apple apps through an XCFramework.

### Core

Requires Rust 1.95 or newer (`rust-version` in `core/Cargo.toml`); `core/rust-toolchain.toml` selects the stable toolchain with rustfmt and clippy.

```sh
cd core
scripts/fetch-fixtures.sh   # pinned real fixtures into core/fixtures/ (not committed)
cargo test --workspace
```

The tests use real JW files pinned by SHA-256 in `core/scripts/fixtures.txt`. Old snapshots may vanish from the CDN, so CI's fixtures cache is what keeps them. To re-pin one: download the new file, `sha256sum` it, update its line in `fixtures.txt`, and update the test expectations.

### Mobile app (Android and iOS)

See [`apps/mobile/README.md`](apps/mobile/README.md) and the setup steps in [CONTRIBUTING.md](CONTRIBUTING.md#mobile-app-expo).

### Apple apps (on a Mac)

Requires Xcode 26 and [XcodeGen](https://github.com/yonaskolb/XcodeGen):

```sh
rustup target add aarch64-apple-ios aarch64-apple-ios-sim aarch64-apple-darwin x86_64-apple-darwin
brew install xcodegen

apple/scripts/build-xcframework.sh      # builds BereanCoreFFI.xcframework + Swift bindings
xcodegen generate --spec apple/project.yml
open apple/Berean.xcodeproj
```

## License

Licensed under either of

- Apache License, Version 2.0 ([LICENSE-APACHE](LICENSE-APACHE) or https://www.apache.org/licenses/LICENSE-2.0)
- MIT license ([LICENSE-MIT](LICENSE-MIT) or https://opensource.org/licenses/MIT)

at your option. Unless you explicitly state otherwise, any contribution intentionally submitted for inclusion in the work by you, as defined in the Apache-2.0 license, shall be dual licensed as above, without any additional terms or conditions.

Bundled third-party assets keep their own licenses, such as the Literata font ([SIL Open Font License](apps/mobile/assets/fonts/Literata-OFL.txt)).
