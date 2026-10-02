# 巨量素材执行器本机更新 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Windows 与 macOS 的巨量素材执行器各自在本机发现并由用户确认安装更新；更新后保留原设备身份与 OCR 运行时，不要求重新配对，也不能由网页替另一台电脑远程安装。

**Architecture:** 执行器把当前的“启动后自动更新”改为本地状态机：后台只检查受签名的、按平台分开的发布清单；本机回环配置页显示可用版本，用户点击后才下载和应用。一个跨平台、短生命周期的更新助手在父执行器退出后替换应用并重启。发布工具生成签名清单和带哈希的制品；平台网页只读取版本可用性，不拥有“更新设备”接口。

**Tech Stack:** Go 1.x（执行器、更新助手、Ed25519 校验）、Node/Express（下载路由）、PowerShell 与 Bash（Windows/macOS 打包）、Go tests、Node source/router tests。

**Global Constraints:**

- `v88` 是唯一维护主线；每个实现提交先落 Git，再按既有 V88 staged deploy 路径发布。不得只改 ECS 运行副本。
- 只保留用户配置目录中的稳定设备凭据；绝不把 Token、配对码、更新私钥或硬件指纹写进安装包、清单或浏览器。
- 设备网页只能显示“此设备有新版本”；不增加远程强制更新、更新全部设备或跨账号更新能力。
- OCR 运行中、结果上传中或执行器租约未释放时，一律拒绝应用更新；旧版本继续运行且显示可理解原因。
- Windows 与 macOS 使用同一份签名清单语义，但制品、替换逻辑和架构字段必须严格区分。
- 当前 0.4/0.5 旧客户端不能校验签名，第一次迁移到签名更新器必须从设置页下载安装包；不得用旧的“仅 SHA-256、自动应用”链路冒充安全自动更新。
- macOS 自动替换的正式发布必须有有效 Developer ID 签名与公证产物；未提供发布签名配置时，构建只能生成测试包，生产清单不得标记为可自动更新。
- 不修改巨量 OCR 内容读取、书城备用读取、生产字数范围或任务分派业务语义。

## File Map

- Modify: `giant-material-executor/internal/update/selfupdate.go`
- Modify: `giant-material-executor/internal/update/manager.go`
- Modify: `giant-material-executor/internal/update/manager_test.go`
- Create: `giant-material-executor/internal/update/manifest.go`
- Create: `giant-material-executor/internal/update/manifest_test.go`
- Create: `giant-material-executor/internal/update/controller.go`
- Create: `giant-material-executor/internal/update/controller_test.go`
- Create: `giant-material-executor/cmd/giant-material-executor-updater/main.go`
- Create: `giant-material-executor/cmd/giant-material-executor-updater/main_test.go`
- Modify: `giant-material-executor/cmd/giant-material-executor/main.go`
- Replace: `giant-material-executor/cmd/giant-material-executor/selfupdate_windows.go`
- Replace: `giant-material-executor/cmd/giant-material-executor/selfupdate_other.go`
- Create: `giant-material-executor/cmd/giant-material-executor/selfupdate_darwin.go`
- Modify: `giant-material-executor/internal/httpapi/server.go`
- Modify: `giant-material-executor/internal/httpapi/server_test.go`
- Modify: `giant-material-executor/internal/ui/ui_windows.go`
- Modify: `giant-material-executor/internal/ui/ui_darwin.go`
- Modify: `giant-material-executor/internal/ui/ui_test.go`
- Modify: `giant-material-executor/scripts/build-windows.ps1`
- Modify: `giant-material-executor/scripts/build-macos.sh`
- Create: `giant-material-executor/cmd/giant-material-executor-release/main.go`
- Create: `giant-material-executor/cmd/giant-material-executor-release/main_test.go`
- Modify: `routes/giant-material-executor-downloads.js`
- Create: `routes/giant-material-executor-downloads.test.js`
- Modify: `frontend/src/user/pages/SettingsPageGiant.jsx` (or the existing executor-status component it imports)
- Modify: the matching frontend source tests for the Settings executor card
- Modify: `docs/superpowers/specs/2026-10-01-giant-material-executor-local-update-design.md` only if implementation exposes an approved deviation

## Task 1: Define and test the signed, platform-specific release contract

