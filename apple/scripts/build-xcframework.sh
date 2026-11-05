#!/usr/bin/env bash
#
# Build the Berean Rust core as an XCFramework and generate its Swift bindings,
# dropping both into apple/Cupertino.
#
#   - compiles berean-ffi (release) for the chosen platforms:
#       ios   → aarch64-apple-ios + aarch64-apple-ios-sim (one slice each)
#       macos → aarch64-apple-darwin + x86_64-apple-darwin, lipo'd into one
#               universal slice
#   - generates the Swift bindings in UniFFI library mode;
#   - assembles BereanCoreFFI.xcframework from the chosen slices.
#
# Must run on macOS (it uses lipo + xcodebuild). Assumes rustup is installed.
set -euo pipefail

# --- resolve paths relative to this script ----------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APPLE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT_DIR="$(cd "$APPLE_DIR/.." && pwd)"

CORE_DIR="$ROOT_DIR/core"
CORE_MANIFEST="$CORE_DIR/Cargo.toml"
TARGET_DIR="$CORE_DIR/target"
CUPERTINO_DIR="$APPLE_DIR/Cupertino"
GENERATED_DIR="$CUPERTINO_DIR/Sources/CupertinoCore/Generated"
XCFRAMEWORK="$CUPERTINO_DIR/BereanCoreFFI.xcframework"

LIB_NAME="libberean_ffi"

IOS_TARGET="aarch64-apple-ios"
IOS_SIM_TARGET="aarch64-apple-ios-sim"
MACOS_ARM_TARGET="aarch64-apple-darwin"
MACOS_X86_TARGET="x86_64-apple-darwin"

usage() {
    cat <<'EOF'
Usage: build-xcframework.sh [--platforms macos|ios|all] [--help]

Builds the Berean Rust core for the chosen Apple platforms, generates the
Swift bindings, and assembles apple/Cupertino/BereanCoreFFI.xcframework from
exactly those slices.

Options:
  --platforms <macos|ios|all>  Which platforms to build (default: all).
                               ios   = aarch64-apple-ios, aarch64-apple-ios-sim
                               macos = aarch64-apple-darwin + x86_64-apple-darwin
                                       (lipo'd into one universal slice)
  --help                       Print this message.
EOF
}

# --- parse arguments ---------------------------------------------------------
PLATFORMS="all"
while [[ $# -gt 0 ]]; do
    case "$1" in
        --help | -h)
            usage
            exit 0
            ;;
        --platforms)
            if [[ $# -lt 2 ]]; then
                echo "error: --platforms needs a value (macos, ios or all)" >&2
                exit 2
            fi
            PLATFORMS="$2"
            shift 2
            ;;
        --platforms=*)
            PLATFORMS="${1#--platforms=}"
            shift
            ;;
        *)
            echo "error: unknown argument: $1" >&2
            echo >&2
            usage >&2
            exit 2
            ;;
    esac
done

case "$PLATFORMS" in
    macos | ios | all) ;;
    *)
        echo "error: --platforms must be macos, ios or all (got: $PLATFORMS)" >&2
        exit 2
        ;;
esac

BUILD_IOS=false
BUILD_MACOS=false
if [[ "$PLATFORMS" == "ios" || "$PLATFORMS" == "all" ]]; then BUILD_IOS=true; fi
if [[ "$PLATFORMS" == "macos" || "$PLATFORMS" == "all" ]]; then BUILD_MACOS=true; fi

if [[ "$(uname)" != "Darwin" ]]; then
    echo "error: this script builds Apple targets and must run on macOS" >&2
    exit 1
fi

# --- the Rust targets this run needs -----------------------------------------
# Only the chosen platforms' targets are installed and built, so a missing iOS
# target can never block a macOS-only build.
TARGETS=()
if $BUILD_IOS; then TARGETS+=("$IOS_TARGET" "$IOS_SIM_TARGET"); fi
if $BUILD_MACOS; then TARGETS+=("$MACOS_ARM_TARGET" "$MACOS_X86_TARGET"); fi

# UniFFI library mode reads the metadata out of a built library. Any target's
# library carries the same metadata, but reading a host (macOS arm64) library
# is the well-trodden path, so: use the macOS arm64 build when this run already
# produced one, and otherwise add that one host target purely for bindgen.
BINDGEN_TARGET="$MACOS_ARM_TARGET"
if ! $BUILD_MACOS; then
    TARGETS+=("$BINDGEN_TARGET")
