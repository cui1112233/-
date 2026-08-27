#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/deploy/.env.production"
COMPOSE_FILE="$ROOT/deploy/docker-compose.production.yml"
LEGACY_ENV_FILE="$ROOT/deploy/.env.test-docker"
LEGACY_COMPOSE_FILE="$ROOT/deploy/docker-compose.test.yml"
STATE_FILE="$ROOT/backups/production/.last-publish"
ACTION="${1:-}"
TAKEOVER_LEGACY="${2:-}" 

compose() { docker compose --project-name qiantie-production --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; }
legacy_compose() { docker compose --project-name deploy --env-file "$LEGACY_ENV_FILE" -f "$LEGACY_COMPOSE_FILE" "$@"; }
env_value() { sed -n "s/^$1=//p" "$ENV_FILE" | head -n1; }

require_env() {
  [[ -f "$ENV_FILE" ]] || { echo "missing production environment: $ENV_FILE" >&2; exit 1; }
  for key in MYSQL_PASSWORD MYSQL_ROOT_PASSWORD QIANTIE_TOKEN_SECRET QIANTIE_BRIDGE_SECRET QIANTIE_CREDENTIAL_ENCRYPTION_KEY; do
    [[ -n "$(env_value "$key")" ]] || { echo "missing $key in production environment" >&2; exit 1; }
  done
}

require_production_volumes() {
  for volume in qiantie-production-mysql qiantie-production-objects qiantie-production-platform qiantie-production-redis; do
    docker volume inspect "$volume" >/dev/null 2>&1 || { echo "missing production volume: $volume" >&2; exit 1; }
  done
}

wait_for() {
  local url="$1" label="$2"
  for _ in $(seq 1 90); do
    if curl -fsS --max-time 3 "$url" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  echo "$label did not become healthy: $url" >&2
  return 1
}

preflight() {
  require_env
  require_production_volumes
  docker compose --project-name qiantie-production --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config >/dev/null
  [[ -n "$(compose ps -q mysql)" ]] || { echo "production mysql is not running" >&2; exit 1; }
  [[ -n "$(compose ps -q redis)" ]] || { echo "production redis is not running" >&2; exit 1; }
  echo "production preflight passed"
}

verify() {
  preflight >/dev/null
  [[ -n "$(compose ps -q backend)" ]] || { echo "production backend is not running" >&2; exit 1; }
  [[ -n "$(compose ps -q platform)" ]] || { echo "production platform is not running" >&2; exit 1; }
  wait_for "http://127.0.0.1:$(env_value QIANTIE_BACKEND_PORT)/healthz" "backend"
  wait_for "http://127.0.0.1:$(env_value QIANTIE_PLATFORM_PORT)/" "platform"
  curl -fsS --max-time 5 "http://127.0.0.1:$(env_value QIANTIE_PLATFORM_PORT)/batch-factory" | grep -q '<div id="root"></div>'
  echo "production verification passed"
}

snapshot_images() {
  local stamp="$1" platform_image backend_image
  platform_image="qiantie-platform:production"
  backend_image="qiantie-backend:production"
  if ! docker image inspect "$platform_image" >/dev/null 2>&1; then
    platform_image="$(docker inspect -f '{{.Config.Image}}' deploy-platform-1 2>/dev/null || true)"
  fi
  if ! docker image inspect "$backend_image" >/dev/null 2>&1; then
    backend_image="$(docker inspect -f '{{.Config.Image}}' deploy-backend-1 2>/dev/null || true)"
  fi
  [[ -n "$platform_image" ]] && docker image tag "$platform_image" "qiantie-platform:production-rollback-$stamp" || true
  [[ -n "$backend_image" ]] && docker image tag "$backend_image" "qiantie-backend:production-rollback-$stamp" || true
}

restore_legacy_apps() {
  [[ -f "$LEGACY_ENV_FILE" ]] || return 0
  legacy_compose up -d --no-deps backend platform
}

publish() {
  local stamp takeover=""
  [[ "$TAKEOVER_LEGACY" == "--takeover-legacy" ]] && takeover=1
  preflight
  "$ROOT/scripts/production-backup-baseline.sh" backup production >/dev/null
  "$ROOT/scripts/production-backup-baseline.sh" baseline production >/dev/null
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  snapshot_images "$stamp"
  if [[ -n "$takeover" ]]; then
    legacy_compose stop backend platform || true
  fi
  if ! compose up --build -d --no-deps --force-recreate backend platform; then
    [[ -n "$takeover" ]] && restore_legacy_apps
    echo "production application start failed; old volumes were not changed" >&2
    exit 1
  fi
  if ! verify; then
    rollback "$stamp"
    [[ -n "$takeover" ]] && restore_legacy_apps
    exit 1
  fi
  printf '%s\n' "$stamp" > "$STATE_FILE"
  echo "production publish completed; rollback tag: $stamp"
}

rollback() {
  local stamp="${1:-}"
  [[ -n "$stamp" ]] || [[ -f "$STATE_FILE" ]] || { echo "no production rollback image is recorded" >&2; exit 1; }
  [[ -n "$stamp" ]] || stamp="$(cat "$STATE_FILE")"
  docker image inspect "qiantie-platform:production-rollback-$stamp" >/dev/null
  docker image inspect "qiantie-backend:production-rollback-$stamp" >/dev/null
  docker image tag "qiantie-platform:production-rollback-$stamp" qiantie-platform:production
  docker image tag "qiantie-backend:production-rollback-$stamp" qiantie-backend:production
  compose up -d --no-deps --force-recreate backend platform
  echo "application images restored from rollback tag: $stamp"
}

case "$ACTION" in
  preflight) preflight ;;
  verify) verify ;;
  publish) publish ;;
  rollback) rollback ;;
  *) echo "usage: $0 [preflight|publish|verify|rollback] [--takeover-legacy]" >&2; exit 2 ;;
esac
