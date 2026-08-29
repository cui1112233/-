#!/usr/bin/env bash
set -euo pipefail

SOURCE_VOLUME=""
IMAGE=""
CLEANUP=false

usage() {
  cat <<'EOF'
Usage:
  scripts/verify-preset-volume-upgrade.sh \
    --source-volume <production-app-data-volume> \
    --image <candidate-web-image> \
    [--cleanup]

This command NEVER migrates the source volume in place. It creates a temporary
Docker volume, copies the source volume with the source mounted read-only, and
runs the candidate image against the temporary copy.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --source-volume)
      [ "$#" -ge 2 ] || { echo "ERROR: --source-volume requires a value" >&2; exit 2; }
      SOURCE_VOLUME="$2"
      shift 2
      ;;
    --image)
      [ "$#" -ge 2 ] || { echo "ERROR: --image requires a value" >&2; exit 2; }
      IMAGE="$2"
      shift 2
      ;;
    --cleanup)
      CLEANUP=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "ERROR: unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

[ -n "$SOURCE_VOLUME" ] || { echo "ERROR: --source-volume is required" >&2; exit 2; }
[ -n "$IMAGE" ] || { echo "ERROR: --image is required" >&2; exit 2; }
command -v docker >/dev/null 2>&1 || { echo "ERROR: docker CLI is required" >&2; exit 2; }

docker volume inspect "$SOURCE_VOLUME" >/dev/null 2>&1 || {
  echo "ERROR: Docker volume does not exist: $SOURCE_VOLUME" >&2
  exit 2
}

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
TEMP_VOLUME="qiantie-preset-upgrade-${stamp}-$$"

if [ "$SOURCE_VOLUME" = "$TEMP_VOLUME" ]; then
  echo "ERROR: temporary volume must differ from source volume" >&2
  exit 2
fi

echo "[1/5] Creating isolated temporary volume: $TEMP_VOLUME"
docker volume create "$TEMP_VOLUME" >/dev/null

echo "[2/5] Copying source volume read-only -> temporary volume"
docker run --rm \
  -v "${SOURCE_VOLUME}:/from:ro" \
  -v "${TEMP_VOLUME}:/to" \
  alpine:3.20 \
  sh -eu -c 'cp -a /from/. /to/'

echo "[3/5] Running candidate preset migration against temporary volume only"
docker run --rm \
  -v "${TEMP_VOLUME}:/app/data" \
  --entrypoint node \
  "$IMAGE" \
  -e '
    const fs = require("node:fs");
    const { createPresetStore } = require("/app/lib/preset-store");
    const systemDir = "/app/data/system";
    const store = createPresetStore({ systemDir });
    for (const moduleId of ["script", "novel-panel", "batch-factory"]) {
      store.listAll(moduleId);
    }
    const marker = JSON.parse(fs.readFileSync(`${systemDir}/preset-store-schema.json`, "utf8"));
    if (marker.schemaVersion !== 2) throw new Error("unexpected preset schema marker");
    console.log(JSON.stringify({ schemaVersion: marker.schemaVersion, quarantinedRecords: marker.quarantinedRecords }));
  '

echo "[4/5] Verifying migration evidence in temporary volume"
docker run --rm \
  -v "${TEMP_VOLUME}:/data:ro" \
  alpine:3.20 \
  sh -eu -c '
    test -f /data/system/preset-store-schema.json
    test -d /data/system/preset-store-backups
    test -f /data/system/preset-store-migration-audit.json
    test -f /data/system/preset-store-quarantine.json
    echo "--- schema marker ---"
    cat /data/system/preset-store-schema.json
    echo "--- quarantine ---"
    cat /data/system/preset-store-quarantine.json
    echo "--- migration audit ---"
    cat /data/system/preset-store-migration-audit.json
    echo "--- backups ---"
    ls -la /data/system/preset-store-backups
  '

echo "[5/5] Isolated migration drill completed successfully"
echo "Source volume was mounted read-only and was not modified: $SOURCE_VOLUME"
echo "Temporary migrated volume: $TEMP_VOLUME"
echo "Candidate image: $IMAGE"
echo
echo "Next manual verification should use the TEMPORARY volume only."
echo "Verify login, Settings, Prompt Library, novel acquisition, and Batch Factory before any production cutover."
echo "For example, create an isolated compose override mapping app_data to external volume: $TEMP_VOLUME"

if [ "$CLEANUP" = true ]; then
  echo "--cleanup requested; deleting temporary verification volume: $TEMP_VOLUME"
  docker volume rm "$TEMP_VOLUME" >/dev/null
else
  echo "Temporary volume retained for Codex/operator review."
  echo "Delete it only after review: docker volume rm $TEMP_VOLUME"
fi
