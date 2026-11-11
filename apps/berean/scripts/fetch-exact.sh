#!/usr/bin/env bash
# Clone Exact at the commit exact-version.txt pins into .sdk/exact, then
# install its script dependencies. Safe to rerun: it does nothing when the
# checkout is already at the pin.
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
commit="$(grep -v '^#' "$here/exact-version.txt" | tr -d '[:space:]')"
sdk="$here/.sdk/exact"

if [ -d "$sdk/.git" ] && [ "$(git -C "$sdk" rev-parse HEAD)" = "$commit" ]; then
  echo "Exact is at $commit"
else
  rm -rf "$sdk"
  mkdir -p "$sdk"
  git -C "$sdk" init -q
  git -C "$sdk" remote add origin https://github.com/expo/exact.git
  git -C "$sdk" fetch -q --depth 1 origin "$commit"
  git -C "$sdk" checkout -q FETCH_HEAD
  echo "Cloned Exact at $commit"
fi

(cd "$sdk" && bun install --frozen-lockfile)
