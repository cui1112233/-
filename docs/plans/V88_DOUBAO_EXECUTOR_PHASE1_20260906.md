# V88 豆包执行器 Phase 1 执行计划与实时进度

> 项目：一战晟铭 V88  
> 基线分支：`v88`  
> 工作分支：`fix/v88-doubao-executor-phase1-20260906`  
> 原则：不改 master；源码证据优先；TDD RED → 最小修复 → GREEN；每个关键节点实时更新本文件。

## 最终链路

```text
公网 /script
→ Node 视频任务入口
→ Go localexecutor
→ Windows 一战晟铭豆包执行器
→ 豆包账号/视频页面
→ 填词/参考图/模型/时长/比例
→ 提交
→ 确认豆包真正接单
→ generating
→ 精确匹配成片
→ 下载 MP4
→ 上传公网
→ succeeded
→ /script 可播放
```

## 状态机硬规则

```text
queued              等待执行器领取
leased              执行器已领取
preparing           正在准备豆包页面
submitting          正在提交豆包任务
acceptance_unknown  正在确认豆包是否接单
accepted            豆包已接单
generating          豆包正在生成视频
downloading         正在下载视频
uploading           正在回传视频
succeeded           已完成
failed              失败
cancelled           已取消
```

只有服务端记录 `accepted` 后才允许进入 `generating`；`queued / preparing / submitting / acceptance_unknown` 绝不能在网页显示成“正在生成视频”。

## 已完成并验证

### Step 1 — Node → Go VIDEO 桥接 + stable 下载源

- 已修复原 `POST /api/script-videos/local`、`GET /api/script-videos/{id}` 404。
- 新增 `backend/internal/httpapi/script_video_local.go`，复用现有 `localexecutor.Service`。
- stable manifest 已成为 Windows 正式最新版来源，不再手写版本。
- 关键提交：`af69bbf90d7416069c7f8d62dd1c9c34f763505e`。
- GREEN：CI `34017379066`，Go / Node / Electron / Frontend 全通过。

### Step 2–3 — 设置页动态版本与下载

- 新增 `frontend/src/shared/api/executorRelease.js`。
- 严格 `x.y.z` 数字比较；支持 latest/minimum/current、updateAvailable、updateRequired。
- SettingsPage 下载地址来自 manifest；显示当前版本、最新稳定版、最低支持版、已是最新/有新版本/必须更新/版本未知。
- 关键提交：`0847510b7f552087223412b3efbd0b5a72816e8a`。
- GREEN：CI `34018080537` 全通过。

### Step 4–5 — `yizhan-executor://` + Electron 单实例

- 新增安全协议解析器 `local-executor/src/electron/protocol-handler.js`。
- 只允许 `yizhan-executor://open`；拒绝任意命令、未知 action、http/https。
- 主进程增加 `requestSingleInstanceLock`、`second-instance`、冷/热启动聚焦。
- electron-builder/NSIS 注册 `yizhan-executor` scheme。
- 关键提交：`9f9fd1fbc948d2fd3cf1dac8c057cddae9e1cc57`。
- GREEN：CI `34018270271` 全通过。

### Step 6 — 设置页“打开执行器”

- SettingsPage 增加固定 `[打开执行器] → yizhan-executor://open`。
- 不拼用户输入，不调用 PowerShell/CMD；下载按钮继续保留。
- 关键提交：`8b2b6751e31c6ac53c02f840b375a825dff72c64`。
- GREEN：CI `34018460735` 全通过。

## Step 7 — `/script` 真实 VIDEO stage

### 已完成代码

阶段 helper：

```text
frontend/src/shared/api/scriptVideoStage.js
commit: 52ff1d55b7ea20a1f4df6a03b183e93485e3cb36
```

RED：`34018608427`；GREEN：`34018665157`。

页面显示层：

```text
bd2b3f30c8bfb51678ef6d97ddb1a6b80d916bf7
feat: show precise script video stages
```

页面链路：

```text
e1a030cf03749ed37f9d4c07fde2f6f4692a95dc
fix: persist real local executor video stages
```

