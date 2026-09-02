# V78 Production Deploy V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the V78 ECS production deployment reproducible and offline-safe, with GitHub and ECS using the same configurable public port, release metadata, health gates, rollback snapshot, and backup procedure while keeping `http://115.190.156.223:3000` available until the separate HTTPS phase.

**Architecture:** Keep Nginx as the only host-facing service and make its host port configurable through `PUBLIC_PORT`. Build application images only in GitHub Actions from the locked V78 and Go SHAs, package exact deployment scripts with the image archives, then let ECS perform only checksum verification, `docker load`, `docker compose up --no-build --pull never`, health verification, and Nginx cutover. Rollback is release-based and restores matching deployment files plus application image tags without touching `.env` or data volumes.

**Tech Stack:** Docker Compose, Bash, GitHub Actions, Node.js runtime health probes, MySQL 8.4, Nginx 1.27 Alpine, Go distroless runtime, Playwright Browser Worker.

**Spec:** `docs/superpowers/specs/2026-09-02-v78-production-deploy-v2-design.md`

## Global Constraints

- Production public endpoint for this phase is `http://115.190.156.223:3000`.
- Only Nginx may bind a host port; Node `3000`, Go `4000`, MySQL `3306`, and 121 Worker `8787` remain Docker-internal.
- V78 application source remains locked to `cb9decd1054ca6c9e6931f6fb24627d6ae6f280c`.
- Go source remains locked to `13e40da4092046846ad13c5c0bbb15918216465a`.
- ECS production deployment must not run `docker pull` or `docker build`.
- Production deploy and rollback must not run `docker compose down -v`, delete volumes, regenerate `.env`, or print real secrets.
- `QIANTIE_121_CREDENTIAL_SECRET` must remain stable across normal releases.
- Existing ECS data volumes must be preserved.
- HTTPS/domain work is explicitly out of scope for this plan.

---

### Task 1: Add Deploy V2 Contract Tests and Configurable Public Port

**Files:**
- Create: `deploy/v78-public/tests/deploy-v2-contract.sh`
- Modify: `deploy/v78-public/.env.example`
- Modify: `deploy/v78-public/docker-compose.yml`
- Modify: `deploy/v78-public/verify.sh`

**Interfaces:**
- Consumes: existing Compose service names `mysql`, `go-api`, `browser-worker`, `v78-node`, `nginx`.
- Produces: `PUBLIC_PORT`, defaulting to `3000` in `.env.example`, used by Compose and verification.

- [ ] **Step 1: Write the failing contract test**

Create `deploy/v78-public/tests/deploy-v2-contract.sh` with checks that fail against the current deployment definition:

```bash
#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

grep -q '^PUBLIC_PORT=3000$' .env.example
grep -q '\${PUBLIC_PORT}:80' docker-compose.yml
! grep -q '"80:80"' docker-compose.yml

grep -q '127.0.0.1:${PUBLIC_PORT}/api/build-info' verify.sh
grep -q 'http://${PUBLIC_IP:-115.190.156.223}:${PUBLIC_PORT}' verify.sh
! grep -q 'serving V78 on port 80' verify.sh

for forbidden in '3000:3000' '4000:4000' '3306:3306' '8787:8787'; do
  ! grep -q "$forbidden" docker-compose.yml
done

echo 'deploy-v2 contract PASS'
```

- [ ] **Step 2: Run the contract test and verify it fails**

Run:

```bash
bash deploy/v78-public/tests/deploy-v2-contract.sh
```

Expected: non-zero exit because `.env.example` does not yet define `PUBLIC_PORT=3000` and Compose still contains `80:80`.

- [ ] **Step 3: Add the public port setting**

Add directly below `PUBLIC_IP=115.190.156.223` in `.env.example`:

```text
PUBLIC_PORT=3000
```

Change the Nginx Compose mapping from:

```yaml
ports:
  - "80:80"
```

to:

```yaml
ports:
  - "${PUBLIC_PORT}:80"
```

Keep all other services on `expose` only.

- [ ] **Step 4: Make `verify.sh` use the configured port**

After sourcing `.env`, require a numeric port in range 1-65535:

```bash
PUBLIC_PORT="${PUBLIC_PORT:-3000}"
if [[ ! "$PUBLIC_PORT" =~ ^[0-9]+$ ]] || (( PUBLIC_PORT < 1 || PUBLIC_PORT > 65535 )); then
  echo "ERROR: PUBLIC_PORT must be an integer between 1 and 65535."
  exit 1
fi
```

Change the local Nginx probe to:

```bash
curl --fail --silent --show-error --max-time 15 \
  "http://127.0.0.1:${PUBLIC_PORT}/api/build-info" >/dev/null
```

Change the final messages to:

```bash
echo "VERIFY PASS: local public entry is serving V78 on port ${PUBLIC_PORT}."
echo "External check: http://${PUBLIC_IP:-115.190.156.223}:${PUBLIC_PORT}"
```

- [ ] **Step 5: Run shell syntax and contract tests**

Run:

```bash
bash -n deploy/v78-public/verify.sh
bash deploy/v78-public/tests/deploy-v2-contract.sh
```

Expected: both exit 0.

- [ ] **Step 6: Validate the Compose model with an ephemeral environment**

Run:

```bash
cd deploy/v78-public
cp .env.example .env.test
sed -i.bak 's/CHANGE_ME_MYSQL_PASSWORD/test_mysql_password/' .env.test
sed -i.bak 's/CHANGE_ME_MYSQL_ROOT_PASSWORD/test_mysql_root_password/' .env.test
sed -i.bak 's/CHANGE_ME_LONG_RANDOM_BRIDGE_SECRET/test_bridge_secret/' .env.test
sed -i.bak 's/CHANGE_ME_LONG_RANDOM_WORKER_SECRET/test_worker_secret/' .env.test
sed -i.bak 's/CHANGE_ME_LONG_RANDOM_CREDENTIAL_SECRET/test_credential_secret/' .env.test
rm -f .env.test.bak
docker compose --env-file .env.test -f docker-compose.yml config -q
rm -f .env.test
```

Expected: exit 0 and no tracked `.env.test` file.

- [ ] **Step 7: Commit**

```bash
git add deploy/v78-public/.env.example deploy/v78-public/docker-compose.yml deploy/v78-public/verify.sh deploy/v78-public/tests/deploy-v2-contract.sh
git commit -m "ops(v78): unify configurable public port"
```

---

### Task 2: Add Runtime Health Gates Without Requiring Tools in the Go Distroless Image

**Files:**
- Modify: `deploy/v78-public/docker-compose.yml`
- Modify: `deploy/v78-public/verify.sh`
- Modify: `deploy/v78-public/tests/deploy-v2-contract.sh`

**Interfaces:**
- Consumes: Node built-in `fetch`, Browser Worker Node runtime, existing MySQL healthcheck.
- Produces: Docker health status for Node and Browser Worker; explicit verifier health gate for Go.

- [ ] **Step 1: Extend the failing contract test**

Append these checks before the final PASS line:

```bash
grep -q 'healthcheck:' docker-compose.yml
grep -q '127.0.0.1:3000/api/build-info' docker-compose.yml
grep -q '127.0.0.1:8787/healthz' docker-compose.yml
grep -q 'go-api:4000/health' verify.sh
```

Run:

```bash
bash deploy/v78-public/tests/deploy-v2-contract.sh
```

Expected: fail because Node and Browser Worker do not yet define health checks.

- [ ] **Step 2: Add the Node healthcheck**

Add to `v78-node`:

```yaml
healthcheck:
  test:
    - CMD
    - node
    - -e
    - "fetch('http://127.0.0.1:3000/api/build-info').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
  interval: 15s
  timeout: 5s
  retries: 10
  start_period: 20s
```

- [ ] **Step 3: Add the Browser Worker healthcheck without logging the secret**

Add to `browser-worker`:

```yaml
healthcheck:
  test:
    - CMD
    - node
    - -e
    - "fetch('http://127.0.0.1:8787/healthz',{headers:{'x-qiantie-internal-secret':process.env.QIANTIE_121_WORKER_SECRET}}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
  interval: 15s
  timeout: 5s
  retries: 10
  start_period: 20s
```

Do not add a shell/curl healthcheck to `go-api`; its final image is distroless and contains only `/qiantie`. Keep Go verification explicit from `v78-node`, which already has Node.js and network access to `go-api:4000`.

- [ ] **Step 4: Tighten dependency conditions**

