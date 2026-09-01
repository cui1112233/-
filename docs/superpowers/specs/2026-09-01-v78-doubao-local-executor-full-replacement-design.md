# V78 Doubao Local Executor Full Replacement Design

**Date:** 2026-09-01

## Goal

Replace the unusable legacy `0.1.14` local executor with a source-controlled Yi Zhan Sheng Ming executor that can pair to V78, receive VIDEO jobs, operate local Doubao accounts, return the exact generated video, and expose trustworthy account/task state back to V78.

## User-visible success criteria

The replacement is considered usable only when this flow works end to end:

1. User downloads the new executor from V78 Settings.
2. User generates a pairing code in V78 and enters it in the executor.
3. Executor shows paired/online in V78.
4. User logs one or more Doubao accounts into isolated local browser profiles.
5. A V78 VIDEO task is queued for the paired owner.
6. Exactly one executor leases the task; exactly one local account owns the submission.
7. Executor sends the prompt and, when present, uploads optional reference images, submits once, and records platform acceptance evidence.
8. After acceptance, recovery stays on the same account/conversation and never resubmits on another account.
9. Executor binds completion to the exact submitted message/media identity, downloads the matched MP4, validates it, and uploads the result.
10. V78 attaches the returned artifact to the original VIDEO task and shows success/failure/cancelled accurately.

The old `0.1.14` download is removed from the primary Settings path only after the replacement package is published and the acceptance flow above passes.

## Architecture

### Cloud control plane

Go/MySQL owns durable executor state and job ownership:

- pairing and device token authentication;
- executor heartbeat and account health summary;
- durable local-video job queue;
- lease/renew/release semantics;
- desired cancellation state;
- submission/acceptance evidence;
- progress events and terminal outcome;
- artifact metadata and idempotent completion.

Node remains the public V78 gateway. Website routes keep normal account authentication. Device routes are exposed through a narrow Node-to-Go proxy and are authenticated by executor bearer token, never by website cookie.

### Local executor runtime

A new source-controlled runtime lives under `local-executor/` and owns all sensitive local state:

- V78 base URL and device token;
- Doubao browser profiles/login state;
- local account registry and account locks;
- browser automation adapter;
- active task checkpoints;
- downloaded artifacts before upload.

Cloud never receives cookies, passwords, localStorage/sessionStorage, profile directories, or raw browser credentials.

### Account model

Each Doubao login is one isolated local account/profile. At most one VIDEO task owns an account at a time.

Account states include:

- `available`
- `busy`
- `quota_exhausted`
- `auth_required`
- `human_verification`
- `cooldown`
- `disabled`

Ordinary generation failures do not permanently disable an account. Explicit quota exhaustion can hold the account until local midnight. Human verification pauses the account and requires manual user action; the executor must not bypass captcha/verification.

## VIDEO input contract

VIDEO jobs require a non-empty text prompt. Reference images are optional.

Supported input shapes:

- prompt only -> text-to-video;
- prompt + one or more reference images -> reference-guided video generation.

The executor must not reject a VIDEO task only because `images` is absent or empty. When images are present, the adapter uploads them before submission. When images are absent, the adapter skips the upload step and submits the prompt directly.

## Job state machine

Cloud job states:

- `queued`
- `leased`
- `preparing`
- `submitting`
- `acceptance_unknown`
- `accepted`
- `generating`
- `downloading`
- `uploading`
- `succeeded`
- `failed`
- `cancelled`

Acceptance is the irreversible boundary.

Before positive acceptance evidence, a task may retry or use another eligible account according to bounded policy. After positive acceptance evidence, the task must never be submitted again on another account or in another conversation. Connection loss, browser refresh, CDP/WebView replacement, slow generation, and download failures recover against the same accepted submission.

## Required safety invariants

1. One executor job has at most one active lease.
2. One local account has at most one active VIDEO owner.
3. Lease expiry before acceptance may make a job claimable again; lease expiry after recorded acceptance must not permit a second submission.
4. `acceptance_unknown` is not equivalent to `not_accepted`.
5. Positive acceptance evidence permanently sets `accepted_at` and freezes `executor_id`, `account_id`, and submission identity for that attempt.
6. A returned video must be traceable to the exact submission/message/media identity; never choose “latest video”.
7. Download retry never triggers regeneration.
8. Cancellation prevents future account switches, retries, monitor loops, and downloads. A request already accepted by Doubao cannot be revoked, but the executor must not send another request.
9. Human verification is manual; no captcha solving or bypass.
10. Cloud stores no Doubao login credentials or browser session material.

