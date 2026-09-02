#!/usr/bin/env bash
set -Eeuo pipefail

PACKAGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RELEASE_DIR="${RELEASE_DIR:-$(cd "$PACKAGE_DIR/.." && pwd)}"
ACTIVE_DIR="${ACTIVE_DIR:-/opt/qiantie/v78/deploy/v78-public}"
ACTIVE_ENV="${ACTIVE_DIR}/.env"

on_error() {
  local code=$?
  echo "ERROR: offline deployment stopped with exit code ${code}." >&2
  echo "No data volumes were deleted. If Nginx was stopped after the snapshot, inspect the error and use ${ACTIVE_DIR}/rollback.sh when rollback is appropriate." >&2
  exit "$code"
}
trap on_error ERR

for required in \
  "$ACTIVE_ENV" \
  "$RELEASE_DIR/SHA256SUMS" \
  "$RELEASE_DIR/DEPLOYMENT-SHA256SUMS" \
  "$RELEASE_DIR/RELEASE-METADATA.txt" \
  "$PACKAGE_DIR/docker-compose.yml" \
  "$PACKAGE_DIR/nginx.conf" \
  "$PACKAGE_DIR/release-snapshot.sh" \
  "$PACKAGE_DIR/verify.sh"; do
  if [[ ! -f "$required" ]]; then
    echo "ERROR: required deployment input is missing: $required" >&2
    exit 1
  fi
done

if grep -q 'CHANGE_ME_' "$ACTIVE_ENV"; then
  echo "ERROR: active .env still contains CHANGE_ME placeholders." >&2
  exit 1
fi

# Verify the image archives and the exact deployment package before touching runtime state.
(
  cd "$RELEASE_DIR"
  sha256sum -c SHA256SUMS
)
(
  cd "$PACKAGE_DIR"
  sha256sum -c "$RELEASE_DIR/DEPLOYMENT-SHA256SUMS"
)

metadata="$RELEASE_DIR/RELEASE-METADATA.txt"
grep -Fxq 'architecture=linux/amd64' "$metadata"
grep -Fxq 'V78_SHA=cb9decd1054ca6c9e6931f6fb24627d6ae6f280c' "$metadata"
grep -Fxq 'Go_SHA=13e40da4092046846ad13c5c0bbb15918216465a' "$metadata"
grep -Fxq 'smoke=passed' "$metadata"

