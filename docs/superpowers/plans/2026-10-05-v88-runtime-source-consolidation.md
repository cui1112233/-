# V88 Runtime Source Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the public V88 runtime fully traceable to `origin/v88`, with one declared service topology, configuration provenance, and Git-SHA rollback contract before retiring ECS-only legacy artifacts.

**Architecture:** Treat `origin/v88` as the sole code authority and the ECS host as evidence of the currently active topology. First capture a red/green parity manifest for every active service and runtime-owned file; then bring non-secret Compose/Nginx/Browser Worker topology into Git; then release an exact Git SHA through the approved direct path. Only after live contract checks prove the replacement is equivalent may old runtime backups, unused images, and compatibility services be considered for retirement.

**Tech Stack:** Git `v88`, Docker Compose, Node.js, Go, Nginx, MySQL 8, Browser Worker, ECS root SSH, shell contract tests.

## Global Constraints

- `v88` is the only maintained source branch; historical branches and ECS runtime copies are read-only evidence.
- Do not overwrite or modify unrelated dirty worktrees; use an isolated worktree based on the current `origin/v88` SHA.
- Normal release is Git `v88` -> exact staged SHA -> Direct Cutover -> external exact-SHA verification; no Docker image recreate for daily Node changes.
- Preserve MySQL data, Docker volumes, business media, current release, and the immediately previous known-good release.
- Secrets, `.env` values, certificates, sessions, and database backups must never be committed to Git.
- `shuihuo-compat` cannot be removed until request/route ownership proves it has no required live traffic or its behavior has an equivalent V88 replacement.
- A 200 response, container health, or image presence alone is not release acceptance; verify the relevant public path and runtime identity.

---

## Runtime baseline captured on 2026-10-05

- Canonical source: `origin/v88` at `d1b4754a4db56f66392c9405ff066f7212ddf853`.
- ECS active Compose project: `v88-public` with six active services: Node, Go API, Browser Worker, Nginx, Shuihuo compatibility service, and MySQL.
- ECS direct current release: `a0d223563ddc4802e592a2903de64139312066a3`; previous release: `1afc35c13869ffe0674689ea63f907f9d74214f3`.
- ECS Compose invocation includes `/opt/qiantie/v88/deploy/v88-public/docker-compose.browser-worker.yml`, while that file is not present in `origin/v88`; this is a source-of-truth violation.
- ECS root filesystem is 20 GB and was 98% used with roughly 540 MB free; all removal work needs a measured capacity gate.

### Task 1: Commit a non-secret runtime topology manifest

**Files:**
- Create: `deploy/v88-public/runtime-topology.manifest.json`
- Create: `tests/v88-runtime-topology.test.js`
- Modify: `deploy/v88-public/README.md`

**Interfaces:**
- Consumes: normalized output from `docker compose config --format json`, `docker inspect`, and the current `origin/v88` release SHA.
- Produces: a machine-readable list of required services, images/build sources, internal dependencies, persistent mount purpose, public listener ownership, and source-owned configuration file paths.

- [ ] **Step 1: Write the failing topology contract test**

```js
test('runtime topology declares every public V88 service and excludes host-local secrets', () => {
  const manifest = loadManifest('deploy/v88-public/runtime-topology.manifest.json');
  assert.deepEqual(manifest.services.map(({ id }) => id).sort(), [
    'browser-worker', 'go-api', 'mysql', 'nginx', 'node', 'shuihuo-compat',
  ]);
  assert.equal(JSON.stringify(manifest).includes('/opt/qiantie/'), false);
  assert.equal(JSON.stringify(manifest).includes('.env'), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/v88-runtime-topology.test.js`

Expected: FAIL because the manifest and test helper do not yet exist.

- [ ] **Step 3: Add the manifest and its test loader**

Create a manifest with the six IDs above. For every service, declare `source`, `runtimeImageOrBinary`, `dependsOn`, `persistentDataPurpose`, `publicExposure`, and `retirementGate`. Use symbolic mount purposes such as `batch-book-data` and `mysql-data`; never copy host paths, values from `.env`, passwords, tokens, certificate paths, or session data.

