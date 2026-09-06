# V88 豆包执行器下一步计划与执行记录

日期：2026-09-06  
正式分支：`v88`  
工作分支：`fix/v88-doubao-executor-phase1-20260906`  
正式 V88 执行器版本：`1.0.3`  
Phase 1 候选版本：`1.0.4`

## 一、当前基线

本轮开始时，`v88` 在执行期间继续前进。重新审计后确认最新 V88 新增内容集中在公网剧本提示词/导演流水线、prompt 文件及 server wiring，没有与 Phase 1 豆包执行器核心文件发生重叠。

已执行：

```text
PR #19
v88 → fix/v88-doubao-executor-phase1-20260906
```

PR #19 已成功合并：

```text
merge commit: f63f5af1a6b57629f03a104ad2e22491ff33bfef
```

合并后重新比较：

```text
candidate ahead 88 / behind 0 relative to v88
v88 HEAD: eee8ec0f4994fddcfc15e00dd5ea2db60625870e
```

没有把任何 Phase 1 未验证代码反向合入正式 `v88`。

## 二、当前真正阻塞

GitHub-hosted Ubuntu/Windows job 持续在 runner 分配之前失败：

```text
runner_id=0
steps=[] / steps=null
logs_url=null
```

这意味着：

1. 不是 Go/Node/Electron/Frontend 测试自身失败；
2. 不是 Windows NSIS 构建命令执行后失败；
3. job 连 Checkout 都没有真正开始；
4. 继续修改 workflow 不能证明代码正确。

外部调查结果：当前现象与 GitHub 私有仓库 hosted runner 的 Actions 额度/计费 entitlement 问题，以及 2026-08 社区出现的 runner_id=0 预启动失败高度一致。仓库连接无法读取账号 Billing/Actions 管理页面，因此目前不能把具体原因断言成某一种计费状态。

## 三、下一步执行顺序

### Step A — 恢复真实验证环境（最高优先级）

二选一，优先 A1：

#### A1. 修复 GitHub hosted Actions entitlement

检查 GitHub 账号：

```text
Settings
→ Billing / Billing & licensing
→ Budgets and alerts / Actions
```

确认：

- Actions 未被预算 0 / spending limit 阻断；
- 没有失败付款/支付验证提示；
- 私有仓库 Actions 用量仍可用；
- 修复后手动触发 `V88 Doubao Executor Verify`。

验收：job 必须出现真实 runner 名称和 Checkout/Setup/Test steps；仅显示 run=success 但没有 steps 不算通过。

#### A2. Windows/ECS 本地等价验证

若 hosted runner 暂时无法恢复，则在 Windows/ECS 上直接执行与 CI 等价的验证，不依赖 GitHub-hosted runner。

准备新增一个仓库内 PowerShell 验收入口，目标只做编排，不改变业务代码：

```text
scripts/verify-v88-doubao-phase1.ps1
```

预期执行：

```text
检查 node/npm/go 环境
→ backend: go test ./...
→ root Node route tests
→ local-executor: npm install / npm test / npm run check
→ frontend: npm ci / npm test / npm run build
→ local-executor: npm run dist:win
→ 定位 1.0.4 NSIS EXE
→ 计算 SHA-256
→ 计算 bytes / MiB
→ 确认 <= 90 MiB
→ 生成 local-validation-report.json
```

该脚本属于新的仓库行为，按 Superpowers 规则必须在用户确认本设计后再实现。

### Step B — 取得 1.0.4 Windows 实包

只有 Step A 有真实执行环境后进行。

必须拿到：

```text
yizhan-local-executor-v88-1.0.4-win-x64.exe
SHA-256
sizeBytes
sizeMiB
minimumVersion=1.0.3
channel=stable
commit SHA
```

硬规则：

```text
installer <= 90 MiB
```

超过 90 MiB 直接失败，不发布。

### Step C — Windows 安装/覆盖更新验收

在 Windows 真机验证：

1. 1.0.3 或旧版客户端存在；
2. 1.0.4 静默/正常安装成功；
3. 覆盖安装仍为同一程序安装位置；
4. `userData` 中配对、账号、update preferences 不丢；
5. `yizhan-executor://open` 唤起同一个实例；
6. `yizhan-executor://update` 只触发内置 UpdateManager；
7. 不调用 PowerShell/CMD 下载 EXE；
8. 更新包保存在 `userData/updates`，不进入 Downloads；
9. 更新后没有 `(1)/(2)/(3)` 多份正式程序。

### Step D — HTTPS stable update feed

正式自更新仍需要 HTTPS。

当前 plain HTTP 公网地址只能继续承担配对/任务通信，不允许作为 EXE 更新源。

发布前必须提供：

```text
https://<正式更新域名>/downloads/local-executor/updates/stable/manifest.json
https://<正式更新域名>/downloads/local-executor/updates/stable/yizhan-local-executor-v88-1.0.4-win-x64.exe
```

manifest 必须与真实 EXE 一致：

```text
version=1.0.4
minimumVersion=1.0.3
platform=win32
arch=x64
sha256=<真实SHA>
size=<真实字节数>
```

禁止为了兼容现有 HTTP 公网而关闭执行器 HTTPS fail-closed 校验。

### Step E — `/script → 豆包 → MP4 → 回传` 实机闭环

真实任务必须经过：

```text
queued
→ leased
→ preparing
→ submitting
→ acceptance_unknown / accepted
→ generating
→ downloading
→ uploading
→ succeeded
```

验收硬规则：

- 未确认 accepted 前网页不得显示 generating；
- conversationId 不能单独证明本次接单；
- 成片必须匹配本次 messageId/taskId/generationId；
- 不允许拿同 conversation 的旧视频冒充当前结果；
- JSONL 必须能定位每个边界；
- 日志不得包含完整 prompt/token/Cookie/Authorization/签名 URL query。

### Step F — 才允许合入正式 V88

必须同时满足：

```text
全套测试 GREEN
frontend build GREEN
Windows NSIS GREEN
installer <= 90 MiB
SHA/size/manifest 一致
覆盖更新 GREEN
协议唤起 GREEN
HTTPS stable feed GREEN
真实 VIDEO E2E succeeded
```

然后才创建：

```text
fix/v88-doubao-executor-phase1-20260906
→ v88
```

不会合入 `master`，不会切生产默认分支，除非用户后续明确要求。

## 四、本轮已执行动作

- [x] 重新审计 V88 最新 26 个提交文件范围。
- [x] 确认没有与豆包 Phase 1 核心文件重叠。
- [x] PR #19 `mergeable=true` 后执行合并。
- [x] 合并提交 `f63f5af1a6b57629f03a104ad2e22491ff33bfef`。
- [x] 合并后确认工作分支 `ahead 88 / behind 0`。
- [x] 更新 `CURRENT_VERSION.md`，记录 V88 HEAD、1.0.4 candidate、PR #19 和当前验证阻塞。
- [x] 调查 GitHub hosted runner 预启动失败模式；不再继续无证据修改 workflow。
- [ ] 等用户确认 Windows/ECS 一键本地验收脚本设计后实现 A2。
- [ ] 恢复 hosted runner 或完成等价本地验证。
- [ ] 构建并验证 1.0.4 实包。
- [ ] 配置 HTTPS stable feed。
- [ ] Windows 实机覆盖更新。
- [ ] 真实 VIDEO E2E。
- [ ] 最终合入 V88。
