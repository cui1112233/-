#!/bin/zsh
set -euo pipefail

ROOT="${0:A:h:h}"
cd "$ROOT"

if [[ "${1:-}" == "--check-config" ]]; then
  set +e
  output="$(go run ./cmd/qiantie 2>&1)"
  exit_code=$?
  set -e
  print -r -- "${output%%$'\n'*}"
  exit "$exit_code"
fi

exec go run ./cmd/qiantie
