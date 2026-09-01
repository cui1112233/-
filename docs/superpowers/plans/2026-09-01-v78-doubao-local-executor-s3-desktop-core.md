# V78 Doubao Local Executor Slice 3 Desktop Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the source-controlled Yi Zhan Sheng Ming desktop executor core that pairs to V78, keeps isolated local Doubao account profiles, polls/renews jobs, and enforces no-resubmit-after-acceptance before any live Doubao DOM automation is added.

**Architecture:** Use Electron 44.1.0 so the runtime ships its own Chromium and can isolate each Doubao login with a persistent Electron session partition. Keep protocol, account pool, and job runner as plain CommonJS modules testable with Node's built-in test runner; Electron-specific window/session code is a thin shell. The runner talks only to the V78 device API and a `DoubaoAdapter` interface, allowing deterministic fake-adapter tests before live browser selectors are introduced.

**Tech Stack:** Electron 44.1.0 (Chromium 152 / Node 24.19), CommonJS, Node built-in `fetch`, `node:test`, Electron `safeStorage`, `BrowserWindow`, persistent `session` partitions, electron-builder for Windows/macOS packaging later.

**Spec:** `docs/superpowers/specs/2026-09-01-v78-doubao-local-executor-full-replacement-design.md`

## Global Constraints

- Work on `feat/v78-doubao-local-executor-replacement`.
- Desktop version starts at `1.0.0-dev.1`; do not replace the Settings download links until a packaged live acceptance test passes.
- Website URL and executor token are local-only; the token is encrypted with Electron `safeStorage` and plaintext fallback is prohibited.
- Doubao cookies/passwords/session data never leave the local Electron session partitions.
- One local account can own at most one active VIDEO job.
- Before positive acceptance, bounded retry/account rotation is allowed; after positive acceptance the runner never calls `submit` again for that job.
- `acceptance_unknown` triggers same-account recovery/checking before any retry decision.
- Cancellation stops future submit/retry/monitor/download work.
- Download retry calls download only; it never calls submit/generate again.
- Human verification is surfaced to the user and paused; no captcha solving or bypass.

---

## File Structure

- Create: `local-executor/package.json` — Electron 44.1.0 app metadata/scripts.
- Create: `local-executor/src/api-client.js` — V78 pair/heartbeat/job API client.
- Create: `local-executor/src/device-store.js` — encrypted device config/token persistence abstraction.
- Create: `local-executor/src/account-pool.js` — account registry, states, exclusive locking.
- Create: `local-executor/src/job-runner.js` — job state machine and acceptance boundary.
- Create: `local-executor/src/fake-doubao-adapter.js` — deterministic fake for tests/dev.
- Create: `local-executor/src/electron/account-windows.js` — one persistent Electron partition per account.
- Create: `local-executor/src/electron/main.js` — main process, polling/heartbeat lifecycle.
- Create: `local-executor/src/electron/preload.js` — narrow renderer API.
- Create: `local-executor/ui/index.html`, `ui/app.js`, `ui/styles.css` — minimal pairing/account/status UI.
- Create: `local-executor/test/api-client.test.js`, `account-pool.test.js`, `job-runner.test.js`.

### Task 1: V78 device client and account locking

**Interfaces:**

```js
class ExecutorApiClient {
  constructor({ baseUrl, fetchImpl = fetch })
  pair(input)
  heartbeat(token, input)
  claim(token)
  renew(token, jobId, lease)
  progress(token, jobId, lease, state)
  acceptance(token, jobId, lease, input)
  release(token, jobId, lease, reason)
  fail(token, jobId, lease, input)
  result(token, jobId, lease, artifactId)
}
```

`AccountPool.acquire({ excludeIds = [] })` returns one available account and marks it busy; `release(id, nextState='available')` unlocks it. A busy account cannot be acquired twice.