**Files:**

- Create: `giant-material-executor/internal/update/manifest.go`
- Create: `giant-material-executor/internal/update/manifest_test.go`
- Modify: `giant-material-executor/internal/update/manager.go`
- Modify: `giant-material-executor/internal/update/manager_test.go`

- [ ] **Step 1: Write failing manifest-verification tests.**
  - Cover a valid Ed25519-signed Windows manifest and a valid macOS universal manifest.
  - Cover every rejection boundary: malformed version, wrong platform/architecture, an URL with an unapproved scheme, changed SHA-256 after signing, tampered signature, missing minimum-compatible-version, and a downgrade/replay attempt.
  - Include a test proving the verifier accepts an `http` origin only when the manifest itself verifies; the artifact URL must be included in signed bytes, so a network interceptor cannot replace it.

- [ ] **Step 2: Run the focused tests and confirm they fail for missing contract behavior.**
  - Run: `cd giant-material-executor && go test ./internal/update -run 'Manifest|Signature|Platform' -count=1`
  - Expected: compile or assertion failures because the manifest verifier does not exist yet.

- [ ] **Step 3: Implement canonical manifest verification.**
  - Introduce one `ReleaseManifest` type with `schemaVersion`, `version`, `platform`, `architecture`, `url`, `sha256`, `minimumExecutorVersion`, `publishedAt`, and base64 `signature`.
  - Canonicalize exactly the unsigned fields before Ed25519 verification; reject unknown schema versions and malformed/ambiguous data instead of silently ignoring it.
  - Embed only the update public key in the executor at build time. Keep the private signing key outside Git and accept it only in the release tool through a local path/environment variable.
  - Retire the duplicate, incompatible `Manifest`/`ReleaseManifest` validation paths by making `Manager` consume the verified manifest. Preserve useful coded errors, adding explicit `UPDATE_MANIFEST_SIGNATURE_INVALID`, `UPDATE_PLATFORM_MISMATCH`, and `UPDATE_NOT_AVAILABLE` outcomes.

- [ ] **Step 4: Run focused verification.**
  - Run: `cd giant-material-executor && go test ./internal/update -count=1`
  - Expected: all manifest, signature, hash, busy, downgrade, and staging tests pass.

- [ ] **Step 5: Commit the contract change.**
  - `git add giant-material-executor/internal/update`
  - `git commit -m "feat: verify signed giant executor releases"`

## Task 2: Replace automatic-on-start updates with a user-controlled local update state machine

**Files:**

- Create: `giant-material-executor/internal/update/controller.go`
- Create: `giant-material-executor/internal/update/controller_test.go`
- Modify: `giant-material-executor/internal/update/selfupdate.go`
- Modify: `giant-material-executor/cmd/giant-material-executor/main.go`
- Modify: `giant-material-executor/cmd/giant-material-executor/selfupdate_windows.go`
- Modify: `giant-material-executor/cmd/giant-material-executor/selfupdate_darwin.go`
- Modify: `giant-material-executor/cmd/giant-material-executor/selfupdate_other.go`

- [ ] **Step 1: Write failing controller tests.**
  - Test startup/periodic checks transition to `up_to_date` or `available` but never download or exit.
  - Test `Apply` stages exactly the available release only after a user request.
  - Test a running, cleaning, uploading, or leased OCR job produces `busy` and leaves the old executable untouched.
  - Test concurrent check/apply calls serialize correctly and a failed download or signature check returns to a recoverable error state without losing the previously known version.

- [ ] **Step 2: Run the focused tests and confirm they fail.**
  - Run: `cd giant-material-executor && go test ./internal/update -run 'Controller|Apply|Available' -count=1`
  - Expected: failures because `SelfUpdater.Run` currently stages and applies automatically.

- [ ] **Step 3: Implement the controller and refactor the updater behind it.**
  - Add status fields for `currentVersion`, `availableVersion`, `state`, `message`, `checkedAt`, and `canApply`; do not expose URLs, signatures, or credentials to the loopback page.
  - Make periodic execution call `CheckAvailability` only. `ApplyAvailable` must re-fetch and re-verify the manifest, re-check executor idleness, download, hash-check, stage, and only then hand off to the platform updater.
  - Delete the old Windows behavior that silently applies after the first one-minute timer. Use platform-specific manifest endpoints such as `/downloads/giant-material-executor/releases/windows/latest.json` and `/releases/macos/latest.json`, never the ambiguous shared `latest.json`.
  - Preserve `credential.bin` and the OCR model cache by staging under the app's update area / user data, never by replacing the user config directory.