Set `v78-node` dependencies to:

```yaml
depends_on:
  go-api:
    condition: service_started
  browser-worker:
    condition: service_healthy
```

Keep `go-api` dependent on MySQL `service_healthy`.

- [ ] **Step 5: Make `verify.sh` require Docker health states**

Before endpoint probes, get container IDs and require MySQL, Node, and Browser Worker to be `healthy`:

```bash
require_healthy() {
  local service="$1"
  local cid
  cid="$("${COMPOSE[@]}" ps -q "$service")"
  if [[ -z "$cid" ]]; then
    echo "ERROR: service is not running: $service"
    exit 1
  fi
  local status
  status="$(docker inspect -f '{{.State.Health.Status}}' "$cid")"
  if [[ "$status" != "healthy" ]]; then
    echo "ERROR: service is not healthy: $service status=$status"
    exit 1
  fi
}

require_healthy mysql
require_healthy browser-worker
require_healthy v78-node
```

Retain the existing explicit Go request from `v78-node`:

```bash
"${COMPOSE[@]}" exec -T v78-node node -e "fetch('http://go-api:4000/health').then(async r=>{if(!r.ok)throw new Error('go '+r.status);console.log('Go API OK',await r.text())}).catch(e=>{console.error(e);process.exit(1)})"
```

- [ ] **Step 6: Run contract and Compose validation**

Run:

```bash
bash -n deploy/v78-public/verify.sh
bash deploy/v78-public/tests/deploy-v2-contract.sh
```

Then run the same ephemeral `docker compose ... config -q` command from Task 1.

Expected: all exit 0.

- [ ] **Step 7: Commit**

```bash
git add deploy/v78-public/docker-compose.yml deploy/v78-public/verify.sh deploy/v78-public/tests/deploy-v2-contract.sh
git commit -m "ops(v78): add production health gates"
```

---

### Task 3: Add Release Snapshot and Release-Based Rollback

**Files:**
- Create: `deploy/v78-public/release-snapshot.sh`
- Modify: `deploy/v78-public/rollback.sh`
- Modify: `deploy/v78-public/tests/deploy-v2-contract.sh`

**Interfaces:**
- Consumes: current `docker-compose.yml`, `nginx.conf`, and application image tags.
- Produces: `/opt/qiantie/releases/${release_id}/snapshot/` plus immutable rollback tags and `/opt/qiantie/releases/previous` symlink.

- [ ] **Step 1: Add failing snapshot/rollback contract checks**

Append:

```bash
test -f release-snapshot.sh
grep -q 'RELEASE_ROOT=' release-snapshot.sh
grep -q 'docker-compose.yml' release-snapshot.sh
grep -q 'nginx.conf' release-snapshot.sh
grep -q 'previous' rollback.sh
grep -q -- '--pull never' rollback.sh
grep -q -- '--no-build' rollback.sh
! grep -q 'down -v' rollback.sh
```

Run the contract test and confirm it fails because `release-snapshot.sh` does not exist.

- [ ] **Step 2: Implement `release-snapshot.sh`**

Use this behavior:

```bash
#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

RELEASE_ROOT="${QIANTIE_RELEASE_ROOT:-/opt/qiantie/releases}"
release_id="${1:-$(date -u +%Y%m%dT%H%M%SZ)}"
snapshot_dir="${RELEASE_ROOT}/${release_id}/snapshot"
mkdir -p "$snapshot_dir"

cp docker-compose.yml "$snapshot_dir/docker-compose.yml"
cp nginx.conf "$snapshot_dir/nginx.conf"
chmod 644 "$snapshot_dir/docker-compose.yml" "$snapshot_dir/nginx.conf"

images=(
  qiantie-v78-node
  qiantie-go-api
  qiantie-121-browser-worker
)

: > "$snapshot_dir/IMAGE-IDS.txt"
for image in "${images[@]}"; do
  docker image inspect "${image}:public-v78" >/dev/null
  image_id="$(docker image inspect --format '{{.Id}}' "${image}:public-v78")"
  rollback_tag="${image}:release-${release_id}"
  docker tag "${image}:public-v78" "$rollback_tag"
  printf '%s %s %s\n' "$image" "$image_id" "$rollback_tag" >> "$snapshot_dir/IMAGE-IDS.txt"
done

ln -sfn "${RELEASE_ROOT}/${release_id}" "${RELEASE_ROOT}/previous"
printf '%s\n' "$release_id"
```