fi

installed_targets="$(rustup target list --installed)"
for target in "${TARGETS[@]}"; do
    if ! grep -qx "$target" <<<"$installed_targets"; then
        echo "Installing missing Rust target: $target"
        rustup target add "$target"
    fi
done

# --- build the library for each target ---------------------------------------
# The deployment targets must match apple/project.yml: without them the C code
# the core vendors (sqlite3, built by the cc crate) is compiled against the
# whole SDK version, and the app then links objects built for a newer OS than
# it targets.
IOS_DEPLOYMENT_TARGET="26.0"
MACOS_DEPLOYMENT_TARGET="26.0"

for target in "${TARGETS[@]}"; do
    echo "Building berean-ffi for $target"
    case "$target" in
        *-apple-ios*) deployment=(IPHONEOS_DEPLOYMENT_TARGET="$IOS_DEPLOYMENT_TARGET") ;;
        *-apple-darwin) deployment=(MACOSX_DEPLOYMENT_TARGET="$MACOS_DEPLOYMENT_TARGET") ;;
    esac
    env "${deployment[@]}" \
        cargo build --release --manifest-path "$CORE_MANIFEST" -p berean-ffi --target "$target"
done

# --- scratch workspace -------------------------------------------------------
# Kept inside the repo (apple/build/ is gitignored) rather than /tmp.
BUILD_DIR="$APPLE_DIR/build/xcframework"
rm -rf "$BUILD_DIR"
trap 'rm -rf "$BUILD_DIR"' EXIT
mkdir -p "$BUILD_DIR/macos" "$BUILD_DIR/headers" "$BUILD_DIR/bindgen"

# --- generate the Swift bindings (library mode) ------------------------------
# uniffi-bindgen's library mode shells out to `cargo metadata`, which reads the
# manifest of the *current directory* — so it must run from core/, not from
# wherever the caller happens to be.
(
    cd "$CORE_DIR"
    cargo run --bin uniffi-bindgen -- \
        generate \
        --library "$TARGET_DIR/$BINDGEN_TARGET/release/$LIB_NAME.dylib" \
        --language swift \
        --out-dir "$BUILD_DIR/bindgen"
)

# The generated Swift source goes into the CupertinoCore target.
mkdir -p "$GENERATED_DIR"
cp "$BUILD_DIR/bindgen/berean_ffi.swift" "$GENERATED_DIR/berean_ffi.swift"

# The C header + modulemap go into the framework. UniFFI names the modulemap
# after the FFI module (berean_ffiFFI), which is exactly what the generated
# Swift imports; xcodebuild just needs it called `module.modulemap`.
cp "$BUILD_DIR/bindgen/berean_ffiFFI.h" "$BUILD_DIR/headers/"
cp "$BUILD_DIR/bindgen/berean_ffiFFI.modulemap" "$BUILD_DIR/headers/module.modulemap"

# --- assemble the XCFramework ------------------------------------------------
CREATE_ARGS=()
if $BUILD_IOS; then
    CREATE_ARGS+=(-library "$TARGET_DIR/$IOS_TARGET/release/$LIB_NAME.a" -headers "$BUILD_DIR/headers")
    CREATE_ARGS+=(-library "$TARGET_DIR/$IOS_SIM_TARGET/release/$LIB_NAME.a" -headers "$BUILD_DIR/headers")
fi
if $BUILD_MACOS; then
    # lipo the two macOS slices into one universal static library.
    lipo -create \
        "$TARGET_DIR/$MACOS_ARM_TARGET/release/$LIB_NAME.a" \
        "$TARGET_DIR/$MACOS_X86_TARGET/release/$LIB_NAME.a" \
        -output "$BUILD_DIR/macos/$LIB_NAME.a"
    CREATE_ARGS+=(-library "$BUILD_DIR/macos/$LIB_NAME.a" -headers "$BUILD_DIR/headers")
fi

rm -rf "$XCFRAMEWORK"
xcodebuild -create-xcframework "${CREATE_ARGS[@]}" -output "$XCFRAMEWORK"

echo "Built $XCFRAMEWORK (platforms: $PLATFORMS)"
echo "Generated $GENERATED_DIR/berean_ffi.swift"
