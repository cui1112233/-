#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

case "$(uname -m)" in
  arm64|aarch64) ARCH=arm64 ;;
  x86_64|amd64) ARCH=amd64 ;;
  *) echo "unsupported build architecture: $(uname -m)" >&2; exit 1 ;;
esac

command -v go >/dev/null || { echo "Go is required to build the backend." >&2; exit 1; }
command -v npm >/dev/null || { echo "npm is required to build the frontend." >&2; exit 1; }

(
  cd "$ROOT"
  npm ci --omit=dev --prefer-offline
)
(
  cd "$ROOT/frontend"
  npm ci --prefer-offline
)

npm --prefix "$ROOT/frontend" run build

(
  cd "$ROOT/backend"
  if [[ "${QIANTIE_RUN_TESTS:-0}" == "1" ]]; then
    go test ./...
  fi
  GOOS=linux GOARCH="$ARCH" CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o "dist/qiantie-linux-$ARCH" ./cmd/qiantie
)

printf '%s\n' "$ARCH"
