#!/usr/bin/env bash
# Capture the Exact app's screens on the iOS Simulator (CI: exact.yml).
#
#   scripts/capture-ios.sh <out> <phone udid> <tablet udid> <nwtsty_E.jwpub>
#
# For each simulator: install the app, put the Study Bible in the inbox of
# the agent's `ci` store (the data crate installs what it finds there on
# first open), then drive the Library, open the Bible in Read (John 3), tap
# verse 2 (not at the largest text size), open Settings › Appearance, and
# pick Sepia with its fourth accent, and save <out>/<screen>/<variant>.png
# (library, read, tapped, appearance, appearance-sepia): phone-light,
# phone-dark, phone-large-text, tablet-light, tablet-dark. Each drive puts
# Paper and the first accent back, since the store is kept between drives.
# `check both` lists clipped text, covered controls, small targets and low
# contrast in the log.
set -euo pipefail

out="$(mkdir -p "$1" && cd "$1" && pwd)"
phone="$2"
tablet="$3"
bible="$(cd "$(dirname "$4")" && pwd)/$(basename "$4")"
app="${APP_ID:-com.odonckers.berean.exact}"
cd "$(dirname "$0")/.."
mkdir -p "$out/library" "$out/read" "$out/tapped" "$out/appearance" "$out/appearance-sepia"

seed() {
  local udid="$1" container inbox
  container="$(xcrun simctl get_app_container "$udid" "$app" data)"
  inbox="$container/Library/Caches/exact/$app/agent/ci/data/inbox"
  mkdir -p "$inbox"
  cp "$bible" "$inbox/"
}

# One drive: the Library, the Bible in Read, then Settings › Appearance, in
# one scheme. The first open installs the Bible, so the chapter waits on data.
# A fourth argument of `notap` skips the verse tap: at the largest text size
# verse 2's number is below the fold.
drive() {
  local udid="$1" variant="$2" scheme="$3" tap=()
  if [ "${4:-}" != notap ]; then
    tap=("tap verse-2" "clock settle" "screenshot $out/tapped/$variant.png window" "tap verse-2")
  fi
  # A drive that never reaches the agent can wait forever; ten minutes is
  # several times a slow one. perl's alarm survives the exec.
  perl -e 'alarm shift; exec @ARGV' 600 \
  ./exact.mjs agent ios --sim "$udid" --storage ci --scale 2 \
    "prefer prefers-color-scheme $scheme" \
    "clock data" "clock settle" \
    "tap tab-library" "clock data" "clock settle" \
    "screenshot $out/library/$variant.png window" \
    tree \
    "tap pub-nwtsty" "clock data" "clock settle" \
    "screenshot $out/read/$variant.png window" \
    ${tap[@]+"${tap[@]}"} \
    "check both" \
    "tap tab-library" "clock settle" \
    "tap open-settings" "clock settle" \
    "tap settings-appearance" "clock settle" \
    "screenshot $out/appearance/$variant.png window" \
    "check both" \
    "tap theme-sepia" "tap accent-four" "clock settle" \
    "screenshot $out/appearance-sepia/$variant.png window" \
    "tap theme-paper" "tap accent-one" "clock settle" \
    "tap tab-library" "clock settle"
}

# A drive again, once, when the first fails, on a freshly restarted
# simulator. The app's first launch sometimes never opens the agent's
# socket (seen on the iPad's first drive and on the phone after a text size
# change), and relaunching onto the same simulator can hang the same way.
again() {
  local udid="$1"
  drive "$@" && return 0
  echo "-- restarting the simulator and trying $2 again"
  xcrun simctl shutdown "$udid" || true
  # A boot sent before the shutdown finishes finds the device still booted.
  for _ in $(seq 1 30); do
    xcrun simctl list devices | grep "$udid" | grep -q Shutdown && break
    sleep 2
  done
  xcrun simctl boot "$udid"
  xcrun simctl bootstatus "$udid" -b
  drive "$@"
}

# Every variant is tried even when one fails, so a failure still leaves the
# other screenshots to look at; the script fails at the end.
status=0
for device in phone tablet; do
  udid="${!device}"
  echo "== $device ($udid)"
  # Booted and ready before the install, so the first launch isn't racing
  # the simulator's own start-up.
  xcrun simctl bootstatus "$udid" -b
  ./exact.mjs ios --sim "$udid"
  seed "$udid"
  again "$udid" "$device-light" light || status=1
  again "$udid" "$device-dark" dark || status=1
done

echo "== phone, largest text"
before="$(xcrun simctl ui "$phone" content_size)"
xcrun simctl ui "$phone" content_size accessibility-extra-extra-extra-large
again "$phone" phone-large-text light notap || status=1
xcrun simctl ui "$phone" content_size "$before" || true
exit "$status"
