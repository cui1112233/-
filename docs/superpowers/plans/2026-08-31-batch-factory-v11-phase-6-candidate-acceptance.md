# Batch Factory V11 Phase 6 Candidate Compose And Acceptance Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. This phase creates an isolated candidate only; it cannot change the live V78 `:3000` deployment.

**Goal:** 从固定 V11 commit 构建可追溯的 Node platform 与 Go backend 候选镜像，在新 MySQL 8.4/object/app-data volumes、隔离端口和无外网执行条件下完成 API、UI、刷新、重启、迁移与回滚验收。

**Architecture:** Candidate Compose contains `platform`, `backend`, `mysql`, and `objects` services joined only to an internal runtime network. Platform exposes one explicitly chosen loopback port; backend is reachable only as `backend:4000`. Candidate data is created afresh, or from an immutable RAW clone through separately named writable/sanitized clones for the final import rehearsal. Runtime feature gates disable Director/Production/121/Yadi, no production credential file is mounted, and the internal network prevents provider egress.

**Tech Stack:** Docker BuildKit, Docker Compose v2, Node 24 platform Dockerfile, Go 1.23 backend Dockerfile, MySQL 8.4, MinIO-compatible candidate object storage, Bash, curl, Node test runner, Go tests, browser acceptance.

## Global Constraints

- This phase begins only after Phase 2 through Phase 5 committed SHAs and their gates are reviewed. Phase 1's real import occurs only after this candidate is green; its dry-run tooling may be exercised against fixtures earlier.
- Build platform from the repository root `Dockerfile`; build Go from `backend/Dockerfile` with `backend` as its build context. `deploy/Dockerfile.platform` does not exist and must not be introduced as an assumed dependency.
- Candidate image tags contain full source provenance: `qiantie-platform:bfv11-candidate-${SHORT_SHA}` and `qiantie-backend:bfv11-candidate-${SHORT_SHA}`. `latest`, `v8-latest`, image IDs, and unrecorded mutable tags are prohibited.
- Candidate Compose project name is `qiantie-bfv11-${SHORT_SHA}`; host port is supplied by `QIANTIE_BFV11_CANDIDATE_PORT` and must bind `127.0.0.1:${QIANTIE_BFV11_CANDIDATE_PORT}:3000`. The script rejects `3000`, any non-numeric port, or an already-listening port.
- Candidate volumes must be uniquely named with the project name: `mysql`, `objects`, and `appdata`. They cannot reference an existing formal volume name, bind mount a formal data directory, or be declared `external: true`.
- Runtime networks are `candidate-edge` and `candidate-internal`. `candidate-internal` has `internal: true`; backend, mysql, and objects join only it; platform joins it and candidate-edge; candidate-edge is not used by backend/mysql/objects. Any service with a configured external provider URL or production credential mount fails the preflight.
- `QIANTIE_BATCH_FACTORY_V11_DIRECTOR_EXECUTION_ENABLED=false`, `QIANTIE_BATCH_FACTORY_V11_PRODUCTION_EXECUTION_ENABLED=false`, `QIANTIE_BATCH_FACTORY_EXTERNAL_EXECUTION=false`, and all 121/Yadi execution flags are set false in Compose. The preflight verifies no value is overwritten from the host environment.
- Candidate DB credentials and bridge secret are generated locally per run into `artifacts/batch-factory-v11/${RUN_ID}/candidate.env` with file mode `0600`; that file, browser session data, MySQL dump contents, and object content are ignored by Git and never printed or committed.
- No production DSN, production object endpoint, provider key, 121 credential, Yadi credential, current `:3000` container, formal MySQL volume, formal object volume, or `master` may be read-write mounted, stopped, renamed, rebuilt, or modified.
- Candidate success does not authorize a `:3000` release. A separate user confirmation after documented acceptance and rollback evidence is mandatory.

## File Structure

- Create: `deploy/batch-factory-v11-candidate.compose.yml` and `deploy/batch-factory-v11-candidate.env.example`.
- Create: `scripts/batch-factory-v11-candidate-preflight.sh`, `scripts/batch-factory-v11-candidate-up.sh`, `scripts/batch-factory-v11-candidate-smoke.sh`, `scripts/batch-factory-v11-candidate-restart-check.sh`, `scripts/batch-factory-v11-candidate-down.sh`, and `scripts/batch-factory-v11-candidate-report.sh`.
- Create: `scripts/seed-batch-factory-v11-candidate-account.js` and `test/batch-factory-v11-candidate-scripts.test.js`.
- Create: `docs/batch-factory/alpha-releases/${RUN_ID}-candidate-acceptance.md` only after a real run; before then use `docs/batch-factory/alpha-releases/README.md` to define its redacted evidence fields.
- Modify: `.gitignore` to exclude `artifacts/batch-factory-v11/`, candidate `.env` files, and generated acceptance screenshots/data dumps while retaining scripts, compose YAML, and redacted reports.

