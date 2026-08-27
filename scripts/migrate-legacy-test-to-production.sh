#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LEGACY_ENV="$ROOT/deploy/.env.test-docker"
PRODUCTION_ENV="$ROOT/deploy/.env.production"
PRODUCTION_COMPOSE="$ROOT/deploy/docker-compose.production.yml"

[[ -f "$LEGACY_ENV" ]] || { echo "missing legacy environment" >&2; exit 1; }
[[ ! -e "$PRODUCTION_ENV" ]] || { echo "production environment already exists; refusing to overwrite" >&2; exit 1; }
for volume in qiantie-production-mysql qiantie-production-objects qiantie-production-platform qiantie-production-redis; do
  if docker volume inspect "$volume" >/dev/null 2>&1; then echo "production volume already exists: $volume" >&2; exit 1; fi
done

umask 077
cp "$LEGACY_ENV" "$PRODUCTION_ENV"
perl -0pi -e 's/^QIANTIE_PLATFORM_PORT=.*/QIANTIE_PLATFORM_PORT=3000/m; s/^QIANTIE_BACKEND_PORT=.*/QIANTIE_BACKEND_PORT=14000/m' "$PRODUCTION_ENV"

"$ROOT/scripts/production-backup-baseline.sh" backup legacy-test >/dev/null
BACKUP="$(find "$ROOT/backups/production" -path '*-legacy-test/qiantie.sql' -type f -print | sort | tail -n1)"
[[ -s "$BACKUP" ]] || { echo "legacy MySQL backup was not created" >&2; exit 1; }

copy_volume() {
  local source="$1" target="$2"
  docker volume create "$target" >/dev/null
  docker run --rm -v "$source":/from:ro -v "$target":/to alpine:3.20 sh -c 'cd /from && tar cf - . | tar xf - -C /to'
}
copy_volume deploy_qiantie-test-platform qiantie-production-platform
copy_volume deploy_qiantie-test-objects qiantie-production-objects
docker volume create qiantie-production-mysql >/dev/null
docker volume create qiantie-production-redis >/dev/null

compose() { docker compose --project-name qiantie-production --env-file "$PRODUCTION_ENV" -f "$PRODUCTION_COMPOSE" "$@"; }
compose up -d mysql redis
for _ in $(seq 1 30); do compose exec -T mysql mysqladmin ping -h localhost -uqiantie -p"$(sed -n 's/^MYSQL_PASSWORD=//p' "$PRODUCTION_ENV")" --silent && break; sleep 1; done
compose exec -T mysql mysql -uroot -p"$(sed -n 's/^MYSQL_ROOT_PASSWORD=//p' "$PRODUCTION_ENV")" < "$BACKUP"
"$ROOT/scripts/production-backup-baseline.sh" baseline production >/dev/null
echo "migration staged; old deploy volumes and containers remain untouched"
