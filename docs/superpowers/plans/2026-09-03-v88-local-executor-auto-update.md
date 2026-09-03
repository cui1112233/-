# V88 Local Executor Auto-Update Implementation Plan

> Source design: `docs/superpowers/specs/2026-09-03-v88-local-executor-auto-update-design.md`
> Maintenance target: V88 lineage only
> Bootstrap version: 1.0.3

## Task 1 — Lock the update contracts with failing tests

Files:
- Create `local-executor/test/update-manager.test.js`
- Create `test/local-executor-updates.test.js`

Tests first:
- HTTPS-only update origin.
- valid/invalid manifest parsing.
- path traversal rejection.
- no downgrade.
- active-task install deferral.
- verified idle installer launch.
- server stable/beta allow-list and cache headers.

Verification:
- Run V88 local-executor regression workflow and confirm RED for missing implementation.

## Task 2 — Implement the secure desktop update manager

Files:
- Create `local-executor/src/electron/update-manager.js`
- Create `local-executor/src/update-preferences-store.js`
- Modify `local-executor/src/electron/main.js`
- Modify `local-executor/src/electron/preload.js`
- Modify `local-executor/package.json`

Behavior:
- Use Node/Electron built-ins; no GitHub token and no renderer process execution privileges.
- Resolve an explicitly configured HTTPS update base URL.
- Persist `beta`/`stable` preference under Electron `userData`.
- Check/fetch manifest, compare version, download to `userData/updates`, verify SHA-256.
- Never install while a VIDEO task is active.
- Launch verified NSIS installer silently only after explicit install action and idle check.
- Surface sanitized updater state through IPC.

Verification:
- Local-executor tests green.
- `npm run check` green.

## Task 3 — Add the updater UI

Files:
- Modify `local-executor/ui/index.html`
- Modify `local-executor/ui/app.js`
- Modify `local-executor/ui/styles.css`
- Add/update UI tests as appropriate.

UI:
- Current version.
- Stable/beta selector.
- Update status.
- Check update button.
- Install/restart button when verified.
- Explicit HTTPS-required state.
- Busy-task deferred state.

Verification:
- Renderer syntax checks pass.
- Existing account/task UI behavior remains intact.

## Task 4 — Extend the V88 download server for update feeds

Files:
- Modify `routes/local-executor-downloads.js`
- Add `test/local-executor-updates.test.js`
- Modify `Dockerfile` only if a safe persistent update root contract is required.

Routes:
- `GET /downloads/local-executor/updates/:channel/manifest.json`
- `GET /downloads/local-executor/updates/:channel/:file`

Rules:
- Channels exactly `beta|stable`.
- Manifest no-store.
- Versioned installers immutable-cache.
- No arbitrary filesystem path resolution.
- Legacy direct-download route remains compatible.

Verification:
- Node route tests green.

## Task 5 — Build the 1.0.3 updater publication bundle

Files:
- Modify `.github/workflows/v88-local-executor-windows.yml`
- Modify `local-executor/package.json` version to `1.0.3`.

Workflow output:
- `yizhan-local-executor-v88-1.0.3-win-x64.exe`
- `.sha256`
- `manifest.json`

The artifact is a publication bundle; it is not automatically copied to ECS unless deployment credentials are configured separately.

Verification:
- Windows Actions job: install dependencies, tests, syntax, build, manifest generation, artifact upload all green.

## Task 6 — Full V88 verification and consolidation

- Re-run local-executor regression on the final commit.
- Verify Windows build artifact contents.
- Compare feature branch against the then-current V88 branch.
- If V88 has advanced, integrate/rebase by selective fast-forward-safe work rather than overwriting concurrent V88 changes.
- Fast-forward V88 only if it is a clean descendant and verification is green.
- Update `CURRENT_VERSION.md` with updater bootstrap status and the HTTPS deployment prerequisite.
- Do not change production/default branch.

## Manual deployment/acceptance after code completion

1. Publish the 1.0.3 beta bundle under an HTTPS V88 update origin.
2. User manually installs 1.0.3 one final time.
3. Publish a harmless 1.0.4 beta build.
4. Verify 1.0.3 discovers/downloads/verifies 1.0.4.
5. With no task active, verify in-place update/restart and preserved pairing/Doubao session.
6. With a task active, verify install is deferred.
