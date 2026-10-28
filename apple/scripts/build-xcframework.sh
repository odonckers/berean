#!/usr/bin/env bash
#
# Build the Berean Rust core as an XCFramework and generate its Swift bindings,
# dropping both into apple/Cupertino.
#
#   - compiles berean-ffi (release) for iOS device, iOS simulator, and macOS
#     (x86_64 + arm64, lipo'd into one universal slice);
#   - generates the Swift bindings in UniFFI library mode;
#   - assembles BereanCoreFFI.xcframework from the three static-library slices.
#
# Must run on macOS (it uses lipo + xcodebuild). Assumes rustup is installed.
set -euo pipefail

# --- resolve paths relative to this script ----------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APPLE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT_DIR="$(cd "$APPLE_DIR/.." && pwd)"

CORE_MANIFEST="$ROOT_DIR/core/Cargo.toml"
TARGET_DIR="$ROOT_DIR/core/target"
CUPERTINO_DIR="$APPLE_DIR/Cupertino"
GENERATED_DIR="$CUPERTINO_DIR/Sources/CupertinoCore/Generated"
XCFRAMEWORK="$CUPERTINO_DIR/BereanCoreFFI.xcframework"

LIB_NAME="libberean_ffi"

if [[ "$(uname)" != "Darwin" ]]; then
    echo "error: this script builds Apple targets and must run on macOS" >&2
    exit 1
fi

# --- ensure the Rust targets are installed -----------------------------------
IOS_TARGET="aarch64-apple-ios"
IOS_SIM_TARGET="aarch64-apple-ios-sim"
MACOS_ARM_TARGET="aarch64-apple-darwin"
MACOS_X86_TARGET="x86_64-apple-darwin"
ALL_TARGETS=("$IOS_TARGET" "$IOS_SIM_TARGET" "$MACOS_ARM_TARGET" "$MACOS_X86_TARGET")

installed_targets="$(rustup target list --installed)"
for target in "${ALL_TARGETS[@]}"; do
    if ! grep -qx "$target" <<<"$installed_targets"; then
        echo "Installing missing Rust target: $target"
        rustup target add "$target"
    fi
done

# --- build the static library for each target --------------------------------
for target in "${ALL_TARGETS[@]}"; do
    echo "Building berean-ffi for $target"
    cargo build --release --manifest-path "$CORE_MANIFEST" -p berean-ffi --target "$target"
done

# --- scratch workspace -------------------------------------------------------
BUILD_DIR="$(mktemp -d)"
trap 'rm -rf "$BUILD_DIR"' EXIT
mkdir -p "$BUILD_DIR/macos" "$BUILD_DIR/headers" "$BUILD_DIR/bindgen"

# lipo the two macOS slices into one universal static library.
lipo -create \
    "$TARGET_DIR/$MACOS_ARM_TARGET/release/$LIB_NAME.a" \
    "$TARGET_DIR/$MACOS_X86_TARGET/release/$LIB_NAME.a" \
    -output "$BUILD_DIR/macos/$LIB_NAME.a"

# --- generate the Swift bindings (library mode) ------------------------------
# Read metadata from the macOS cdylib; the bindings are the same for every
# target, so any one built library works.
cargo run --manifest-path "$CORE_MANIFEST" --bin uniffi-bindgen -- \
    generate \
    --library "$TARGET_DIR/$MACOS_ARM_TARGET/release/$LIB_NAME.dylib" \
    --language swift \
    --out-dir "$BUILD_DIR/bindgen"

# The generated Swift source goes into the CupertinoCore target.
mkdir -p "$GENERATED_DIR"
cp "$BUILD_DIR/bindgen/berean_ffi.swift" "$GENERATED_DIR/berean_ffi.swift"

# The C header + modulemap go into the framework. UniFFI names the modulemap
# after the FFI module (berean_ffiFFI), which is exactly what the generated
# Swift imports; xcodebuild just needs it called `module.modulemap`.
cp "$BUILD_DIR/bindgen/berean_ffiFFI.h" "$BUILD_DIR/headers/"
cp "$BUILD_DIR/bindgen/berean_ffiFFI.modulemap" "$BUILD_DIR/headers/module.modulemap"

# --- assemble the XCFramework ------------------------------------------------
rm -rf "$XCFRAMEWORK"
xcodebuild -create-xcframework \
    -library "$TARGET_DIR/$IOS_TARGET/release/$LIB_NAME.a" -headers "$BUILD_DIR/headers" \
    -library "$TARGET_DIR/$IOS_SIM_TARGET/release/$LIB_NAME.a" -headers "$BUILD_DIR/headers" \
    -library "$BUILD_DIR/macos/$LIB_NAME.a" -headers "$BUILD_DIR/headers" \
    -output "$XCFRAMEWORK"

echo "Built $XCFRAMEWORK"
echo "Generated $GENERATED_DIR/berean_ffi.swift"
