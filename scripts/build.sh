#!/bin/sh
# Build Berean for linux/amd64 and darwin/arm64. CGO stays off.
# The Mac app is not signed and not notarized. VERSION is git describe,
# or the tag passed in, and is linked into internal/read.Version.
set -eu
cd "$(dirname "$0")/.."
version=${VERSION:-}
if [ -z "$version" ]; then
  version=$(git describe --tags --always --dirty 2>/dev/null || echo dev)
fi
export CGO_ENABLED=0
export MYGO_LDFLAGS="-X github.com/odonckers/berean/internal/read.Version=${version}"
go tool mygo build -platform linux/amd64,darwin/arm64 -skip-dmg -skip-notarize
(
  cd build/darwin-arm64
  zip -r -y "../Berean-${version}-darwin-arm64.zip" Berean.app
)
(
  cd build/linux-amd64
  zip "../berean-${version}-linux-amd64.zip" berean
)