契约测试：

```text
c66cb8e0222a2d52d7d657e6d9c393ed341252de
```

已修复：

1. Go 正式列表返回 `{"executors": [...]}`，ScriptPage 原来误读 `result.items`，现已改为 `result.executors`。
2. 创建任务保存真实 `status/stage`，无 stage 时只安全回退 `queued`。
3. 每轮 poll 都把服务端任务响应合并进 `shotVideoTasks`。
4. 中间 stage 会自动同步历史。
5. 草稿/历史恢复会继续轮询所有非终态任务。
6. 只有 `generating` 显示“豆包正在生成视频”。
7. `failed/cancelled` 可重新生成。

提交级 diff 核对：`ScriptPage.jsx +20/-11`，未波及其他剧本功能。

### Step 7 当前验证阻塞

CI `34020329804`、`34020375585` 都是 GitHub Runner 基础设施故障：

```text
steps=[]
runner_id=0
runner_name=""
```

测试命令没有启动，所以 Step 7 暂不勾选完成。

## Step 8 — acceptance / network tracker 审计

### 已确认正确机制

`doubao-acceptance.js`：

- 只输出 `accepted / unknown / not_accepted`。
- 没证据默认 `unknown`，不会乐观当成接单。
- DOM 接单证据要求“新 identity + 当前 prompt 唯一绑定”；多个候选返回 unknown。

`job-runner.js`：

- `unknown` 进入 `acceptance_unknown`。
- 最多调用 `recoverAcceptance()` 3 次，使用同一次 tracker 继续取证，**不重新点击提交**。
- `recoverAcceptance` 仍 unknown → `ACCEPTANCE_UNKNOWN` 失败。
- 只有明确 `not_accepted` 才允许重新 submit，最多 3 次。
- accepted 后完成/下载/上传重试都复用同一个 submission，不重新生成。
- 顺序严格：`api.acceptance(...) → progress('generating')`。

Go + MySQL 状态机：

- `accepted` 只能从 `submitting / acceptance_unknown` 写入。
- `generating` 只能从已经 accepted 的 `accepted` 状态进入。
- accepted 任务被 pin，不能 release 回队列。

账号异常：

- `human_verification`
- `quota_exhausted`
- `auth_required`

都会抛 `DoubaoAccountError`，账号池进入对应 hold 状态，不会误判 accepted，也不绕过人机验证。

成片绑定：

- `bindExactMedia()` 要求当前 submission identity 唯一匹配。
- 无匹配直接失败。
- 多个匹配直接判 ambiguous，不拿“页面任意视频”当当前成片。

### Step 8 新发现风险：conversationId 误判接单/旧片

原 `doubao-network-tracker.js` 的网络 acceptance 逻辑是：

```text
请求体包含当前 prompt
+ 任意 stable id（其中包含 conversationId）
+ HTTP 2xx
→ accepted=true
```

风险：同一会话中的同步/保存类请求只带旧 `conversationId` 时，也可能被误当“豆包已接单”；并且旧视频若只共享 conversationId，也可能成为候选。

新增回归测试：

```text
257a5dbab6bc9c91eb814b9d7426da39d4c02148
test: reject conversation-only submit evidence
```

规则：当前 prompt + 旧 conversationId + 2xx，但没有新 message/task/generation ID，必须保持 `accepted=false`。

最小修复：

```text
813d7761cc83c95c4b1e98ba38704964d727e9c5
fix: require submission identity for network acceptance
```

修复后身份分层：

```text
上下文 stable IDs：conversation/message/task/generation/media/video
接单级 submission IDs：message/task/generation
```

只有 `messageId / taskId / generationId` 能推进 network accepted；`conversationId / mediaId / videoId` 不能单独证明接单。

网络媒体候选也只允许通过当前 submission IDs 关联，不能只因共享 conversationId 被绑定。

额外回归测试：

```text
d3753e84a6110fb004e3ea232cb6534e06c3fe34
test: reject conversation-only media binding
```

