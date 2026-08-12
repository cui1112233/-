#!/bin/zsh
set -euo pipefail

ROOT="${0:A:h:h}"
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

set +e
output="$(QIANTIE_ADDR=127.0.0.1:4019 \
  QIANTIE_MYSQL_DSN='' \
  QIANTIE_STORAGE_DRIVER=local \
  QIANTIE_STORAGE_LOCAL_DIR="$TMPDIR/objects" \
  "$ROOT/scripts/run-qiantie-backend.sh" --check-config 2>&1)"
exit_code=$?
set -e

if [[ "$exit_code" -eq 0 ]]; then
  print -u2 -- 'expected configuration check to fail'
  exit 1
fi

print -r -- "$output" | grep -F 'QIANTIE_MYSQL_DSN' >/dev/null
