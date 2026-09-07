#!/usr/bin/env bash
set -Eeuo pipefail

ENV_FILE="${QIATIE_V88_ENV_FILE:-/opt/qiantie/v88/shared/env/v88.env}"
NODE_PORT=18081
GO_ADDR=127.0.0.1:4000
WORKER_PORT=8787
PUBLIC_URL="${QIATIE_PUBLIC_HEALTH_URL:-}"

read_env_value() {
  key="$1"
  [ -r "$ENV_FILE" ] || return 0
  sed -n "s/^${key}=//p" "$ENV_FILE" | tail -n 1 | sed -e 's/^"//' -e 's/"$//'
}

value="$(read_env_value QIANTIE_NODE_PORT)"
[ -z "$value" ] || NODE_PORT="$value"
value="$(read_env_value QIANTIE_GO_LISTEN_ADDR)"
[ -z "$value" ] || GO_ADDR="$value"
GO_ADDR="${GO_ADDR/0.0.0.0/127.0.0.1}"
GO_ADDR="${GO_ADDR/#:/127.0.0.1:}"
worker_secret="$(read_env_value QIANTIE_121_WORKER_SECRET)"

curl -fsS --max-time 10 "http://127.0.0.1:${NODE_PORT}/" >/dev/null
curl -fsS --max-time 10 "http://${GO_ADDR}/health" >/dev/null
if [ -n "$worker_secret" ]; then
  curl -fsS --max-time 10 -H "x-qiantie-internal-secret: ${worker_secret}" "http://127.0.0.1:${WORKER_PORT}/healthz" >/dev/null
else
  echo "QIANTIE_121_WORKER_SECRET is missing from runtime env" >&2
  exit 21
fi

if [ -n "$PUBLIC_URL" ]; then
  curl -fsS --max-time 15 "$PUBLIC_URL" >/dev/null
fi

printf 'V88_DIRECT_HEALTH_OK\n'