- [ ] **Step 1:** Write failing `api-client.test.js` proving public `/api/local-executor/v1/*` paths, bearer headers, 204 claim handling, and 409 error propagation.
- [ ] **Step 2:** Write failing `account-pool.test.js` proving exclusive lock, quota/auth/verification exclusion, and release.
- [ ] **Step 3:** Run `cd local-executor && node --test test/api-client.test.js test/account-pool.test.js`; expected RED because modules do not exist.
- [ ] **Step 4:** Implement `api-client.js` and `account-pool.js` minimally.
- [ ] **Step 5:** Re-run tests; expected GREEN.

### Task 2: Enforce acceptance boundary in the job runner

`DoubaoAdapter` contract:

```js
prepare({ job, account, signal })
submit({ job, account, signal }) // => { status: 'accepted'|'not_accepted'|'unknown', submissionId? }
recoverAcceptance({ job, account, signal }) // same result shape
waitForCompletion({ job, account, submissionId, signal }) // => completion identity
fetchArtifact({ job, account, completion, signal }) // => { artifactId, path?, metadata? }
```

`JobRunner.runClaim(claim)`:

1. acquire local account;
2. report `preparing`;
3. prepare references/prompt;
4. report `submitting` and call `submit`;
5. for `unknown`, report `acceptance_unknown` and call `recoverAcceptance` on the same account;
6. only a definite `not_accepted` may cause another pre-accept submit/account attempt;
7. on accepted, immediately report acceptance with local account ID + submission identity;
8. from then on never call `submit` again;
9. report generating/downloading/uploading around completion/download/upload stages;
10. cancellation/409 from server aborts work without another submit;
11. download retries only `fetchArtifact`.

- [ ] **Step 1:** Write failing tests for normal success, unknown→accepted recovery, accepted connection failure with zero resubmit, cancellation with zero later submit, and download retry with submit count fixed at one.
- [ ] **Step 2:** Run `node --test test/job-runner.test.js`; expected RED.
- [ ] **Step 3:** Implement `job-runner.js` and `fake-doubao-adapter.js`.
- [ ] **Step 4:** Run all local-executor core tests; expected GREEN.

### Task 3: Electron isolated accounts and encrypted device credentials

`DeviceStore` receives adapters for `safeStorage`, `fs`, and user-data path to remain unit-testable. Saving an executor token fails when encryption is unavailable; stored JSON contains encrypted base64 only.

`AccountWindows` creates each account with `session.fromPartition('persist:yi-zhan-doubao-'+safeAccountId)` and a dedicated `BrowserWindow`. Closing/showing/reloading one account window does not touch another partition.

- [ ] **Step 1:** Write failing device-store tests for no plaintext token and fail-closed encryption unavailable.
- [ ] **Step 2:** Implement `device-store.js`.
- [ ] **Step 3:** Implement Electron `account-windows.js`, `preload.js`, and `main.js` thin shell; live Doubao automation remains behind the adapter boundary.
- [ ] **Step 4:** Run plain Node tests and `node --check` on all CommonJS source files.

### Task 4: Minimal beginner-friendly desktop UI

The UI exposes only:

- V78 server address;
- pairing code and “绑定” button;
- paired/online state;
- “添加豆包账号” button;
- account rows with name and status (`可用 / 使用中 / 今日额度用完 / 需要登录 / 需要人工验证 / 冷却中`);
- start/stop automation;
- current task line;
- open account window action for login/manual verification.

No hidden advanced settings are required for the first replacement build.

- [ ] **Step 1:** Implement static HTML/CSS/renderer using only preload-exposed IPC methods.
- [ ] **Step 2:** Add accessibility labels and explicit status text, not color-only state.
- [ ] **Step 3:** Run syntax checks and ensure renderer has no Node integration.

### Task 5: Slice 3 verification

- [ ] Run `cd local-executor && node --test test/*.test.js` with zero failures.
- [ ] Run `node --check` across `src/**/*.js` and `ui/app.js`.
- [ ] Confirm `package.json` pins Electron `44.1.0` and app version `1.0.0-dev.1`.
- [ ] Search source for cookie/password/localStorage upload behavior; none may exist.
- [ ] Stop truthfully: desktop core can pair/poll/lock/run against a fake adapter; live Doubao page automation and binary artifact upload/package publication are the next slice.