deploy_sha="$(sed -n 's/^DEPLOY_SHA=//p' "$metadata" | head -n1)"
workflow_run_id="$(sed -n 's/^workflow_run_id=//p' "$metadata" | head -n1)"
if [[ ! "$deploy_sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "ERROR: RELEASE-METADATA.txt has an invalid DEPLOY_SHA." >&2
  exit 1
fi
if [[ ! "$workflow_run_id" =~ ^[0-9]+$ ]]; then
  echo "ERROR: RELEASE-METADATA.txt has an invalid workflow_run_id." >&2
  exit 1
fi

# Load the existing server configuration without printing secret values.
set -a
source "$ACTIVE_ENV"
set +a

if [[ "${PUBLIC_IP:-}" != "115.190.156.223" ]]; then
  echo "ERROR: PUBLIC_IP must be 115.190.156.223." >&2
  exit 1
fi

# Older ECS .env files predate Deploy V2. Add only the new non-secret port key; never regenerate secrets.
if ! grep -q '^PUBLIC_PORT=' "$ACTIVE_ENV"; then
  printf '\n# Added by V78 Deploy V2; Nginx remains the only public service.\nPUBLIC_PORT=3000\n' >> "$ACTIVE_ENV"
  chmod 600 "$ACTIVE_ENV"
  PUBLIC_PORT=3000
  export PUBLIC_PORT
else
  PUBLIC_PORT="${PUBLIC_PORT:-3000}"
fi

if [[ ! "$PUBLIC_PORT" =~ ^[0-9]+$ ]] || (( PUBLIC_PORT < 1 || PUBLIC_PORT > 65535 )); then
  echo "ERROR: PUBLIC_PORT must be an integer between 1 and 65535." >&2
  exit 1
fi

RELEASE_ROOT="${QIANTIE_RELEASE_ROOT:-/opt/qiantie/releases}"
mkdir -p "$RELEASE_ROOT" "$ACTIVE_DIR"
chmod 700 "$RELEASE_ROOT"

# Snapshot the currently active runtime files and image tags BEFORE docker load can replace public-v78 tags.
snapshot_id="pre-${deploy_sha:0:12}-$(date -u +%Y%m%dT%H%M%SZ)"
ACTIVE_DIR="$ACTIVE_DIR" \
QIANTIE_RELEASE_ROOT="$RELEASE_ROOT" \
bash "$PACKAGE_DIR/release-snapshot.sh" "$snapshot_id" >/dev/null

echo "Snapshot ready: ${RELEASE_ROOT}/${snapshot_id}"

# Stop the old public entry before replacing private services. This is a short fail-closed maintenance window.
old_compose=(docker compose --env-file "$ACTIVE_ENV" -f "$ACTIVE_DIR/docker-compose.yml")
"${old_compose[@]}" stop nginx >/dev/null 2>&1 || true

# The archives were verified above. ECS only imports them; it never rebuilds the application images.
gzip -dc "$RELEASE_DIR/qiantie-v78-linux-amd64-base.tar.gz" | docker load
gzip -dc "$RELEASE_DIR/qiantie-v78-linux-amd64-browser-worker.tar.gz" | docker load
gzip -dc "$RELEASE_DIR/qiantie-v78-linux-amd64-go.tar.gz" | docker load
gzip -dc "$RELEASE_DIR/qiantie-v78-linux-amd64-node.tar.gz" | docker load

images=(
  mysql:8.4
  nginx:1.27-alpine
  qiantie-v78-node:public-v78
  qiantie-go-api:public-v78
  qiantie-121-browser-worker:public-v78
)
for image in "${images[@]}"; do
  if ! docker image inspect "$image" >/dev/null 2>&1; then
    echo "ERROR: required image missing after docker load: $image" >&2
    exit 1
  fi
  platform="$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$image")"
  if [[ "$platform" != "linux/amd64" ]]; then
    echo "ERROR: wrong image architecture: $image -> $platform" >&2
    exit 1
  fi
done

# Install the exact reviewed deployment package without replacing the server-only .env.
install -m 644 "$PACKAGE_DIR/.env.example" "$ACTIVE_DIR/.env.example"
install -m 644 "$PACKAGE_DIR/CODEX_RUNBOOK.md" "$ACTIVE_DIR/CODEX_RUNBOOK.md"
install -m 644 "$PACKAGE_DIR/docker-compose.yml" "$ACTIVE_DIR/docker-compose.yml"
install -m 644 "$PACKAGE_DIR/nginx.conf" "$ACTIVE_DIR/nginx.conf"
install -m 755 "$PACKAGE_DIR/backup.sh" "$ACTIVE_DIR/backup.sh"
install -m 755 "$PACKAGE_DIR/deploy.sh" "$ACTIVE_DIR/deploy.sh"
install -m 755 "$PACKAGE_DIR/offline-deploy.sh" "$ACTIVE_DIR/offline-deploy.sh"
install -m 755 "$PACKAGE_DIR/release-snapshot.sh" "$ACTIVE_DIR/release-snapshot.sh"
install -m 755 "$PACKAGE_DIR/rollback.sh" "$ACTIVE_DIR/rollback.sh"
install -m 755 "$PACKAGE_DIR/verify.sh" "$ACTIVE_DIR/verify.sh"
mkdir -p "$ACTIVE_DIR/tests"
install -m 755 "$PACKAGE_DIR/tests/deploy-v2-contract.sh" "$ACTIVE_DIR/tests/deploy-v2-contract.sh"
install -m 600 "$RELEASE_DIR/RELEASE-METADATA.txt" "$ACTIVE_DIR/RELEASE-METADATA.txt"
install -m 600 "$RELEASE_DIR/SHA256SUMS" "$ACTIVE_DIR/IMAGE-SHA256SUMS"
install -m 600 "$RELEASE_DIR/DEPLOYMENT-SHA256SUMS" "$ACTIVE_DIR/DEPLOYMENT-SHA256SUMS"

cd "$ACTIVE_DIR"
set -a
source .env
set +a
PUBLIC_PORT="${PUBLIC_PORT:-3000}"
export PUBLIC_PORT
COMPOSE=(docker compose --env-file .env -f docker-compose.yml)
"${COMPOSE[@]}" config -q

# Start only private services. No public Nginx container is started until all gates pass.
"${COMPOSE[@]}" up -d --no-build --pull never mysql go-api browser-worker v78-node

wait_healthy() {
  local service="$1"
  for attempt in $(seq 1 60); do
    cid="$("${COMPOSE[@]}" ps -q "$service")"
    if [[ -n "$cid" ]]; then
      health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cid")"
      if [[ "$health" = healthy ]]; then
        return 0
      fi
    fi
    sleep 2
  done
  echo "ERROR: service did not become healthy: $service" >&2
  return 1
}

wait_healthy mysql
wait_healthy browser-worker
wait_healthy v78-node

"${COMPOSE[@]}" exec -T v78-node node -e "fetch('http://go-api:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
"${COMPOSE[@]}" exec -T v78-node node -e "fetch('http://browser-worker:8787/healthz',{headers:{'x-qiantie-internal-secret':process.env.QIANTIE_121_WORKER_SECRET}}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
"${COMPOSE[@]}" exec -T v78-node node -e "fetch('http://127.0.0.1:3000/api/build-info').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Private candidate passed. Start the single public entry and run the full verifier.
"${COMPOSE[@]}" up -d --no-build --pull never nginx
bash ./verify.sh

ln -sfn "$RELEASE_DIR" "$RELEASE_ROOT/current"
trap - ERR

echo "DEPLOYMENT READY: http://${PUBLIC_IP}:${PUBLIC_PORT}"
echo "DEPLOY_SHA=${deploy_sha} workflow_run_id=${workflow_run_id}"
