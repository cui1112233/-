#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$ROOT/../.." && pwd)"
cd "$ROOT"

fail() {
  echo "CONTRACT FAIL: $*" >&2
  exit 1
}

require_file() {
  [[ -f "$1" ]] || fail "missing file: $1"
}

require_text() {
  local pattern="$1"
  local file="$2"
  grep -q -- "$pattern" "$file" || fail "missing pattern '$pattern' in $file"
}

forbid_text() {
  local pattern="$1"
  local file="$2"
  if grep -q -- "$pattern" "$file"; then
    fail "forbidden pattern '$pattern' in $file"
  fi
}

require_text '^PUBLIC_PORT=3000$' .env.example
require_text '\${PUBLIC_PORT}:80' docker-compose.yml
forbid_text '"80:80"' docker-compose.yml
for forbidden in '3000:3000' '4000:4000' '3306:3306' '8787:8787'; do
  forbid_text "$forbidden" docker-compose.yml
done

require_text '127.0.0.1:${PUBLIC_PORT}/api/build-info' verify.sh
require_text 'http://${PUBLIC_IP:-115.190.156.223}:${PUBLIC_PORT}' verify.sh
forbid_text 'serving V78 on port 80' verify.sh
require_text '127.0.0.1:3000/api/build-info' docker-compose.yml
require_text '127.0.0.1:8787/healthz' docker-compose.yml
require_text 'go-api:4000/health' verify.sh

require_file release-snapshot.sh
require_text 'ACTIVE_DIR=' release-snapshot.sh
require_text 'RELEASE_ROOT=' release-snapshot.sh
require_text 'docker-compose.yml' release-snapshot.sh
require_text 'nginx.conf' release-snapshot.sh
require_text 'IMAGE-TAGS.txt' release-snapshot.sh

require_text 'previous' rollback.sh
require_text '--pull never' rollback.sh
require_text '--no-build' rollback.sh
forbid_text 'down -v' rollback.sh

require_file offline-deploy.sh
require_text 'sha256sum -c SHA256SUMS' offline-deploy.sh
require_text 'DEPLOYMENT-SHA256SUMS' offline-deploy.sh
require_text 'docker load' offline-deploy.sh
require_text '--pull never' offline-deploy.sh
require_text '--no-build' offline-deploy.sh
require_text 'ACTIVE_DIR=' offline-deploy.sh
require_text 'stop nginx' offline-deploy.sh
require_text 'PUBLIC_PORT=3000' offline-deploy.sh
forbid_text 'docker compose pull' offline-deploy.sh
forbid_text 'docker compose build' offline-deploy.sh
forbid_text 'down -v' offline-deploy.sh

require_file backup.sh
require_text 'mysqldump' backup.sh
require_text 'openssl enc -aes-256-cbc -pbkdf2' backup.sh
require_text 'SHA256SUMS' backup.sh
forbid_text 'down -v' backup.sh
require_text 'QIANTIE_BACKUP_ROOT=/opt/qiantie/backups' .env.example
require_text 'QIANTIE_BACKUP_PASSPHRASE_FILE=/root/.qiantie-backup-passphrase' .env.example

workflow="$REPO_ROOT/.github/workflows/v78-amd64-image-release.yml"
require_text 'DEPLOY_SHA' "$workflow"
require_text 'workflow_run_id=' "$workflow"
require_text 'DEPLOYMENT-SHA256SUMS' "$workflow"
require_text 'offline-deploy.sh' "$workflow"
require_text 'PUBLIC_PORT=18080' "$workflow"
require_text 'cb9decd1054ca6c9e6931f6fb24627d6ae6f280c' "$workflow"
require_text '13e40da4092046846ad13c5c0bbb15918216465a' "$workflow"

require_text 'offline-deploy.sh' CODEX_RUNBOOK.md
require_text 'http://115.190.156.223:3000' CODEX_RUNBOOK.md
require_text '仅 Nginx' CODEX_RUNBOOK.md
require_text 'incoming' CODEX_RUNBOOK.md
require_text 'QIANTIE_ALLOW_ONLINE_BUILD_DEPLOY' deploy.sh

echo 'deploy-v2 contract PASS'
