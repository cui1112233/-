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

RELEASE_ROOT="${QIANTIE_RELEASE_ROOT:-/opt/qiantie/releases}"
previous_link="${RELEASE_ROOT}/previous"
if [[ ! -L "$previous_link" ]]; then
  echo "ERROR: previous release snapshot is missing: $previous_link"
  exit 1
fi

previous_path="$(readlink -f "$previous_link")"
snapshot_dir="${previous_path}/snapshot"
for required in docker-compose.yml nginx.conf IMAGE-TAGS.txt SNAPSHOT-METADATA.txt; do
  if [[ ! -f "$snapshot_dir/$required" ]]; then
    echo "ERROR: rollback snapshot is incomplete: $snapshot_dir/$required"
    exit 1
  fi
done

if grep -Fxq 'first-install=true' "$snapshot_dir/SNAPSHOT-METADATA.txt"; then
  echo "ERROR: the previous snapshot represents a first installation and has no earlier application release to restore."
  exit 1
fi

while IFS=$'\t' read -r image image_id rollback_tag; do
  [[ -n "$image" ]] || continue
  if ! docker image inspect "$rollback_tag" >/dev/null 2>&1; then
    echo "ERROR: rollback image is missing: $rollback_tag"
    exit 1
  fi
  actual_id="$(docker image inspect --format '{{.Id}}' "$rollback_tag")"
  if [[ "$actual_id" != "$image_id" ]]; then
    echo "ERROR: rollback image id mismatch for $rollback_tag"
    exit 1
  fi
done < "$snapshot_dir/IMAGE-TAGS.txt"

COMPOSE=(docker compose --env-file .env -f docker-compose.yml)
"${COMPOSE[@]}" stop nginx >/dev/null 2>&1 || true

cp "$snapshot_dir/docker-compose.yml" docker-compose.yml
cp "$snapshot_dir/nginx.conf" nginx.conf
chmod 644 docker-compose.yml nginx.conf

while IFS=$'\t' read -r image image_id rollback_tag; do
  [[ -n "$image" ]] || continue
  docker tag "$rollback_tag" "${image}:public-v78"
done < "$snapshot_dir/IMAGE-TAGS.txt"

COMPOSE=(docker compose --env-file .env -f docker-compose.yml)
"${COMPOSE[@]}" config -q
"${COMPOSE[@]}" up -d --no-build --pull never mysql go-api browser-worker v78-node

for attempt in $(seq 1 60); do
  mysql_cid="$("${COMPOSE[@]}" ps -q mysql)"
  if [[ -n "$mysql_cid" ]] && [[ "$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$mysql_cid")" = healthy ]]; then
    break
  fi
  if [[ "$attempt" = 60 ]]; then
    echo "ERROR: MySQL did not become healthy during rollback."
    exit 1
  fi
  sleep 2
done

for attempt in $(seq 1 60); do
  if "${COMPOSE[@]}" exec -T v78-node node -e "Promise.all([fetch('http://127.0.0.1:3000/api/build-info'),fetch('http://go-api:4000/health'),fetch('http://browser-worker:8787/healthz',{headers:{'x-qiantie-internal-secret':process.env.QIANTIE_121_WORKER_SECRET}})]).then(rs=>process.exit(rs.every(r=>r.ok)?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
    break
  fi
  if [[ "$attempt" = 60 ]]; then
    echo "ERROR: application services did not become ready during rollback."
    exit 1
  fi
  sleep 2
done

"${COMPOSE[@]}" up -d --no-build --pull never nginx
bash ./verify.sh

echo "ROLLBACK COMPLETE: restored runtime config and application images from $(basename "$previous_path")."
