#!/usr/bin/env bash
# One approved emergency frontend activation; not a general release entry point.
set -Eeuo pipefail
[ "${1:-}" = "--approved-frontend-only" ] || { echo "Explicit approved-frontend-only flag required" >&2; exit 2; }
COVER_SHA=563920d2c126f492797ad2f6e4e99bcd84aae3cd
BACKEND_SHA=7df6290b0c8294f89f7e226fdeecf3024cedbdcf
BACKEND_DIGEST=86d4093040e78340e3dddb85b1e5471c17e4d1d2353b0fef482b54d64a66feaa
COVER_STAGE=/opt/qiantie/v88/direct/staging/cover-$COVER_SHA
DEPLOY_DIR=/opt/qiantie/v88/deploy/v88-public
DIRECT_FILE=/opt/qiantie/v88/direct/docker-compose.direct.yml
[ "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)" = "$COVER_STAGE" ] || exit 3
cd "$DEPLOY_DIR"
[ "$(sha256sum /opt/qiantie/v88/direct/current/go/qiantie | cut -d' ' -f1)" = "$BACKEND_DIGEST" ]
[ "$(sha256sum nginx.conf | cut -d' ' -f1)" = "365f179a3ddd20297b1a92a8505c2a2d80ff012033c060651f538137145a2dee" ]
curl -fsS --max-time 10 http://127.0.0.1:3000/api/runtime-build-info | python3 -c 'import json,sys; assert json.load(sys.stdin)["git_sha"] == sys.argv[1]' "$BACKEND_SHA"
(cd "$COVER_STAGE/frontend" && sha256sum -c "$COVER_STAGE/frontend.sha256" >/dev/null)
docker compose -f docker-compose.yml -f "$DIRECT_FILE" -f "$COVER_STAGE/docker-compose.cover-recovery.yml" config -q
docker cp "$COVER_STAGE/nginx.candidate.conf" v88-public-nginx-1:/tmp/v88-cover-nginx.candidate.conf >/dev/null
docker cp "$COVER_STAGE/nginx.test.conf" v88-public-nginx-1:/tmp/v88-cover-nginx.test.conf >/dev/null
docker exec v88-public-nginx-1 nginx -t -c /tmp/v88-cover-nginx.test.conf
COVER_BACKUP="$COVER_STAGE/rollback-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir "$COVER_BACKUP"
cp -p nginx.conf "$COVER_BACKUP/nginx.conf"
docker inspect --format '{{json .Mounts}}' v88-public-nginx-1 > "$COVER_BACKUP/nginx-mounts.json"
docker ps --format '{{.Names}} {{.ID}} {{.Status}}' > "$COVER_BACKUP/services-before.txt"
rollback() {
  local failure_status=$?
  trap - ERR
  echo "ROLLBACK restoring original frontend ingress" >&2
  cp -p "$COVER_BACKUP/nginx.conf" "$DEPLOY_DIR/nginx.conf"
  docker compose -f docker-compose.yml -f "$DIRECT_FILE" up -d --no-deps --force-recreate --pull never nginx
  exit "$failure_status"
}
trap rollback ERR
cp "$COVER_STAGE/nginx.candidate.conf" nginx.conf
docker compose -f docker-compose.yml -f "$DIRECT_FILE" -f "$COVER_STAGE/docker-compose.cover-recovery.yml" up -d --no-deps --force-recreate --pull never nginx
cover_ready=0
for attempt in $(seq 1 20); do
  if curl -fsS --max-time 5 -D "$COVER_BACKUP/headers-after.txt" http://127.0.0.1:3000/shuihuo-production -o "$COVER_BACKUP/index-after.html" &&
     grep -qi "X-Qiantie-Frontend-SHA: $COVER_SHA" "$COVER_BACKUP/headers-after.txt" &&
     grep -qi 'Content-Type: text/html' "$COVER_BACKUP/headers-after.txt" &&
     cmp -s "$COVER_BACKUP/index-after.html" "$COVER_STAGE/frontend/index.html"; then cover_ready=1; break; fi
  sleep 1
done
[ "$cover_ready" = 1 ]
curl -fsS --max-time 10 http://127.0.0.1:3000/api/runtime-build-info | python3 -c 'import json,sys; assert json.load(sys.stdin)["git_sha"] == sys.argv[1]' "$BACKEND_SHA"
[ "$(sha256sum /opt/qiantie/v88/direct/current/go/qiantie | cut -d' ' -f1)" = "$BACKEND_DIGEST" ]
trap - ERR
printf 'ACTIVATED frontend=%s backend=%s rollback=%s\n' "$COVER_SHA" "$BACKEND_SHA" "$COVER_BACKUP"