### Task 1: Add a fail-closed candidate Compose definition and preflight

**Interfaces:**

- `deploy/batch-factory-v11-candidate.compose.yml` defines services named `platform`, `backend`, `mysql`, and `objects`, all with immutable candidate image tags supplied through `QIANTIE_BFV11_PLATFORM_IMAGE` and `QIANTIE_BFV11_BACKEND_IMAGE`.
- `scripts/batch-factory-v11-candidate-preflight.sh "$SOURCE_SHA" "$PORT"` prints one redacted JSON object and exits non-zero on unsafe input.
- `scripts/batch-factory-v11-candidate-preflight.sh` writes `artifacts/batch-factory-v11/${RUN_ID}/manifest.json`, containing source SHA, image tags/digests, compose project, port, generated volume names, feature-gate values, and no secret values.

- [ ] **Step 1: Write failing script/Compose tests**

Create `test/batch-factory-v11-candidate-scripts.test.js` using `node:child_process.spawnSync`. It invokes the preflight with a temporary artifact root and asserts that it rejects all of these inputs:

~~~text
source SHA shorter than 40 hexadecimal characters
port 3000
a port with letters or a port already held by a temporary HTTP server
an image tag ending in :latest
a compose file that contains external: true under volumes
a compose file containing /var/lib/docker/volumes or a production-looking volume name
an env file with any execution gate equal to true
an env file containing QIANTIE_MYSQL_DSN with a host other than mysql:3306
~~~

Run:

~~~bash
node --test test/batch-factory-v11-candidate-scripts.test.js
~~~

Expected: FAIL because candidate Compose and preflight do not exist.

- [ ] **Step 2: Implement Compose with fresh internal-only services**

`mysql` uses `mysql:8.4`, a named project-scoped volume, and generated credentials from the local candidate env file. `objects` uses `minio/minio` with a generated local access key/secret and a named project-scoped volume. `backend` receives a candidate-only MySQL DSN that names host `mysql`, a bridge secret generated for this run, its feature gates set false, and `QIANTIE_GO_LISTEN_ADDR=:4000`. `platform` receives `QIANTIE_GO_BASE_URL=http://backend:4000`, the matching bridge secret, feature gates set false, and a new app-data volume; it binds only `127.0.0.1:${QIANTIE_BFV11_CANDIDATE_PORT}:3000`.

The Compose file is image-only: it declares all candidate volumes as named non-external volumes and `candidate-internal: { internal: true }`, contains no `build:` section and no source-code bind mount. The source checkout is used only as the explicit context of the two `docker build` commands; it never appears in a running service's `volumes:` or mounts.

- [ ] **Step 3: Implement the preflight**

The preflight must call `git rev-parse --verify "${SOURCE_SHA}^{commit}"`, inspect `docker image inspect` for each immutable tag, render `docker compose --project-name "${CANDIDATE_PROJECT}" --env-file "${CANDIDATE_ENV}" -f deploy/batch-factory-v11-candidate.compose.yml config`, reject any `:latest`, formal volume/bind marker, external volume, missing false gate, non-loopback port binding, production-looking host, or backend attachment to candidate-edge. It generates `RUN_ID` from a UTC timestamp plus `SHORT_SHA`, creates the artifact directory with `umask 077`, and creates candidate secrets with `openssl rand -hex 24`.

- [ ] **Step 4: Run tests and commit**

~~~bash
node --test test/batch-factory-v11-candidate-scripts.test.js
git add deploy/batch-factory-v11-candidate.compose.yml deploy/batch-factory-v11-candidate.env.example scripts/batch-factory-v11-candidate-preflight.sh test/batch-factory-v11-candidate-scripts.test.js .gitignore
git commit -m "chore(batch-v11): add fail-closed candidate compose"
~~~

### Task 2: Build immutable images from a clean worktree

**Interfaces:**

- `scripts/batch-factory-v11-candidate-up.sh "$SOURCE_SHA" "$PORT"` runs all source tests before Docker build and refuses a dirty implementation worktree other than its redacted artifact directory.
- Platform image is built by `docker build --pull --no-cache -t "qiantie-platform:bfv11-candidate-${SHORT_SHA}" -f Dockerfile .`.
- Backend image is built by `docker build --pull --no-cache -t "qiantie-backend:bfv11-candidate-${SHORT_SHA}" -f backend/Dockerfile backend`.
- The manifest records the immutable `RepoDigests` returned by `docker image inspect`; an absent digest is a build failure, not a substitute with local image ID.

