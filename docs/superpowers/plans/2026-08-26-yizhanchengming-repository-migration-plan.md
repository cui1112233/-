# Yizhanchengming Repository Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a recoverable, sensitive-data-free migration baseline in `cui1112233/yizhanchengming`, then establish a verified `develop` workflow without changing the target repository's existing `main`.

**Architecture:** Keep the old repository as the historical source of truth. Create an external recovery bundle for Docker data and a separate clean Git snapshot with no old Git history, so prior accidentally tracked runtime files cannot enter the new repository. Push only new migration branches and tags; target `main` remains untouched until a later reviewed merge.

**Tech Stack:** Git, GitHub remote, Docker Compose v2, MySQL 8, Redis 7, Bash, Node.js, Vite.

## Global Constraints

- Source repository: `/Users/ming/Downloads/qiantie`; target repository: `https://github.com/cui1112233/yizhanchengming.git`.
- Git repository is source code only. Never add `data/`, `deploy/.env.test-docker`, `.env`, credentials, sessions, cookies, API keys, Docker volumes, MySQL dumps, Redis dumps, or uploaded media.
- Recovery directory: `/Users/ming/Documents/一战晟铭-恢复备份/2026-08-26/`, mode `0700`; all created archive files mode `0600`.
- Preserve target `main` at `7da851112291c0f6214dbc606aaa26e6c35d7b57` and `migration/phase-1-clean-foundation`; no force push, deletion, or history rewrite.
- Preserve old repository and all of its branches; do not run `git reset --hard`, `git clean`, `git branch -D`, `git push --force`, or Docker `clean`.
- Published application source point is `27b04e4007b72497da656336bd438aef62e95907`; the migration snapshot is built from that point and tagged `legacy-published-20260826`.

## File Structure

- Create outside Git: `/Users/ming/Documents/一战晟铭-恢复备份/2026-08-26/manifest.json` records source/target refs, archive SHA-256 values, Docker volume names and restore commands without secrets.
- Create outside Git: `/Users/ming/Documents/一战晟铭-恢复备份/2026-08-26/mysql.sql.gz` is a logical MySQL backup.
- Create outside Git: `/Users/ming/Documents/一战晟铭-恢复备份/2026-08-26/volumes/*.tar.gz` holds `deploy_qiantie-test-{mysql,objects,platform,redis}` snapshots.
- Create temporary, then delete: `/Users/ming/Documents/一战晟铭-迁移暂存/` is a detached source worktree and a clean-history Git repository.
- Create in target Git: `migration/legacy-published-20260826`, `develop`, and annotated tag `legacy-published-20260826`.

### Task 1: Freeze evidence and validate the recovery destination

**Files:**
- Create: `/Users/ming/Documents/一战晟铭-恢复备份/2026-08-26/manifest.json`

**Interfaces:**
- Consumes: the fixed source and target SHAs in Global Constraints.
- Produces: an immutable migration manifest used by every later task.

- [ ] **Step 1: Create protected directories**

Run:

```bash
mkdir -p /Users/ming/Documents/一战晟铭-恢复备份/2026-08-26/volumes
mkdir -p /Users/ming/Documents/一战晟铭-迁移暂存
chmod 700 /Users/ming/Documents/一战晟铭-恢复备份 /Users/ming/Documents/一战晟铭-恢复备份/2026-08-26 /Users/ming/Documents/一战晟铭-迁移暂存
chmod 700 /Users/ming/Documents/一战晟铭-恢复备份/2026-08-26/volumes
```

- [ ] **Step 2: Capture immutable Git evidence**

Run from `/Users/ming/Downloads/qiantie`:

```bash
git show -s --format='%H%n%ci%n%D' 27b04e4007b72497da656336bd438aef62e95907
git ls-remote --symref https://github.com/cui1112233/yizhanchengming.git HEAD 'refs/heads/*'
git status --short
```

Expected: the source commit exists, target `main` remains `7da851112291c0f6214dbc606aaa26e6c35d7b57`, and dirty files are recorded but untouched.

- [ ] **Step 3: Write the evidence manifest without secrets**

Create `manifest.json` with only these keys: `createdAt`, `sourceRepository`, `publishedCommit`, `sourceBranch`, `targetRepository`, `targetMainCommit`, `volumeNames`, `mysqlDump`, `volumeArchives`, `sha256`, and `restoreCommands`.

Use this exact initial JSON shape, replacing only ISO time and generated archive hashes:

```json
{
  "createdAt": "2026-08-26T00:00:00.000Z",
  "sourceRepository": "/Users/ming/Downloads/qiantie",
  "publishedCommit": "27b04e4007b72497da656336bd438aef62e95907",
  "sourceBranch": "integration/remote-workbench-20260819",
  "targetRepository": "https://github.com/cui1112233/yizhanchengming.git",
  "targetMainCommit": "7da851112291c0f6214dbc606aaa26e6c35d7b57",
  "volumeNames": ["deploy_qiantie-test-mysql", "deploy_qiantie-test-objects", "deploy_qiantie-test-platform", "deploy_qiantie-test-redis"],
  "mysqlDump": "mysql.sql.gz",
  "volumeArchives": {},
  "sha256": {},
  "restoreCommands": []
}
```

- [ ] **Step 4: Verify permissions and sensitive-file exclusion**

Run:

```bash
stat -f '%Lp %N' /Users/ming/Documents/一战晟铭-恢复备份/2026-08-26
git -C /Users/ming/Downloads/qiantie check-ignore -v deploy/.env.test-docker
```

Expected: backup directory mode is `700`; deployment environment file is ignored.

- [ ] **Step 5: Commit**

No Git commit. The recovery manifest deliberately remains outside every Git repository.

### Task 2: Create and verify MySQL and Docker-volume recovery backups

**Files:**
- Create: `/Users/ming/Documents/一战晟铭-恢复备份/2026-08-26/mysql.sql.gz`
- Create: `/Users/ming/Documents/一战晟铭-恢复备份/2026-08-26/volumes/mysql.tar.gz`
- Create: `/Users/ming/Documents/一战晟铭-恢复备份/2026-08-26/volumes/objects.tar.gz`
- Create: `/Users/ming/Documents/一战晟铭-恢复备份/2026-08-26/volumes/platform.tar.gz`
- Create: `/Users/ming/Documents/一战晟铭-恢复备份/2026-08-26/volumes/redis.tar.gz`
- Modify: `/Users/ming/Documents/一战晟铭-恢复备份/2026-08-26/manifest.json`

**Interfaces:**
- Consumes: Docker Compose services and named volumes declared in `deploy/docker-compose.test.yml`.
- Produces: a logical database restore point plus byte-level volume archives and their checksums.

- [ ] **Step 1: Verify the running stack before backup and obtain the maintenance gate**

Run:

```bash
bash scripts/deploy-test-docker.sh health
docker compose --env-file deploy/.env.test-docker -f deploy/docker-compose.test.yml ps
```

Expected: health endpoint returns `{"ok":true}` and platform is running on port 3000. Before Step 3, explicitly tell the user that the platform will be unavailable for the duration of the volume snapshot and wait for that approval; do not infer it from approval of the migration plan.

- [ ] **Step 2: Export the MySQL database without exposing credentials in the command line**

Run from `/Users/ming/Downloads/qiantie`:

```bash
set -o pipefail
umask 077
docker compose --env-file deploy/.env.test-docker -f deploy/docker-compose.test.yml exec -T mysql sh -lc 'mysqldump --no-tablespaces -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" --single-transaction --routines --events --triggers "$MYSQL_DATABASE"' | gzip -9 > /Users/ming/Documents/一战晟铭-恢复备份/2026-08-26/mysql.sql.gz
chmod 600 /Users/ming/Documents/一战晟铭-恢复备份/2026-08-26/mysql.sql.gz
gzip -t /Users/ming/Documents/一战晟铭-恢复备份/2026-08-26/mysql.sql.gz
```

Expected: `gzip -t` exits zero and decompressed output ends with `Dump completed`. `--no-tablespaces` is required because the application account intentionally has database-level privileges only; `pipefail` prevents gzip from masking a failed dump. The terminal command contains environment variable names but no password value.

- [ ] **Step 3: Stop the stack and archive every Docker volume atomically**

Run from `/Users/ming/Downloads/qiantie` only after the maintenance gate is approved:

