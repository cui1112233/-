# V88 Public Unified Runtime Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the current mixed host-stage/Docker V88 public runtime with one Docker-only V88 release at `/opt/qiantie/v88/deploy/v88-public`, where public port `3000` is served only by `v88-public-nginx-1` and every request reaches a same-SHA `v88-node`/`go-api` pair through Compose service DNS.

**Architecture:** Nginx is the sole public entry point and proxies all application paths to `v88-node:3000`; the Node application calls `go-api:4000` and `browser-worker:8787` by Compose service name. `qiantie-unified-mysql` remains the sole persistent database container and stays attached to the existing V88 Compose network under its `mysql` alias. Release metadata is baked into both images and exposed through non-legacy runtime metadata endpoints, so a deploy can prove that its Node and Go containers originate from the same Git SHA.

**Tech Stack:** Docker Compose, Nginx 1.27 Alpine, Node 24, Go 1.23, GitHub Actions/GHCR, Node's built-in test runner, SSH deployment script.

---

### Task 1: Add an executable contract for the canonical public topology

**Files:**
- Create: `tests/v88-public-unified-topology.test.js`
- Create: `deploy/v88-public/docker-compose.yml`
- Create: `deploy/v88-public/nginx.conf`
- Create: `deploy/v88-public/.env.example`

**Step 1: Write the failing topology contract**

Create `tests/v88-public-unified-topology.test.js` using `node:test` and `node:assert/strict`. Read the canonical Compose and Nginx files as text and assert all of the following:

- `v88-node`, `go-api`, `browser-worker`, and `nginx` are Compose services; `mysql` is not a service that can start in the public release.
- Node has `QIANTIE_GO_BASE_URL=http://go-api:4000` and `QIANTIE_121_BROWSER_WORKER_URL=http://browser-worker:8787`.
- Go reaches `mysql:3306`; `qiantie-unified-mysql` is connected to the `qiantie_internal` external network with alias `mysql`.
- Nginx binds `3000:80`, and every application request is proxied to `v88-node:3000`; Nginx must not route `/api/` directly to Go.
- The files contain neither `18081`, `172.19.`, `host.docker.internal`, nor a `build:` block.
- Images are supplied only through `QIANTIE_NODE_IMAGE`, `QIANTIE_GO_IMAGE`, and `QIANTIE_BROWSER_WORKER_IMAGE` environment variables.

**Step 2: Run the test to verify it fails**

Run: `node --test tests/v88-public-unified-topology.test.js`

Expected: FAIL because the canonical files do not exist yet.

**Step 3: Implement the canonical Compose and Nginx configuration**

Create `deploy/v88-public/docker-compose.yml` with project-compatible service names, no build contexts, and only named persistent volumes for the existing V88 data and outputs. Define `qiantie_internal` as an external network named `v88-public_qiantie_internal`; declare `qiantie-unified-mysql` as an external network attachment with alias `mysql` rather than declaring a second MySQL service or a volume.

Configure:

- `go-api` from `${QIANTIE_GO_IMAGE}`, with the existing required runtime variables from `.env`, `QIANTIE_GO_LISTEN_ADDR=:4000`, `QIANTIE_MYSQL_DSN` using `mysql:3306`, and `QIANTIE_RELEASE_SHA`.
- `v88-node` from `${QIANTIE_NODE_IMAGE}`, with `QIANTIE_GO_BASE_URL=http://go-api:4000`, `QIANTIE_121_BROWSER_WORKER_URL=http://browser-worker:8787`, `QIANTIE_RELEASE_SHA`, and the existing V88 data/output/static mounts.
- `browser-worker` from `${QIANTIE_BROWSER_WORKER_IMAGE}` and its existing sessions volume; do not recreate or reset its session data.
- `nginx` at public port `3000:80`, mounting only the canonical Nginx configuration and favicon.

Create `deploy/v88-public/nginx.conf` with proxy headers and timeouts appropriate for generation/streaming routes, but only one application upstream, `http://v88-node:3000`; keep `/favicon.png` static.