Do not copy `.env` into the snapshot.

- [ ] **Step 3: Replace tag-only rollback with release-based rollback**

Make `rollback.sh` resolve `${QIANTIE_RELEASE_ROOT:-/opt/qiantie/releases}/previous`, require `snapshot/docker-compose.yml`, `snapshot/nginx.conf`, and `snapshot/IMAGE-IDS.txt`, restore the two config files, then retag the recorded `release-${release_id}` images back to `public-v78`.

Use only:

```bash
"${COMPOSE[@]}" up -d --no-build --pull never mysql go-api browser-worker v78-node
"${COMPOSE[@]}" up -d --no-build --pull never nginx
bash ./verify.sh
```

If any required rollback tag is missing, exit before changing running services.

- [ ] **Step 4: Run shell syntax and contract tests**

Run:

```bash
bash -n deploy/v78-public/release-snapshot.sh
bash -n deploy/v78-public/rollback.sh
bash deploy/v78-public/tests/deploy-v2-contract.sh
```

Expected: all exit 0.

- [ ] **Step 5: Commit**

```bash
git add deploy/v78-public/release-snapshot.sh deploy/v78-public/rollback.sh deploy/v78-public/tests/deploy-v2-contract.sh
git commit -m "ops(v78): add release based rollback snapshot"
```

---

### Task 4: Add the ECS Offline Deployment Script

**Files:**
- Create: `deploy/v78-public/offline-deploy.sh`
- Modify: `deploy/v78-public/tests/deploy-v2-contract.sh`

**Interfaces:**
- Consumes: `.env`, `release/SHA256SUMS`, `release/RELEASE-METADATA.txt`, and four `.tar.gz` image archives.
- Produces: loaded `linux/amd64` images, private services started before Nginx, verified public entry after cutover.

- [ ] **Step 1: Add failing offline-deploy contract checks**

Append:

```bash
test -f offline-deploy.sh
grep -q 'sha256sum -c SHA256SUMS' offline-deploy.sh
grep -q 'docker load' offline-deploy.sh
grep -q -- '--pull never' offline-deploy.sh
grep -q -- '--no-build' offline-deploy.sh
! grep -Eq 'docker (compose )?pull|docker (compose )?build' offline-deploy.sh
! grep -q 'down -v' offline-deploy.sh
```

Run and confirm failure because the script does not exist.

- [ ] **Step 2: Implement fail-closed input validation**

`offline-deploy.sh` must:

1. require `deploy/v78-public/.env`;
2. reject `CHANGE_ME_` values;
3. load `PUBLIC_IP` and `PUBLIC_PORT`;
4. require `PUBLIC_IP=115.190.156.223` and numeric `PUBLIC_PORT`;
5. require `RELEASE_DIR`, defaulting to `${ROOT}/release`;
6. require `SHA256SUMS` and `RELEASE-METADATA.txt`;
7. run from inside `RELEASE_DIR`:

```bash
sha256sum -c SHA256SUMS
```

8. require metadata lines:

```text
architecture=linux/amd64
V78_SHA=cb9decd1054ca6c9e6931f6fb24627d6ae6f280c
Go_SHA=13e40da4092046846ad13c5c0bbb15918216465a
```

Do not source the metadata file; parse exact key/value lines with `grep -Fx` so artifact content cannot execute shell code.

- [ ] **Step 3: Load the four archives only after checksum verification**

Use:

```bash
gzip -dc "$RELEASE_DIR/qiantie-v78-linux-amd64-base.tar.gz" | docker load
gzip -dc "$RELEASE_DIR/qiantie-v78-linux-amd64-browser-worker.tar.gz" | docker load
gzip -dc "$RELEASE_DIR/qiantie-v78-linux-amd64-go.tar.gz" | docker load
gzip -dc "$RELEASE_DIR/qiantie-v78-linux-amd64-node.tar.gz" | docker load
```

Then require these images:

```bash
images=(
  mysql:8.4
  nginx:1.27-alpine
  qiantie-v78-node:public-v78
  qiantie-go-api:public-v78
  qiantie-121-browser-worker:public-v78
)
```

For each, require:

