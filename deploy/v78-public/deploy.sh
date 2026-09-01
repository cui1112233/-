#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  echo "ERROR: deploy/v78-public/.env is missing. Copy .env.example to .env and fill the secrets first."
  exit 1
fi

if grep -q 'CHANGE_ME_' .env; then
  echo "ERROR: .env still contains CHANGE_ME placeholders."
  exit 1
fi

set -a
source .env
set +a

if [[ "${PUBLIC_IP:-}" != "115.190.156.223" ]]; then
  echo "ERROR: PUBLIC_IP must be 115.190.156.223 for this deployment."
  exit 1
fi

if [[ ! -f "${QIANTIE_GO_SOURCE_DIR:-}/backend/Dockerfile" ]]; then
  echo "ERROR: Go checkout is missing at QIANTIE_GO_SOURCE_DIR=${QIANTIE_GO_SOURCE_DIR:-unset}."
  exit 1
fi

if command -v git >/dev/null 2>&1 && git -C "$QIANTIE_GO_SOURCE_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  GO_BRANCH="$(git -C "$QIANTIE_GO_SOURCE_DIR" branch --show-current || true)"
  if [[ "$GO_BRANCH" != "feat/v78-novel-fetch-go-bridge" ]]; then
    echo "ERROR: Go checkout must be on feat/v78-novel-fetch-go-bridge, got: ${GO_BRANCH:-detached}."
    exit 1
  fi
fi

COMPOSE=(docker compose --env-file .env -f docker-compose.yml)
"${COMPOSE[@]}" config -q

# Preserve the last working application images for one-command rollback.
for image in qiantie-v78-node qiantie-go-api qiantie-121-browser-worker; do
  if docker image inspect "${image}:public-v78" >/dev/null 2>&1; then
    docker tag "${image}:public-v78" "${image}:rollback"
  fi
done

"${COMPOSE[@]}" pull mysql nginx
"${COMPOSE[@]}" build go-api browser-worker v78-node

# Start the private candidate first. Port 80 is not switched until these checks pass.
"${COMPOSE[@]}" up -d mysql go-api browser-worker v78-node

for attempt in $(seq 1 30); do
  if "${COMPOSE[@]}" exec -T v78-node node -e "fetch('http://127.0.0.1:3000/api/build-info').then(r=>{if(!r.ok)process.exit(1);return r.json()}).then(()=>process.exit(0)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
    break
  fi
  if [[ "$attempt" == "30" ]]; then
    echo "ERROR: V78 Node candidate did not become ready. Public port 80 was not switched."
    exit 1
  fi
  sleep 2
done

"${COMPOSE[@]}" exec -T v78-node node -e "fetch('http://go-api:4000/health').then(r=>{if(!r.ok)process.exit(1);return r.json()}).then(()=>console.log('Go API OK')).catch(e=>{console.error(e);process.exit(1)})"
"${COMPOSE[@]}" exec -T v78-node node -e "fetch('http://browser-worker:8787/healthz',{headers:{'x-qiantie-internal-secret':process.env.QIANTIE_121_WORKER_SECRET}}).then(r=>{if(!r.ok)process.exit(1);return r.json()}).then(()=>console.log('121 Browser Worker OK')).catch(e=>{console.error(e);process.exit(1)})"

# Candidate passed. Switch the single public entrypoint.
"${COMPOSE[@]}" up -d nginx

./verify.sh

echo "DEPLOYMENT READY: http://115.190.156.223"