Create `.env.example` containing names and safe defaults only. It must document image references, release SHA, required secret variable names, existing MySQL database/user variable names, and no secret values.

**Step 4: Run the topology test and Compose validation**

Run:

```bash
node --test tests/v88-public-unified-topology.test.js
docker compose --env-file deploy/v88-public/.env.example -f deploy/v88-public/docker-compose.yml config --quiet
```

Expected: PASS; the Compose file renders without a build context or an embedded MySQL service.

**Step 5: Commit the configuration contract**

```bash
git add tests/v88-public-unified-topology.test.js deploy/v88-public
git commit -m "feat(deploy): define unified V88 public topology"
```

### Task 2: Make Node and Go release identity observable and build both images from one SHA

**Files:**
- Modify: `Dockerfile`
- Modify: `backend/Dockerfile`
- Modify: `server.js`
- Modify: `backend/cmd/qiantie/main.go` (or the current Go HTTP route registration file)
- Create: `tests/v88-public-release-identity.test.js`
- Create: `.github/workflows/v88-unified-public-image-release.yml`
- Modify: `.github/workflows/v88-linux-amd64-image-release.yml`

**Step 1: Write failing identity and workflow contracts**

Create `tests/v88-public-release-identity.test.js`. It must assert that:

- both Dockerfiles declare `ARG QIANTIE_RELEASE_SHA`, set OCI revision metadata, and carry `QIANTIE_RELEASE_SHA` into the runtime image;
- Node exposes a new `GET /api/runtime-build-info` endpoint whose JSON includes `service: "v88-node"` and the injected release SHA without changing the legacy `/api/build-info` compatibility payload;
- Go exposes `GET /api/runtime-build-info` with `service: "go-api"` and the injected release SHA;
- the image workflow builds both Dockerfiles for `linux/amd64` from the same immutable `${{ github.sha }}`, pushes SHA-qualified Node and Go tags, and never publishes `latest`.

**Step 2: Run the test to verify it fails**

Run: `node --test tests/v88-public-release-identity.test.js`

Expected: FAIL because the new metadata and workflow do not yet exist.

**Step 3: Implement runtime metadata**

In both Dockerfiles, accept a `QIANTIE_RELEASE_SHA` build argument, add `org.opencontainers.image.revision` and a source label, and make `QIANTIE_RELEASE_SHA` available to the final runtime process. Preserve the current production commands and non-root behavior.

In `server.js`, add the new runtime endpoint before the SPA fallback. Read only the injected SHA and return a stable, non-sensitive JSON object. Do not alter the existing `/api/build-info` legacy `v78.3.0.3` compatibility response.

In the Go route layer, add the equivalent unauthenticated health/identity endpoint. Thread the release SHA through configuration without logging secrets or DSNs.

**Step 4: Add a replacement image-release workflow**

Create `.github/workflows/v88-unified-public-image-release.yml` as the supported path for V88 public images. It must run the two contract tests before build, use Buildx for `linux/amd64`, pass the exact checked-out Git SHA to both image builds, and push only exact-SHA tags to the existing registry namespace. Emit a workflow summary containing the SHA and the two immutable image references, not credentials.

Replace the body of the retired `v88-linux-amd64-image-release.yml` with a short redirect/deprecation notice that points maintainers to the new workflow and cannot initiate an old host-stage deployment.

**Step 5: Run the identity tests and local image smoke test**

Run:

```bash
node --test tests/v88-public-release-identity.test.js
docker build --build-arg QIANTIE_RELEASE_SHA=plan-smoke -t qiantie-v88-node:plan-smoke .
docker build --build-arg QIANTIE_RELEASE_SHA=plan-smoke -t qiantie-go-api:plan-smoke backend
```

Expected: PASS. Start each image only in an isolated temporary network if an endpoint smoke test is needed; do not start it on port 3000 and do not touch public containers.

**Step 6: Commit release identity work**