- [ ] **Step 4: Document the evidence and ownership boundary**

In `deploy/v88-public/README.md`, state that Compose inputs must exist in Git except secret overlays, describe the six service roles, and list the only permitted secret material as deploy-time environment values and certificate/session storage outside Git.

- [ ] **Step 5: Run the contract test**

Run: `node --test tests/v88-runtime-topology.test.js`

Expected: PASS with all six service IDs and no host paths or `.env` values serialized.

- [ ] **Step 6: Commit**

```bash
git add deploy/v88-public/runtime-topology.manifest.json deploy/v88-public/README.md tests/v88-runtime-topology.test.js
git commit -m "docs(v88): record public runtime topology"
```

### Task 2: Bring the Browser Worker Compose contract under Git

**Files:**
- Create: `deploy/v88-public/docker-compose.browser-worker.yml`
- Create: `tests/v88-browser-worker-compose.test.js`
- Modify: `deploy/v88-public/docker-compose.yml`

**Interfaces:**
- Consumes: the Task 1 `browser-worker` topology entry and the active ECS Compose service definition with secrets removed.
- Produces: a tracked Compose overlay defining only Browser Worker image, network, named volumes, health check, and environment variable names.

- [ ] **Step 1: Write the failing Compose contract test**

```js
test('Browser Worker overlay is tracked and joins the V88 internal network', () => {
  const overlay = readFileSync('deploy/v88-public/docker-compose.browser-worker.yml', 'utf8');
  assert.match(overlay, /^services:\n/m);
  assert.match(overlay, /browser-worker:/);
  assert.match(overlay, /v88-public_qiantie_internal|qiantie_internal/);
  assert.doesNotMatch(overlay, /(password|token|secret):\s*[^$\n]/i);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/v88-browser-worker-compose.test.js`

Expected: FAIL because `origin/v88` currently has no tracked Browser Worker overlay.

- [ ] **Step 3: Reconstruct only the non-secret service contract**

Copy the live service structure only after comparing `docker compose config` and `docker inspect`: preserve image pinning, named session/data volumes, health check, internal network attachment, and environment variable names. Replace every value with `${VARIABLE_NAME:?required}` or an existing documented non-secret default. Do not copy actual `.env` contents or browser session data.

- [ ] **Step 4: Wire the overlay into the checked-in deployment documentation**

Update the base Compose comments/documentation so the standard invocation explicitly includes `docker-compose.browser-worker.yml`; do not change production services during this task.

- [ ] **Step 5: Run source and Compose validation**

Run:

```bash
node --test tests/v88-browser-worker-compose.test.js
docker compose -f deploy/v88-public/docker-compose.yml -f deploy/v88-public/docker-compose.browser-worker.yml config --quiet
```

Expected: test passes and Compose parsing succeeds when required non-secret variables are supplied from a local test environment.

- [ ] **Step 6: Commit**

```bash
git add deploy/v88-public/docker-compose.yml deploy/v88-public/docker-compose.browser-worker.yml tests/v88-browser-worker-compose.test.js
git commit -m "fix(v88): track browser worker deployment contract"
```

### Task 3: Make direct-release identity prove Node and Go provenance

**Files:**
- Modify: `deploy/v88-direct/activate-direct-release.sh`
- Modify: `deploy/v88-direct/activate-direct-release.test.js`
- Modify: `deploy/v88-public/CURRENT_RELEASE`
- Create: `deploy/v88-direct/runtime-release-manifest.sh`

**Interfaces:**
- Consumes: an exact Git SHA, the staged Node release tree, and the compiled Go binary SHA-256.
- Produces: `${releaseDir}/runtime-release.json` containing `gitSha`, `nodeSourceSha`, `goBinarySha256`, `activatedAtUtc`, and `previousReleaseGitSha`.

- [ ] **Step 1: Add failing identity assertions**