- [ ] **Step 1: Write failing build-command tests**

Extend `test/batch-factory-v11-candidate-scripts.test.js` to inspect the up-script source and invoke its `--dry-run` path. Assert it runs these commands in this order before any `docker build` invocation:

~~~bash
npm ci
npm --prefix frontend ci
node --test test/batch-factory-v11-proxy.test.js
node --test frontend/src/user/pages/batch-factory-v11/*.test.js
go -C backend test ./internal/batchfactoryv11 ./internal/httpapi ./internal/storage -count=1
npm --prefix frontend run build
~~~

Also assert the platform command uses root `Dockerfile`, the backend command uses `backend/Dockerfile` and `backend` context, and neither command uses `latest` or `deploy/Dockerfile.platform`.

- [ ] **Step 2: Implement clean build enforcement**

The up script verifies the checkout's HEAD equals the requested full SHA, runs `git diff --quiet` and `git diff --cached --quiet`, then executes the listed commands. A test/build failure stops before Docker build. On success it builds both images with BuildKit, verifies each tag/digest, calls preflight, then starts the project with `docker compose up -d --wait`.

Write source SHA, commands, process exit status, platform digest, backend digest, compose project name, service container IDs, and generated volume names to the redacted manifest. Do not echo candidate env contents.

- [ ] **Step 3: Run script tests and commit**

~~~bash
node --test test/batch-factory-v11-candidate-scripts.test.js
git add scripts/batch-factory-v11-candidate-up.sh test/batch-factory-v11-candidate-scripts.test.js
git commit -m "chore(batch-v11): build immutable candidate images"
~~~

### Task 3: Seed isolated acceptance data and verify migrations

**Interfaces:**

- `scripts/seed-batch-factory-v11-candidate-account.js` creates a candidate-only account record and emits its username only; its generated password remains in the 0600 candidate env file and manifest does not store it.
- `scripts/batch-factory-v11-candidate-smoke.sh "$RUN_ID"` consumes the candidate manifest, never formal credentials, and reports response status/route name only.
- Candidate database setup begins empty; it runs V11 migrations once at backend startup, then once after backend restart to prove idempotence.

- [ ] **Step 1: Write failing seeding and smoke tests**

Add script tests that use a temporary fake manifest and mock curl executable. Assert the smoke script requests these unauthenticated/unauthorized checks in order:

~~~text
GET  /
GET  /novel-fetch
GET  /batch-factory
GET  /batch-factory-preview
GET  /settings
GET  /api/build-info
GET  /api/login/session
GET  /api/batch-factory/v11/capabilities
GET  /api/batch-factory/v11/batches
~~~

The test accepts `401` for session/V11 protected API requests and rejects `404`, `5xx`, a missing route, or an infinite timeout. It also asserts that `seed-batch-factory-v11-candidate-account.js` does not contain a static password literal, API key, 121 URL, or provider URL.

- [ ] **Step 2: Implement candidate seed and smoke scripts**

The seed script reads only candidate env variables, generates a password using `crypto.randomBytes(24).toString('base64url')`, stores it through the existing account-store interface inside the platform container, and writes a local `candidate-login.txt` file with mode `0600` under the artifact run directory. It does not upload or log that file.

The smoke script uses `curl --connect-timeout 3 --max-time 10 -sS -o "$TEMP_BODY" -w '%{http_code}'` against `"http://127.0.0.1:${PORT}"` and exits non-zero for a route `404` or `500` through `599`. It considers `200`, `302`, `401`, and `403` valid only for the routes above; it records statuses and response SHA-256 values, never response bodies. It then starts a disposable MySQL 8.4 test database through the Phase 2 test DSN and runs the empty/schema-one/schema-twenty-six/repeat migration matrix before acceptance is allowed.

- [ ] **Step 3: Run candidate start and smoke test on a new port**

Choose a free port other than 3000 with `PORT="$(node -e "const net=require('net'); const s=net.createServer(); s.listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})")"`. Set `SOURCE_SHA` to the full 40-hex implementation commit and derive `SHORT_SHA="${SOURCE_SHA:0:12}"`; preflight writes `RUN_ID`, `CANDIDATE_PROJECT`, and `CANDIDATE_ENV` into the redacted manifest. Then run:

~~~bash
scripts/batch-factory-v11-candidate-up.sh "$SOURCE_SHA" "$PORT"
scripts/batch-factory-v11-candidate-smoke.sh "$RUN_ID"
~~~

Expected: all public page routes are `200` or documented redirects; protected V11 endpoints return `401` before login instead of `404`; candidate migrations pass without modifying any formal volume.

- [ ] **Step 4: Commit the candidate fixture tooling**

~~~bash
git add scripts/seed-batch-factory-v11-candidate-account.js scripts/batch-factory-v11-candidate-smoke.sh test/batch-factory-v11-candidate-scripts.test.js
git commit -m "test(batch-v11): seed and smoke test isolated candidate"
~~~

### Task 4: Prove egress and external actions are disabled

**Interfaces:**

- Candidate `GET /api/batch-factory/v11/capabilities` reports `director.run`, `production.submit`, `merge.run`, `publish.121`, and `publish.yadi` as `available:false` with explicit reasons.
- Candidate outbound connection test executes inside the backend container and must fail to resolve/connect a non-candidate host; it does not contact a production provider or 121/Yadi service.
- Any V11 POST to disabled external capability returns `503` and writes no submission/run/provider event.

- [ ] **Step 1: Write failing safety tests**

Extend smoke test assertions to perform an authenticated candidate session request and check capability JSON. It must verify that all five capability values are false and that an attempted V11 production-submit request returns `503` with `BFV11_EXTERNAL_EXECUTION_DISABLED`.

Add a Compose source assertion that backend has no candidate-edge network attachment and `candidate-internal` is `internal: true`. Add a runtime command check that runs `getent hosts example.invalid` inside backend and expects non-zero; do not use a real provider hostname.

- [ ] **Step 2: Implement no-outbound verification and audit query**

The smoke script calls a V11 status endpoint after the rejected submit and asserts no new submission IDs appear. It records capability names/statuses and connection-test exit code in the manifest. If any disabled action returns `2xx`, creates a database row, resolves `example.invalid`, or backend is attached to a non-internal network, the script stops and leaves the candidate containers running for inspection.

- [ ] **Step 3: Run safety checks and commit**

~~~bash
node --test test/batch-factory-v11-candidate-scripts.test.js
git add scripts/batch-factory-v11-candidate-smoke.sh deploy/batch-factory-v11-candidate.compose.yml test/batch-factory-v11-candidate-scripts.test.js
git commit -m "test(batch-v11): enforce candidate no-outbound gates"
~~~

### Task 5: Perform authenticated browser acceptance, refresh, and restart recovery

- [ ] **Step 1: Create one fixture Batch through V11 API**

Using the candidate-only account, log in through the candidate UI or session endpoint, call `POST /api/batch-factory/v11/intakes/novel-fetch` with two synthetic Books and at least one synthetic VIDEO per Book, then call `POST /api/batch-factory/v11/intakes/{intakeId}/batches`. Use source text such as `候选验收小说一` and `候选验收小说二`; do not copy formal novel text or account data.

- [ ] **Step 2: Verify Go Settings/Snapshot UI and API behavior**

At `http://127.0.0.1:${PORT}/batch-factory`, verify all of these with the candidate fixture:

~~~text
V11 workbench loads the two Books and selecting each changes the current Book detail
production unified settings Drawer opens and its section order is configuration version, basic settings, constraints
config version list is populated by Go and sync/save persists after reload
Book and VIDEO settings open, save sparse false, empty string, and zero values, then refresh with the same values
restore inheritance removes only the chosen override and preserves all other Book/VIDEO overrides
model/mode/config/ratio/fixed-single change shows Go change-impact and invalidates Director without deleting overrides
constraint toggle opens its editor directly; closing/reopening retains draft
status center selection updates its right-side current-filter output
only one unified player element is present; Book/VIDEO changes do not create another
edit layout, save layout, and restore default work without changing API data
unavailable Hook/Director/Production/Merge/121/Yadi controls remain disabled and say why
~~~

Record a screenshot for the workbench, production Drawer, Book settings, and VIDEO settings in the ignored artifact directory. Do not upload screenshots containing candidate login details.

- [ ] **Step 3: Verify API and container restart recovery**

With the candidate fixture still present, capture `GET /api/batch-factory/v11/batches/{batchId}`, one snapshot ID, and its SHA-256. Run:

~~~bash
docker compose --project-name "$CANDIDATE_PROJECT" --env-file "$CANDIDATE_ENV" -f deploy/batch-factory-v11-candidate.compose.yml restart backend platform
scripts/batch-factory-v11-candidate-smoke.sh "$RUN_ID"
~~~

After restart, log back in, re-read the selected Batch/snapshot, and assert its IDs and serialized effective settings equal the values recorded before restart. Verify `/`, `/novel-fetch`, `/settings`, `/batch-factory`, and `/batch-factory-preview` still return their pre-restart statuses.

- [ ] **Step 4: Record an acceptance report**

Create `docs/batch-factory/alpha-releases/${RUN_ID}-candidate-acceptance.md` containing only:

~~~text
source SHA and implementation phase SHAs
platform/backend image tags and RepoDigests
compose project, loopback port, container IDs, and generated volume names
test/build/migration commands and exit status
route statuses before/after authenticated session and restart
capability matrix and rejected external-action evidence
fixture Batch IDs, snapshot IDs, count reconciliation, and no-formal-volume assertion
screenshots by artifact filename and SHA-256
known unavailable capabilities
rollback/down command
~~~

The report contains no account password, bridge secret, DSN password, object credentials, provider credential, raw novel text, or cookies.

### Task 6: Down, evidence retention, and rollback rehearsal

**Interfaces:**

- `scripts/batch-factory-v11-candidate-down.sh "$RUN_ID" --preserve-evidence` stops and removes only the named candidate project containers/networks, leaves candidate volumes and artifact manifest untouched, and refuses an unknown project prefix.
- `scripts/batch-factory-v11-candidate-down.sh "$RUN_ID" --delete-candidate-volumes` requires the same run ID, verifies every volume has the candidate project prefix, and writes a final redacted deletion record. It never accepts an arbitrary volume name.
- `scripts/batch-factory-v11-candidate-report.sh "$RUN_ID"` prints image tags/digests, route results, volumes, and exact candidate-only restart/down commands.

- [ ] **Step 1: Write failing teardown safety tests**

Add tests that pass `qiantie-production-platform`, `deploy_qiantie-test-mysql`, `3000`, and an unknown run ID to the down script. Each must exit non-zero before running a Docker remove command. Add a valid temporary candidate manifest test asserting the script's rendered command contains only its candidate project/volume names.

- [ ] **Step 2: Implement project-scoped teardown**

The script reads only the recorded manifest, calls `docker compose --project-name "$CANDIDATE_PROJECT" ... down --remove-orphans` for preserve-evidence mode, and does not pass `--volumes`. Delete-volumes mode enumerates `docker volume ls --format '{{.Name}}'`, requires every selected name to begin with "${CANDIDATE_PROJECT}_", then removes only those exact names. Never use globbed or broad volume deletion.

- [ ] **Step 3: Rehearse candidate restart then preserve-evidence down**

Run the restart check once, invoke preserve-evidence down, then use the report script to prove the manifest and volume names remain available. Do not run delete-candidate-volumes until the acceptance report has been reviewed.

- [ ] **Step 4: Run final script tests and commit**

~~~bash
node --test test/batch-factory-v11-candidate-scripts.test.js
git add scripts/batch-factory-v11-candidate-down.sh scripts/batch-factory-v11-candidate-restart-check.sh scripts/batch-factory-v11-candidate-report.sh test/batch-factory-v11-candidate-scripts.test.js docs/batch-factory/alpha-releases/README.md
git commit -m "chore(batch-v11): preserve candidate rollback evidence"
~~~

## Phase Gate

- [ ] Candidate platform/backend images were built from a clean, fixed full SHA and their RepoDigests are recorded.
- [ ] Platform uses root `Dockerfile`; backend uses `backend/Dockerfile`; no nonexistent Dockerfile path is used.
- [ ] Candidate has fresh, project-scoped MySQL/object/app-data volumes and cannot mount/read-write a formal volume or formal data directory.
- [ ] MySQL 8.4 empty/schema-one/schema-twenty-six/repeat migration matrix, Node proxy tests, Go V11 tests, V11 UI tests, and Vite build all pass.
- [ ] `/`, `/novel-fetch`, `/settings`, `/batch-factory`, and `/batch-factory-preview` pass smoke before and after restart. Protected routes may return `401` before login but never `404` or `5xx`.
- [ ] Authenticated V11 settings/save/reload/override/UI acceptance and one-player/layout checks are documented with candidate-only fixture data.
- [ ] Feature gate, missing production credential, and internal-network checks prove no external Director/Production/121/Yadi request can leave the candidate.
- [ ] Candidate teardown is project-scoped, evidence is retained, and no action changed `:3000`, `master`, production image, formal MySQL, or formal volumes.

After this gate, stop and report the acceptance evidence. A separate explicit approval is required for any formal deployment discussion.