- [ ] **Step 4: Run focused verification.**
  - Run: `cd giant-material-executor && go test ./internal/update ./cmd/giant-material-executor -count=1`
  - Expected: controller rules pass; existing credential persistence tests remain green.

- [ ] **Step 5: Commit the state-machine change.**
  - `git add giant-material-executor/internal/update giant-material-executor/cmd/giant-material-executor`
  - `git commit -m "feat: require local confirmation for executor updates"`

## Task 3: Add a safe cross-platform update helper and platform adapters

**Files:**

- Create: `giant-material-executor/cmd/giant-material-executor-updater/main.go`
- Create: `giant-material-executor/cmd/giant-material-executor-updater/main_test.go`
- Modify: `giant-material-executor/cmd/giant-material-executor/selfupdate_windows.go`
- Create: `giant-material-executor/cmd/giant-material-executor/selfupdate_darwin.go`
- Modify: `giant-material-executor/cmd/giant-material-executor/selfupdate_other.go`
- Modify: `giant-material-executor/internal/update/selfupdate.go`

- [ ] **Step 1: Write failing update-helper tests.**
  - Test Windows helper command construction includes only the current parent PID, a canonical app root, staged directory, expected executable name, and restart path.
  - Test macOS discovery converts `.../GiantMaterialExecutor.app/Contents/MacOS/GiantMaterialExecutor` to the enclosing `.app`, rejects a binary outside an app bundle, and refuses a destination it cannot write.
  - Test replacement plan has a rollback action: if new bundle activation or restart preparation fails, the previous application remains launchable.
  - Test a staged archive containing path traversal, a mismatched application name, or missing main binary is rejected before handoff.

- [ ] **Step 2: Run the focused tests and confirm they fail.**
  - Run: `cd giant-material-executor && go test ./cmd/giant-material-executor-updater -count=1`
  - Expected: package/test failures until the helper exists.

- [ ] **Step 3: Implement the helper and remove the global-image-name Windows wait.**
  - Build a small `GiantMaterialExecutorUpdater` helper into each release. It receives validated paths plus the parent PID, waits only for that PID, never all processes named `GiantMaterialExecutor.exe`.
  - On Windows, copy the staged package into the existing app directory only after the originating process exits, then relaunch `GiantMaterialExecutor.exe`. Remove generated `apply-update.cmd` and its image-name-wide `tasklist` loop.
  - On macOS, place staged data outside the `.app`, validate one `GiantMaterialExecutor.app`, rename the current bundle to a temporary backup, atomically move the new bundle in its place, use `/usr/bin/open` to relaunch it, and restore the backup on a replacement failure.
  - Return a clear `UPDATE_INSTALL_PERMISSION_DENIED` response when a macOS app in `/Applications` cannot be replaced by the current account; retain manual-download fallback and preserve the old bundle.
  - Keep unsupported platforms explicitly `not available`; do not pretend that Linux or a development binary can self-update.

- [ ] **Step 4: Run focused verification.**
  - Run: `cd giant-material-executor && go test ./cmd/giant-material-executor-updater ./cmd/giant-material-executor ./internal/update -count=1`
  - Expected: helper plan and platform adapter tests pass.

- [ ] **Step 5: Commit the updater helper.**
  - `git add giant-material-executor/cmd/giant-material-executor-updater giant-material-executor/cmd/giant-material-executor giant-material-executor/internal/update`
  - `git commit -m "feat: add safe giant executor update helper"`

## Task 4: Surface update status and explicit local action in the executor UI

**Files:**

- Modify: `giant-material-executor/internal/httpapi/server.go`
- Modify: `giant-material-executor/internal/httpapi/server_test.go`
- Modify: `giant-material-executor/internal/ui/ui_windows.go`
- Modify: `giant-material-executor/internal/ui/ui_darwin.go`
- Modify: `giant-material-executor/internal/ui/ui_test.go`
- Modify: `giant-material-executor/cmd/giant-material-executor/main.go`

