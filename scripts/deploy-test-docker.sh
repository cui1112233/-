#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE_FILE="$ROOT/deploy/docker-compose.test.yml"
ENV_FILE="$ROOT/deploy/.env.test-docker"
ACTION="${1:-up}"

random_hex() {
  openssl rand -hex "$1"
}

architecture() {
  case "$(uname -m)" in
    arm64|aarch64) printf 'arm64\n' ;;
    x86_64|amd64) printf 'amd64\n' ;;
    *) echo "unsupported Docker architecture: $(uname -m)" >&2; exit 1 ;;
  esac
}

ensure_env() {
  if [[ -f "$ENV_FILE" ]]; then
    return
  fi
  umask 077
  cat > "$ENV_FILE" <<EOF
NODE_IMAGE=node:24-alpine
QIANTIE_ARCH=$(architecture)
QIANTIE_PLATFORM_PORT=3000
QIANTIE_BACKEND_PORT=14000
MYSQL_PASSWORD=$(random_hex 24)
MYSQL_ROOT_PASSWORD=$(random_hex 24)
QIANTIE_TOKEN_SECRET=$(random_hex 32)
QIANTIE_BRIDGE_SECRET=$(random_hex 32)
QIANTIE_CREDENTIAL_ENCRYPTION_KEY=$(openssl rand -base64 32 | tr -d '\n')
QIANTIE_SEED_USERNAME=choushiyiguai
QIANTIE_SEED_PASSWORD=123456
QIANTIE_MODEL_CREDENTIALS=
QIANTIE_MODEL_ENDPOINTS=
EOF
}

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

env_value() {
  local key="$1"
  grep "^${key}=" "$ENV_FILE" | head -1 | cut -d= -f2-
}

port_available() {
  local port="$1"
  ! lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
}

stack_owns_port() {
  local service="$1"
  local container_port="$2"
  local host_port="$3"
  compose ps --status running -q "$service" 2>/dev/null | grep -q . \
    && compose port "$service" "$container_port" 2>/dev/null | grep -Eq ":${host_port}$"
}

ensure_env
PLATFORM_PORT="$(env_value QIANTIE_PLATFORM_PORT)"
BACKEND_PORT="$(env_value QIANTIE_BACKEND_PORT)"

case "$ACTION" in
  up)
    if ! port_available "$PLATFORM_PORT" && ! stack_owns_port platform 3000 "$PLATFORM_PORT"; then
      echo "port $PLATFORM_PORT is already in use; stop the process using the Docker production port or set QIANTIE_PLATFORM_PORT in $ENV_FILE." >&2
      exit 1
    fi
    if ! port_available "$BACKEND_PORT" && ! stack_owns_port backend 4000 "$BACKEND_PORT"; then
      echo "port $BACKEND_PORT is already in use; set QIANTIE_BACKEND_PORT in $ENV_FILE." >&2
      exit 1
    fi
    "$ROOT/scripts/build-test-docker-artifacts.sh" >/dev/null
    compose up --build -d
    "$0" health
    ;;
  down)
    compose down
    ;;
  clean)
    compose down -v
    ;;
  ps)
    compose ps
    ;;
  logs)
    compose logs -f
    ;;
  health)
    for _ in $(seq 1 30); do
      if curl -fsS "http://127.0.0.1:${BACKEND_PORT}/healthz" >/dev/null 2>&1; then
        break
      fi
      sleep 1
    done
    curl -fsS "http://127.0.0.1:${BACKEND_PORT}/healthz"
    printf '\n'
    curl -fsS "http://127.0.0.1:${PLATFORM_PORT}/shuihuo-production" | grep -q '<div id="root"></div>'
    echo "platform: http://127.0.0.1:${PLATFORM_PORT}/shuihuo-production"
    ;;
  *)
    echo "usage: $0 [up|down|clean|ps|logs|health]" >&2
    exit 2
    ;;
esac
