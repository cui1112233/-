# V78 Novel Fetch V2 / 121 Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the V78 Novel Fetch V2 / 121 candidate safe to validate without publishing to `:3000`, by hardening the Browser Worker boundary, session storage, login proof, owner isolation, and legacy mutation routing.

**Architecture:** Keep the existing Novel Fetch V2 and 121 Browser Worker split. Add a private Docker Compose topology for validation, require explicit secrets, restrict navigation to `two.121w.com`, bind owner identity to authenticated server context, encrypt Browser Worker storage state at rest, strengthen login success detection, and block legacy Node 121 mutation fallthrough. Preserve compatible read-only/legacy UI behavior only where it does not bypass V2.

**Tech Stack:** Node.js, Express, Playwright, Docker Compose, Node `crypto`, existing `node:test`, Vite/React frontend.

**Spec:** `docs/superpowers/specs/2026-08-31-v78-novel-fetch-v2-completion-design.md`

## Global Constraints

- Baseline is exactly `56a4278c5f96c3be833df43d5a533349edba91d5`.
- Do not modify `master`, `:3000`, production MySQL volumes, or real user credentials.
- Validation must use temporary network, temporary data directories, and temporary ports only.
- Browser Worker must be private/internal and must not publish a host port.
- `QIANTIE_121_BROWSER_WORKER_URL` and `QIANTIE_121_WORKER_SECRET` are required for Browser Worker integration.
- Missing encryption keys must fail closed; `dev-bridge-secret-change-me` is forbidden.
- 121 browser targets are restricted to `two.121w.com` only.
- Owner identity must come from authenticated server context, not request-body input.
- `storage_state` must be encrypted at rest.
- Login success must be proven by a trusted authenticated 121 backend signal, not merely by the absence of a password field.
- Legacy Node Batch Rewrite mutation routes must not bypass V2.

---

### Task 1: Safety Contract Tests

**Files:**
- Create: `tests/novel-fetch-v2-121-hardening.test.js`
- Modify as needed: existing 121 and route tests only when they encode obsolete behavior.

**Interfaces:**
- Consumes: existing worker/server/session/login modules and Express routes.
- Produces: executable regression contract for all hardening behavior below.

- [ ] Add failing tests proving missing required secrets fail closed and forbidden dev fallback is absent.
- [ ] Add failing tests proving only exact hostname `two.121w.com` is accepted.
- [ ] Add failing tests proving request-body `owner` cannot override authenticated owner.
- [ ] Add failing tests proving storage state is not persisted as plaintext JSON.
- [ ] Add failing tests proving login is not authenticated solely because no password input exists.
- [ ] Add failing tests proving legacy 121 mutation endpoints cannot execute around V2.
- [ ] Run focused tests and confirm they fail for the intended missing behavior before implementation.

### Task 2: Worker Secret and Target Hardening

**Files:**
- Modify: `services/121-browser-worker/src/contracts.js`
- Modify: `services/121-browser-worker/src/server.js`
- Modify: `lib/novel-fetch-workshop/121-browser-client.js`
- Modify: `lib/novel-fetch-workshop/v2-compose.js`

**Interfaces:**
- Consumes: environment variables and worker HTTP requests.
- Produces: validated worker config and requests restricted to the approved 121 host.

- [ ] Require explicit worker secret and reject blank/default values.
- [ ] Add a shared exact-host URL validator for `https://two.121w.com/...` (and documented allowed scheme behavior if existing tests require it).
- [ ] Apply host validation to login/test/action navigation inputs before Playwright navigation.
- [ ] Remove any `dev-bridge-secret-change-me` fallback from V2 compose/runtime paths.
- [ ] Re-run focused tests to green.

### Task 3: Encrypted Browser Storage State

**Files:**
- Modify: `services/121-browser-worker/src/session-store.js`
- Modify: `services/121-browser-worker/src/server.js`
- Modify: `services/121-browser-worker/test/session-store.test.js`

**Interfaces:**
- Consumes: `QIANTIE_121_STORAGE_STATE_SECRET` and Playwright storage-state objects.
- Produces: AES-256-GCM encrypted session files and decrypted state only in memory.