```js
test('activation writes one runtime manifest with current and previous Git identities', async () => {
  await activateFixtureRelease('a'.repeat(40), 'b'.repeat(64));
  const manifest = JSON.parse(readFileSync(path.join(releaseDir, 'runtime-release.json')));
  assert.equal(manifest.gitSha, 'a'.repeat(40));
  assert.equal(manifest.goBinarySha256, 'b'.repeat(64));
  assert.match(manifest.previousReleaseGitSha, /^[0-9a-f]{40}$/);
});
```

- [ ] **Step 2: Run the direct-release test to verify it fails**

Run: `node --test deploy/v88-direct/activate-direct-release.test.js`

Expected: FAIL because no runtime manifest is written.

- [ ] **Step 3: Implement manifest creation before cutover**

Have `runtime-release-manifest.sh` validate SHA formats, calculate the Go binary SHA-256, and write JSON to the staged release directory atomically. Make `activate-direct-release.sh` fail before switching `current` if the manifest cannot be generated or if its Git SHA differs from the requested release SHA.

- [ ] **Step 4: Make `CURRENT_RELEASE` a pointer, not a hand-edited backup**

Store only the active exact Git SHA and manifest relative path. The file must not contain environment values, image credentials, or historical `.env` copies.

- [ ] **Step 5: Run release-script tests**

Run: `node --test deploy/v88-direct/activate-direct-release.test.js`

Expected: PASS, including malformed SHA rejection and failed-manifest no-cutover behavior.

- [ ] **Step 6: Commit**

```bash
git add deploy/v88-direct/activate-direct-release.sh deploy/v88-direct/runtime-release-manifest.sh deploy/v88-direct/activate-direct-release.test.js deploy/v88-public/CURRENT_RELEASE
git commit -m "fix(v88): record exact runtime release identity"
```

### Task 4: Prove compatibility-service ownership before migration or retirement

**Files:**
- Create: `docs/obj/2026-10-05-shuihuo-compat-runtime-ownership.md`
- Create: `tests/v88-shuihuo-compat-boundary.test.js`
- Modify: `deploy/v88-public/runtime-topology.manifest.json`

**Interfaces:**
- Consumes: Nginx route map, Node route list, `shuihuo-compat` container exposed ports, and 24-hour access log route counts.
- Produces: one classification: `required`, `replace-with-node`, or `retire`, with a named public contract and rollback test for every route.

- [ ] **Step 1: Write a failing route-ownership test**

```js
test('every public route forwarded to shuihuo-compat has an explicit owner and retirement gate', () => {
  const manifest = loadManifest('deploy/v88-public/runtime-topology.manifest.json');
  const compat = manifest.services.find(({ id }) => id === 'shuihuo-compat');
  assert.ok(compat.publicContracts.length > 0);
  assert.ok(['required', 'replace-with-node', 'retire'].includes(compat.classification));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/v88-shuihuo-compat-boundary.test.js`

Expected: FAIL because route contracts and classification are not yet recorded.

- [ ] **Step 3: Collect live route evidence without changing traffic**

Capture Nginx configuration, container port mapping, and a bounded 24-hour access-log aggregate. Redact IP addresses, authorization headers, cookies, query text, and request bodies. Record routes with nonzero traffic and their upstream owner.

- [ ] **Step 4: Record the classification and replacement test**

If traffic or an unreplicated route exists, classify as `required` or `replace-with-node` and add a focused route/API contract test. Only classify `retire` when no live route and no internal dependency remains for the whole observation window.

- [ ] **Step 5: Run the test and update the manifest**

Run: `node --test tests/v88-shuihuo-compat-boundary.test.js`

Expected: PASS with explicit route ownership and a non-empty retirement gate.

- [ ] **Step 6: Commit**

```bash
git add docs/obj/2026-10-05-shuihuo-compat-runtime-ownership.md deploy/v88-public/runtime-topology.manifest.json tests/v88-shuihuo-compat-boundary.test.js
git commit -m "docs(v88): classify shuihuo compatibility ownership"
```

