# V78 Novel Fetch V2 / 121 Candidate Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the V78 Novel Fetch V2 / 121 candidate based only on `56a4278c5f96c3be833df43d5a533349edba91d5`, wire the existing Browser Worker into an isolated Docker candidate, and make every 121 mutation path fail closed without touching `master`, `:3000`, production MySQL volumes, or real credentials.

**Architecture:** Keep the existing Node platform as the authenticated owner boundary and make the Browser Worker an internal-only execution service. The platform derives `owner` from `req.username`; the worker accepts only the fixed `two.121w.com/tttadmin` target, encrypts Playwright `storage_state` at rest, and verifies a positive authenticated backend marker before persisting a session. Legacy `/api/batch-rewrite/web-submit/*` mutation routes must delegate to the V2 Browser Worker path or fail closed; they may not retain direct-cookie mutation access.

**Tech Stack:** Node.js, Express, Playwright, AES-256-GCM, Docker Compose, Node built-in test runner, Vite.

**Spec:** `docs/superpowers/specs/2026-08-31-v78-novel-fetch-v2-completion-design.md`

## Global Constraints

- Unique baseline: `56a4278c5f96c3be833df43d5a533349edba91d5`; do not rebase onto a newer same-name branch head.
- Do not modify `master`, the service bound to `:3000`, or production MySQL volumes.
- Validation uses temporary network/data/ports only and no real user credentials.
- Browser Worker must not publish a host port; only the platform service may reach it on an internal Compose network.
- `QIANTIE_121_BROWSER_WORKER_URL`, `QIANTIE_121_WORKER_SECRET`, and a separate Browser Worker storage encryption key are mandatory for the candidate.
- No fallback to `dev-bridge-secret-change-me` is allowed for the Novel Fetch V2 candidate path.
- 121 browser target is exactly `two.121w.com` under `/tttadmin`; arbitrary `baseUrl` is rejected.
- `owner` is derived from authenticated platform identity and is never trusted from browser/client request bodies.
- Playwright `storage_state` is encrypted at rest.
- Login/session verification requires a positive authenticated backend marker; absence of a password field alone is insufficient.

---

### Task 1: Lock the Worker Contract to 121

**Files:**
- Modify: `services/121-browser-worker/test/server.test.js`
- Modify: `services/121-browser-worker/src/contracts.js`

**Interfaces:**
- Consumes: worker request `{ owner, username, password?, baseUrl?, headed? }`.
- Produces: normalized request with canonical `baseUrl: 'http://two.121w.com/tttadmin'`; rejects every other host/path.

- [ ] **Step 1: Write the failing tests** proving arbitrary hosts and alternate paths are rejected and canonical 121 URL is accepted.
- [ ] **Step 2: Verify RED** with `node --test services/121-browser-worker/test/server.test.js`.
- [ ] **Step 3: Implement minimal canonical target validation** in `contracts.js`.
- [ ] **Step 4: Verify GREEN** with the same command.
- [ ] **Step 5: Commit** the contract hardening.

### Task 2: Encrypt Browser Storage State and Fail Fast on Missing Key

**Files:**
- Modify: `services/121-browser-worker/test/session-store.test.js`
- Modify: `services/121-browser-worker/test/server.test.js`
- Modify: `services/121-browser-worker/src/session-store.js`
- Modify: `services/121-browser-worker/src/server.js`

**Interfaces:**
- Consumes: `QIANTIE_121_STORAGE_SECRET` and Playwright storage state object.
- Produces: AES-256-GCM envelope on disk; decrypted object only in memory; worker startup fails when secret is absent.

- [ ] **Step 1: Write failing tests** asserting ciphertext does not contain cookie values, correct-key roundtrip works, wrong-key/corrupt state quarantines, and app creation fails without an encryption secret when no store is injected.
- [ ] **Step 2: Verify RED** with worker session/server tests.
- [ ] **Step 3: Implement AES-256-GCM storage envelope** using a SHA-256-derived 32-byte key and atomic writes with mode `0600`.
- [ ] **Step 4: Verify GREEN** with worker session/server tests.
- [ ] **Step 5: Commit** encrypted storage.

### Task 3: Require Positive Authenticated Backend Evidence

**Files:**
- Modify: `services/121-browser-worker/test/login.test.js`
- Modify: `services/121-browser-worker/src/login.js`

**Interfaces:**
- Consumes: loaded 121 page after navigation/login.
- Produces: authenticated session only when the page is still on `two.121w.com`, is not the login form, and exposes a known backend marker/identity marker.