```bash
docker compose --env-file deploy/.env.test-docker -f deploy/docker-compose.test.yml stop platform backend redis mysql
docker run --rm -v deploy_qiantie-test-mysql:/source:ro -v /Users/ming/Documents/一战晟铭-恢复备份/2026-08-26/volumes:/backup alpine:3.20 sh -c 'tar -C /source -czf /backup/mysql.tar.gz .'
docker run --rm -v deploy_qiantie-test-objects:/source:ro -v /Users/ming/Documents/一战晟铭-恢复备份/2026-08-26/volumes:/backup alpine:3.20 sh -c 'tar -C /source -czf /backup/objects.tar.gz .'
docker run --rm -v deploy_qiantie-test-platform:/source:ro -v /Users/ming/Documents/一战晟铭-恢复备份/2026-08-26/volumes:/backup alpine:3.20 sh -c 'tar -C /source -czf /backup/platform.tar.gz .'
docker run --rm -v deploy_qiantie-test-redis:/source:ro -v /Users/ming/Documents/一战晟铭-恢复备份/2026-08-26/volumes:/backup alpine:3.20 sh -c 'tar -C /source -czf /backup/redis.tar.gz .'
chmod 600 /Users/ming/Documents/一战晟铭-恢复备份/2026-08-26/volumes/*.tar.gz
docker compose --env-file deploy/.env.test-docker -f deploy/docker-compose.test.yml up -d
bash scripts/deploy-test-docker.sh health
```

Expected: every volume is archived while no service is mutating it, then the stack returns to a healthy state. If any archive command fails, run `docker compose --env-file deploy/.env.test-docker -f deploy/docker-compose.test.yml up -d` immediately and stop the migration.

- [ ] **Step 4: Verify archive integrity and update the manifest**

Run:

```bash
gzip -t /Users/ming/Documents/一战晟铭-恢复备份/2026-08-26/volumes/mysql.tar.gz
gzip -t /Users/ming/Documents/一战晟铭-恢复备份/2026-08-26/volumes/objects.tar.gz
gzip -t /Users/ming/Documents/一战晟铭-恢复备份/2026-08-26/volumes/platform.tar.gz
gzip -t /Users/ming/Documents/一战晟铭-恢复备份/2026-08-26/volumes/redis.tar.gz
shasum -a 256 /Users/ming/Documents/一战晟铭-恢复备份/2026-08-26/mysql.sql.gz /Users/ming/Documents/一战晟铭-恢复备份/2026-08-26/volumes/*.tar.gz
```

Add the resulting archive names and SHA-256 strings to `manifest.json`, then set the manifest to mode `600`.

- [ ] **Step 5: Verify recovery instructions without touching production data**

Append these literal restore commands to `manifest.json`:

```text
docker volume create deploy_qiantie-test-objects
docker run --rm -v deploy_qiantie-test-objects:/target -v /Users/ming/Documents/一战晟铭-恢复备份/2026-08-26/volumes:/backup:ro alpine:3.20 sh -c 'tar -C /target -xzf /backup/objects.tar.gz'
gunzip -c /Users/ming/Documents/一战晟铭-恢复备份/2026-08-26/mysql.sql.gz | docker compose --env-file deploy/.env.test-docker -f deploy/docker-compose.test.yml exec -T mysql sh -lc 'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"'
```

Expected: restore commands are documentation only in this task. Do not execute them against the running stack.

- [ ] **Step 6: Commit**

No Git commit. All artifacts stay outside Git.

### Task 3: Build a clean-history, sensitive-data-free Git migration baseline

**Files:**
- Create: `/Users/ming/Documents/一战晟铭-迁移暂存/qiantie-published/`
- Create: `/Users/ming/Documents/一战晟铭-迁移暂存/yizhanchengming-clean/.git/`
- Create: `/Users/ming/Documents/一战晟铭-迁移暂存/yizhanchengming-clean/MIGRATION.md`

**Interfaces:**
- Consumes: source commit `27b04e4007b72497da656336bd438aef62e95907`.
- Produces: one new root commit with only safe published source content, no connection to the old repository's history.

- [ ] **Step 1: Make a detached source worktree without altering the dirty main worktree**

Run:

```bash
git -C /Users/ming/Downloads/qiantie worktree add --detach /Users/ming/Documents/一战晟铭-迁移暂存/qiantie-published 27b04e4007b72497da656336bd438aef62e95907
```

Expected: source worktree HEAD equals `27b04e4007b72497da656336bd438aef62e95907`; existing worktree remains untouched.

- [ ] **Step 2: Export the published tree while excluding all runtime data**

Run:

```bash
mkdir -p /Users/ming/Documents/一战晟铭-迁移暂存/yizhanchengming-clean
git -C /Users/ming/Documents/一战晟铭-迁移暂存/qiantie-published archive --format=tar 27b04e4007b72497da656336bd438aef62e95907 | tar -xf - -C /Users/ming/Documents/一战晟铭-迁移暂存/yizhanchengming-clean
rm -rf /Users/ming/Documents/一战晟铭-迁移暂存/yizhanchengming-clean/data
```

Expected: the export has no `.git` directory and no `data/` directory.

- [ ] **Step 3: Add a migration provenance file without secrets**

