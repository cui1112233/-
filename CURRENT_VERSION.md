# V88 Current Version

- Branch: `v88`
- Current V88 HEAD: `eee8ec0f4994fddcfc15e00dd5ea2db60625870e`
- Status: integration branch, not production/default
- Base source: `master@fc1f5a96364518f0f14073fd5195363ef0e15a77`
- Batch Factory source candidate: `d9c3a164053473c55704fa0ba904041366564b61`
- Integration policy: preserve all base website functions; selectively overlay only verified feature/runtime source; do not merge historical candidate branch history wholesale.
- Production: unchanged
- Default branch: unchanged
- Maintained Doubao desktop executor version in formal V88: `1.0.3`
- Active Doubao Phase 1 release candidate version: `1.0.4`
- Maintained Doubao desktop executor source entry: `local-executor/`
- Maintained web settings entry: `frontend/src/user/pages/SettingsPage.jsx`
- Maintained script VIDEO entry: `frontend/src/user/pages/ScriptPage.jsx`

## Active Doubao Phase 1 candidate — not yet promoted to V88

- Candidate branch: `fix/v88-doubao-executor-phase1-20260906`
- Latest V88 baseline has been synced into the candidate through PR #19.
- PR #19 merge commit on the candidate: `f63f5af1a6b57629f03a104ad2e22491ff33bfef`.
- Current compare after the sync: candidate `ahead 88 / behind 0` relative to `v88`.
- Candidate contains the real VIDEO-stage UI, stricter acceptance/media binding, structured JSONL logging, Windows installer size/build reporting, overwrite-install smoke checks, allow-listed `yizhan-executor://update` web-to-local update initiation, stable-by-default update channel behavior, legacy installer migration handling, and the `1.0.4` release version bump.
- These candidate features are **not** considered part of formal V88 until the full regression, Windows build, installer checks, HTTPS updater-origin check, and real VIDEO end-to-end test pass.
- Candidate execution record: `docs/obj/2026-09-06-v88-doubao-executor-phase1-execution-record.md`.
- Update-protocol record: `docs/obj/2026-09-06-v88-doubao-executor-update-protocol-progress.md`.
- `1.0.4` release-candidate record: `docs/obj/2026-09-06-v88-doubao-executor-1.0.4-release-candidate.md`.

## Included in the V88 consolidation line

- Go Batch Factory V11 backend and MySQL/storage/runtime support
- Local-executor server integration required by Batch Factory V11 video production
- Maintained desktop local executor source under `local-executor/`
- Doubao live-page Video-tab compatibility for the current AI Creation page
- Doubao carousel duplicate-control filtering: click selection now prefers the control that is actually hit-testable in the viewport instead of treating off-screen/clipped carousel clones as equally actionable
- Local executor task errors remain visible after successful heartbeat calls so live-page failures are diagnosable instead of disappearing
- Windows executor updater bootstrap `1.0.3`: beta/stable channels, background download, local size/SHA-256 verification, in-place NSIS update/restart, and active-VIDEO-task deferral
- V88-hosted local-executor update feed routes under `/downloads/local-executor/updates/{beta|stable}/...`
- Executable update delivery is fail-closed to HTTPS only; the current plain-HTTP pairing endpoint may still run jobs but cannot be used to download or execute updates
- Update installers are stored in Electron `userData/updates`, not the user's Downloads folder, so routine updates do not accumulate installer files there
- Shared Yizhan branding asset used by the web favicon and Windows executor packaging
- Batch Factory V11 frontend workbench subtree
- Batch Factory V11 browser API client
- Node-to-Go runtime wiring required for V11 APIs
- V88 local-executor regression workflow
- V88 Windows local-executor build workflow now produces a publication bundle containing EXE, SHA-256 and update manifest

## Update deployment prerequisite

The updater client and V88 feed routes are code-complete only when verified by CI or an equivalent Windows validation environment. Real self-update additionally requires an HTTPS V88 update origin and a deployed/persisted `data/downloads/local-executor-updates/{channel}` feed. The existing plain-HTTP server address is intentionally rejected for executable updates.

## Current validation blocker

GitHub-hosted Ubuntu and Windows jobs are currently failing before runner assignment. Observed jobs have `runner_id=0`, empty/null steps, and no job logs. Repository-side workflow changes therefore cannot prove correctness until the account/repository Actions entitlement issue is resolved or an equivalent Windows validation environment is used.

## Explicitly preserved from master base

All unrelated website routes and source files remain from the exact base commit unless they are selectively brought into V88 as verified consolidation work, including Novel Fetch, Script, Agent, account/member/team, TTS, Shuihuo production, pet, settings and other existing website functions.

## Development rule

New feature development and bug fixes must target the V88 lineage. Older V78/release/feature branches are reference sources only and must not receive new maintained fixes.

## Promotion rule

Do not switch production or the GitHub default branch to `v88` until V88 verification is complete and the user explicitly approves promotion.