- [ ] Add failing tests for missing key, encrypted file format, round-trip decryption, and wrong-key failure.
- [ ] Derive a fixed-length key with SHA-256 from the configured secret and encrypt JSON with AES-256-GCM using a random 12-byte IV.
- [ ] Persist a versioned envelope containing algorithm/version/iv/tag/ciphertext, never plaintext cookies/localStorage.
- [ ] Fail closed on missing/invalid key or malformed ciphertext.
- [ ] Re-run worker session-store tests to green.

### Task 4: Strong Login Proof

**Files:**
- Modify: `services/121-browser-worker/src/login.js`
- Modify: `services/121-browser-worker/test/login.test.js`

**Interfaces:**
- Consumes: Playwright page and 121 backend page content/location.
- Produces: authenticated=true only when a trusted backend condition is observed.

- [ ] Add failing tests for a page with no password input but no authenticated backend marker.
- [ ] Define trusted success as exact 121 host plus an allowed backend path and/or stable authenticated identity/navigation marker already present in the real 121 UI contract.
- [ ] Keep explicit detection for login/password form failure.
- [ ] Save session state only after trusted proof succeeds.
- [ ] Re-run login tests to green.

### Task 5: Owner Isolation and Legacy Mutation Gate

**Files:**
- Modify: `routes/novel-fetch-upload.js`
- Modify: `routes/batch-rewrite.js`
- Modify: `routes/batch-rewrite-v2.js` if needed for explicit ownership/route coverage.
- Modify: related route tests.

**Interfaces:**
- Consumes: authenticated `req.username` / existing auth middleware.
- Produces: user-bound Browser Worker session operations and fail-closed legacy mutation behavior.

- [ ] Add/revise tests proving owner always derives from authenticated request context.
- [ ] Inventory legacy mutation routes touching 121/session/upload/retry/delete/regenerate behavior.
- [ ] For 121-specific legacy mutations, return an explicit V2-required response rather than executing legacy cookie/session logic.
- [ ] Preserve non-conflicting compatibility routes only where they cannot mutate 121 state outside V2.
- [ ] Re-run focused route tests to green.

### Task 6: Isolated Docker Compose Validation Topology

**Files:**
- Create: `docker-compose.novel-fetch-v2-review.yml`
- Create or modify: `.env.novel-fetch-v2-review.example` if repository convention allows examples.
- Add tests/source contract for Compose shape.

**Interfaces:**
- Consumes: temporary review secrets/paths/port supplied by validator.
- Produces: platform + private worker network topology with no worker host-port publishing.

- [ ] Add contract tests that parse/check Compose text for platform and worker services, internal network, required env wiring, temporary data mounts, and no worker `ports:` publishing.
- [ ] Define platform service using the candidate image/build and a non-3000 temporary host binding.
- [ ] Define worker service built from `services/121-browser-worker`, reachable only by Compose service DNS.
- [ ] Wire `QIANTIE_121_BROWSER_WORKER_URL=http://novel-fetch-121-worker:8787`, worker secret, credential secret, and storage-state secret through environment variables without committing real secret values.
- [ ] Re-run Compose contract tests to green.

### Task 7: Diagnose Existing Five Node Failures

**Files:**
- Modify only files proven by root-cause analysis to be stale tests or incorrect implementation.

**Interfaces:**
- Consumes: full `node --test tests/*.test.js` output.
- Produces: documented classification for each failure: stale test, implementation defect, or environment-dependent blocker.

- [ ] Run the full Node suite in an isolated checkout/environment.
- [ ] Record exact five failing test names, stack traces, and assertions.
- [ ] Trace each failure to recent V2/121 contract changes before changing code.
- [ ] Update stale tests only when the intended current contract is independently proven.
- [ ] Fix implementation defects test-first.
- [ ] Re-run full Node suite.

### Task 8: Build and Review Verification

**Files:**
- No production changes unless verification exposes a tested defect.

**Interfaces:**
- Consumes: completed branch.
- Produces: final candidate SHA, test/build results, image metadata when build tooling is available, Compose config, and unresolved issue list.

- [ ] Run `node --test tests/*.test.js`.
- [ ] Run worker tests.
- [ ] Run `npm --prefix frontend run build`.
- [ ] Validate Compose config with temporary paths/secrets and a non-3000 port.
- [ ] Build/tag candidate images only in the isolated review namespace when Docker execution is available.
- [ ] Report branch name, full SHA, tests, image tag/digest if actually built, Compose config, and remaining blockers without claiming unavailable runtime verification.