- [ ] **Step 1: Write failing loopback API/UI tests.**
  - Assert `GET /v1/update` returns only safe status fields and honors existing origin/nonce protection.
  - Assert `POST /v1/update/check` checks without applying, while `POST /v1/update/apply` refuses busy executors and returns the staged/restarting status only after explicit confirmation.
  - Assert the setup page renders current version, available version, `立即更新`, `稍后提醒`, progress/error text, and does not hide update capability on macOS.
  - Assert Windows tray and macOS local UI offer “检查更新”/“打开更新页面” locally; neither invokes a platform web API to update another device.

- [ ] **Step 2: Run the focused tests and confirm they fail.**
  - Run: `cd giant-material-executor && go test ./internal/httpapi ./internal/ui ./cmd/giant-material-executor -count=1`
  - Expected: existing API only supports `POST /v1/update`, and macOS hides the button.

- [ ] **Step 3: Implement explicit check/apply endpoints and local UX.**
  - Replace the overloaded callback with `GetUpdateStatus`, `CheckUpdate`, and `ApplyUpdate` semantics; retain the same loopback guard used by pairing and health.
  - Update the setup page polling to show: current version; available update; idle/busy state; download/check result; “正在重启并恢复连接”. A user click triggers `/v1/update/apply`; it does not make an update request at page load.
  - Add tray/menu entrypoints that open the same local setup page on both supported platforms so “update is in the executor” remains true even when the browser was closed.
  - Ensure the UI continues to say that closing the web page does not stop OCR, and that update availability is a local-device condition.

- [ ] **Step 4: Run focused verification.**
  - Run: `cd giant-material-executor && go test ./internal/httpapi ./internal/ui ./cmd/giant-material-executor -count=1`
  - Expected: loopback authorization, explicit apply, and both-platform UI tests pass.

- [ ] **Step 5: Commit the local UI/API work.**
  - `git add giant-material-executor/internal/httpapi giant-material-executor/internal/ui giant-material-executor/cmd/giant-material-executor`
  - `git commit -m "feat: show local executor update status"`

## Task 5: Build signed platform releases and serve unambiguous manifests

**Files:**

- Create: `giant-material-executor/cmd/giant-material-executor-release/main.go`
- Create: `giant-material-executor/cmd/giant-material-executor-release/main_test.go`
- Modify: `giant-material-executor/scripts/build-windows.ps1`
- Modify: `giant-material-executor/scripts/build-macos.sh`
- Modify: `routes/giant-material-executor-downloads.js`
- Create: `routes/giant-material-executor-downloads.test.js`

- [ ] **Step 1: Write failing release/router tests.**
  - Given Windows and macOS archives, assert the release tool writes a platform-specific manifest whose signed bytes verify with the embedded public-key fixture and whose URL/hash exactly match the artifact.
  - Assert the router only serves an approved `windows` or `macos` manifest and an exact registered artifact path; reject traversal, unsupported platforms, stale ambiguous `latest.json`, and missing artifacts.
  - Assert cache policy is `no-store` for manifests and immutable for versioned archives.

- [ ] **Step 2: Run the focused tests and confirm they fail.**
  - Run: `cd giant-material-executor && go test ./cmd/giant-material-executor-release -count=1`
  - Run: `node --test routes/giant-material-executor-downloads.test.js`
  - Expected: no release generator and no platform-manifest router contract yet.

- [ ] **Step 3: Implement deterministic release generation.**
  - Add a release command that computes archive hashes, writes versioned platform paths, creates the canonical signed manifests, and fails closed if the signing key is absent or malformed. It must never log the key.
  - Update Windows packaging to bundle the helper, publish a signed Windows manifest, and stop overwriting a shared unsigned `latest.json`.
  - Update macOS packaging to bundle the helper, preserve universal ARM64/x86_64 binaries, and accept `MACOS_CODESIGN_IDENTITY` plus notarization credentials for production. Permit ad-hoc signing only in a clearly labelled local-test output that is not eligible for the public auto-update manifest.
  - Add release verification commands: `codesign --verify --deep --strict`, `spctl`/notarization verification when credentials are configured, archive listing, hash verification, and manifest signature verification before copying public files.
  - Change the Express route to serve only the new release tree. Keep old download routes as manual-download compatibility aliases if needed, but never let new clients consume their unsigned shared manifest.

