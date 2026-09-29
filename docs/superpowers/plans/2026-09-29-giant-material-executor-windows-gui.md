# Giant Material Windows GUI Executor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将巨量素材执行器从控制台启动脚本改成可双击、可输入配对码、可最小化后台运行的 Windows 原生 GUI EXE。

**Architecture:** 保留现有 Go agent、DPAPI 凭证和公网任务协议，在 `internal/ui` 增加跨平台 UI 边界。Windows 使用 user32 原生窗口；非 Windows 使用空实现。主程序把现有 Pair、Snapshot、Shutdown 回调注入 UI，GUI 只负责首次绑定和状态展示。

**Tech Stack:** Go 1.23、`golang.org/x/sys/windows`、Windows user32、现有 React/Vite 设置页、PowerShell/ZIP 打包脚本。

## Global Constraints

- 不引入 Electron、WebView2 或需要用户另外安装的 GUI 运行时。
- 不改变 `/api/giant-material-executor/v1/pair`、heartbeat、claim 和结果协议。
- 凭证继续使用 Windows DPAPI；模型与 Python 依赖不进入 ZIP。
- 本机 HTTP 只监听 `127.0.0.1:17861`。
- 保留 `.cmd` 作为诊断备用入口，但 README 和设置页主入口改为 EXE。

---

### Task 1: Lock the GUI contract with failing tests

**Files:**
- Create: `giant-material-executor/internal/ui/ui.go`
- Create: `giant-material-executor/internal/ui/ui_test.go`
- Create: `giant-material-executor/internal/ui/ui_other.go`
- Test: `giant-material-executor/internal/ui/ui_test.go`

**Interfaces:**
- `Config{Pair func(context.Context,string) error, Snapshot func() agent.Snapshot, Shutdown func()}`.
- `Run(context.Context, Config) error` is the cross-platform entry point.

- [ ] **Step 1: Write the failing tests** asserting `Config` validates a pair callback and that state text maps `unpaired`, `connecting`, `online`, `offline`, and `needs_pairing` to user-visible labels.
- [ ] **Step 2: Run `go test ./internal/ui` and verify it fails because the package and mapping are absent.**
- [ ] **Step 3: Add the cross-platform types, validation, and status-label helper; keep `ui_other.go` as a no-op `Run` implementation.**
- [ ] **Step 4: Run `go test ./internal/ui` and verify it passes.**
- [ ] **Step 5: Commit `test(ui): define executor GUI contract`.**

### Task 2: Implement the Windows native pairing window

**Files:**
- Create: `giant-material-executor/internal/ui/ui_windows.go`
- Modify: `giant-material-executor/internal/ui/ui.go`
- Test: `giant-material-executor/internal/ui/ui_test.go`

**Interfaces:**
- Consumes `Config` from Task 1.
- Produces `Run` that registers a user32 window class, creates an Edit control and Bind/Minimize buttons, runs the Windows message loop, and calls `Config.Pair` asynchronously.

- [ ] **Step 1: Add failing source assertions for the Windows implementation:** it must contain the pairing edit control, bind command, `ShowWindow`, and custom status message path.
- [ ] **Step 2: Run the source test and confirm the expected GUI symbols are absent.**
- [ ] **Step 3: Implement the minimal user32 window:** create a 520×260 window, status label, pairing edit, “绑定” button, “最小化到后台” button; `WM_COMMAND` reads the code and invokes `Config.Pair` in a goroutine; `WM_TIMER` refreshes status; `WM_CLOSE` calls `Shutdown`.
- [ ] **Step 4: Run `go test ./internal/ui` on the host and `GOOS=windows GOARCH=amd64 go test ./internal/ui`; verify both compile and pass.**
- [ ] **Step 5: Commit `feat(ui): add native Windows pairing window`.**

### Task 3: Connect GUI to the resident executor

**Files:**
- Modify: `giant-material-executor/cmd/giant-material-executor/main.go`
- Modify: `giant-material-executor/cmd/giant-material-executor/main_test.go`

**Interfaces:**
- Pass existing `pair`, `snapshot`, and `stop` closures into `ui.Run`.
- Preserve startup environment pairing as a diagnostic/backward-compatible path.

- [ ] **Step 1: Add a failing main source test asserting `ui.Run` receives the existing pair and snapshot callbacks.**
- [ ] **Step 2: Run the source test and confirm the integration is absent.**
- [ ] **Step 3: Start the loopback server and resident agent as today, then launch `ui.Run(ctx, ui.Config{...})` for Windows; route pair errors to the GUI status instead of process exit.**
- [ ] **Step 4: Run `go test ./cmd/giant-material-executor ./...` and `go vet ./...`.**
- [ ] **Step 5: Commit `feat(executor): connect native GUI to resident agent`.**

### Task 4: Make the GUI EXE the Windows package entry point

**Files:**
- Modify: `giant-material-executor/scripts/build-windows.ps1`
- Modify: `giant-material-executor/portable/README-Windows.txt`
- Modify: `giant-material-executor/portable/start-giant-material-executor.cmd`
- Modify: `frontend/src/user/pages/SettingsPage.jsx`
- Test: `frontend/src/user/pages/settings-giant-material-executor-source.test.js`

**Interfaces:**
- Windows build uses `-H=windowsgui` and emits `GiantMaterialExecutor.exe` as the primary entry.
- Settings download copy says “双击 EXE”，while the `.cmd` is explicitly diagnostic.

- [ ] **Step 1: Add failing source assertions for the GUI-first README/settings copy and `-H=windowsgui`.**
- [ ] **Step 2: Run frontend/source tests and verify they fail.**
- [ ] **Step 3: Update build/package docs and launcher copy; rebuild the ZIP without model files.**
- [ ] **Step 4: Run frontend targeted tests, `npm run build`, Windows cross-build, `unzip -t`, and local HTTP HEAD for the download URL.**
- [ ] **Step 5: Commit `feat(package): ship GUI-first Windows executor`.**

### Task 5: Final verification and handoff

**Files:**
- Verify: `frontend/public/downloads/giant-material-executor/GiantMaterialExecutor-windows-x64.zip`
- Verify: `docs/superpowers/specs/2026-09-29-giant-material-executor-windows-gui-design.md`

- [ ] **Step 1: Run all executor Go tests and vet.**
- [ ] **Step 2: Run the frontend pairing/status tests and production build.**
- [ ] **Step 3: Confirm PE32+ GUI binary, ZIP contents, no model files, HTTP 200 download, and clean diff for scoped files.**
- [ ] **Step 4: Report the Windows-only interaction boundary honestly: the GUI must be clicked on Windows; macOS only proves cross-compilation and protocol smoke.**
