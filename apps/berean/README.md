# Berean on Exact (test build)

The frontend rebuild on [Exact](https://github.com/expo/exact)
(docs/frontend-rebuild.md). This is slice 1, the test build: the Library of
installed publications and one Bible chapter with tappable verse numbers, a
highlighted verse and a highlighted word, answered by the same Rust core
(`core/berean-core`) the Expo app uses. iOS comes first; the Expo app in
`apps/mobile` stays the app people use until the rebuild ships.

| File | What it is |
| --- | --- |
| `app.contract` | The screens, in Exact's Contract language |
| `data/` | The Rust data crate: the Contract's sources, answered by the core, on a worker |
| `app.ts` | The TypeScript data module: empty on native, a "not yet" message on the web |
| `app.test.contract` | Tests, run on a host with `bun exact.mjs test <host>` |
| `apple/`, `linux/`, `web/` | Host crates Exact generated; the Apple and Linux ones link the data crate |
| `exact-version.txt` | The Exact commit the app builds with |
| `scripts/fetch-exact.sh` | Clones that commit into `.sdk/exact` (ignored by git) |
| `scripts/capture-ios.sh` | CI's iOS Simulator screenshots (`.github/workflows/exact.yml`) |

## Building

You need [Bun](https://bun.sh) 1.4.2, Rust (rustup reads `rust-toolchain.toml`)
and, for iOS, a Mac with Xcode 27.1.

```sh
cd apps/berean
scripts/fetch-exact.sh
bun .sdk/exact/scripts/exact.mjs setup --check   # names what a native build lacks
bun exact.mjs ios --run                          # iOS Simulator
bun exact.mjs linux                              # or the Linux host, which tests drive headless
bun exact.mjs test linux
```

Exact's Hermes bundle comes from its installer, once per pin:
`cargo run --manifest-path .sdk/exact/vendor/ibex/crates/hermes-lean-sys-installer/Cargo.toml -- --target <target>`.

The app has no download screen yet. To read a Bible, copy a `.jwpub` into
the app's data directory under `inbox/` (on a Mac or the simulator,
`~/Library/Application Support/exact/com.odonckers.berean.exact/data/inbox/`);
the data crate installs it on the next open. Never commit publication files.

Set `EXACT_FEEDBACK=0` to keep Exact from sending authoring notes to its team.

## Moving the Exact pin

Exact is pre-1.0 and changes daily. To move to a newer commit: change
`exact-version.txt`, run `scripts/fetch-exact.sh`, then `bun exact.mjs update`
(rewrites the Exact paths in the Cargo files) and `bun exact.mjs lock`, build,
and run the tests.
