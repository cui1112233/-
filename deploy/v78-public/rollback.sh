#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  echo "ERROR: .env is missing."
  exit 1
fi

set -a
source .env
set +a
COMPOSE=(docker compose --env-file .env -f docker-compose.yml)

NODE_ROLLBACK_IMAGE="${QIANTIE_NODE_ROLLBACK_IMAGE:-qiantie-v78-node@sha256:eab43c1edf80426a19ca314f164c2464483db2dae9c81da1db95cf2bdda4dc51}"
GO_ROLLBACK_IMAGE="${QIANTIE_GO_ROLLBACK_IMAGE:-qiantie-go-api:rollback}"
BROWSER_WORKER_ROLLBACK_IMAGE="${QIANTIE_BROWSER_WORKER_ROLLBACK_IMAGE:-qiantie-121-browser-worker:rollback}"
if ! docker image inspect "$NODE_ROLLBACK_IMAGE" >/dev/null 2>&1; then
  echo "ERROR: rollback Node image is missing: $NODE_ROLLBACK_IMAGE"
  exit 1
fi

for image in "$GO_ROLLBACK_IMAGE" "$BROWSER_WORKER_ROLLBACK_IMAGE"; do
  if ! docker image inspect "$image" >/dev/null 2>&1; then
    echo "ERROR: rollback image is missing: $image"
    exit 1
  fi
done

QIANTIE_NODE_IMAGE="$NODE_ROLLBACK_IMAGE" QIANTIE_GO_IMAGE="$GO_ROLLBACK_IMAGE" QIANTIE_BROWSER_WORKER_IMAGE="$BROWSER_WORKER_ROLLBACK_IMAGE" "${COMPOSE[@]}" up -d --no-build --no-deps go-api browser-worker v78-node
QIANTIE_NODE_IMAGE="$NODE_ROLLBACK_IMAGE" QIANTIE_GO_IMAGE="$GO_ROLLBACK_IMAGE" QIANTIE_BROWSER_WORKER_IMAGE="$BROWSER_WORKER_ROLLBACK_IMAGE" "${COMPOSE[@]}" up -d --no-build --no-deps nginx
bash ./verify.sh

echo "ROLLBACK COMPLETE: previous application images restored."