```bash
test "$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$image")" = "linux/amd64"
```

- [ ] **Step 4: Snapshot current release before candidate start**

Call:

```bash
snapshot_id="pre-$(date -u +%Y%m%dT%H%M%SZ)"
bash ./release-snapshot.sh "$snapshot_id"
```

If no current application images exist on first installation, let `release-snapshot.sh` support `QIANTIE_ALLOW_EMPTY_SNAPSHOT=1` and record `first-install=true` instead of failing. Normal upgrades must keep the strict behavior.

- [ ] **Step 5: Start private services without registry/build access**

Use:

```bash
COMPOSE=(docker compose --env-file .env -f docker-compose.yml)
"${COMPOSE[@]}" config -q
"${COMPOSE[@]}" up -d --no-build --pull never mysql go-api browser-worker v78-node
```

Wait for MySQL, Browser Worker, and Node Docker health to become `healthy`, with a bounded retry loop of 60 attempts and 2 seconds sleep.

Then explicitly probe Go from `v78-node`:

```bash
"${COMPOSE[@]}" exec -T v78-node node -e "fetch('http://go-api:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
```

If any private health gate fails, exit without starting or recreating Nginx.

- [ ] **Step 6: Cut over Nginx only after private health passes**

Use:

```bash
"${COMPOSE[@]}" up -d --no-build --pull never nginx
bash ./verify.sh
```

Print:

```bash
echo "DEPLOYMENT READY: http://${PUBLIC_IP}:${PUBLIC_PORT}"
```

- [ ] **Step 7: Run syntax and contract tests**

Run:

```bash
bash -n deploy/v78-public/offline-deploy.sh
bash deploy/v78-public/tests/deploy-v2-contract.sh
```

Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add deploy/v78-public/offline-deploy.sh deploy/v78-public/release-snapshot.sh deploy/v78-public/tests/deploy-v2-contract.sh
git commit -m "ops(v78): add offline ecs deployment path"
```

---

### Task 5: Add Non-Destructive Production Backups

**Files:**
- Create: `deploy/v78-public/backup.sh`
- Modify: `deploy/v78-public/tests/deploy-v2-contract.sh`
- Modify: `deploy/v78-public/.env.example`

**Interfaces:**
- Consumes: running Compose services, `.env`, server-only passphrase file.
- Produces: `/opt/qiantie/backups/${timestamp}/` containing MySQL dump, compressed data/session archives, encrypted `.env`, and SHA256 manifest.

- [ ] **Step 1: Add failing backup contract checks**

Append:

```bash
test -f backup.sh
grep -q 'mysqldump' backup.sh
grep -q 'openssl enc -aes-256-cbc -pbkdf2' backup.sh
grep -q 'SHA256SUMS' backup.sh
! grep -q 'down -v' backup.sh
```

Run and confirm failure because `backup.sh` does not exist.

- [ ] **Step 2: Add server-only backup settings to `.env.example`**

Add:

```text
QIANTIE_BACKUP_ROOT=/opt/qiantie/backups
QIANTIE_BACKUP_PASSPHRASE_FILE=/root/.qiantie-backup-passphrase
```

Document in comments that the passphrase file is created on ECS with:

```bash
umask 077
openssl rand -hex 32 > /root/.qiantie-backup-passphrase
chmod 600 /root/.qiantie-backup-passphrase
```

The passphrase file is not committed and must not be included in release artifacts.

- [ ] **Step 3: Implement `backup.sh`**

The script must:

1. source `.env` with shell tracing disabled;
2. require the passphrase file to exist and have no group/other permission bits;
3. create `${QIANTIE_BACKUP_ROOT}/${timestamp}` with mode 700;
4. dump MySQL with credentials read inside the MySQL container environment:

```bash
"${COMPOSE[@]}" exec -T mysql sh -lc \
  'exec mysqldump --single-transaction --routines --events --triggers -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"' \
  | gzip -1 > "$backup_dir/mysql.sql.gz"
