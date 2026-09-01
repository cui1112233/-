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

for image in qiantie-v78-node qiantie-go-api qiantie-121-browser-worker; do
  if ! docker image inspect "${image}:rollback" >/dev/null 2>&1; then
    echo "ERROR: rollback image is missing: ${image}:rollback"
    exit 1
  fi
done

for image in qiantie-v78-node qiantie-go-api qiantie-121-browser-worker; do
  docker tag "${image}:rollback" "${image}:public-v78"
done

"${COMPOSE[@]}" up -d --no-build mysql go-api browser-worker v78-node
"${COMPOSE[@]}" up -d --no-build nginx
bash ./verify.sh

echo "ROLLBACK COMPLETE: previous application images restored."