Create `MIGRATION.md` with this content:

```markdown
# Migration Provenance

This repository snapshot was exported from the verified published source commit `27b04e4007b72497da656336bd438aef62e95907` on 2026-08-26.

Runtime data, credentials, sessions, uploads, Docker environment files and Docker volume contents are intentionally excluded. Their recovery manifest is stored outside Git.
```

- [ ] **Step 4: Initialize the clean Git history and test the secret boundary**

Run:

```bash
git -C /Users/ming/Documents/一战晟铭-迁移暂存/yizhanchengming-clean init -b migration/legacy-published-20260826
git -C /Users/ming/Documents/一战晟铭-迁移暂存/yizhanchengming-clean add .
matches="$(git -C /Users/ming/Documents/一战晟铭-迁移暂存/yizhanchengming-clean diff --cached --name-only | rg '^(data/|deploy/\.env\.test-docker$|\.env$|.*(session|credential|secret|token).*)' || true)"
test -z "$matches" || { printf '%s\n' "$matches"; exit 1; }
git -C /Users/ming/Documents/一战晟铭-迁移暂存/yizhanchengming-clean commit -m 'chore: import verified published source baseline'
```

Expected: the exclusion scan prints nothing and the new root commit is created.

- [ ] **Step 5: Test the exported source before any remote push**

Run:

```bash
npm --prefix /Users/ming/Documents/一战晟铭-迁移暂存/yizhanchengming-clean/frontend run build
```

Expected: Vite build exits zero; known brand-asset and chunk-size warnings are recorded but do not fail the build.

- [ ] **Step 6: Commit**

The root commit from Step 4 is the task commit. Do not amend it after validation.

### Task 4: Push only protected migration refs into yizhanchengming

**Files:**
- Modify remotely: `refs/heads/migration/legacy-published-20260826`
- Modify remotely: `refs/heads/develop`
- Create remotely: annotated tag `legacy-published-20260826`

**Interfaces:**
- Consumes: the clean root commit from Task 3 and target remote baseline `7da851112291c0f6214dbc606aaa26e6c35d7b57`.
- Produces: reviewable migration refs while preserving target `main` exactly.

- [ ] **Step 1: Read the target refs immediately before writing**

Run:

```bash
git ls-remote https://github.com/cui1112233/yizhanchengming.git refs/heads/main refs/heads/migration/phase-1-clean-foundation refs/heads/migration/legacy-published-20260826 refs/heads/develop
```

Expected: `main` is exactly `7da851112291c0f6214dbc606aaa26e6c35d7b57`; migration and develop refs are absent. Stop if either condition differs.

- [ ] **Step 2: Configure the new remote only in the clean staging repository**

Run:

```bash
git -C /Users/ming/Documents/一战晟铭-迁移暂存/yizhanchengming-clean remote add yizhanchengming https://github.com/cui1112233/yizhanchengming.git
git -C /Users/ming/Documents/一战晟铭-迁移暂存/yizhanchengming-clean remote -v
```

Expected: original repository `origin` remains unchanged; only staging repository has the new remote.

- [ ] **Step 3: Create the annotated release tag and develop branch**

Run:

```bash
git -C /Users/ming/Documents/一战晟铭-迁移暂存/yizhanchengming-clean tag -a legacy-published-20260826 -m 'Verified Docker published source baseline: 27b04e4'
git -C /Users/ming/Documents/一战晟铭-迁移暂存/yizhanchengming-clean branch develop migration/legacy-published-20260826
```

- [ ] **Step 4: Push migration refs without force**

Run:

```bash
git -C /Users/ming/Documents/一战晟铭-迁移暂存/yizhanchengming-clean push yizhanchengming migration/legacy-published-20260826:refs/heads/migration/legacy-published-20260826
git -C /Users/ming/Documents/一战晟铭-迁移暂存/yizhanchengming-clean push yizhanchengming develop:refs/heads/develop
git -C /Users/ming/Documents/一战晟铭-迁移暂存/yizhanchengming-clean push yizhanchengming refs/tags/legacy-published-20260826
```

Expected: every command reports a new ref; no `--force` is used.

- [ ] **Step 5: Verify source and target refs after push**

Run:

```bash
git ls-remote https://github.com/cui1112233/yizhanchengming.git refs/heads/main refs/heads/develop refs/heads/migration/legacy-published-20260826 refs/tags/legacy-published-20260826
```

Expected: target `main` remains `7da851112291c0f6214dbc606aaa26e6c35d7b57`; `develop`, migration branch and tag point to the same new clean root commit.

- [ ] **Step 6: Commit**

