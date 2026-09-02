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

PUBLIC_PORT="${PUBLIC_PORT:-3000}"
if [[ ! "$PUBLIC_PORT" =~ ^[0-9]+$ ]] || (( PUBLIC_PORT < 1 || PUBLIC_PORT > 65535 )); then
  echo "ERROR: PUBLIC_PORT must be an integer between 1 and 65535."
  exit 1
fi

COMPOSE=(docker compose --env-file .env -f docker-compose.yml)
"${COMPOSE[@]}" config -q
"${COMPOSE[@]}" ps

require_ready_container() {
  local service="$1"
  local cid
  cid="$("${COMPOSE[@]}" ps -q "$service")"
  if [[ -z "$cid" ]]; then
    echo "ERROR: service is not running: $service"
    exit 1
  fi

  if [[ "$(docker inspect -f '{{.State.Running}}' "$cid")" != "true" ]]; then
    echo "ERROR: service is not running: $service"
    exit 1
  fi

  local health
  health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cid")"
  if [[ "$health" != "none" && "$health" != "healthy" ]]; then
    echo "ERROR: service health is not ready: $service status=$health"
    exit 1
  fi
}

require_ready_container mysql
require_ready_container go-api
require_ready_container browser-worker
require_ready_container v78-node
require_ready_container nginx

"${COMPOSE[@]}" exec -T v78-node node -e "fetch('http://127.0.0.1:3000/api/build-info').then(async r=>{if(!r.ok)throw new Error('node '+r.status);console.log('V78 Node OK',await r.text())}).catch(e=>{console.error(e);process.exit(1)})"
"${COMPOSE[@]}" exec -T v78-node node -e "fetch('http://go-api:4000/health').then(async r=>{if(!r.ok)throw new Error('go '+r.status);console.log('Go API OK',await r.text())}).catch(e=>{console.error(e);process.exit(1)})"
"${COMPOSE[@]}" exec -T v78-node node -e "fetch('http://browser-worker:8787/healthz',{headers:{'x-qiantie-internal-secret':process.env.QIANTIE_121_WORKER_SECRET}}).then(async r=>{if(!r.ok)throw new Error('worker '+r.status);console.log('121 Worker OK',await r.text())}).catch(e=>{console.error(e);process.exit(1)})"

if command -v curl >/dev/null 2>&1; then
  curl --fail --silent --show-error --max-time 15 \
    "http://127.0.0.1:${PUBLIC_PORT}/api/build-info" >/dev/null
elif command -v wget >/dev/null 2>&1; then
  wget -q -T 15 -O /dev/null \
    "http://127.0.0.1:${PUBLIC_PORT}/api/build-info"
else
  echo "ERROR: curl or wget is required for public-entry verification."
  exit 1
fi

echo "VERIFY PASS: local public entry is serving V78 on port ${PUBLIC_PORT}."
echo "External check: http://${PUBLIC_IP:-115.190.156.223}:${PUBLIC_PORT}"