```

5. stream `v78_data` and `v78_outputs` from the Node container:

```bash
"${COMPOSE[@]}" exec -T v78-node tar -C /app/data -czf - . > "$backup_dir/v78_data.tar.gz"
"${COMPOSE[@]}" exec -T v78-node tar -C /app/outputs -czf - . > "$backup_dir/v78_outputs.tar.gz"
```

6. stream Browser Worker sessions:

```bash
"${COMPOSE[@]}" exec -T browser-worker tar -C /data/sessions -czf - . > "$backup_dir/browser_sessions.tar.gz"
```

7. encrypt `.env`:

```bash
openssl enc -aes-256-cbc -pbkdf2 -salt \
  -in .env \
  -out "$backup_dir/env.enc" \
  -pass "file:${QIANTIE_BACKUP_PASSPHRASE_FILE}"
```

8. write checksums:

```bash
(cd "$backup_dir" && sha256sum mysql.sql.gz v78_data.tar.gz v78_outputs.tar.gz browser_sessions.tar.gz env.enc > SHA256SUMS)
```

9. chmod backup files 600 and directory 700.

- [ ] **Step 4: Run syntax and contract tests**

Run:

```bash
bash -n deploy/v78-public/backup.sh
bash deploy/v78-public/tests/deploy-v2-contract.sh
```

Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add deploy/v78-public/backup.sh deploy/v78-public/.env.example deploy/v78-public/tests/deploy-v2-contract.sh
git commit -m "ops(v78): add non destructive production backup"
```

---

### Task 6: Make the GitHub AMD64 Release Artifact Carry the Exact Deployment Package

**Files:**
- Modify: `.github/workflows/v78-amd64-image-release.yml`
- Modify: `deploy/v78-public/tests/deploy-v2-contract.sh`

**Interfaces:**
- Consumes: deployment branch SHA, locked V78 application SHA, locked Go SHA.
- Produces: image archives plus exact deployment files, `RELEASE-METADATA.txt`, `SHA256SUMS`, and `DEPLOYMENT-SHA256SUMS`.

- [ ] **Step 1: Add a contract test for release metadata requirements**

Append checks that the workflow contains:

```bash
workflow="$ROOT/../../.github/workflows/v78-amd64-image-release.yml"
grep -q 'DEPLOY_SHA' "$workflow"
grep -q 'workflow_run_id=' "$workflow"
grep -q 'DEPLOYMENT-SHA256SUMS' "$workflow"
grep -q 'offline-deploy.sh' "$workflow"
grep -q 'PUBLIC_PORT=18080' "$workflow"
```

Run the contract test and confirm it fails.

- [ ] **Step 2: Separate deployment source from application source in the workflow**

The workflow must perform three source roles:

```text
deploy-src = current workflow commit (${GITHUB_SHA})
v78 = cb9decd1054ca6c9e6931f6fb24627d6ae6f280c
go = 13e40da4092046846ad13c5c0bbb15918216465a
```

Checkout current branch into `deploy-src`, locked V78 into `v78`, and locked Go into `go`.

Before Compose use, replace only the deployment directory in the locked V78 tree:

```bash
rm -rf v78/deploy/v78-public
mkdir -p v78/deploy
cp -a deploy-src/deploy/v78-public v78/deploy/v78-public
```

This ensures application files come from the locked V78 SHA while deployment scripts come from the reviewed deployment SHA.

- [ ] **Step 3: Force CI smoke to prove port configurability**

During ephemeral `.env` preparation, set:

```bash
sed -i 's/^PUBLIC_PORT=3000$/PUBLIC_PORT=18080/' .env
```

Update the Nginx smoke probe to:

```bash
curl --fail --silent --show-error --max-time 15 \
  http://127.0.0.1:18080/api/build-info
```

This makes the workflow fail if any path still hard-codes port 80 or 3000.

- [ ] **Step 4: Add deploy-v2 contract execution before Docker build**

Run:

```bash
bash v78/deploy/v78-public/tests/deploy-v2-contract.sh
bash -n v78/deploy/v78-public/offline-deploy.sh
bash -n v78/deploy/v78-public/release-snapshot.sh
bash -n v78/deploy/v78-public/rollback.sh
bash -n v78/deploy/v78-public/backup.sh
bash -n v78/deploy/v78-public/verify.sh
```

- [ ] **Step 5: Expand release metadata**

Write exact lines:

```text
architecture=linux/amd64
V78_SHA=cb9decd1054ca6c9e6931f6fb24627d6ae6f280c
Go_SHA=13e40da4092046846ad13c5c0bbb15918216465a
DEPLOY_SHA=${GITHUB_SHA}
workflow_run_id=${GITHUB_RUN_ID}
smoke=passed
```

