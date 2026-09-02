#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ACTIVE_DIR="${ACTIVE_DIR:-$SCRIPT_DIR}"
cd "$ACTIVE_DIR"

if [[ -f .env ]]; then
  set -a
  source .env
  set +a
fi

RELEASE_ROOT="${QIANTIE_RELEASE_ROOT:-/opt/qiantie/releases}"
release_id="${1:-$(date -u +%Y%m%dT%H%M%SZ)}"
release_path="${RELEASE_ROOT}/${release_id}"
snapshot_dir="${release_path}/snapshot"

mkdir -p "$snapshot_dir"
chmod 700 "$release_path" "$snapshot_dir"

for required in docker-compose.yml nginx.conf; do
  if [[ ! -f "$required" ]]; then
    echo "ERROR: active deployment file missing: ${ACTIVE_DIR}/${required}"
    exit 1
  fi
done

cp docker-compose.yml "$snapshot_dir/docker-compose.yml"
cp nginx.conf "$snapshot_dir/nginx.conf"
chmod 600 "$snapshot_dir/docker-compose.yml" "$snapshot_dir/nginx.conf"

if [[ -f RELEASE-METADATA.txt ]]; then
  cp RELEASE-METADATA.txt "$snapshot_dir/RELEASE-METADATA.txt"
  chmod 600 "$snapshot_dir/RELEASE-METADATA.txt"
fi

images=(
  qiantie-v78-node
  qiantie-go-api
  qiantie-121-browser-worker
)

: > "$snapshot_dir/IMAGE-TAGS.txt"
chmod 600 "$snapshot_dir/IMAGE-TAGS.txt"
missing=0
for image in "${images[@]}"; do
  if ! docker image inspect "${image}:public-v78" >/dev/null 2>&1; then
    echo "WARN: current application image missing: ${image}:public-v78" >&2
    missing=$((missing + 1))
    continue
  fi

  image_id="$(docker image inspect --format '{{.Id}}' "${image}:public-v78")"
  rollback_tag="${image}:release-${release_id}"
  docker tag "${image}:public-v78" "$rollback_tag"
  printf '%s\t%s\t%s\n' "$image" "$image_id" "$rollback_tag" >> "$snapshot_dir/IMAGE-TAGS.txt"
done

if (( missing > 0 )) && [[ "${QIANTIE_ALLOW_EMPTY_SNAPSHOT:-0}" != "1" ]]; then
  echo "ERROR: snapshot is incomplete; refusing upgrade. Set QIANTIE_ALLOW_EMPTY_SNAPSHOT=1 only for a true first installation."
  exit 1
fi

if (( missing == ${#images[@]} )); then
  printf 'first-install=true\n' > "$snapshot_dir/SNAPSHOT-METADATA.txt"
else
  printf 'first-install=false\n' > "$snapshot_dir/SNAPSHOT-METADATA.txt"
fi
printf 'release_id=%s\n' "$release_id" >> "$snapshot_dir/SNAPSHOT-METADATA.txt"
printf 'created_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$snapshot_dir/SNAPSHOT-METADATA.txt"
chmod 600 "$snapshot_dir/SNAPSHOT-METADATA.txt"

ln -sfn "$release_path" "$RELEASE_ROOT/previous"
printf '%s\n' "$release_id"