- [ ] **Step 1: Write failing tests** for “password field disappeared but backend marker absent” and “backend marker present”.
- [ ] **Step 2: Verify RED** with `node --test services/121-browser-worker/test/login.test.js`.
- [ ] **Step 3: Add positive marker verification** and reject ambiguous pages.
- [ ] **Step 4: Verify GREEN** with login tests.
- [ ] **Step 5: Commit** authenticated-page verification.

### Task 4: Keep Owner Server-Derived and Cut Legacy 121 Mutations Over

**Files:**
- Modify: `tests/novel-fetch-upload-browser-worker.test.js`
- Modify: `routes/novel-fetch-upload.js`
- Modify: `tests/batch-rewrite-v2-router.test.js` or add a focused legacy-cutover test.
- Modify: `routes/batch-rewrite.js`
- Modify: `app.js` only if dependency injection is required.

**Interfaces:**
- Consumes: authenticated Express request with `req.username`; existing V2 browser client.
- Produces: Worker requests whose `owner` always equals `req.username`; legacy web-submit login/test/sync/submit mutations use the same Browser Worker-backed service or return an explicit unavailable response.

- [ ] **Step 1: Write failing tests** proving request-body owner cannot change the worker owner and proving legacy web-submit no longer uses direct stored cookies/`target.requestHttp` for mutation or session verification.
- [ ] **Step 2: Verify RED** with focused Node tests.
- [ ] **Step 3: Implement minimal delegation/fail-closed cutover** without changing unrelated Batch Factory routes.
- [ ] **Step 4: Verify GREEN** with focused tests.
- [ ] **Step 5: Commit** the route cutover.

### Task 5: Add Isolated Candidate Compose Wiring

**Files:**
- Create: `docker-compose.novel-fetch-v2-review.yml`
- Add/modify: focused source/compose contract test under `tests/`.

**Interfaces:**
- Consumes: candidate platform image, Browser Worker build context, temporary named/bind data path, generated secrets.
- Produces: `platform-review` + `browser-worker-121` on an internal Docker network; no worker host port; platform receives `QIANTIE_121_BROWSER_WORKER_URL=http://browser-worker-121:8787`.

- [ ] **Step 1: Write failing Compose contract test** asserting internal network, no worker `ports`, mandatory secret variables, temporary data volume, and no `:3000` binding.
- [ ] **Step 2: Verify RED** with the focused test.
- [ ] **Step 3: Add Compose file** with `internal: true` worker network and fail-fast `${VAR:?message}` substitutions.
- [ ] **Step 4: Verify GREEN** with the contract test.
- [ ] **Step 5: Commit** Compose wiring.

### Task 6: Remove Candidate Secret Fallbacks and Reconcile Existing Test Failures

**Files:**
- Modify: `lib/novel-fetch-workshop/mysql-store.js` only for the V2 candidate bridge-secret fallback behavior if required by failing contract tests.
- Modify: stale tests only when the documented V2 contract intentionally supersedes legacy expectations.

**Interfaces:**
- Consumes: `QIANTIE_BRIDGE_SECRET`/injected bridge secret.
- Produces: explicit configuration failure instead of `dev-bridge-secret-change-me` on candidate V2 execution paths.

- [ ] **Step 1: Add/identify failing tests** that exercise the insecure fallback or stale contract.
- [ ] **Step 2: Verify RED** and classify each failure as implementation defect vs obsolete test expectation.
- [ ] **Step 3: Fix implementation defects; update only demonstrably obsolete tests.**
- [ ] **Step 4: Verify focused tests.**
- [ ] **Step 5: Commit** secret/contract reconciliation.

### Task 7: Full Candidate Verification

**Files:**
- No production changes unless verification reveals a real defect.

- [ ] **Step 1: Run** `node --test tests/*.test.js`.
- [ ] **Step 2: Run** worker suite from `services/121-browser-worker`.
- [ ] **Step 3: Run** `npm --prefix frontend run build`.
- [ ] **Step 4: Build** platform candidate and Browser Worker images with review-only tags.
- [ ] **Step 5: Start** only `docker-compose.novel-fetch-v2-review.yml` with temporary network/data/ports and synthetic credentials/mocked target where necessary.
- [ ] **Step 6: Record** full SHA, test counts, image tags/digests, Compose configuration, and unresolved issues; do not publish to `:3000`.
