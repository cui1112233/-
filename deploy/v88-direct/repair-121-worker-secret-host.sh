#!/usr/bin/env bash
set -Eeuo pipefail

ENV_FILE=/opt/qiantie/v88/shared/env/v88-stage.env
SERVICE=qiantie-v88-node-stage.service
NETWORK=v88-public_qiantie_internal
NODE_URL=http://127.0.0.1:18081
backup=""
tmp=""

cleanup() {
  if [ -n "$tmp" ]; then rm -f "$tmp" 2>/dev/null || true; fi
}

rollback() {
  local code=$?
  trap - ERR
  if [ -n "$backup" ] && [ -f "$backup" ]; then
    cp -a "$backup" "$ENV_FILE" || true
    systemctl restart "$SERVICE" || true
  fi
  cleanup
  exit "$code"
}
trap 'rollback' ERR
trap 'cleanup' EXIT

[ -f "$ENV_FILE" ] || { echo "V88 stage env missing: $ENV_FILE" >&2; exit 2; }
systemctl is-active --quiet "$SERVICE" || { echo "V88 Git-direct Node service is not active" >&2; exit 3; }
docker network inspect "$NETWORK" >/dev/null

before_info="$(curl -fsS --max-time 5 "$NODE_URL/api/build-info")"
before_sha="$(printf '%s' "$before_info" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("git_sha", ""))')"
[ -n "$before_sha" ] || { echo "current Node build SHA is empty" >&2; exit 4; }

worker_id="$(docker ps --filter 'name=v88-public-browser-worker' --format '{{.ID}}' | head -n1)"
[ -n "$worker_id" ] || { echo "running 121 Browser Worker container not found" >&2; exit 5; }
worker_ip="$(docker inspect -f "{{with index .NetworkSettings.Networks \"$NETWORK\"}}{{.IPAddress}}{{end}}" "$worker_id")"
[ -n "$worker_ip" ] || { echo "121 Browser Worker IP not found" >&2; exit 6; }
worker_secret="$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$worker_id" | grep '^QIANTIE_121_WORKER_SECRET=' | tail -n1 | cut -d= -f2-)"
[ -n "$worker_secret" ] || { echo "121 Browser Worker internal secret is missing" >&2; exit 7; }

# Prove the Worker accepts its own configured secret before changing Node.
curl -fsS --connect-timeout 2 --max-time 5 \
  -H "x-qiantie-internal-secret: $worker_secret" \
  "http://$worker_ip:8787/healthz" >/dev/null

backup="${ENV_FILE}.bak-121-$(date -u +%Y%m%dT%H%M%SZ)"
cp -a "$ENV_FILE" "$backup"
tmp="$(mktemp)"
grep -v '^QIANTIE_121_WORKER_SECRET=' "$ENV_FILE" > "$tmp"
printf 'QIANTIE_121_WORKER_SECRET=%s\n' "$worker_secret" >> "$tmp"
install -m 0600 "$tmp" "$ENV_FILE"

systemctl restart qiantie-v88-node-stage.service

after_info=""
for _ in $(seq 1 30); do
  if after_info="$(curl -fsS --max-time 3 "$NODE_URL/api/build-info" 2>/dev/null)"; then
    break
  fi
  sleep 1
done
[ -n "$after_info" ] || { echo "Node did not recover after secret repair" >&2; exit 8; }
after_sha="$(printf '%s' "$after_info" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("git_sha", ""))')"
[ "$before_sha" = "$after_sha" ] || { echo "Node build SHA changed unexpectedly: before=$before_sha after=$after_sha" >&2; exit 9; }

node_secret="$(grep '^QIANTIE_121_WORKER_SECRET=' "$ENV_FILE" | tail -n1 | cut -d= -f2-)"
[ -n "$node_secret" ] || { echo "repaired Node worker secret is missing" >&2; exit 10; }
node_hash="$(printf '%s' "$node_secret" | sha256sum | awk '{print $1}')"
worker_hash="$(printf '%s' "$worker_secret" | sha256sum | awk '{print $1}')"
[ "$node_hash" = "$worker_hash" ] || { echo "Node and Worker secret hashes still differ" >&2; exit 11; }

# Prove the repaired Node-side secret now authenticates to the live Worker.
curl -fsS --connect-timeout 2 --max-time 5 \
  -H "x-qiantie-internal-secret: $node_secret" \
  "http://$worker_ip:8787/healthz" >/dev/null
curl -fsS --max-time 5 "$NODE_URL/" >/dev/null

trap - ERR
rm -f "$backup"
backup=""
printf 'V88_121_SECRET_REPAIR_OK sha=%s worker_ip=%s\n' "$after_sha" "$worker_ip"
