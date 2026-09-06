# V88 豆包执行器 A2 Windows 本地验收实时记录

日期：2026-09-06  
工作分支：`fix/v88-doubao-executor-phase1-20260906`  
目标：在 GitHub hosted runner 无法分配的情况下，用 Windows/ECS 直接执行与 CI 等价的 Phase 1 验证，并生成 1.0.4 实包证据。

## 1. 已执行

### RED 契约

提交：

```text
675dffab66a4eb1e0970143a8f5610eb95bcdb8c
```

文件：

```text
local-executor/test/phase1-local-validation-script.test.js
```

契约要求：

- 检查 `node` / `npm` / `go` 环境；
- `backend: go test ./...`；
- root local-executor / script-video route tests；
- `local-executor: npm test`；
- `local-executor: npm run check`；
- `frontend: npm test`；
- `frontend: npm run build`；
- `local-executor: npm run dist:win`；
- 计算 SHA-256；
- installer 最大 90 MiB；
- 生成 `local-validation-report.json`；
- 报告必须包含 `minimumVersion=1.0.3`、`channel=stable`；
- 版本来源必须读取 `local-executor/package.json`，不能维护第二个 `$version='1.0.4'`。

RED 提交触发 Actions：

```text
V88 Doubao Executor Verify: 34024241489
V88 Local Executor Windows: 34024241574
```

但 hosted runner 仍未启动。Verify run 的四个 job 均为：

```text
steps=null
logs_url=null
```

因此没有得到可执行的 RED 日志；这是现有 Actions entitlement / runner 分配外部阻塞，不代表测试通过。

### A2 最小实现

初始实现提交：

```text
15f6e56784d47f769d5f441f3a3434942f6699ea
```

Windows/PowerShell 兼容修正提交：

```text
e4e3132e61e5bab16ed73a68a47c53a82917dfc5
```

正式入口：

```text
scripts/verify-v88-doubao-phase1.ps1
```

## 2. 脚本实际流程

```text
确认 Windows
→ 确认 stable / minimumVersion=1.0.3
→ Get-Command node/npm/go/git
→ 从 local-executor/package.json 读取 version
→ 要求当前候选 version=1.0.4
→ backend go test ./...
→ root npm ci
→ root executor route tests
→ local-executor npm install
→ local-executor npm test
→ local-executor npm run check
→ frontend npm ci
→ frontend npm test
→ frontend npm run build
→ 清空旧 local-executor/dist
→ local-executor npm run dist:win
→ 生成 canonical 1.0.4 EXE
→ 检查 <=90 MiB
→ Get-FileHash SHA256
→ 读取当前 Git commit
→ 写 local-validation-report.json
```

Windows 下优先使用 `npm.cmd`，避免 PowerShell execution policy 把 `npm.ps1` 拦截。

## 3. 运行方法

在已经拉取本工作分支的 Windows PowerShell 中，从仓库根目录运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\verify-v88-doubao-phase1.ps1
```

如果使用 PowerShell 7，也可运行：

```powershell
pwsh -File .\scripts\verify-v88-doubao-phase1.ps1
```

不需要手工指定版本、通道或 SHA。

## 4. 成功产物

全部步骤真实通过后，必须出现：

```text
local-executor/dist/yizhan-local-executor-v88-1.0.4-win-x64.exe
local-executor/dist/local-validation-report.json
```

报告必须包含：

```text
result=passed
version=1.0.4
minimumVersion=1.0.3
channel=stable
platform=win32
arch=x64
sizeBytes=<真实值>
sizeMiB=<真实值>
maxInstallerMiB=90
sha256=<真实SHA-256>
commit=<实际验证提交>
```

任何测试、build、版本检查、SHA/文件定位或 90 MiB 门槛失败，脚本都会抛错退出，不能输出成功结论。

## 5. 当前状态

- [x] A2 设计已批准。
- [x] 测试契约先提交。
- [x] A2 PowerShell 入口已实现。
- [x] Windows npm.cmd 兼容处理。
- [x] 版本读取自 package.json。
- [x] stable / minimumVersion / 90 MiB / SHA / report 门槛写入脚本。
- [x] A2 提交差异核对：从 A2 开始仅新增脚本、契约测试、本 OBJ 三个文件，没有修改业务链路。
- [x] 再次确认 hosted Actions RED run 仍为 0-step，不能提供真实测试证据。
- [x] 当前 ChatGPT 执行容器检查过，没有 `pwsh` / `powershell`，不能在这里冒充 Windows 语法或 NSIS 实跑。
- [ ] 在真实 Windows/ECS 上执行脚本。
- [ ] 得到完整测试结果。
- [ ] 得到真实 1.0.4 installer。
- [ ] 得到真实 bytes / MiB / SHA-256。
- [ ] 进入 Windows 覆盖安装与协议实机验收。

## 6. 当前唯一需要在 Windows 执行的命令

仓库切到：

```text
fix/v88-doubao-executor-phase1-20260906
```

然后在仓库根目录运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\verify-v88-doubao-phase1.ps1
```

脚本会自行完成测试、前端构建、NSIS 构建、SHA、体积门槛和报告，不需要逐条复制十几条命令。

## 7. 禁止提前宣称

在真实 Windows 执行完成之前，不允许宣称：

- Step 7–10 已 GREEN；
- Windows 1.0.4 已构建成功；
- 安装包真实大小已确定；
- SHA-256 已确定；
- 1.0.4 可发布；
- Phase 1 可以合入正式 V88。
