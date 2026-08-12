#!/bin/zsh
set -euo pipefail

ROOT="${0:A:h:h}"
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

QIANTIE_ADDR=127.0.0.1:4019 \
QIANTIE_MYSQL_DSN='' \
QIANTIE_STORAGE_DRIVER=local \
QIANTIE_STORAGE_LOCAL_DIR="$TMPDIR/objects" \
"$ROOT/scripts/run-qiantie-backend.sh" --check-config 2>&1 | grep -F 'QIANTIE_MYSQL_DSN'
