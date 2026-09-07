#!/usr/bin/env bash
set -Eeuo pipefail

release_dir="${1:-}"
sha="${2:-}"
change_env_file="${3:-$release_dir/.deploy-changes.env}"

if [ -z "$release_dir" ] || [ -z "$sha" ]; then
  echo "usage: deploy.sh <release_dir> <sha> [change_env_file]" >&2
  exit 2
fi

ROOT=/opt/qiantie/v88
SHARED="$ROOT/shared"
CURRENT_LINK="$ROOT/current"
PREVIOUS_LINK="$ROOT/previous"
ENV_FILE="$SHARED/env/v88.env"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

case "$release_dir" in
  /opt/qiantie/releases/v88/*) ;;
  *) echo "release must live under /opt/qiantie/releases/v88" >&2; exit 3 ;;
esac

[ -f "$release_dir/package.json" ] || { echo "release source is incomplete" >&2; exit 4; }
[ -r "$ENV_FILE" ] || { echo "runtime env is missing: $ENV_FILE" >&2; exit 5; }

FRONTEND_CHANGED=1
NODE_CHANGED=1
GO_CHANGED=1
WORKER_CHANGED=1
MIGRATIONS_CHANGED=0
if [ -r "$change_env_file" ]; then
  # File is generated only by our classifier and validated below before use.
  # shellcheck disable=SC1090
  source "$change_env_file"
fi
for flag in FRONTEND_CHANGED NODE_CHANGED GO_CHANGED WORKER_CHANGED MIGRATIONS_CHANGED; do
  value="${!flag:-}"
  case "$value" in 0|1) ;; *) echo "invalid change flag: $flag=$value" >&2; exit 6 ;; esac
done

previous_target=""
if [ -L "$CURRENT_LINK" ]; then
  previous_target="$(readlink -f "$CURRENT_LINK" || true)"
fi

restart_affected() {
  if [ "$GO_CHANGED" = "1" ]; then systemctl restart qiantie-v88-go.service; fi
  if [ "$WORKER_CHANGED" = "1" ]; then systemctl restart qiantie-v88-browser-worker.service; fi
  if [ "$NODE_CHANGED" = "1" ] || [ "$FRONTEND_CHANGED" = "1" ]; then systemctl restart qiantie-v88-node.service; fi
}

rollback() {
  status=$?
  trap - ERR
  echo "V88 direct deploy failed; rolling back to previous release" >&2
  if [ -n "$previous_target" ] && [ -d "$previous_target" ]; then
    ln -sfn "$previous_target" "$CURRENT_LINK"
    restart_affected || true
    "$SCRIPT_DIR/health-check.sh" || true
  else
    systemctl stop qiantie-v88-node.service qiantie-v88-go.service qiantie-v88-browser-worker.service >/dev/null 2>&1 || true
  fi
  exit "$status"
}
trap rollback ERR

"$SCRIPT_DIR/prepare-release.sh" "$release_dir" "$sha"
printf 'QIATIE_RELEASE_SHA=%s\nQIATIE_DEPLOY_MODE=git-direct\nQIATIE_DEPLOYED_AT=%s\n' \
  "$sha" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$release_dir/RELEASE-ENV"

install -d -m 0755 "$SHARED/cache/root-node" "$SHARED/cache/frontend-node" "$SHARED/cache/worker-node" "$SHARED/playwright"

link_shared_dir() {
  target="$1"
  link="$2"
  if [ -e "$link" ] && [ ! -L "$link" ]; then
    echo "refusing to replace non-symlink runtime path: $link" >&2
    return 1
  fi
  ln -sfn "$target" "$link"
}
link_shared_dir "$SHARED/data" "$release_dir/data"
link_shared_dir "$SHARED/outputs" "$release_dir/outputs"

cache_npm_modules() {
  workdir="$1"
  cache_root="$2"
  omit_dev="$3"
  lock="$workdir/package-lock.json"
  [ -f "$lock" ] || { echo "missing lockfile: $lock" >&2; return 1; }
  hash="$(sha256sum "$lock" | awk '{print $1}')"
  cache="$cache_root/$hash"
  if [ ! -d "$cache" ]; then
    rm -f "$workdir/node_modules"
    if [ "$omit_dev" = "1" ]; then
      (cd "$workdir" && npm ci --omit=dev)
    else
      (cd "$workdir" && npm ci)
    fi
    mv "$workdir/node_modules" "$cache"
  fi
  rm -f "$workdir/node_modules"
  ln -s "$cache" "$workdir/node_modules"
}

# Root dependencies are tiny, but cache them by lock hash so UI-only releases do
# not repeatedly download the same production packages.
cache_npm_modules "$release_dir" "$SHARED/cache/root-node" 1

if [ "$FRONTEND_CHANGED" = "1" ] || [ ! -s "$release_dir/frontend/dist/index.html" ]; then
  cache_npm_modules "$release_dir/frontend" "$SHARED/cache/frontend-node" 0
  (cd "$release_dir/frontend" && npm run build)
fi

if [ "$GO_CHANGED" = "1" ]; then
  command -v go >/dev/null 2>&1 || { echo "Go toolchain is required for backend changes" >&2; exit 20; }
  (cd "$release_dir/backend" && go test ./...)
  install -d -m 0755 "$release_dir/bin"
  (cd "$release_dir/backend" && go build -trimpath -o "$release_dir/bin/qiantie" ./cmd/qiantie)
elif [ -n "$previous_target" ] && [ -x "$previous_target/bin/qiantie" ]; then
  install -d -m 0755 "$release_dir/bin"
  cp -a "$previous_target/bin/qiantie" "$release_dir/bin/qiantie"
fi

if [ "$WORKER_CHANGED" = "1" ]; then
  worker="$release_dir/services/121-browser-worker"
  cache_npm_modules "$worker" "$SHARED/cache/worker-node" 1
  export PLAYWRIGHT_BROWSERS_PATH="$SHARED/playwright"
  playwright_version="$(node -p "require('$worker/node_modules/playwright/package.json').version")"
  version_file="$SHARED/playwright/.qiantie-playwright-version"
  installed_version="$(cat "$version_file" 2>/dev/null || true)"
  if [ "$installed_version" != "$playwright_version" ]; then
    (cd "$worker" && npx playwright install --with-deps chromium)
    printf '%s\n' "$playwright_version" > "$version_file"
  fi
elif [ -n "$previous_target" ] && [ -L "$previous_target/services/121-browser-worker/node_modules" ]; then
  worker="$release_dir/services/121-browser-worker"
  ln -sfn "$(readlink -f "$previous_target/services/121-browser-worker/node_modules")" "$worker/node_modules"
fi

if [ "$MIGRATIONS_CHANGED" = "1" ]; then
  migration_dir=""
  for candidate in "$release_dir/backend/migrations" "$release_dir/migrations" "$release_dir/database/migrations"; do
    if [ -d "$candidate" ]; then migration_dir="$candidate"; break; fi
  done
  [ -n "$migration_dir" ] || { echo "migration flag set but no Goose migration directory exists" >&2; exit 30; }
  command -v goose >/dev/null 2>&1 || { echo "goose is required for migration changes" >&2; exit 31; }
  mysql_dsn="$(sed -n 's/^QIANTIE_MYSQL_DSN=//p' "$ENV_FILE" | tail -n 1 | sed -e 's/^"//' -e 's/"$//')"
  [ -n "$mysql_dsn" ] || { echo "QIANTIE_MYSQL_DSN is required for migrations" >&2; exit 32; }
  goose -dir "$migration_dir" mysql "$mysql_dsn" up
fi

BUILD_PRECHECK_COMPLETE=1

if [ -n "$previous_target" ]; then
  ln -sfn "$previous_target" "$PREVIOUS_LINK"
fi
ln -sfn "$release_dir" "$CURRENT_LINK"

restart_affected
"$SCRIPT_DIR/health-check.sh"
trap - ERR

printf 'V88_DIRECT_DEPLOY_OK sha=%s\n' "$sha"
