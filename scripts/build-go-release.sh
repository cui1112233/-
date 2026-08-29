#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND="$ROOT/backend"
WEB_DIR="$BACKEND/web"
DIST_DIR="$ROOT/frontend/dist"
ARCH="${QIANTIE_ARCH:-amd64}"
OUT_DIR="${QIANTIE_RELEASE_DIR:-$ROOT/dist/releases}"
VERSION="${QIANTIE_VERSION:-$(git -C "$ROOT" rev-parse --short HEAD)}"

case "$ARCH" in amd64|arm64) ;; *) echo "unsupported QIANTIE_ARCH: $ARCH" >&2; exit 2 ;; esac
command -v go >/dev/null || { echo "Go is required" >&2; exit 1; }
command -v npm >/dev/null || { echo "npm is required" >&2; exit 1; }

npm --prefix "$ROOT/frontend" ci --prefer-offline
npm --prefix "$ROOT/frontend" run build

mkdir -p "$WEB_DIR"
rm -rf "$WEB_DIR/dist" "$WEB_DIR/prompts"
cp -R "$DIST_DIR" "$WEB_DIR/dist"
cp -R "$ROOT/prompts" "$WEB_DIR/prompts"

mkdir -p "$OUT_DIR"
binary="$OUT_DIR/qiantie-linux-$ARCH-$VERSION"
(
  cd "$BACKEND"
  if [[ "${QIANTIE_RUN_TESTS:-1}" == "1" ]]; then go test ./...; fi
  GOOS=linux GOARCH="$ARCH" CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o "$binary" ./cmd/qiantie
)
sha256sum "$binary" > "$binary.sha256"
printf '%s\n' "$binary"