- [ ] **Step 4: Run focused verification.**
  - Run: `cd giant-material-executor && go test ./cmd/giant-material-executor-release ./internal/update -count=1`
  - Run: `node --test routes/giant-material-executor-downloads.test.js`
  - Expected: manifests are signed, platform-routed, and immutable artifact serving is constrained.

- [ ] **Step 5: Commit release support.**
  - `git add giant-material-executor/cmd/giant-material-executor-release giant-material-executor/scripts routes/giant-material-executor-downloads.js routes/giant-material-executor-downloads.test.js`
  - `git commit -m "feat: publish signed giant executor updates"`

## Task 6: Make the platform settings page informational, not remotely controlling

**Files:**

- Modify: `frontend/src/user/pages/SettingsPageGiant.jsx` (or the current status component)
- Modify: matching `frontend/src/user/pages/SettingsPageGiant*.test.js`
- Modify: backend/executor list API only if its existing response cannot expose `updateAvailable` and `latestVersion` without leaking manifest data

- [ ] **Step 1: Write failing source/component tests.**
  - Verify Settings lists one active executor record per stable device, its platform/current version/online state, and a passive “可更新至 x.y.z” label.
  - Verify it has no “更新此设备” or “更新全部设备” action; download remains only the one-time legacy migration path.
  - Verify an older client is labelled “需手动安装一次以启用安全更新”, rather than claimed as self-updatable.

- [ ] **Step 2: Run the focused tests and confirm they fail.**
  - Run the existing Settings executor source/component test command discovered in `frontend/package.json`.
  - Expected: current UI either lacks the passive version state or implies an unsigned cross-device update capability.

- [ ] **Step 3: Implement passive version presentation.**
  - Derive latest platform versions on the server from the public release inventory; never trust a browser-supplied release version.
  - Render it beside each current device and preserve current device deletion/re-pairing behavior. Do not count historical token rows as active devices.
  - Keep the actual action in the executor's local UI only.

- [ ] **Step 4: Run focused verification.**
  - Run the matching Settings tests and `cd frontend && npm run build`.
  - Expected: settings compiles and has no remote update action.

- [ ] **Step 5: Commit settings presentation.**
  - Stage explicit source/test files only (never generated `frontend/dist` artifacts).
  - `git commit -m "feat: show giant executor update availability"`

## Task 7: Verify migration, packaging, and release boundaries before V88 integration

**Files:**

- Modify only any test/fixture files required by failures discovered below; otherwise no production source changes.

- [ ] **Step 1: Run complete targeted checks.**
  - `cd giant-material-executor && go test ./... -count=1`
  - `node --test routes/giant-material-executor-downloads.test.js`
  - `cd frontend && npm run build`
  - Run the existing backend tests for executor pairing/heartbeat/listing and status display.

- [ ] **Step 2: Perform an isolated Windows replacement rehearsal.**
  - Use a disposable release folder and test binary, not an installed user executor.
  - Assert the old process exits, exactly its own PID is awaited, the helper replaces/relaunches the new binary, the saved credential file remains byte-identical, and no OCR model-cache directory is touched.

- [ ] **Step 3: Perform an isolated macOS replacement rehearsal.**
  - Use a disposable `.app` copy, not `/Applications` or the active user app.
  - Assert a universal staged app passes validation, helper rollback leaves the old app launchable on injected failure, and a successful replacement starts the new app while the credential/cache directory remains intact.

- [ ] **Step 4: Validate public-release prerequisites without deploying.**
  - Confirm the release signing key is available only to the release process.
  - Confirm a real macOS Developer ID/notarization configuration exists. If it does not, record macOS auto-update as blocked and leave its public manifest disabled; do not release a misleading “one-click update” button.
  - Confirm a staged V88 release uses an exact commit SHA and has a prior rollback SHA, per project deployment rules.

- [ ] **Step 5: Review diff and integrate correctly.**
  - Run `git diff --check`, inspect each commit, and make no changes to pre-existing dirty `frontend/dist`, `backend/qiantie`, or other generated artifacts.
  - Merge the reviewed feature branch into `v88`, record the resulting SHA, and only then use the approved staged V88 direct-deployment route.
