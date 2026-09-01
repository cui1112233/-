# V78 Doubao Local Executor Design

**Date:** 2026-09-01

## Context

V78 already exposes a user-facing “豆包本地执行器” section in `SettingsPage.jsx`. The page calls `GET /api/shuihuo-production/local-executors` and `POST /api/shuihuo-production/local-executors/pairings`, while the Node shuihuo gateway forwards authenticated `/api/shuihuo-production/*` requests to the Go service. The current Go router only serves Batch Factory V11 and `/health`, so the settings flow has no Go endpoint to terminate on.

The existing local-executor download route publishes manifest/version `0.1.14`, but the repository does not contain a source implementation for the Windows/macOS desktop runtime. Two supplied references show the desired architectural split: a local account/browser manager plus a bridge that owns task/account locking, acceptance detection, result binding, safe retry, cancellation, and download handling.

## Goal

Build the V78 local-executor protocol in slices without pretending unfinished production paths are ready.

Slice 1 makes pairing and online-state management real end-to-end at the Go control plane. Later slices add durable job leasing, Doubao submission state, artifact return, and a maintained desktop runtime.

## Non-goals for Slice 1

- Do not automate Doubao browser actions yet.
- Do not claim a VIDEO task can be generated locally yet.
- Do not store Doubao passwords, cookies, session storage, or browser profiles in V78.
- Do not reuse or reverse engineer the supplied closed-source executable as production code.
- Do not add automatic captcha solving or verification bypass.

## Architecture

### 1. User control plane

The existing Node gateway remains the authenticated browser-facing entry point. It signs requests with the existing Qiantie bridge headers and forwards them to Go.

Go adds a signed sub-router for:

- `GET /api/shuihuo-production/local-executors`
- `POST /api/shuihuo-production/local-executors/pairings`

These routes use the existing `BridgeAuth` identity and are owner-scoped by username.

### 2. Executor direct plane

The desktop executor talks directly to Go and never needs the user’s website session cookie.

Slice 1 exposes:

- `POST /api/local-executor/v1/pair`
- `POST /api/local-executor/v1/heartbeat`

Pairing consumes a short-lived one-time pairing code and returns a high-entropy executor bearer token. Heartbeat authenticates only with that executor token.

### 3. Persistence

Create separate local-executor tables rather than putting device state into Batch Factory V11 tables:

- `local_executor_pairings`
- `local_executors`

Pairing codes and executor tokens are stored only as SHA-256 hashes. Plaintext pairing codes and tokens are returned once and are not recoverable from the database.

The application migration plan combines the existing V11 migrations with the local-executor migrations, while keeping `V11Migrations()` intact for existing tests/contracts.

### 4. Online state

Online is derived, not persisted. An executor is online when `last_seen_at` is within 45 seconds of the server clock. Executors heartbeat every 15 seconds by default.

The heartbeat payload may report non-sensitive health counters:

- total accounts
- available accounts
- busy accounts
- quota exhausted accounts
- login error accounts
- human verification accounts

No account cookies or credentials are accepted.

## API Contract

### Create pairing

`POST /api/shuihuo-production/local-executors/pairings`

Request:

```json
{
  "platform": "doubao"
}
```

Response `201`:

```json
{
  "code": "7Q4M-K9PX",
  "expiresAt": "2026-09-01T10:10:00Z"
}
```

Rules:

- only `doubao` is accepted in Slice 1;
- code expires after 10 minutes;
- code is single-use;
- generating a new code does not expose old codes.

### Pair executor

`POST /api/local-executor/v1/pair`

Request:

```json
{
  "code": "7Q4M-K9PX",
  "deviceName": "DESKTOP-ABC123",
  "platform": "doubao",
  "os": "windows",
  "version": "0.1.14"
}
```

Response `200`:

```json
{
  "executorId": "lex_...",
  "token": "...",
  "heartbeatIntervalSeconds": 15
}
```

The token is shown once. A consumed, expired, wrong-platform, or unknown code fails closed.

### Heartbeat

`POST /api/local-executor/v1/heartbeat`

Header:

`Authorization: Bearer <executor-token>`

Request:

```json
{
  "deviceName": "DESKTOP-ABC123",
  "os": "windows",
  "version": "0.1.14",
  "accounts": {
    "total": 8,
    "available": 5,
    "busy": 2,
    "quotaExhausted": 1,
    "loginError": 0,
    "humanVerification": 0
  }
}
```

Response `200`:

```json
{
  "ok": true,
  "heartbeatIntervalSeconds": 15
}
```

Negative counters or any counter greater than `total` are rejected.

### List executors

`GET /api/shuihuo-production/local-executors`

Response:

```json
{
  "executors": [
    {
      "id": "lex_...",
      "name": "DESKTOP-ABC123",
      "platform": "doubao",
      "os": "windows",
      "version": "0.1.14",
      "online": true,
      "lastSeenAt": "2026-09-01T10:00:12Z",
      "accounts": {
        "total": 8,
        "available": 5,
        "busy": 2,
        "quotaExhausted": 1,
        "loginError": 0,
        "humanVerification": 0
      }
    }
  ]
}
```

Only executors owned by the signed website user are returned.

## Security Invariants

1. Pairing codes are cryptographically random, one-time, expire in 10 minutes, and are stored hashed.
2. Executor bearer tokens contain at least 256 bits of randomness and are stored hashed.
3. Website users cannot list another owner’s executor.
4. Direct executor APIs do not accept website auth headers as a substitute for an executor token.
5. Doubao credentials, cookies, local browser profile paths, and login-state material are never accepted by these endpoints.
6. Human verification is a reported health state only; V78 does not bypass it.

## Future Slice 2: Job Lease and Safe Submission

Slice 2 will add durable executor jobs and the reference-system invariants:

- one account has at most one active VIDEO task owner;
- a task is leased to one executor with an expiry/renew protocol;
- `ACCEPTANCE_UNKNOWN` is distinct from `NOT_ACCEPTED`;
- after any positive acceptance evidence, a task is never resubmitted on another account;
- task result is bound to the exact submitted message/completion/video identity, never “latest video”;
- cancellation propagates to the executor and prevents future resubmit/download work;
- download failure retries download only, never generation.

## Future Slice 3: Artifact Return

Add signed artifact metadata/upload flow, checksum validation, idempotent result attachment, and task completion semantics. V78 stores only returned production artifacts and bounded task evidence.

## Future Slice 4: Maintained Desktop Runtime

Create a source-controlled Windows/macOS executor that owns local account profiles and browser automation. It may use CDP/WebView techniques, but must preserve the security and state-machine contracts above. Captcha/human verification remains manual.

## Testing

Slice 1 must have tests for:

- pairing code generation and normalization;
- expired/single-use pairing rejection;
- token hashing and invalid token rejection;
- cross-owner executor isolation;
- online/offline threshold calculation;
- heartbeat counter validation;
- signed control-plane route behavior;
- unauthenticated direct heartbeat rejection;
- migration registration without changing existing V11 migration checksums.

No Slice 1 UI change is required for basic functionality because the existing Settings page already calls the target endpoints. UI enrichment can follow once real device metadata is available.