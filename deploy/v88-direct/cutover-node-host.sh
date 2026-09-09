#!/usr/bin/env bash
set -Eeuo pipefail

target_sha="${1:-}"
if [[ ! "$target_sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "usage: cutover-node-host.sh <40-char-git-sha>" >&2
  exit 2
fi

NETWORK=v88-public_qiantie_internal
STAGE_PORT=18081
STAGE_ENV=/opt/qiantie/v88/shared/env/v88-stage.env
STAGE_UNIT=qiantie-v88-node-stage.service
NGINX_DEST=/etc/nginx/conf.d/default.conf

nginx_id="$(docker ps --filter 'name=v88-public-nginx' --format '{{.ID}}' | head -n1)"
[ -n "$nginx_id" ] || { echo "running V88 Nginx container not found" >&2; exit 3; }

node_id="$(docker ps --filter 'name=v88-public-v88-node' --format '{{.ID}}' | head -n1)"
[ -n "$node_id" ] || { echo "running V88 Docker Node container not found" >&2; exit 3; }

gateway="$(docker network inspect "$NETWORK" --format '{{(index .IPAM.Config 0).Gateway}}')"
[ -n "$gateway" ] || { echo "V88 Docker bridge gateway not found" >&2; exit 4; }
NEW_UPSTREAM="${gateway}:${STAGE_PORT}"

# Discover every endpoint that can legitimately identify the currently running
# Docker Node on the V88 internal network. This keeps cutover compatible with
# Compose aliases (for example v88-node:3000), concrete container names, and
# the current container IP without ever doing a broad :3000 replacement.
node_name="$(docker inspect -f '{{.Name}}' "$node_id" | sed 's#^/##')"
node_ip="$(docker inspect -f "{{with index .NetworkSettings.Networks \"$NETWORK\"}}{{.IPAddress}}{{end}}" "$node_id")"
mapfile -t node_aliases < <(
  docker inspect -f "{{with index .NetworkSettings.Networks \"$NETWORK\"}}{{range .Aliases}}{{println .}}{{end}}{{end}}" "$node_id" \
    | sed '/^$/d'
)

current_node_endpoints=()
add_current_node_endpoint() {
  value="${1:-}"
  [ -n "$value" ] || return 0
  endpoint="${value}:3000"
  for existing in "${current_node_endpoints[@]:-}"; do
    [ "$existing" = "$endpoint" ] && return 0
  done
  current_node_endpoints+=("$endpoint")
}
add_current_node_endpoint "$node_name"
add_current_node_endpoint "$node_ip"
for node_alias in "${node_aliases[@]:-}"; do
  add_current_node_endpoint "$node_alias"
done
[ "${#current_node_endpoints[@]}" -gt 0 ] || { echo "no live Docker Node endpoints discovered" >&2; exit 4; }

validate_build_info() {
  expected_sha="$1"
  expected_mode="${2:-}"
  python3 -c 'import json,sys; data=json.load(sys.stdin); expected=sys.argv[1]; mode=sys.argv[2]; assert data.get("git_sha")==expected, (data.get("git_sha"), expected); assert not mode or data.get("deploy_mode")==mode, (data.get("deploy_mode"), mode)' "$expected_sha" "$expected_mode"
}

# Prove the staged host Node is healthy and reachable from both the host and
# the currently running Nginx container before touching public routing.
curl -fsS --max-time 5 "http://127.0.0.1:${STAGE_PORT}/api/build-info" \
  | validate_build_info "$target_sha"
docker exec "$nginx_id" sh -c "wget -qO- -T 5 http://${NEW_UPSTREAM}/api/build-info" \
  | validate_build_info "$target_sha"

config_source="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/etc/nginx/conf.d/default.conf"}}{{.Source}}{{end}}{{end}}' "$nginx_id")"
[ -n "$config_source" ] && [ -f "$config_source" ] || { echo "mounted Nginx config source not found" >&2; exit 5; }
[ -f "$STAGE_ENV" ] || { echo "staging environment file not found" >&2; exit 6; }

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup="${config_source}.backup-${target_sha}-${stamp}"
env_backup="${STAGE_ENV}.backup-${target_sha}-${stamp}"
cp -a "$config_source" "$backup"
cp -a "$STAGE_ENV" "$env_backup"

rollback() {
  status=$?
  trap - ERR
  echo "V88 Node cutover failed; rollback to previous Nginx Node upstream" >&2
  if [ -f "$backup" ]; then
    cat "$backup" > "$config_source"
    docker exec "$nginx_id" nginx -t >/dev/null
    docker exec "$nginx_id" nginx -s reload >/dev/null
  fi
  if [ -f "$env_backup" ]; then
    install -m 0600 "$env_backup" "$STAGE_ENV"
    systemctl restart "$STAGE_UNIT" >/dev/null 2>&1 || true
  fi
  curl -fsS --max-time 10 http://127.0.0.1:3000/api/build-info >/dev/null 2>&1 || true
  exit "$status"
}
trap rollback ERR

# Promote the already verified stage process to the public git-direct identity.
# Public traffic is still on the old Docker Node at this point.
tmp_env="$(mktemp)"
tmp_conf="$(mktemp)"
cleanup_tmp() { rm -f "$tmp_env" "$tmp_conf"; }
trap cleanup_tmp EXIT
grep -vE '^(QIANTIE_DEPLOY_MODE|QIANTIE_DEPLOYED_AT)=' "$STAGE_ENV" > "$tmp_env"
printf 'QIANTIE_DEPLOY_MODE=git-direct\nQIANTIE_DEPLOYED_AT=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$tmp_env"
install -m 0600 "$tmp_env" "$STAGE_ENV"
systemctl restart "$STAGE_UNIT"

build_info=""
for _ in $(seq 1 30); do
  if build_info="$(curl -fsS --max-time 3 "http://127.0.0.1:${STAGE_PORT}/api/build-info" 2>/dev/null)"; then
    if printf '%s' "$build_info" | validate_build_info "$target_sha" git-direct; then
      break
    fi
  fi
  build_info=""
  sleep 1
done
[ -n "$build_info" ] || { echo "promoted host Node did not become healthy" >&2; exit 7; }

# Replace only endpoints proven to belong to the currently running Docker Node.
# Go/worker routes and every other Nginx rule remain byte-for-byte unchanged.
# Docker Node stays running as the rollback target.
matching_node_endpoints=()
for endpoint in "${current_node_endpoints[@]}"; do
  if grep -Fq "$endpoint" "$config_source"; then
    matching_node_endpoints+=("$endpoint")
  fi
done

if [ "${#matching_node_endpoints[@]}" -gt 0 ]; then
  python3 - "$config_source" "$tmp_conf" "$NEW_UPSTREAM" "${matching_node_endpoints[@]}" <<'PY'
import re
import sys

source, target, replacement, *endpoints = sys.argv[1:]
text = open(source, 'r', encoding='utf-8').read()
changed = 0
for endpoint in endpoints:
    pattern = r'(?<![A-Za-z0-9._-])' + re.escape(endpoint) + r'(?![A-Za-z0-9._-])'
    text, count = re.subn(pattern, replacement, text)
    changed += count
if changed < 1:
    raise SystemExit('no exact live Docker Node endpoint was replaced')
with open(target, 'w', encoding='utf-8') as fh:
    fh.write(text)
print(f'NODE_UPSTREAM_REPLACEMENTS={changed}')
PY
  cat "$tmp_conf" > "$config_source"
elif grep -Fq "$NEW_UPSTREAM" "$config_source"; then
  echo "Nginx already points to ${NEW_UPSTREAM}; verifying idempotently."
else
  echo "no discovered live Docker Node endpoint or staged upstream exists in Nginx config" >&2
  printf 'discovered_node_endpoint=%s\n' "${current_node_endpoints[@]}" >&2
  exit 8
fi

docker exec "$nginx_id" nginx -t
docker exec "$nginx_id" nginx -s reload

public_info=""
for _ in $(seq 1 20); do
  if public_info="$(curl -fsS --max-time 4 http://127.0.0.1:3000/api/build-info 2>/dev/null)"; then
    if printf '%s' "$public_info" | validate_build_info "$target_sha" git-direct; then
      break
    fi
  fi
  public_info=""
  sleep 1
done
[ -n "$public_info" ] || { echo "public route did not switch to requested Git SHA" >&2; exit 9; }
curl -fsS --max-time 10 http://127.0.0.1:3000/ >/dev/null

trap - ERR
cleanup_tmp
trap - EXIT
printf 'V88_NODE_PUBLIC_CUTOVER_OK sha=%s upstream=%s\n' "$target_sha" "$NEW_UPSTREAM"