### Task 5: Release current V88 and retire only proven redundant runtime artifacts

**Files:**
- Modify: `deploy/v88-public/ROLLBACK.md`
- Create: `deploy/v88-public/cleanup/2026-10-05-ecs-runtime-retirement-manifest.md`
- Test: `tests/v88-runtime-topology.test.js`
- Test: `tests/v88-browser-worker-compose.test.js`
- Test: `deploy/v88-direct/activate-direct-release.test.js`
- Test: `tests/v88-shuihuo-compat-boundary.test.js`

**Interfaces:**
- Consumes: Tasks 1-4 commits, an exact `origin/v88` SHA, and live ECS health/public route verification.
- Produces: current and previous exact Git release manifests, a retirement manifest with deletion candidates, retained rollback references, and measured disk usage before/after.

- [ ] **Step 1: Run all source-level contracts before deployment**

Run:

```bash
node --test tests/v88-runtime-topology.test.js tests/v88-browser-worker-compose.test.js tests/v88-shuihuo-compat-boundary.test.js deploy/v88-direct/activate-direct-release.test.js
git diff --check origin/v88...HEAD
```

Expected: all tests pass and no whitespace errors.

- [ ] **Step 2: Commit and fast-forward/merge into `v88`**

Run:

```bash
git log --oneline origin/v88..HEAD
git push origin HEAD:v88
git ls-remote origin refs/heads/v88
```

Expected: remote `v88` resolves to the approved exact SHA; do not overwrite concurrent work.

- [ ] **Step 3: Stage and cut over through the approved direct release scripts**

Run the project’s `deploy/v88-direct` Stage then Cutover sequence with the exact pushed SHA. Preserve the existing `current` release as `previous`; do not recreate MySQL, Browser Worker, Nginx, or data volumes.

- [ ] **Step 4: Verify the live runtime boundary**

Verify all of the following after cutover: public `shuihuo-production` response, Node-to-Go bridge health, Browser Worker network/health, runtime-release manifest SHA, active/previous release symlinks, and relevant authenticated Batch Factory API/UI behavior.

- [ ] **Step 5: Create a deletion manifest before removal**

List each candidate as `tmp-upload-artifact`, `obsolete-image`, `runtime-config-backup`, or `superseded-release`; for each, show byte size, source Git SHA, replacement/rollback reference, and whether it is safe to delete. Exclude Docker volumes, MySQL data, browser sessions, business video artifacts, current release, previous release, and all secrets.

- [ ] **Step 6: Delete only manifest-approved items and verify recovery**

After explicit approval of the generated retirement manifest, remove only the listed artifacts. Re-run `df -h`, `docker system df`, `docker ps`, and the live verification in Step 4. Record before/after available disk space.

- [ ] **Step 7: Commit documentation only after verified release**

```bash
git add deploy/v88-public/ROLLBACK.md deploy/v88-public/cleanup/2026-10-05-ecs-runtime-retirement-manifest.md
git commit -m "docs(v88): record runtime consolidation release"
```

## Scope deliberately deferred to separate plans

- Feature-level A2/A3 migration from `master`, historical branches, and stale PRs: it requires one plan per domain (Novel Fetch/121, H3, local executor, Batch Factory, script pipeline).
- Branch and Workflow deletion: prohibited until the seven-stage consolidation reaches its final deletion stage.
- Database/media retention policy: requires a separate storage and backup plan; Git is not a database or media archive.

## Self-review

- Spec coverage: ECS-only Browser Worker configuration, exact release identity, compatibility-service ownership, source/runtime parity, rollback policy, and storage cleanup gates each map to Tasks 1-5.
- Placeholder scan: no task delegates an unspecified implementation; every task names files, commands, tests, interfaces, and acceptance evidence.
- Type consistency: all manifest fields referenced by tests (`services`, `id`, `publicContracts`, `classification`, `retirementGate`) are produced in Task 1 or Task 4.
