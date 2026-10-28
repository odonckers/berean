#!/usr/bin/env bash
# Download the pinned real-JWPUB test fixtures listed in fixtures.txt into
# core/fixtures/ (gitignored; never commit them). Cached files are kept only if
# their SHA-256 matches; every download is verified before it's moved in place.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
list="$script_dir/fixtures.txt"
dest="$script_dir/../fixtures"
mkdir -p "$dest"

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

while read -r sum name url; do
  [[ -z "${sum:-}" || "$sum" == \#* ]] && continue
  target="$dest/$name"
  if [[ -f "$target" && "$(sha256 "$target")" == "$sum" ]]; then
    echo "ok (cached): $name"
    continue
  fi
  tmp="$(mktemp "$dest/.$name.XXXXXX")"
  trap 'rm -f "$tmp"' EXIT
  echo "fetching: $name"
  curl -fsSL --retry 3 -o "$tmp" "$url"
  got="$(sha256 "$tmp")"
  if [[ "$got" != "$sum" ]]; then
    echo "error: sha256 mismatch for $name: expected $sum, got $got" >&2
    exit 1
  fi
  chmod 644 "$tmp"
  mv "$tmp" "$target"
  trap - EXIT
  echo "ok: $name"
done <"$list"
