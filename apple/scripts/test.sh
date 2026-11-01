#!/usr/bin/env bash
#
# Run the Cupertino package's tests (ios), or build the Mac app and run its
# tests (mac).
#
#   apple/scripts/test.sh [ios|mac]
#
# mac builds the core's macOS slice, generates the Xcode project, builds
# Berean-macOS and runs BereanTests-macOS, with DerivedData in apple/build/.
#
# The tests live in the Cupertino SwiftPM package rather than in an app
# scheme's test action (XcodeGen can only put project targets there), so they
# run against the package's own Cupertino-Package scheme.
#
# Set DESTINATION to override the xcodebuild destination entirely.
set -euo pipefail

# --- resolve paths relative to this script ----------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APPLE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT_DIR="$(cd "$APPLE_DIR/.." && pwd)"

CUPERTINO_DIR="$APPLE_DIR/Cupertino"
XCFRAMEWORK="$CUPERTINO_DIR/BereanCoreFFI.xcframework"

PLATFORM="${1:-ios}"

if [[ "$PLATFORM" == "mac" ]]; then
    cd "$ROOT_DIR"
    "$SCRIPT_DIR/build-xcframework.sh" --platforms macos
    xcodegen generate --spec apple/project.yml
    mac_args=(
        -project apple/Berean.xcodeproj
        -scheme Berean-macOS
        -destination "${DESTINATION:-platform=macOS}"
        -derivedDataPath apple/build/DerivedData
        -clonedSourcePackagesDirPath apple/build/SourcePackages
    )
    echo "Building Berean-macOS"
    xcodebuild build "${mac_args[@]}"
    echo "Testing BereanTests-macOS"
    xcodebuild test "${mac_args[@]}"
    exit 0
fi

# The package links the core as a binary target, so there is nothing to test
# until the XCFramework exists.
if [[ ! -d "$XCFRAMEWORK" ]]; then
    echo "error: $XCFRAMEWORK is missing — run apple/scripts/build-xcframework.sh first" >&2
    exit 1
fi

# An available iPhone simulator on an iOS 26.x runtime, as `id=<udid>`. The
# runtime's marketing version does not always match its `OS=` value (the
# iOS 26.0 runtime reports 26.0.1), and neither omitting `OS=` nor `OS=latest`
# resolves for a package scheme — so address the device by UDID instead.
ios_simulator_destination() {
    xcrun simctl list devices available -j | /usr/bin/python3 -c '
import json, sys

devices = json.load(sys.stdin)["devices"]
prefix = "com.apple.CoreSimulator.SimRuntime.iOS-26-"
for runtime in sorted(devices, reverse=True):
    if not runtime.startswith(prefix):
        continue
    for device in devices[runtime]:
        if device["name"].startswith("iPhone"):
            print("platform=iOS Simulator,id=" + device["udid"])
            sys.exit(0)
sys.exit("error: no available iPhone simulator with an iOS 26.x runtime")
'
}

case "$PLATFORM" in
    ios)
        destination="${DESTINATION:-$(ios_simulator_destination)}"
        ;;
    *)
        echo "error: unknown platform: $PLATFORM (expected: ios or mac)" >&2
        exit 2
        ;;
esac

echo "Testing Cupertino-Package on $destination"
cd "$ROOT_DIR"
xcodebuild test \
    -workspace apple/Cupertino \
    -scheme Cupertino-Package \
    -destination "$destination" \
    -derivedDataPath build/DerivedData-pkg