Also keep one line per runtime image showing `linux/amd64`.

- [ ] **Step 6: Package deployment files separately from secrets**

Create `release/deployment/` containing exactly:

```text
.env.example
CODEX_RUNBOOK.md
backup.sh
docker-compose.yml
nginx.conf
offline-deploy.sh
release-snapshot.sh
rollback.sh
verify.sh
tests/deploy-v2-contract.sh
```

Generate:

```bash
(cd "$release_dir/deployment" && find . -type f -print0 | sort -z | xargs -0 sha256sum > ../DEPLOYMENT-SHA256SUMS)
```

Assert that neither `release/` nor any archive contains a file named `.env`, and assert that `QIANTIE_BACKUP_PASSPHRASE_FILE` points only to a path, never to an embedded passphrase.

- [ ] **Step 7: Include deployment package in the artifact upload**

Upload:

```text
release/*.tar.gz
release/SHA256SUMS
release/DEPLOYMENT-SHA256SUMS
release/RELEASE-METADATA.txt
release/deployment/**
```

Retention remains 14 days.

- [ ] **Step 8: Run workflow YAML review and local contract test**

Run:

```bash
bash deploy/v78-public/tests/deploy-v2-contract.sh
```

Then inspect the workflow diff to verify the application checkout is still locked to the exact V78 SHA and Go checkout to the exact Go SHA.

- [ ] **Step 9: Commit**

```bash
git add .github/workflows/v78-amd64-image-release.yml deploy/v78-public/tests/deploy-v2-contract.sh
git commit -m "ci(v78): package verified offline deployment release"
```

---

### Task 7: Update the Runbook and Make Build-Oriented `deploy.sh` Explicitly Non-Production

**Files:**
- Modify: `deploy/v78-public/CODEX_RUNBOOK.md`
- Modify: `deploy/v78-public/deploy.sh`
- Modify: `deploy/v78-public/tests/deploy-v2-contract.sh`

**Interfaces:**
- Consumes: all Deploy V2 scripts.
- Produces: one operator path for ECS production: `offline-deploy.sh`.

- [ ] **Step 1: Add failing documentation/safety checks**

Append:

```bash
grep -q 'offline-deploy.sh' CODEX_RUNBOOK.md
grep -q 'http://115.190.156.223:3000' CODEX_RUNBOOK.md
grep -q '仅 Nginx' CODEX_RUNBOOK.md
grep -q 'QIANTIE_ALLOW_ONLINE_BUILD_DEPLOY' deploy.sh
```

Run and confirm failure.

- [ ] **Step 2: Guard `deploy.sh` against accidental ECS production use**

At the top after loading `.env`, require explicit opt-in:

```bash
if [[ "${QIANTIE_ALLOW_ONLINE_BUILD_DEPLOY:-0}" != "1" ]]; then
  echo "ERROR: deploy.sh is the online build/pull path and is disabled by default."
  echo "Use offline-deploy.sh for ECS production."
  exit 1
fi
```

Do not remove its existing SHA validation; preserve it for intentional registry-connected environments.

- [ ] **Step 3: Rewrite the production runbook around the offline flow**

The runbook must state:

- supported endpoint: `http://115.190.156.223:3000`;
- only Nginx binds the host port;
- Mac only downloads/verifies/uploads release files;
- ECS verifies `SHA256SUMS` and `DEPLOYMENT-SHA256SUMS`;
- ECS installs the exact packaged deployment directory without overwriting `.env`;
- ECS runs `bash offline-deploy.sh`;
- ECS does not run `docker pull`, `docker build`, or `docker compose down -v`;
- before each upgrade run `bash backup.sh`;
- rollback uses `bash rollback.sh`;
- infrastructure verification is not the same as manual business acceptance;
- manual acceptance includes login, Novel Fetch create/refresh/restart persistence, and real 121 login.

- [ ] **Step 4: Run tests**

Run:

```bash
bash -n deploy/v78-public/deploy.sh
bash deploy/v78-public/tests/deploy-v2-contract.sh
```

Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add deploy/v78-public/CODEX_RUNBOOK.md deploy/v78-public/deploy.sh deploy/v78-public/tests/deploy-v2-contract.sh
git commit -m "docs(v78): make offline ecs flow canonical"
```

---

### Task 8: Run Full GitHub AMD64 Verification and Review the Release Artifact

**Files:**
- Verify only; modify files only if the verification exposes a defect, then repeat the failing task's test cycle.

**Interfaces:**
- Consumes: completed Deploy V2 branch.
- Produces: one successful GitHub Actions run and an artifact that can be handed to Codex for ECS synchronization.

- [ ] **Step 1: Re-read the design and plan against the final diff**

Run:

```bash
git diff --check <branch-base>...HEAD
git diff --stat <branch-base>...HEAD
```

Use the actual merge-base SHA reported by Git rather than substituting a moving branch name.

Verify every success criterion in `docs/superpowers/specs/2026-09-02-v78-production-deploy-v2-design.md` maps to a concrete changed file or workflow assertion.

- [ ] **Step 2: Run all local static verification**

Run:

```bash
bash deploy/v78-public/tests/deploy-v2-contract.sh
bash -n deploy/v78-public/offline-deploy.sh
bash -n deploy/v78-public/release-snapshot.sh
bash -n deploy/v78-public/rollback.sh
bash -n deploy/v78-public/backup.sh
bash -n deploy/v78-public/verify.sh
bash -n deploy/v78-public/deploy.sh
```

Expected: all exit 0.

- [ ] **Step 3: Push the reviewed Deploy V2 branch and trigger the AMD64 release workflow**

The workflow must run on `ubuntu-24.04`, confirm `x86_64`, build the locked application sources, execute Compose smoke using `PUBLIC_PORT=18080`, package exact deployment files, and upload the artifact.

- [ ] **Step 4: Inspect every workflow step**

Require success for:

```text
Assert Linux AMD64 runner
Validate locked sources and clean trees
Run Deploy V2 contracts
Validate Compose model
Prepare pinned AMD64 base images
Build locked application images for AMD64
Validate all runtime image architectures
Start candidate without registry pulls
Run internal candidate smoke checks
Smoke test Nginx public entry
Save formal AMD64 deployment images
Package exact deployment files
Upload AMD64 deployment artifacts
Cleanup ephemeral candidate
```

Any failed or skipped required step blocks ECS deployment.

- [ ] **Step 5: Inspect the artifact contents**

Require:

```text
qiantie-v78-linux-amd64-base.tar.gz
qiantie-v78-linux-amd64-browser-worker.tar.gz
qiantie-v78-linux-amd64-go.tar.gz
qiantie-v78-linux-amd64-node.tar.gz
SHA256SUMS
DEPLOYMENT-SHA256SUMS
RELEASE-METADATA.txt
deployment/.env.example
deployment/CODEX_RUNBOOK.md
deployment/backup.sh
deployment/docker-compose.yml
deployment/nginx.conf
deployment/offline-deploy.sh
deployment/release-snapshot.sh
deployment/rollback.sh
deployment/verify.sh
deployment/tests/deploy-v2-contract.sh
```

Require metadata values:

```text
architecture=linux/amd64
V78_SHA=cb9decd1054ca6c9e6931f6fb24627d6ae6f280c
Go_SHA=13e40da4092046846ad13c5c0bbb15918216465a
smoke=passed
```

Require a concrete `DEPLOY_SHA` equal to the workflow head SHA and `workflow_run_id` equal to that successful run.

- [ ] **Step 6: Verify secret exclusion**

Search extracted artifact names and text files. There must be no `.env`, private key, SSH key, GitHub token, MySQL real password, `QIANTIE_BRIDGE_SECRET` value, `QIANTIE_121_WORKER_SECRET` value, `QIANTIE_121_CREDENTIAL_SECRET` value, or backup passphrase file.

The string names of environment variables are allowed in `.env.example`; actual secret values are not.

- [ ] **Step 7: Report the handoff without touching ECS**

Return:

```text
Deploy V2 branch
full HEAD SHA
successful workflow run ID
artifact ID/name/size/digest
four archive SHA256 values
DEPLOYMENT-SHA256SUMS digest
locked V78 SHA
locked Go SHA
PUBLIC_PORT default
confirmation that no ECS deployment was performed
```

Only after this evidence is reviewed should Codex synchronize the packaged deployment directory and images to ECS.
