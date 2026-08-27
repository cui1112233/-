# 正式部署与数据保护 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 `10.0.101.164:3000` 固定为数据不丢失、密钥一致、可回滚的长期正式服务。

**Architecture:** 新增 production 专用 Compose、环境模板和发布脚本；正式数据卷使用固定命名并在脚本中拒绝销毁。发布脚本先做 MySQL 备份与数据基线，再滚动替换后端和平台，最后执行健康、会话、桥接和基线对比。

**Tech Stack:** Docker Compose、Bash、MySQL CLI、Node/Express、Go health endpoint。

## Global Constraints

- 不执行 `docker compose down -v`、`docker volume rm` 或任何正式数据卷删除操作。
- `10.0.101.164:3000` 只能由 production Compose 占用。
- 密钥只从 `deploy/.env.production` 读取，不提交 Git，不在普通发布时重新生成。
- 121 上传发布不纳入本计划。

---

### Task 1: Formalize Production Compose and Environment Contract

**Files:**
- Create: `deploy/docker-compose.production.yml`
- Create: `deploy/.env.production.example`
- Modify: `deploy/docker-compose.test.yml`
- Test: `tests/production-deployment-config.test.js`

**Interfaces:**
- Produces services `production-platform`, `production-backend`, `production-mysql`, `production-redis` and volumes `qiantie-production-*`.
- Production platform/backend consume the same `QIANTIE_BRIDGE_SECRET`, `QIANTIE_TOKEN_SECRET`, `MYSQL_PASSWORD`, and `QIANTIE_CREDENTIAL_ENCRYPTION_KEY`.

- [ ] **Step 1: Write failing config tests** asserting production Compose uses `qiantie-production-*` volumes, ports `3000/14000`, and never references `.env.test-docker`.
- [ ] **Step 2: Run `node --test tests/production-deployment-config.test.js` and verify failure.**
- [ ] **Step 3: Add production Compose copied from the tested service topology, replacing service/container/volume names and using `${...}` values from `.env.production`. Add a production env example with generated-value instructions but no real secrets.**
- [ ] **Step 4: Add test-stack guard that exits when `QIANTIE_PLATFORM_PORT=3000` or any `qiantie-production-*` volume is selected.**
- [ ] **Step 5: Run the config test and `docker compose --env-file deploy/.env.production -f deploy/docker-compose.production.yml config` with a temporary non-secret env file; expect PASS and valid YAML.**
- [ ] **Step 6: Commit `feat: isolate production docker deployment`.**

### Task 2: Add Non-Destructive Backup and Baseline Script

**Files:**
- Create: `scripts/production-backup-baseline.sh`
- Create: `tests/production-backup-baseline.test.js`

**Interfaces:**
- Command: `bash scripts/production-backup-baseline.sh baseline`
- Command: `bash scripts/production-backup-baseline.sh backup`
- Outputs timestamped files under `backups/production/<timestamp>/` and exits nonzero if required production volumes or credentials are missing.

- [ ] **Step 1: Write failing shell-contract tests checking the script rejects `.env.test-docker`, rejects missing production volumes, and contains no destructive Docker command.**
- [ ] **Step 2: Run the test and verify failure.**
- [ ] **Step 3: Implement `baseline` using read-only MySQL count queries for users, model_definitions, novel tasks, projects, batch tables, and object files; write JSON with timestamp and image digests.**
- [ ] **Step 4: Implement `backup` using `mysqldump --single-transaction --routines --triggers`, then verify file size and `mysqldump --no-data` readability.**
- [ ] **Step 5: Run tests and a dry-run against an isolated test Compose; expect PASS without changing any volume.**
- [ ] **Step 6: Commit `feat: add production backup and data baseline`.**

### Task 3: Implement Safe Production Publish and Rollback

**Files:**
- Create: `scripts/deploy-production.sh`
- Create: `tests/deploy-production.test.js`

**Interfaces:**
- Commands: `bash scripts/deploy-production.sh preflight`, `publish`, `verify`, `rollback`.
- `publish` calls Task 2 backup/baseline before replacing application containers and never removes data volumes.

- [ ] **Step 1: Write failing tests for command guards, backup-before-recreate ordering, health failure behavior, and absence of `down -v`/`volume rm`.**
- [ ] **Step 2: Run tests and verify failure.**
- [ ] **Step 3: Implement `preflight`: validate env file permissions, matching platform/backend secrets, fixed production ports, existing production volumes, and required Docker image architecture.**
- [ ] **Step 4: Implement `publish`: build images, run backup and baseline, recreate only platform/backend with `--no-deps`, wait for health, and preserve previous image digests.**
- [ ] **Step 5: Implement `verify`: curl backend `/healthz`, platform `/`, login session using a supplied non-secret test token flow, water-production bridge endpoint, and compare post-publish baseline counts.**
- [ ] **Step 6: Implement `rollback`: restore only previous platform/backend image tags after verification failure; print the backup path and never auto-restore over MySQL.**
- [ ] **Step 7: Run tests and shellcheck if available; commit `feat: add safe production publish workflow`.**

### Task 4: Repair Session Persistence and Bridge Regression Coverage

**Files:**
- Modify: `deploy/docker-compose.production.yml`
- Modify: `frontend/src/shared/layouts/UserLayout.jsx`
- Create: `tests/production-session-bridge.test.js`

**Interfaces:**
- Session data persists in the production platform volume.
- A 401 from a Go bridge request is only treated as login expiry when `/api/login/session` also fails with 401.

- [ ] **Step 1: Write failing regression tests for a valid Node session plus bridge 401, and for a truly expired Node session.**
- [ ] **Step 2: Run tests and verify failure.**
- [ ] **Step 3: Update frontend auth handling to verify `/api/login/session` before clearing a session on a downstream bridge 401; preserve current valid token when the bridge is misconfigured.**
- [ ] **Step 4: Ensure production Compose mounts the platform data volume containing persistent sessions and does not recreate it during publish.**
- [ ] **Step 5: Run frontend auth tests and batch-factory tests; commit `fix: distinguish bridge auth failures from expired sessions`.**

### Task 5: Production Dry Run, Data Verification, and Documentation

**Files:**
- Create: `docs/superpowers/audits/2026-08-27-production-deployment-dry-run.md`
- Modify: `README.md`

- [ ] **Step 1: Run `preflight` and record the production volume/image/data baseline.**
- [ ] **Step 2: Run `publish` without any volume deletion; record container IDs and health output.**
- [ ] **Step 3: Simulate browser flow on `http://10.0.101.164:3000`: login, open water production, open batch factory, create no data, and confirm empty state does not show samples.**
- [ ] **Step 4: Run `verify` and record unchanged-or-increased counts for every baseline category.**
- [ ] **Step 5: Document the exact recovery command and backup location; explicitly record any unresolved model configuration (local Doubao max duration) without inventing a value.**
- [ ] **Step 6: Run `git diff --check`, all targeted tests, frontend build, Go tests, and commit `docs: record production deployment verification`.**

