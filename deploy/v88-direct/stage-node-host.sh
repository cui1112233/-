#!/usr/bin/env bash
set -Eeuo pipefail

release_dir="${1:-}"
sha="${2:-}"

if [ -z "$release_dir" ] || [ -z "$sha" ]; then
  echo "usage: stage-node-host.sh <release_dir> <sha>" >&2
  exit 2
fi

case "$release_dir" in
  /opt/qiantie/releases/v88-stage/*) ;;
  *) echo "stage release must live under /opt/qiantie/releases/v88-stage" >&2; exit 3 ;;
esac

NODE_VERSION=24.19.0
NODE_DIST="node-v${NODE_VERSION}-linux-x64"
NODE_ARCHIVE="${NODE_DIST}.tar.xz"
RUNTIME_ROOT=/opt/qiantie/runtime
NODE_HOME="$RUNTIME_ROOT/$NODE_DIST"
ROOT=/opt/qiantie/v88
SHARED_DATA=/opt/qiantie/v88/shared/data
SHARED_OUTPUTS=/opt/qiantie/v88/shared/outputs
STAGE_ENV="$ROOT/shared/env/v88-stage.env"
STAGE_UNIT=/etc/systemd/system/qiantie-v88-node-stage.service
NETWORK=v88-public_qiantie_internal
STAGE_PORT=18081

[ -f "$release_dir/package.json" ] || { echo "release source is incomplete" >&2; exit 4; }
[ -f "$release_dir/RELEASE-SHA" ] || { echo "RELEASE-SHA is missing" >&2; exit 5; }
[ "$(tr -d '\r\n' < "$release_dir/RELEASE-SHA")" = "$sha" ] || { echo "RELEASE-SHA does not match requested SHA" >&2; exit 6; }
[ -d "$release_dir/node_modules" ] || { echo "prebuilt root node_modules is missing" >&2; exit 7; }
[ -s "$release_dir/frontend/dist/index.html" ] || { echo "prebuilt frontend/dist is missing" >&2; exit 8; }

docker network inspect "$NETWORK" >/dev/null
gateway="$(docker network inspect "$NETWORK" --format '{{(index .IPAM.Config 0).Gateway}}')"

container_id() {
  docker ps --filter "name=$1" --format '{{.ID}}' | head -n1
}
container_ip() {
  docker inspect -f "{{with index .NetworkSettings.Networks \"$NETWORK\"}}{{.IPAddress}}{{end}}" "$1"
}

node_id="$(container_id v88-public-v88-node)"
go_id="$(container_id v88-public-go-api)"
worker_id="$(container_id v88-public-browser-worker)"
nginx_id="$(container_id v88-public-nginx)"
for id in "$node_id" "$go_id" "$worker_id" "$nginx_id"; do
  [ -n "$id" ] || { echo "required current V88 container is missing" >&2; exit 9; }
done

go_ip="$(container_ip "$go_id")"
worker_ip="$(container_ip "$worker_id")"
[ -n "$go_ip" ] && [ -n "$worker_ip" ] || { echo "Docker upstream IP resolution failed" >&2; exit 10; }

# The running Browser Worker is authoritative for its internal request secret.
# A Git-direct Node may outlive/restart independently from the Docker Node; inheriting
# the old Docker Node copy can therefore produce 401 unauthorized after a Worker change.
worker_secret="$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$worker_id" | grep '^QIANTIE_121_WORKER_SECRET=' | tail -n1 | cut -d= -f2-)"
[ -n "$worker_secret" ] || { echo "running 121 Browser Worker has no QIANTIE_121_WORKER_SECRET" >&2; exit 11; }
curl -fsS --connect-timeout 2 --max-time 5 \
  -H "x-qiantie-internal-secret: $worker_secret" \
  "http://$worker_ip:8787/healthz" >/dev/null \
  || { echo "running 121 Browser Worker rejected its configured internal secret" >&2; exit 12; }

mount_source_for() {
  local destination="$1"
  docker inspect -f "{{range .Mounts}}{{if eq .Destination \"$destination\"}}{{.Source}}{{end}}{{end}}" "$node_id"
}

prepare_persistence() {
  local destination="$1"
  local shared_path="$2"
  local source
  source="$(mount_source_for "$destination")"
  if [ -n "$source" ] && [ -d "$source" ]; then
    rm -rf "$release_dir${destination#/app}"
    ln -s "$source" "$release_dir${destination#/app}"
    return 0
  fi

  mkdir -p "$shared_path"
  if [ -z "$(find "$shared_path" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]; then
    docker cp "$node_id:$destination/." "$shared_path/" 2>/dev/null || true
  fi
  rm -rf "$release_dir${destination#/app}"
  ln -s "$shared_path" "$release_dir${destination#/app}"
}

mkdir -p "$SHARED_DATA" "$SHARED_OUTPUTS" "$ROOT/shared/env" "$RUNTIME_ROOT"
prepare_persistence /app/data "$SHARED_DATA"
prepare_persistence /app/outputs "$SHARED_OUTPUTS"

if [ ! -x "$NODE_HOME/bin/node" ] || [ "$($NODE_HOME/bin/node --version 2>/dev/null || true)" != "v$NODE_VERSION" ]; then
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' RETURN
  curl -fsSLo "$tmp/$NODE_ARCHIVE" "https://nodejs.org/dist/v$NODE_VERSION/$NODE_ARCHIVE"
  curl -fsSLo "$tmp/SHASUMS256.txt" "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt"
  (cd "$tmp" && grep "  $NODE_ARCHIVE\$" SHASUMS256.txt | sha256sum -c -)
  tar -xJf "$tmp/$NODE_ARCHIVE" -C "$RUNTIME_ROOT"
  rm -rf "$tmp"
  trap - RETURN
fi
[ "$($NODE_HOME/bin/node --version)" = "v$NODE_VERSION" ] || { echo "pinned Node runtime verification failed" >&2; exit 13; }

tmp_env="$(mktemp)"
trap 'rm -f "$tmp_env"' EXIT
docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$node_id" \
  | grep -vE '^(PATH|HOSTNAME|HOME|NODE_VERSION|YARN_VERSION|NODE_ENV|QIANTIE_NODE_PORT|QIANTIE_GO_BASE_URL|QIANTIE_121_BROWSER_WORKER_URL|QIANTIE_121_WORKER_SECRET|QIANTIE_RELEASE_SHA|QIANTIE_DEPLOY_MODE|QIANTIE_DEPLOYED_AT|QIANTIE_RELEASE_SHA_FILE)=' \
  > "$tmp_env"
printf '%s\n' \
  "NODE_ENV=production" \
  "QIANTIE_NODE_PORT=$STAGE_PORT" \
  "QIANTIE_GO_BASE_URL=http://$go_ip:4000" \
  "QIANTIE_121_BROWSER_WORKER_URL=http://$worker_ip:8787" \
  "QIANTIE_121_WORKER_SECRET=$worker_secret" \
  "QIANTIE_RELEASE_SHA=$sha" \
  "QIANTIE_RELEASE_SHA_FILE=$release_dir/RELEASE-SHA" \
  "QIANTIE_DEPLOY_MODE=git-direct-stage" \
  "QIANTIE_DEPLOYED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  >> "$tmp_env"
install -m 0600 "$tmp_env" "$STAGE_ENV"

cat > "$STAGE_UNIT" <<UNIT
[Unit]
Description=Qiantie V88 Node Parallel Stage
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$release_dir
EnvironmentFile=$STAGE_ENV
ExecStart=$NODE_HOME/bin/node server.js
Restart=on-failure
RestartSec=3
TimeoutStopSec=20

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl restart qiantie-v88-node-stage.service

build_info=""
for _ in $(seq 1 30); do
  if build_info="$(curl -fsS --max-time 3 "http://127.0.0.1:$STAGE_PORT/api/build-info" 2>/dev/null)"; then break; fi
  sleep 1
done
[ -n "$build_info" ] || { systemctl status qiantie-v88-node-stage.service --no-pager >&2 || true; exit 14; }

printf '%s' "$build_info" | python3 -c 'import json,sys; expected=sys.argv[1]; data=json.load(sys.stdin); assert data.get("git_sha")==expected, (data.get("git_sha"), expected)' "$sha"
curl -fsS --max-time 5 "http://127.0.0.1:$STAGE_PORT/" >/dev/null
docker exec "$nginx_id" sh -c "wget -qO- -T 5 http://$gateway:$STAGE_PORT/api/build-info" \
  | python3 -c 'import json,sys; expected=sys.argv[1]; data=json.load(sys.stdin); assert data.get("git_sha")==expected' "$sha"

printf 'V88_NODE_STAGE_OK sha=%s port=%s\n' "$sha" "$STAGE_PORT"