No additional commit. Remote refs point to the immutable Task 3 root commit.

### Task 5: Validate the new repository in isolation and record the handoff

**Files:**
- Create outside Git: `/Users/ming/Documents/一战晟铭-恢复备份/2026-08-26/validation.txt`
- Modify: `/Users/ming/Documents/一战晟铭-恢复备份/2026-08-26/manifest.json`

**Interfaces:**
- Consumes: remote `develop` created by Task 4.
- Produces: evidence that a fresh checkout contains no runtime data and can build without modifying production Docker.

- [ ] **Step 1: Clone the target develop branch into a separate validation directory**

Run:

```bash
rm -rf /Users/ming/Documents/一战晟铭-迁移暂存/validation
git clone --branch develop --single-branch https://github.com/cui1112233/yizhanchengming.git /Users/ming/Documents/一战晟铭-迁移暂存/validation
```

Expected: validation clone is a fresh checkout from target GitHub remote.

- [ ] **Step 2: Verify no runtime files entered Git**

Run:

```bash
matches="$(git -C /Users/ming/Documents/一战晟铭-迁移暂存/validation ls-files | rg '^(data/|deploy/\.env\.test-docker$|\.env$|.*(session|credential|secret|token).*)' || true)"
test -z "$matches" || { printf '%s\n' "$matches"; exit 1; }
test ! -e /Users/ming/Documents/一战晟铭-迁移暂存/validation/data
```

Expected: no matching tracked files and no `data/` directory.

- [ ] **Step 3: Run build and isolated Docker configuration validation**

Run:

```bash
npm --prefix /Users/ming/Documents/一战晟铭-迁移暂存/validation/frontend run build
docker compose --env-file /Users/ming/Downloads/qiantie/deploy/.env.test-docker -f /Users/ming/Documents/一战晟铭-迁移暂存/validation/deploy/docker-compose.test.yml config --quiet
```

Expected: both commands exit zero. Do not execute `up` from this validation clone because it would use production ports and named volumes.

- [ ] **Step 4: Record validation outcome and update the recovery manifest**

Write `validation.txt` containing exact source SHA, target branch SHA, build exit status, compose validation exit status and UTC timestamp. Add its SHA-256 to `manifest.json` and set both files to mode `600`.

- [ ] **Step 5: Commit**

No Git commit. Validation evidence remains outside Git.

### Task 6: Set the ongoing branch policy without destructive cleanup

**Files:**
- Modify remotely: target repository default branch setting only after an explicit later approval.
- Create: target repository pull request from `develop` to `main` only after application acceptance is complete.

**Interfaces:**
- Consumes: successful Task 5 validation.
- Produces: a future-safe workflow; this task does not alter production default branch or delete branches.

- [ ] **Step 1: Set local developer workflow documentation in the target repository**

Create `docs/repository-workflow.md` on a new `docs/repository-workflow` branch from `develop` with this exact policy:

```markdown
# Repository Workflow

- `main` is stable release history. Update it only through reviewed pull requests from `develop`.
- `develop` is the integration branch. Feature branches use names such as `feature/script-constraint` and merge only after focused tests and build verification.
- `migration/*` and `archive/*` are recovery references. Do not commit new work to them or delete them.
- Runtime data and deployment secrets never enter Git. Restore from the protected local recovery manifest instead.
- Never force-push `main`, `develop`, `migration/*`, or `archive/*`.
```

- [ ] **Step 2: Verify the documentation branch only contains the policy file**

Run:

```bash
git diff --name-only develop...docs/repository-workflow
```

Expected: only `docs/repository-workflow.md` is listed.

- [ ] **Step 3: Push the documentation branch without merging it**

Run:

```bash
git push yizhanchengming docs/repository-workflow:refs/heads/docs/repository-workflow
```

Expected: no changes to target `main` or `develop`.

- [ ] **Step 4: Commit**

Commit on `docs/repository-workflow`:

```bash
git add docs/repository-workflow.md
git commit -m 'docs: define protected repository workflow'
```

## Plan Self-Review

- Spec coverage: Tasks 1-2 create and verify independent Git and Docker recovery points; Tasks 3-5 create, push and validate a clean source-only migration without changing existing target `main`; Task 6 defines non-destructive branch governance.
- Placeholder scan: fixed source SHA, target SHA, backup directory, branch names, volume names, commands and verification expectations are explicit; no implementation action depends on an unnamed destination.
- Consistency: all remote writes occur only in the clean staging repository; all runtime artifacts remain under the protected recovery directory; no task writes the target `main`.
