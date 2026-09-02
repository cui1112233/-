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

if [[ "${QIANTIE_ALLOW_ONLINE_BUILD_DEPLOY:-0}" != "1" ]]; then
  echo "ERROR: deploy.sh is the online build/pull path and is disabled by default."
  echo "Use offline-deploy.sh for ECS production."
  exit 1
fi

PUBLIC_PORT="${PUBLIC_PORT:-3000}"
export PUBLIC_PORT

if [[ "${PUBLIC_IP:-}" != "115.190.156.223" ]]; then
  echo "ERROR: PUBLIC_IP must be 115.190.156.223 for this deployment."
  exit 1
fi

if [[ ! -f "${QIANTIE_GO_SOURCE_DIR:-}/backend/Dockerfile" ]]; then
  echo "ERROR: Go checkout is missing at QIANTIE_GO_SOURCE_DIR=${QIANTIE_GO_SOURCE_DIR:-unset}."
  exit 1
fi

if [[ -z "${QIANTIE_GO_EXPECTED_SHA:-}" ]]; then
  echo "ERROR: QIANTIE_GO_EXPECTED_SHA is required."
  exit 1
fi

if ! command -v git >/dev/null 2>&1 || ! git -C "$QIANTIE_GO_SOURCE_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "ERROR: QIANTIE_GO_SOURCE_DIR must be a git checkout so its verified SHA can be enforced."
  exit 1
fi

GO_SHA="$(git -C "$QIANTIE_GO_SOURCE_DIR" rev-parse HEAD)"
if [[ "$GO_SHA" != "$QIANTIE_GO_EXPECTED_SHA" ]]; then
  echo "ERROR: Go checkout SHA mismatch. expected=$QIANTIE_GO_EXPECTED_SHA actual=$GO_SHA"
  exit 1
fi

GO_BRANCH="$(git -C "$QIANTIE_GO_SOURCE_DIR" branch --show-current || true)"
if [[ -n "$GO_BRANCH" && "$GO_BRANCH" != "feat/v78-novel-fetch-go-bridge" ]]; then
  echo "ERROR: Go checkout branch must be feat/v78-novel-fetch-go-bridge when attached, got: $GO_BRANCH"
  exit 1
fi

COMPOSE=(docker compose --env-file .env -f docker-compose.yml)
"${COMPOSE[@]}" config -q

for image in qiantie-v78-node qiantie-go-api qiantie-121-browser-worker; do
  if docker image inspect "${image}:public-v78" >/dev/null 2>&1; then
    docker tag "${image}:public-v78" "${image}:rollback"
  fi
done

"${COMPOSE[@]}" pull mysql nginx
"${COMPOSE[@]}" build go-api browser-worker v78-node

"${COMPOSE[@]}" stop nginx >/dev/null 2>&1 || true
"${COMPOSE[@]}" up -d mysql go-api browser-worker v78-node

for attempt in $(seq 1 60); do
  if "${COMPOSE[@]}" exec -T v78-node node -e "fetch('http://127.0.0.1:3000/api/build-info').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
    break
  fi
  if [[ "$attempt" == "60" ]]; then
    echo "ERROR: V78 Node candidate did not become ready. Public Nginx was not switched."
    exit 1
  fi
  sleep 2
done

"${COMPOSE[@]}" exec -T v78-node node -e "fetch('http://go-api:4000/health').then(r=>{if(!r.ok)process.exit(1);return r.json()}).then(()=>console.log('Go API OK')).catch(e=>{console.error(e);process.exit(1)})"
"${COMPOSE[@]}" exec -T v78-node node -e "fetch('http://browser-worker:8787/healthz',{headers:{'x-qiantie-internal-secret':process.env.QIANTIE_121_WORKER_SECRET}}).then(r=>{if(!r.ok)process.exit(1);return r.json()}).then(()=>console.log('121 Browser Worker OK')).catch(e=>{console.error(e);process.exit(1)})"

"${COMPOSE[@]}" up -d nginx
bash ./verify.sh

echo "DEPLOYMENT READY: http://${PUBLIC_IP}:${PUBLIC_PORT}"
