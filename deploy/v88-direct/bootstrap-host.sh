#!/usr/bin/env bash
set -Eeuo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "bootstrap-host.sh must run as root" >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT=/opt/qiantie/v88
SHARED="$ROOT/shared"
RELEASE_ROOT=/opt/qiantie/releases/v88
ENV_FILE="$SHARED/env/v88.env"

if ! id qiantie >/dev/null 2>&1; then
  useradd --system --home-dir "$ROOT" --shell /usr/sbin/nologin qiantie
fi

install -d -m 0755 "$ROOT" "$RELEASE_ROOT"
install -d -o qiantie -g qiantie -m 0755 \
  "$SHARED/env" \
  "$SHARED/data" \
  "$SHARED/outputs" \
  "$SHARED/browser-worker-sessions" \
  "$SHARED/playwright" \
  "$SHARED/logs"

if [ ! -e "$ENV_FILE" ]; then
  install -o root -g qiantie -m 0640 /dev/null "$ENV_FILE"
  cat > "$ENV_FILE" <<'ENV'
# Production secrets and runtime values belong here, never in Git.
QIANTIE_NODE_PORT=18081
QIANTIE_GO_LISTEN_ADDR=127.0.0.1:4000
QIANTIE_121_BROWSER_WORKER_URL=http://127.0.0.1:8787
PLAYWRIGHT_BROWSERS_PATH=/opt/qiantie/v88/shared/playwright
ENV
  chown root:qiantie "$ENV_FILE"
  chmod 0640 "$ENV_FILE"
fi

for unit in qiantie-v88-node.service qiantie-v88-go.service qiantie-v88-browser-worker.service; do
  install -m 0644 "$SCRIPT_DIR/systemd/$unit" "/etc/systemd/system/$unit"
done

systemctl daemon-reload
systemctl enable qiantie-v88-node.service qiantie-v88-go.service qiantie-v88-browser-worker.service >/dev/null

# Fail closed on missing host runtime. Installation is deliberately separate so
# bootstrap cannot unexpectedly replace production packages.
command -v node >/dev/null 2>&1 || { echo "Node.js is required" >&2; exit 10; }
command -v npm >/dev/null 2>&1 || { echo "npm is required" >&2; exit 11; }
command -v curl >/dev/null 2>&1 || { echo "curl is required" >&2; exit 12; }
command -v Xvfb >/dev/null 2>&1 || { echo "Xvfb is required for Browser Worker" >&2; exit 13; }

node_major="$(node -p 'Number(process.versions.node.split(`.`)[0])')"
if [ "$node_major" -lt 22 ]; then
  echo "Node.js 22+ is required, found $(node -v)" >&2
  exit 14
fi

printf 'V88_HOST_BOOTSTRAP_OK\n'