该测试加入“同一 conversation 的旧 media”并要求只保留真正命中当前 message/task 的 exact media。

### Step 8 验证状态

CI `34020644614`（RED 提交）和 `34020695665`（修复提交）仍是 GitHub Runner 基础设施故障：

```text
四个 job 全部 steps=[] / runner_id=0
```

测试没有实际执行。因此 Step 8 的源码审计和修复已落地，但仍等待真实 CI 后才勾选完成。

## 当前执行：Step 9 — 关键边界结构化日志

目标事件：

```text
JOB_CLAIMED
ACCOUNT_ACQUIRED
DOUBAO_PAGE_READY
VIDEO_OPTIONS_SELECTED
PROMPT_FILLED
SUBMIT_CLICKED
ACCEPTANCE_UNKNOWN
ACCEPTANCE_DETECTED
GENERATION_STARTED
MEDIA_DETECTED
VIDEO_DOWNLOADED
ARTIFACT_UPLOADED
JOB_COMPLETED
JOB_FAILED
```

日志至少带：

```text
timestamp
event
jobId
executorId（有则带）
accountId（有则带）
submissionId（有则带）
stage
errorCode（失败时）
errorMessage（失败时，限长）
```

禁止日志写入：

```text
完整 prompt
executor token / lease token
Cookie / Authorization
下载签名 URL query
账号密码
```

先审计当前日志设施；若没有统一 logger，则新增轻量 JSONL logger，并通过依赖注入接入 JobRunner/adapter 关键边界，不引入新大型依赖。

## 后续顺序

- [x] Step 1：Go VIDEO 桥接 + stable 下载源
- [x] Step 2：SettingsPage 去掉旧下载版本硬编码
- [x] Step 3：当前/最新/最低版本状态
- [x] Step 4：`yizhan-executor://`
- [x] Step 5：Electron 单实例
- [x] Step 6：设置页“打开执行器”
- [ ] Step 7：`/script` 真实 stage + `items/executors` 修复（代码完成，等待真实 CI）
- [ ] Step 8：接单/网络/成片绑定审计与 conversation-only 修复（代码完成，等待真实 CI）
- [ ] Step 9：关键边界结构化日志
- [ ] Step 10：全套 Go / Node / Electron / Frontend 回归
- [ ] Step 11：Windows NSIS 构建
- [ ] Step 12：记录 installer 版本 / 字节数 / MiB / SHA-256
- [ ] Step 13：Windows 实机安装 / 覆盖更新 / 协议唤起 / 单实例
- [ ] Step 14：实机 `/script → executor → doubao → mp4 → upload → succeeded`
- [ ] Step 15：全部通过后合并到 `v88`，不合 master

## 安装包与更新硬约束

Phase 1 保留 Electron。已知早期 Windows 安装包约 79 MiB；本阶段不额外捆绑 Chromium/Playwright/Python/Node 副本/完整 FFmpeg，不用 UPX 强行压缩。继续复用现有 UpdateManager + NSIS 原地覆盖；更新临时文件不得堆到 Downloads；持久配对/设备/账号状态不得因更新丢失。

## 实时进度日志

- 进度 01：修复 Node → Go 404；stable 下载源 GREEN `34017379066`。
- 进度 02：动态版本/SettingsPage GREEN `34018080537`。
- 进度 03：协议 + 单实例 GREEN `34018270271`。
- 进度 04：设置页“打开执行器” GREEN `34018460735`。
- 进度 05：Step 7 helper RED `34018608427` → GREEN `34018665157`；确认 `items/executors` 接口字段错误。
- 进度 06：Step 7 页面代码已完成；`34020329804 / 34020375585` 因 GitHub runner_id=0 未执行测试。
- 进度 07：Step 8 确认 bounded acceptance recovery 与服务端状态机正确；发现 conversation-only 网络接单/旧片关联风险，提交测试 `257a5dba...`、修复 `813d7761...`、旧片回归测试 `d3753e84...`；相关 Actions 仍因 runner_id=0 未实际执行。
