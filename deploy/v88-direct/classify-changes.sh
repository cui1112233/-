#!/usr/bin/env bash
set -Eeuo pipefail

old_sha="${1:-}"
new_sha="${2:-}"

FRONTEND_CHANGED=0
NODE_CHANGED=0
GO_CHANGED=0
WORKER_CHANGED=0
MIGRATIONS_CHANGED=0

if [ -z "$new_sha" ]; then
  echo "new SHA is required" >&2
  exit 2
fi

# First direct deployment has no prior Git-direct SHA. Build everything once.
if [ -z "$old_sha" ] || ! git cat-file -e "${old_sha}^{commit}" 2>/dev/null; then
  FRONTEND_CHANGED=1
  NODE_CHANGED=1
  GO_CHANGED=1
  WORKER_CHANGED=1
  MIGRATIONS_CHANGED=1
else
  while IFS= read -r file; do
    [ -n "$file" ] || continue
    case "$file" in
      frontend/*|public/*|pets/*|index.html)
        FRONTEND_CHANGED=1
        ;;
    esac
    case "$file" in
      app.js|server.js|package.json|package-lock.json|routes/*|lib/*|middleware/*|prompts/*)
        NODE_CHANGED=1
        ;;
    esac
    case "$file" in
      backend/*)
        GO_CHANGED=1
        ;;
    esac
    case "$file" in
      services/121-browser-worker/*)
        WORKER_CHANGED=1
        ;;
    esac
    case "$file" in
      backend/migrations/*|migrations/*|database/migrations/*)
        MIGRATIONS_CHANGED=1
        ;;
    esac
  done < <(git diff --name-only "$old_sha" "$new_sha")
fi

printf 'FRONTEND_CHANGED=%s\n' "$FRONTEND_CHANGED"
printf 'NODE_CHANGED=%s\n' "$NODE_CHANGED"
printf 'GO_CHANGED=%s\n' "$GO_CHANGED"
printf 'WORKER_CHANGED=%s\n' "$WORKER_CHANGED"
printf 'MIGRATIONS_CHANGED=%s\n' "$MIGRATIONS_CHANGED"
