# V88 Local Executor Auto-Update Design

Date: 2026-09-03
Status: approved design, implementation target
Branch lineage: V88 only

## Goal

Turn the Windows “一战晟铭豆包执行器” into a one-time-install desktop application that can update itself in place, so users no longer download and retain a new installer for every bug fix.

The updater must preserve existing pairing data, Doubao account records, Chromium session/cookies, and returned-video data because those live under Electron `userData`, outside the installed application bundle.

## Scope

### Included

- Windows x64 executor self-update.
- Stable and beta update channels.
- Startup/manual update checks.
- Background installer download.
- SHA-256 verification before install.
- Update status UI.
- In-place silent NSIS update and app restart.
- Job-aware install deferral: never terminate an active VIDEO task for an update.
- V88-hosted update feed and installer files.
- CI packaging of a complete update bundle for server publication.
- Cleanup of downloaded update installers after successful/failed lifecycle where possible.

### Not included in this slice

- Automatic ECS publication from GitHub Actions unless deployment credentials are explicitly configured later.
- macOS auto-update.
- Changing production/default branch to V88.
- Changing Doubao generation behavior.

## Security model

The updater is an executable delivery path and therefore fails closed.

1. Update feed URLs MUST be HTTPS.
2. HTTP update feeds are rejected before any download occurs.
3. The manifest includes installer filename, version, SHA-256, size, and channel.
4. The downloaded installer is hashed locally and must exactly match the manifest before it becomes installable.
5. The manifest filename is allow-listed; path traversal and arbitrary download paths are rejected by the V88 server route.
6. No GitHub token, private signing key, SSH key, or other deployment secret is embedded in the executor.

Current public pairing endpoint `http://115.190.156.223:3000` may continue to be used for executor jobs, but it is NOT trusted as an executable update source. Until V88 has an HTTPS update origin configured, the updater reports a blocked/HTTPS-required state rather than weakening transport security.

## Update feed layout

Server-side storage:

```text
data/downloads/local-executor-updates/
  beta/
    manifest.json
    yizhan-local-executor-v88-<version>-win-x64.exe
  stable/
    manifest.json
    yizhan-local-executor-v88-<version>-win-x64.exe
```

Public routes:

```text
GET /downloads/local-executor/updates/:channel/manifest.json
GET /downloads/local-executor/updates/:channel/:file
```

Allowed channel values are exactly `beta` and `stable`.

Manifest contract:

```json
{
  "schemaVersion": 1,
  "channel": "beta",
  "version": "1.0.3",
  "platform": "win32",
  "arch": "x64",
  "file": "yizhan-local-executor-v88-1.0.3-win-x64.exe",
  "sha256": "<64 lowercase hex>",
  "size": 123456789,
  "publishedAt": "2026-09-03T00:00:00.000Z"
}
```

The server serves manifest metadata with `Cache-Control: no-store`. Versioned installers may be cached long-term/immutably.

## Client architecture

Add `local-executor/src/electron/update-manager.js` with no privileged renderer access to filesystem/process APIs.

Responsibilities:

- Track updater state: `idle`, `blocked`, `checking`, `available`, `downloading`, `downloaded`, `install_deferred`, `installing`, `up_to_date`, `error`.
- Keep current app version and selected channel.
- Resolve update origin from an explicit updater configuration, not blindly from an HTTP pairing URL.
- Require an HTTPS URL.
- Fetch/validate the manifest.
- Compare semantic versions conservatively.
- Download to a dedicated `userData/updates` temporary directory.
- Stream SHA-256 while/after download and reject mismatches.
- Expose only sanitized state to the renderer.
- Launch the verified NSIS installer silently on Windows and quit the current app.
- Refuse install while `DesktopRuntime.currentTask` exists; mark the update deferred instead.
- Re-evaluate deferred installation once the task clears, but still require an explicit user “立即更新并重启” action unless the user has already asked to install.

The updater uses Electron/Node built-ins rather than giving the renderer raw network or process capabilities.

## Channel behavior

- `beta`: active development/test channel. This is the recommended channel while Doubao live-page adaptation is being debugged.
- `stable`: normal long-term channel.
- Channel preference is stored in `userData/update-preferences.json`.
- Changing channel triggers a new check; it never downgrades automatically.

## UI

Add an “执行器更新” card below automatic tasks:

- Current version.
- Channel selector: 测试版(beta) / 稳定版(stable).
- Human-readable updater status.
- “检查更新” button.
- When download is verified and idle: “立即更新并重启”.
- When a VIDEO task is active: “已下载，任务结束后可更新”; install button disabled.
- When update origin is HTTP/non-HTTPS: explicit “自动更新要求 HTTPS；当前不会下载或执行安装包”.

No downloaded installer is placed in the user’s Downloads folder, preventing the “十几个 EXE” accumulation problem.

## Server integration

Extend `routes/local-executor-downloads.js` instead of creating a second unrelated download subsystem.

Legacy direct download behavior remains compatible. New update routes use strict channel/file allow-lists and a dedicated update root.

The existing Docker image does not copy `data/downloads`; updater artifacts therefore need a persistent deployment mount or an explicit copy/publish step on ECS. This design does not pretend CI can publish to ECS until deployment credentials or a supported upload path are configured.

## CI/release behavior

V88 Windows workflow moves from “single renamed EXE artifact” to a complete updater publication bundle:

- Build NSIS x64 installer.
- Normalize canonical V88 installer filename.
- Compute SHA-256 and size.
- Generate `manifest.json` for the selected channel.
- Upload installer + checksum + manifest as one GitHub Actions artifact.

Version 1.0.3 is the bootstrap updater-enabled release. The user installs this version manually one final time. Later versions can update in place once the HTTPS feed is deployed.

## Failure behavior

- Manifest unavailable: keep current version running, show error.
- Non-HTTPS feed: block update, never download.
- Invalid manifest: block update.
- Hash mismatch: delete the candidate installer, block install.
- Active VIDEO task: defer install, never interrupt task.
- Installer spawn failure: keep app running if possible and show error.
- Update download failure: no effect on executor job polling/login state.

## Verification requirements

TDD coverage must prove at least:

1. HTTP feed is rejected.
2. HTTPS manifest is accepted only with valid schema/channel/platform/arch/file/hash.
3. Path traversal filenames are rejected.
4. Version comparison never downgrades.
5. Hash mismatch prevents install and removes the bad candidate.
6. An active task prevents installer launch.
7. Idle downloaded update can launch installer.
8. Stable/beta channel state persists and chooses the correct feed.
9. Server update route rejects unknown channels/files and serves valid files with correct cache policy.
10. Full existing local-executor regression remains green.
11. Windows installer build remains green and produces the updater publication bundle.

## Promotion rule

Implementation work is done on a V88-derived feature branch. It may fast-forward into `v88` only after tests/build verification pass. Production/default branch remains unchanged until the user separately approves promotion.
