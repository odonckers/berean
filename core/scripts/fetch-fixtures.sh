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

# When a publication's pinned file is gone (jw.org replaces a .jwpub when it
# publishes a new version), print the current one to pin in fixtures.txt.
report_current() {
  local name="$1" stem pub lang issue api current got
  [[ "$name" == *.jwpub ]] || return 0
  stem="${name%.jwpub}"
  IFS=_ read -r pub lang issue <<<"$stem"
  api="https://b.jw-cdn.org/apis/pub-media/GETPUBMEDIALINKS?output=json&fileformat=JWPUB&pub=$pub&langwritten=$lang"
  [[ -n "${issue:-}" ]] && api="$api&issue=$issue"
  current="$(curl -fsSL --retry 3 "$api" | jq -r --arg l "$lang" '.files[$l].JWPUB[0].file.url // empty')"
  if [[ -z "$current" ]]; then
    echo "the catalog lists no current $name either"
    return 0
  fi
  echo "the catalog's current $name: $current"
  local tmp_current
  tmp_current="$(mktemp)"
  if curl -fsSL --retry 3 -o "$tmp_current" "$current"; then
    got="$(sha256 "$tmp_current")"
    echo "to pin it, put this line in fixtures.txt (and check the tests that use it):"
    echo "$got  $name  $current"
  else
    echo "that URL can't be downloaded either"
  fi
  rm -f "$tmp_current"
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
  if ! curl -fsSL --retry 3 -o "$tmp" "$url"; then
    echo "error: couldn't download $name from its pinned URL" >&2
    report_current "$name" >&2 || true
    exit 1
  fi
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
