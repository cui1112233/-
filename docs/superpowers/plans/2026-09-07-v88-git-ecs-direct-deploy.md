# V88 Git → ECS Direct Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace routine V88 Docker image releases with exact-SHA GitHub Actions → ECS release-directory deployment, systemd-managed app services, incremental rebuild/restart, health checks, and automatic rollback.

**Architecture:** Git `v88` remains the only maintained source. GitHub Actions packages the exact verified commit, uploads it to `/opt/qiantie/releases/v88/<sha>`, builds only affected components in that immutable release, atomically switches `/opt/qiantie/v88/current`, restarts only affected systemd units, and rolls back to `previous` on failed checks. Existing Docker MySQL/Redis/Nginx may remain during migration; application containers are not required for routine deploys.

**Tech Stack:** GitHub Actions, Bash, Node.js 22, React/Vite, Go, systemd, Playwright 1.55, Nginx, existing MySQL/Redis/TOS.

**Spec:** `docs/superpowers/specs/2026-09-07-v88-git-ecs-direct-deploy-design.md`

## Global Constraints

- `v88` is the only maintained source line and future consolidation branch.
- Public ECS is a runtime target, never a development source.
- Routine deploys must not require Docker image build/push/pull.
- Existing Docker database/Redis infrastructure is not deleted or reset by this work.
- Every public deployment must identify an exact Git SHA.
- Failed deployment must restore the previous release automatically.
- Secrets, browser sessions, data, outputs, and logs live outside immutable release directories.
- Existing Docker release workflow remains available only as manual emergency fallback.
- No business-feature semantics are changed in this project.

---

### Task 1: Lock the deployment contract with failing tests

**Files:**
- Create: `tests/v88-direct-deploy-contract.test.js`
- Modify: `.github/workflows/v88-linux-amd64-image-release.yml`

**Interfaces:**
- Produces contract checks consumed by all later tasks.
- No runtime interface changes.

- [ ] **Step 1: Write failing contract tests**

Create a Node test that asserts:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const dockerRelease = fs.readFileSync('.github/workflows/v88-linux-amd64-image-release.yml', 'utf8');
const directDeploy = fs.existsSync('.github/workflows/v88-ecs-direct-deploy.yml')
  ? fs.readFileSync('.github/workflows/v88-ecs-direct-deploy.yml', 'utf8')
  : '';

test('routine Docker release no longer listens to v88 push', () => {
  assert.doesNotMatch(dockerRelease, /push:\s*[\s\S]*branches:\s*[\s\S]*- v88/);
  assert.match(dockerRelease, /workflow_dispatch:/);
});

test('direct deploy exists and deploys exact GITHUB_SHA', () => {
  assert.match(directDeploy, /branches:\s*\n\s*- v88/);
  assert.match(directDeploy, /GITHUB_SHA/);
  assert.match(directDeploy, /deploy\/v88-direct\/deploy\.sh/);
});