## Public API groups

### Website control plane

Under `/api/shuihuo-production/local-executors`:

- list executors;
- create pairing;
- disconnect executor;
- inspect executor/account health summary.

V78 VIDEO creation routes enqueue local-executor jobs when the selected video provider is the local Doubao executor.

### Device plane

Under `/api/local-executor/v1`:

- `POST /pair`
- `POST /heartbeat`
- `POST /jobs/claim`
- `POST /jobs/{id}/renew`
- `POST /jobs/{id}/progress`
- `POST /jobs/{id}/acceptance`
- `POST /jobs/{id}/result`
- `POST /jobs/{id}/fail`
- `POST /jobs/{id}/release`

Every endpoint after pairing requires the executor bearer token. Job mutations additionally verify the active lease token/lease generation so a stale executor cannot update a reassigned job.

## Persistence

Existing Slice 1 tables remain:

- `local_executor_pairings`
- `local_executors`

Add:

- `local_executor_jobs`
- `local_executor_job_events`
- `local_executor_artifacts`

The job row stores owner, source task identity, payload JSON, state, lease executor/token hash/generation/expiry, cancellation desired flag, accepted timestamp, accepted account ID, submission identity, terminal error code/message, and artifact reference.

Events are bounded/redacted and contain no cookies or secrets.

## Local runtime implementation strategy

The first maintained runtime is a Go desktop/CLI core that can be packaged for Windows and macOS. UI can remain minimal initially: pairing, account list/status, start/stop, logs, and manual verification indicator. Browser control is behind a `DoubaoAdapter` interface so protocol/state-machine tests do not depend on live Doubao.

The live adapter may use a Chromium profile plus CDP/Playwright-compatible browser automation, but the executable must not depend on the supplied closed-source manager/plugin. The supplied references are behavior references only.

## Doubao submission/result rules

The adapter must:

- select supported Seedance model/duration options from task payload;
- require a non-empty prompt but treat reference images as optional;
- upload task reference images before submission only when images are present;
- record a pre-submit baseline for conversation/message/media identity;
- detect acceptance using positive evidence from the new submission;
- automatically answer a normal confirmation request at most once when required;
- on ambiguous submit/network failure, refresh/rebind the same account and check whether the previous submission was accepted before deciding to retry;
- after three definitely-not-accepted rounds, release/requeue according to policy;
- after acceptance, only rebind the same account/conversation;
- match the completion/media to the accepted submission identity;
- obtain the official downloadable MP4 when available and validate size/container header before upload;
- fail closed instead of returning an unrelated or watermarked/latest video.

## Release strategy

1. Finish control plane and public device proxy.
2. Add durable job leasing and cancellation.
3. Add source-controlled executor core with fake adapter and end-to-end contract tests.
4. Add live Doubao adapter and manual-login account profiles.
5. Add artifact upload/attachment and V78 provider wiring.
6. Package Windows/macOS replacement as version `1.0.0` (or later verified version).
7. Change Settings download links/manifest from legacy `0.1.14` only after replacement artifacts exist.
8. Run real controlled-account acceptance test before declaring the old executor replaced.

## Testing gates

- Unit tests for pairing/token/account summaries.
- Migration checksum regression for existing V11 migrations.
- Lease exclusivity, stale lease, expiry, cancellation, acceptance freeze, no-resubmit invariants.
- Device proxy tests proving pair/body and Bearer headers pass through while arbitrary paths do not.
- Executor state-machine tests with fake Doubao adapter for normal success, not-accepted retry, ambiguous acceptance, accepted connection loss, cancellation, quota exhaustion, human verification, and download retry.
- VIDEO input tests proving prompt-only succeeds, prompt+images succeeds, and missing prompt fails.
- Artifact identity/idempotency tests.
- Full Go tests and Node/frontend build where dependencies are available.
- Real live acceptance test is required before replacing the download links.