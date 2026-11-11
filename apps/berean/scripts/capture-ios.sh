#!/usr/bin/env bash
# Capture the test build's screens on the iOS Simulator (CI: exact.yml).
#
#   scripts/capture-ios.sh <out> <phone udid> <tablet udid> <nwtsty_E.jwpub>
#
# For each simulator: install the app, put the Study Bible in the inbox of
# the agent's `ci` store (the data crate installs what it finds there on
# first open), then drive the Library and John 3 and save
# <out>/<screen>/<variant>.png: phone-light, phone-dark, phone-large-text,
# tablet-light, tablet-dark. `check both` lists clipped text, covered
# controls, small targets and low contrast in the log.
set -euo pipefail

out="$(mkdir -p "$1" && cd "$1" && pwd)"
phone="$2"
tablet="$3"
bible="$(cd "$(dirname "$4")" && pwd)/$(basename "$4")"
app="${APP_ID:-com.odonckers.berean.exact}"
cd "$(dirname "$0")/.."
mkdir -p "$out/library" "$out/read"

seed() {
  local udid="$1" container inbox
  container="$(xcrun simctl get_app_container "$udid" "$app" data)"
  inbox="$container/Library/Caches/exact/$app/agent/ci/data/inbox"
  mkdir -p "$inbox"
  cp "$bible" "$inbox/"
}

# One drive: Library, then the Bible, in one scheme. The first open
# installs the Bible, so the chapter waits on data.
drive() {
  local udid="$1" variant="$2" scheme="$3"
  ./exact.mjs agent ios --sim "$udid" --storage ci --scale 2 \
    "prefer prefers-color-scheme $scheme" \
    "clock data" "clock settle" \
    "screenshot $out/library/$variant.png window" \
    "tap pub-nwtsty_E" "clock data" "clock settle" \
    "screenshot $out/read/$variant.png window" \
    "tap verse-3" "clock settle" \
    "check both" \
    back "clock settle"
}

for device in phone tablet; do
  udid="${!device}"
  echo "== $device ($udid)"
  ./exact.mjs ios --sim "$udid"
  seed "$udid"
  drive "$udid" "$device-light" light
  drive "$udid" "$device-dark" dark
done

echo "== phone, largest text"
before="$(xcrun simctl ui "$phone" content_size)"
xcrun simctl ui "$phone" content_size accessibility-extra-extra-extra-large
drive "$phone" phone-large-text light || status=$?
xcrun simctl ui "$phone" content_size "$before" || true
exit "${status:-0}"
