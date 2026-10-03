# V88 Unified Runtime Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate the active V88 121 worker deployment configuration into the main public Compose file.

**Architecture:** `deploy/v88-public/docker-compose.yml` is the formal public topology. It owns the only browser worker, its health contract, and Node's dependency on that healthy worker. The former overlay is removed without touching persistent session volumes.

**Tech Stack:** Docker Compose, Node.js test runner, Git-managed YAML, ECS Docker runtime.

## Global Constraints

- Only V88 public Compose changes are in scope.
- Do not alter MySQL, named data volumes, `shuihuo-compat`, Nginx routes, or v78.
- Do not stop the historical worker until the retained worker passes its authenticated health check and Node points to it.
- Preserve the existing untracked `frontend/dist/downloads/` directory.

---

### Task 1: Make the primary Compose file the sole browser-worker contract

**Files:**
- Modify: `deploy/v88-public/docker-compose.yml`
- Modify: `deploy/v88-public/.env.example`
- Delete: `deploy/v88-public/docker-compose.browser-worker.yml`
- Modify: `tests/v88-direct-121-runtime.test.js`
- Test: `tests/v88-public-unified-topology.test.js`

**Interfaces:**
- Consumes: `QIANTIE_121_WORKER_SECRET`, `QIANTIE_121_CLIENT_TIMEOUT_MS`, external `browser_sessions` and `novel-fetch-121-data` volumes.
- Produces: a single `browser-worker` service whose `/healthz` endpoint is gated by `QIANTIE_121_WORKER_SECRET`.

- [ ] **Step 1: Write failing topology assertions**

```js
assert.match(compose, /healthcheck:/);
assert.match(compose, /condition: service_healthy/);
assert.equal(fs.existsSync(oldOverlay), false);
```

- [ ] **Step 2: Run the focused tests and confirm failure**

Run: `node --test tests/v88-public-unified-topology.test.js tests/v88-direct-121-runtime.test.js`

- [ ] **Step 3: Move the health/dependency contract into the main Compose file**

```yaml
healthcheck:
  test: ["CMD", "node", "-e", "require('http').get(...)"]
v88-node:
  depends_on:
    browser-worker:
      condition: service_healthy
```

- [ ] **Step 4: Remove the obsolete worker overlay**

Delete `deploy/v88-public/docker-compose.browser-worker.yml`; its alternate
worker is no longer an allowed production topology.

- [ ] **Step 5: Re-run focused tests and Compose validation**

Run: `node --test tests/v88-public-unified-topology.test.js tests/v88-direct-121-runtime.test.js && docker compose --env-file deploy/v88-public/.env.example -f deploy/v88-public/docker-compose.yml config -q`

### Task 2: Apply and verify the unified configuration on ECS

**Files:**
- Modify: `deploy/v88-public/UNIFIED-DEPLOY-REQUEST`

**Interfaces:**
- Consumes: committed public Compose contract and the existing ECS `.env`.
- Produces: one healthy `browser-worker`, Node configured for its Docker DNS name, and no orphan 121-worker container.

- [ ] **Step 1: Commit the validated configuration**

```bash
git add deploy/v88-public tests docs/superpowers
git commit -m "chore(v88): consolidate public worker deployment"
git push origin HEAD:v88
```

- [ ] **Step 2: Back up and copy only the Compose file**

```bash
cp -a docker-compose.yml "docker-compose.yml.pre-unified-worker-<sha>"
docker compose config -q
```

- [ ] **Step 3: Verify the retained worker before removal**

Run an authenticated `/healthz` request from `v88-node` to `browser-worker:8787`, and verify `QIANTIE_121_BROWSER_WORKER_URL` remains `http://browser-worker:8787`.

- [ ] **Step 4: Recreate only browser-worker and remove the verified orphan**

```bash
docker compose up -d --no-deps --force-recreate --remove-orphans browser-worker
```

Do not use `down`, `-v`, `system prune`, or volume removal.

- [ ] **Step 5: Verify runtime and public app continuity**

Run the worker health probe again, inspect running V88 containers and volumes,
then confirm `/api/build-info` and `/shuihuo-production` still respond.