test('direct deploy does not build Docker images', () => {
  assert.doesNotMatch(directDeploy, /docker build/);
  assert.doesNotMatch(directDeploy, /docker push/);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
node --test tests/v88-direct-deploy-contract.test.js
```

Expected: FAIL because the Docker workflow still listens to `v88` and the direct-deploy workflow does not yet exist.

- [ ] **Step 3: Make only the minimal trigger change**

Change `.github/workflows/v88-linux-amd64-image-release.yml` so `on:` contains `workflow_dispatch:` only for production release execution. Do not delete Docker build logic.

- [ ] **Step 4: Re-run the test**

Expected: still FAIL only for missing direct-deploy files. This proves the Docker auto-trigger portion is fixed without hiding unfinished work.

- [ ] **Step 5: Commit**

```bash
git add tests/v88-direct-deploy-contract.test.js .github/workflows/v88-linux-amd64-image-release.yml
git commit -m "test(deploy): lock V88 direct-deploy contract"
```

---

### Task 2: Add immutable release preparation and change classification

**Files:**
- Create: `deploy/v88-direct/classify-changes.sh`
- Create: `deploy/v88-direct/prepare-release.sh`
- Extend test: `tests/v88-direct-deploy-contract.test.js`

**Interfaces:**
- `classify-changes.sh <old_sha> <new_sha>` prints shell assignments: `FRONTEND_CHANGED`, `NODE_CHANGED`, `GO_CHANGED`, `WORKER_CHANGED`, `MIGRATIONS_CHANGED` as `0|1`.
- `prepare-release.sh <release_dir> <sha>` validates path, writes `RELEASE-SHA`, and creates no shared runtime data inside the release.

- [ ] **Step 1: Add failing tests for file classification and release immutability**

Test the scripts as subprocesses with a temporary Git repo. Assert:
- `frontend/**` toggles frontend only.
- `backend/**` toggles Go only.
- `services/121-browser-worker/**` toggles Worker only.
- `lib/**` toggles Node.
- migration paths toggle migrations.
- `prepare-release.sh` refuses `/opt/qiantie/v88/current` as a build target.

- [ ] **Step 2: Run tests and verify RED**

```bash
node --test tests/v88-direct-deploy-contract.test.js
```

- [ ] **Step 3: Implement the scripts minimally**

`classify-changes.sh` must use:

```bash
git diff --name-only "$old_sha" "$new_sha"
```

and deterministic case patterns. `prepare-release.sh` must reject empty SHA, reject any path containing `/current`, create the release directory, and write the exact SHA to `RELEASE-SHA`.

- [ ] **Step 4: Re-run tests and verify GREEN**

- [ ] **Step 5: Commit**

```bash
git add deploy/v88-direct tests/v88-direct-deploy-contract.test.js
git commit -m "feat(deploy): classify V88 incremental release changes"
```

---

### Task 3: Add systemd service definitions and persistent-data boundaries

**Files:**
- Create: `deploy/v88-direct/systemd/qiantie-v88-node.service`
- Create: `deploy/v88-direct/systemd/qiantie-v88-go.service`
- Create: `deploy/v88-direct/systemd/qiantie-v88-browser-worker.service`
- Create: `deploy/v88-direct/bootstrap-host.sh`
- Extend test: `tests/v88-direct-deploy-contract.test.js`

**Interfaces:**
- Services read `/opt/qiantie/v88/shared/env/v88.env`.
- Node working directory: `/opt/qiantie/v88/current`.
- Go binary: `/opt/qiantie/v88/current/bin/qiantie`.
- Worker working directory: `/opt/qiantie/v88/current/services/121-browser-worker`.
- Worker session path: `/opt/qiantie/v88/shared/browser-worker-sessions`.

- [ ] **Step 1: Write failing static tests**

Assert unit files:
- reference `/opt/qiantie/v88/current`;
- use the root-only environment file;
- use `Restart=on-failure`;
- do not reference Docker DNS names;
- Worker uses a localhost URL contract and shared session directory.

Assert `bootstrap-host.sh` never contains `docker volume rm`, database reset commands, or deletion of `/opt/qiantie/v88/shared`.

- [ ] **Step 2: Run tests and verify RED**

- [ ] **Step 3: Implement units and idempotent bootstrap**

Bootstrap creates:

```text
/opt/qiantie/v88/shared/env
/opt/qiantie/v88/shared/data
/opt/qiantie/v88/shared/outputs
/opt/qiantie/v88/shared/browser-worker-sessions
/opt/qiantie/v88/shared/logs
/opt/qiantie/releases/v88
```

It installs/copies unit files and runs `systemctl daemon-reload`, but must not overwrite an existing production env file.

- [ ] **Step 4: Re-run tests and verify GREEN**

- [ ] **Step 5: Commit**

```bash
git add deploy/v88-direct/systemd deploy/v88-direct/bootstrap-host.sh tests/v88-direct-deploy-contract.test.js
git commit -m "feat(deploy): add V88 systemd runtime services"
```

---

### Task 4: Implement build, switch, health-check, and rollback transaction

**Files:**
- Create: `deploy/v88-direct/deploy.sh`
- Create: `deploy/v88-direct/health-check.sh`
- Extend test: `tests/v88-direct-deploy-contract.test.js`

**Interfaces:**
- `deploy.sh <release_dir> <new_sha> <previous_sha> <change_env_file>`.
- `health-check.sh` returns nonzero on any required local/public check failure.
- `current` and `previous` symlinks are switched atomically with `ln -sfn` only after build/preflight passes.

- [ ] **Step 1: Write failing transaction-order tests**

Extract script text and assert ordering:
1. build/preflight occurs before `current` symlink switch;
2. previous target is captured before switch;
3. rollback rewrites `current` to the prior target;
4. release cleanup never deletes `shared`;
5. frontend-only change does not execute `go build` or Worker install branch;
6. Worker branch installs Playwright browsers only when Worker lock/package Playwright version changed;
7. migrations run only when `MIGRATIONS_CHANGED=1`.

- [ ] **Step 2: Run tests and verify RED**

- [ ] **Step 3: Implement build transaction**

Required behavior:
- root Node dependency install only when root lock/package changed or `node_modules` absent;
- frontend `npm ci && npm run build` only when frontend changed or dist absent;
- Go `go test ./...` and `go build -o ../../bin/qiantie ./cmd/qiantie` only when Go changed;
- Worker `npm ci --omit=dev` only when Worker changed or modules absent;
- Worker browser install only when Playwright version changed or browser executable missing;
- write `RELEASE-SHA` before switch;
- stop on any build error before touching `current`;
- switch, restart only affected units, run health check;
- rollback symlink and affected units on failure.

- [ ] **Step 4: Re-run tests and shell syntax checks**

```bash
bash -n deploy/v88-direct/*.sh
node --test tests/v88-direct-deploy-contract.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add deploy/v88-direct/deploy.sh deploy/v88-direct/health-check.sh tests/v88-direct-deploy-contract.test.js
git commit -m "feat(deploy): add atomic V88 release transaction"
```

---

### Task 5: Add exact-SHA GitHub Actions direct deployment

**Files:**
- Create: `.github/workflows/v88-ecs-direct-deploy.yml`
- Extend test: `tests/v88-direct-deploy-contract.test.js`

**Interfaces:**
- Trigger: `push` to `v88` plus `workflow_dispatch`.
- Uses existing `V88_ECS_SSH_PRIVATE_KEY` secret; does not persist GitHub credentials on ECS.
- Upload destination: `/opt/qiantie/releases/v88/${GITHUB_SHA}`.

- [ ] **Step 1: Add failing workflow contract tests**

Assert workflow:
- checks out exact commit;
- runs Node regression relevant to deployment contract;
- creates source archive excluding `.git`, secrets, runtime data, and `node_modules`;
- uploads release to exact SHA directory;
- invokes `bootstrap-host.sh` only in explicit/bootstrap-safe branch;
- invokes `deploy.sh` with exact SHA;
- has `concurrency.group: v88-public-direct-deploy` and `cancel-in-progress: true`;
- contains no `docker build`, `docker push`, or `docker pull`.

- [ ] **Step 2: Run tests and verify RED**

- [ ] **Step 3: Implement workflow**

Workflow stages:
1. checkout exact `GITHUB_SHA`;
2. setup Node/Go;
3. run deployment contract tests and existing focused V88 regression gates;
4. build a source tarball with production source only;
5. SSH preflight;
6. upload tarball and deploy scripts;
7. unpack into exact release dir;
8. classify changes against current deployed SHA;
9. run `deploy.sh`;
10. verify public page/API endpoints and print deployed SHA.

- [ ] **Step 4: Re-run tests**

```bash
node --test tests/v88-direct-deploy-contract.test.js
```

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/v88-ecs-direct-deploy.yml tests/v88-direct-deploy-contract.test.js
git commit -m "ci(deploy): add V88 exact-SHA ECS direct release"
```

---

### Task 6: Expose and verify deployed Git SHA

**Files:**
- Modify: `server.js` or existing build-info middleware only if an existing route cannot surface release metadata cleanly.
- Create/Modify: focused build-info test under `tests/`.
- Extend: `deploy/v88-direct/health-check.sh`.

**Interfaces:**
- Runtime metadata fields: `branch: "v88"`, `git_sha`, `deployed_at`, `deploy_mode: "git-direct"`.
- Source for `git_sha`: `QIATIE_RELEASE_SHA` env or `RELEASE-SHA` file; never a guessed branch head.

- [ ] **Step 1: Write failing build-info test**

Provide `QIATIE_RELEASE_SHA=abc123` and assert the response exposes exactly `abc123` with `deploy_mode=git-direct`.

- [ ] **Step 2: Run focused test and verify RED**

- [ ] **Step 3: Implement minimal metadata exposure**

Prefer extending an existing build-info endpoint over adding a duplicate endpoint.

- [ ] **Step 4: Run focused and deployment tests**

```bash
node --test tests/v88-direct-deploy-contract.test.js tests/*build-info*.test.js
```

- [ ] **Step 5: Commit**

```bash
git add server.js lib tests deploy/v88-direct/health-check.sh
git commit -m "feat(deploy): expose V88 deployed Git SHA"
```

---

### Task 7: First production migration and guarded cutover

**Files:**
- No new business code unless diagnostics expose a concrete missing host-runtime requirement.
- GitHub Actions run and ECS runtime state only.

**Interfaces:**
- Old Docker app remains rollback source during cutover.
- Database/Redis volumes are preserved.

- [ ] **Step 1: Run preflight diagnostics only**

Collect on ECS:
- current Nginx upstream and published ports;
- MySQL/Redis host reachability;
- current Node/Go/Worker env requirements;
- disk space;
- Node 22, Go, systemd, Playwright prerequisites;
- current public build/SHA marker if available.

Expected: no production mutation.

- [ ] **Step 2: Bootstrap host runtime**

Run `bootstrap-host.sh` and populate `/opt/qiantie/v88/shared/env/v88.env` from existing runtime configuration without committing secrets to Git.

- [ ] **Step 3: Deploy latest verified `v88` SHA to alternate/local ports**

Start systemd units without changing public Nginx upstream yet. Validate local Node, Go, Worker, database access, Novel Fetch, Script, login/session, and static assets.

- [ ] **Step 4: Cut public traffic to host-managed services**

Change only the required Nginx upstream/port mapping after all local checks pass. Do not delete old application containers.

- [ ] **Step 5: Verify public endpoints and exact SHA**

Required checks include homepage, `/script`, Novel Fetch page/API, build-info SHA, Go API health, and Worker health.

- [ ] **Step 6: Roll back immediately on any failure**

Restore prior Nginx upstream or previous `current` symlink, restart prior runtime, and verify public recovery.

- [ ] **Step 7: Record successful production SHA**

Update the deployment memory/snapshot documentation with exact SHA and `deploy_mode=git-direct` only after fresh public verification.

---

## Self-Review

- Spec coverage: immutable release directories, systemd, incremental classification, manual-only Docker fallback, exact SHA, secrets/shared-data boundaries, Browser Worker, Go, Node/frontend, migrations, rollback, and first cutover are all mapped to tasks.
- Placeholder scan: no TBD/TODO/"implement later" instructions remain.
- Interface consistency: release root, shared root, service names, `RELEASE-SHA`, change flags, and exact-SHA workflow are consistent across tasks.