```bash
git add Dockerfile backend/Dockerfile server.js backend .github/workflows tests/v88-public-release-identity.test.js
git commit -m "feat(release): stamp V88 public images with one revision"
```

### Task 3: Retire host-stage cutover as a public deployment path

**Files:**
- Modify: `deploy/v88-direct/stage-node-host.sh`
- Modify: `deploy/v88-direct/cutover-node-host.sh`
- Modify: `.github/workflows/v88-direct-deploy-node-stage.yml`
- Modify: `.github/workflows/v88-direct-deploy-node-cutover.yml`
- Modify: `.github/workflows/v88-direct-deploy-contract.yml`
- Modify: `tests/v88-public-browser-worker-deploy.test.js`
- Modify: `tests/v88-release-registry-resilience.test.js`
- Create: `tests/v88-public-host-stage-retirement.test.js`

**Step 1: Write the failing retirement contract**

Create `tests/v88-public-host-stage-retirement.test.js` to assert that no supported public deployment workflow or script can rewrite public Nginx to `18081`, resolve a Docker container IP, or set `QIANTIE_GO_BASE_URL` to an IP address. It must allow read-only diagnostics and an explicit rollback document, but reject public cutover execution paths.

**Step 2: Run the test to verify it fails**

Run: `node --test tests/v88-public-host-stage-retirement.test.js`

Expected: FAIL because current direct-stage scripts and workflows implement precisely that behavior.

**Step 3: Retire, do not delete, the host-stage public cutover**

Convert stage/cutover scripts to fail fast with a clear migration message for public use and preserve their bodies in a dated rollback/reference document outside executable deployment paths. Modify the two direct-deploy workflows so manual dispatch cannot start a host-stage public cutover; replace the job with a validation-only deprecation notice.

Update existing direct-deploy tests to assert the canonical Docker public path, not the superseded host-stage/IP behavior. Keep browser-worker requirements intact: it remains a Compose service and Node always uses its DNS name.

**Step 4: Run all release topology contracts**

Run:

```bash
node --test tests/v88-public-unified-topology.test.js tests/v88-public-release-identity.test.js tests/v88-public-host-stage-retirement.test.js tests/v88-public-browser-worker-deploy.test.js tests/v88-release-registry-resilience.test.js
```

Expected: PASS with no contract describing host port 18081 as a public upstream.

**Step 5: Commit the deployment-path retirement**

```bash
git add deploy/v88-direct .github/workflows tests
git commit -m "fix(deploy): retire V88 host-stage public cutover"
```

### Task 4: Add an atomic, rollback-safe ECS deployment runner

**Files:**
- Create: `scripts/deploy-v88-public-unified.sh`
- Create: `scripts/verify-v88-public-unified.sh`
- Create: `tests/v88-public-unified-deploy-script.test.js`
- Create: `docs/operations/v88-public-unified-release-runbook.md`

**Step 1: Write a failing deployment-script safety contract**

Create `tests/v88-public-unified-deploy-script.test.js` that reads both scripts and asserts:

- target path is exactly `/opt/qiantie/v88/deploy/v88-public`;
- deployment requires explicit Node image, Go image, and one release SHA arguments;
- it runs `docker compose config --quiet`, pulls the two image references, and recreates only `v88-node`, `go-api`, and `nginx` in dependency-safe order;
- it does not run `docker compose down`, `down -v`, `system prune`, `rm -rf`, or any V78 command;
- it saves the previous canonical Compose/Nginx/image environment under a timestamped rollback directory before mutation;
- verification inspects the running image labels, checks Nginx config for only `v88-node:3000`, calls both internal runtime metadata endpoints, and requires Node/Go SHA equality before public HTTP checks.

**Step 2: Run the test to verify it fails**

Run: `node --test tests/v88-public-unified-deploy-script.test.js`

Expected: FAIL because these scripts do not exist.

**Step 3: Implement the deployment and verification scripts**

