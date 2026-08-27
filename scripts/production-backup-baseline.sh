#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ACTION="${1:-}"
SOURCE="${2:-production}"

case "$ACTION" in
  baseline|backup) ;;
  *) echo "usage: $0 baseline|backup [legacy-test|production]" >&2; exit 2 ;;
esac
case "$SOURCE" in
  legacy-test)
    ENV_FILE="$ROOT/deploy/.env.test-docker"
    COMPOSE_FILE="$ROOT/deploy/docker-compose.test.yml"
    PROJECT="deploy"
    ;;
  production)
    ENV_FILE="$ROOT/deploy/.env.production"
    COMPOSE_FILE="$ROOT/deploy/docker-compose.production.yml"
    PROJECT="qiantie-production"
    ;;
  *) echo "source must be legacy-test or production" >&2; exit 2 ;;
esac

[[ -f "$ENV_FILE" ]] || { echo "missing environment file: $ENV_FILE" >&2; exit 1; }
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUTPUT_DIR="$ROOT/backups/production/$TIMESTAMP-$SOURCE"
mkdir -p "$OUTPUT_DIR"

compose() { docker compose --project-name "$PROJECT" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; }
env_value() { sed -n "s/^$1=//p" "$ENV_FILE" | head -n1; }

MYSQL_PASSWORD="$(env_value MYSQL_PASSWORD)"
MYSQL_ROOT_PASSWORD="$(env_value MYSQL_ROOT_PASSWORD)"
[[ -n "$MYSQL_PASSWORD" && -n "$MYSQL_ROOT_PASSWORD" ]] || { echo "MySQL credentials are missing" >&2; exit 1; }
MYSQL_CONTAINER="$(compose ps -q mysql)"
[[ -n "$MYSQL_CONTAINER" ]] || { echo "mysql service is not running for $SOURCE" >&2; exit 1; }

sql_scalar() {
  docker exec -e MYSQL_PWD="$MYSQL_ROOT_PASSWORD" "$MYSQL_CONTAINER" mysql -N -uroot qiantie -e "$1"
}

baseline() {
  cat > "$OUTPUT_DIR/baseline.json" <<EOF
{
  "capturedAt": "$(date -u +%FT%TZ)",
  "source": "$SOURCE",
  "users": $(sql_scalar 'SELECT COUNT(*) FROM users'),
  "modelDefinitions": $(sql_scalar 'SELECT COUNT(*) FROM model_definitions'),
  "shuihuoProjects": $(sql_scalar 'SELECT COUNT(*) FROM shuihuo_projects'),
  "batchFactoryBatches": $(sql_scalar 'SELECT COUNT(*) FROM batch_factory_batches'),
  "batchFactoryItems": $(sql_scalar 'SELECT COUNT(*) FROM batch_factory_items')
}
EOF
  test -s "$OUTPUT_DIR/baseline.json"
  printf '%s\n' "$OUTPUT_DIR/baseline.json"
}

backup() {
  baseline >/dev/null
  docker exec -e MYSQL_PWD="$MYSQL_ROOT_PASSWORD" "$MYSQL_CONTAINER" \
    mysqldump -uroot --single-transaction --routines --triggers --databases qiantie > "$OUTPUT_DIR/qiantie.sql"
  test -s "$OUTPUT_DIR/qiantie.sql" || { echo "MySQL backup is empty" >&2; exit 1; }
  grep -q 'CREATE DATABASE' "$OUTPUT_DIR/qiantie.sql" || { echo "MySQL backup is invalid" >&2; exit 1; }
  printf '%s\n' "$OUTPUT_DIR/qiantie.sql"
}

"$ACTION"
