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

"${COMPOSE[@]}" ps

"${COMPOSE[@]}" exec -T v78-node node -e "fetch('http://127.0.0.1:3000/api/build-info').then(async r=>{if(!r.ok)throw new Error('node '+r.status);console.log('V78 Node OK',await r.text())}).catch(e=>{console.error(e);process.exit(1)})"
"${COMPOSE[@]}" exec -T v78-node node -e "fetch('http://go-api:4000/health').then(async r=>{if(!r.ok)throw new Error('go '+r.status);console.log('Go API OK',await r.text())}).catch(e=>{console.error(e);process.exit(1)})"
"${COMPOSE[@]}" exec -T v78-node node -e "fetch('http://browser-worker:8787/healthz',{headers:{'x-qiantie-internal-secret':process.env.QIANTIE_121_WORKER_SECRET}}).then(async r=>{if(!r.ok)throw new Error('worker '+r.status);console.log('121 Worker OK',await r.text())}).catch(e=>{console.error(e);process.exit(1)})"

if command -v curl >/dev/null 2>&1; then
  curl --fail --silent --show-error --max-time 15 "http://127.0.0.1/api/build-info" >/dev/null
elif command -v wget >/dev/null 2>&1; then
  wget -q -T 15 -O /dev/null "http://127.0.0.1/api/build-info"
else
  echo "ERROR: curl or wget is required for public-entry verification."
  exit 1
fi

echo "VERIFY PASS: local public entry is serving V78 on port 80."
echo "Next external check: http://${PUBLIC_IP:-115.190.156.223}"