Write a local runner that copies only canonical Compose/Nginx and invokes a quoted, bounded remote script. The remote side must use `set -euo pipefail`, validate required parameters before changes, create the rollback snapshot, write image variables without secret expansion, run `docker compose config --quiet`, pull explicit SHA tags, and recreate only `go-api`, `v88-node`, and `nginx` with `--no-deps --force-recreate` after confirming the database and browser worker are still running.

Write the verification script to perform internal endpoint/label checks first and public `http://127.0.0.1:3000` and external HTTPS/HTTP checks second. It must report a failed authentication-required business request as “needs logged-in verification,” never as a provider success or failure.

The runbook must include precise prepare/deploy/verify/rollback commands, declare V78 read-only rollback retention, and require a human logged-in Shuihuo verification of one harmless existing-book action before calling the cutover complete.

**Step 4: Run safety tests and shell checks**

Run:

```bash
node --test tests/v88-public-unified-deploy-script.test.js
shellcheck scripts/deploy-v88-public-unified.sh scripts/verify-v88-public-unified.sh
```

Expected: PASS. If `shellcheck` is unavailable, record that fact and run `bash -n` on both scripts instead.

**Step 5: Commit deployment tooling**

```bash
git add scripts/deploy-v88-public-unified.sh scripts/verify-v88-public-unified.sh tests/v88-public-unified-deploy-script.test.js docs/operations/v88-public-unified-release-runbook.md
git commit -m "feat(deploy): add rollback-safe V88 public release runner"
```

### Task 5: Build, deploy, and verify the same-SHA public release

**Files:**
- Modify only generated release snapshot files under `/opt/qiantie/v88/deploy/v88-public/.rollback/` on ECS; do not commit them.

**Step 1: Establish a clean V88 implementation worktree**

Create a new worktree from the clean `v88` tip on a dedicated branch such as `fix/v88-public-unified-runtime-20260911`. Do not use or clean the existing dirty V88 mainline worktree, and do not include unrelated `frontend/dist`, data, lockfile, or user changes.

**Step 2: Run the complete local release gate**

Run the focused contracts from Tasks 1-4, the relevant existing V88 release tests, and both production image builds. Record the exact Git SHA and generated image digests.

Expected: all local tests/builds pass before any registry or ECS change.

**Step 3: Publish the paired artifacts**

Dispatch the unified image workflow for the exact V88 SHA. Confirm registry availability of both image digests before starting ECS deployment. If registry access fails or times out, stop at that boundary; do not switch to a host-stage deployment or a mutable tag.

**Step 4: Deploy with the canonical runner**

Run `scripts/deploy-v88-public-unified.sh` with the exact Node image, Go image, and release SHA. Keep `qiantie-unified-mysql`, all V78 containers/images/old database, existing volumes, and browser-worker sessions intact. Do not delete images or volumes as part of this release.

**Step 5: Verify in layers and resolve only observed failures**

Verify, in order:

1. ECS Compose configuration and container names are `v88-public-*`; port `3000` belongs only to `v88-public-nginx-1`.
2. Nginx sends application traffic only to `v88-node:3000`; Node reaches `go-api:4000` by DNS; neither service has an IP-based backend URL.
3. Both runtime metadata endpoints and image labels report the exact same requested SHA.
4. Public unauthenticated static and metadata requests have an HTTP response and serve the expected V88 bundle.
5. After the user logs in, execute one harmless Shuihuo existing-book navigation/action and inspect the exact request/response, persistence/readback, and a restart readback if it writes state.

If Steps 1-4 fail, use the rollback snapshot to recreate only Node, Go, and Nginx with the prior configuration and image references; preserve data and gather the failing command/status. If only Step 5 is blocked by login, report “infrastructure cutover verified; authenticated business E2E pending” rather than declaring the feature complete.

**Step 6: Commit and integrate**

After all code/test gates pass, merge the dedicated branch into `v88` following the repository’s review workflow. Do not merge the unrelated new Batch Factory design until its separately approved design and implementation plan are complete.

