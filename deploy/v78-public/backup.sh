#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  echo "ERROR: .env is missing." >&2
  exit 1
fi

set -a
source .env
set +a

BACKUP_ROOT="${QIANTIE_BACKUP_ROOT:-/opt/qiantie/backups}"
PASSPHRASE_FILE="${QIANTIE_BACKUP_PASSPHRASE_FILE:-/root/.qiantie-backup-passphrase}"

if [[ ! -f "$PASSPHRASE_FILE" ]]; then
  echo "ERROR: backup passphrase file is missing: $PASSPHRASE_FILE" >&2
  exit 1
fi

if find "$PASSPHRASE_FILE" -perm /077 -print -quit | grep -q .; then
  echo "ERROR: backup passphrase file permissions are too broad; require mode 600 or stricter." >&2
  exit 1
fi

COMPOSE=(docker compose --env-file .env -f docker-compose.yml)
"${COMPOSE[@]}" config -q

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_dir="${BACKUP_ROOT}/${timestamp}"
mkdir -p "$backup_dir"
chmod 700 "$BACKUP_ROOT" "$backup_dir"

cleanup_partial() {
  local code=$?
  if [[ "$code" != 0 ]]; then
    echo "ERROR: backup failed; partial files remain in $backup_dir for inspection." >&2
  fi
  exit "$code"
}
trap cleanup_partial ERR

"${COMPOSE[@]}" exec -T mysql sh -lc \
  'MYSQL_PWD="$MYSQL_PASSWORD" exec mysqldump --single-transaction --routines --events --triggers -u"$MYSQL_USER" "$MYSQL_DATABASE"' \
  | gzip -1 > "$backup_dir/mysql.sql.gz"

"${COMPOSE[@]}" exec -T v78-node tar -C /app/data -czf - . \
  > "$backup_dir/v78_data.tar.gz"
"${COMPOSE[@]}" exec -T v78-node tar -C /app/outputs -czf - . \
  > "$backup_dir/v78_outputs.tar.gz"
"${COMPOSE[@]}" exec -T browser-worker tar -C /data/sessions -czf - . \
  > "$backup_dir/browser_sessions.tar.gz"

openssl enc -aes-256-cbc -pbkdf2 -salt \
  -in .env \
  -out "$backup_dir/env.enc" \
  -pass "file:${PASSPHRASE_FILE}"

if [[ -f RELEASE-METADATA.txt ]]; then
  cp RELEASE-METADATA.txt "$backup_dir/RELEASE-METADATA.txt"
fi

(
  cd "$backup_dir"
  files=(mysql.sql.gz v78_data.tar.gz v78_outputs.tar.gz browser_sessions.tar.gz env.enc)
  if [[ -f RELEASE-METADATA.txt ]]; then
    files+=(RELEASE-METADATA.txt)
  fi
  sha256sum "${files[@]}" > SHA256SUMS
)

find "$backup_dir" -type f -exec chmod 600 {} +
trap - ERR

echo "BACKUP READY: $backup_dir"
echo "Verify with: (cd '$backup_dir' && sha256sum -c SHA256SUMS)"
