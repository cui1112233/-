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

## 已完成并有 GREEN 证据

### Step 1 — Node → Go VIDEO 桥接 + stable 下载源

- 修复 `/api/script-videos/*` 404，复用现有 `localexecutor.Service`。
- stable manifest 成为 Windows 正式最新版来源。
- 关键提交：`af69bbf90d7416069c7f8d62dd1c9c34f763505e`
- GREEN：CI `34017379066`，Go / Node / Electron / Frontend 全通过。

### Step 2–3 — 设置页动态版本与下载

- 新增 `frontend/src/shared/api/executorRelease.js`。
- SettingsPage 显示当前/最新/最低版本及升级状态，下载地址来自 manifest。
- 关键提交：`0847510b7f552087223412b3efbd0b5a72816e8a`
- GREEN：CI `34018080537`。

### Step 4–5 — `yizhan-executor://` + Electron 单实例

- 仅允许 `yizhan-executor://open`，拒绝任意命令和未知 action。
- 单实例、二次唤起聚焦、NSIS 协议注册已完成。
- 关键提交：`9f9fd1fbc948d2fd3cf1dac8c057cddae9e1cc57`
- GREEN：CI `34018270271`。

### Step 6 — 设置页“打开执行器”

- `[打开执行器] → yizhan-executor://open`
- 不拼用户输入，不调用 PowerShell/CMD。
- 关键提交：`8b2b6751e31c6ac53c02f840b375a825dff72c64`
- GREEN：CI `34018460735`。

## Step 7 — `/script` 真实 VIDEO stage

阶段 helper：

```text
frontend/src/shared/api/scriptVideoStage.js
52ff1d55b7ea20a1f4df6a03b183e93485e3cb36
```

该 helper 已经 RED `34018608427` → GREEN `34018665157`。

页面实现：

```text
bd2b3f30c8bfb51678ef6d97ddb1a6b80d916bf7  显示真实 stage
e1a030cf03749ed37f9d4c07fde2f6f4692a95dc  轮询持续写回 stage
c66cb8e0222a2d52d7d657e6d9c393ed341252de  页面集成契约测试
```

已修复：

1. Go 正式列表返回 `{"executors": [...]}`，ScriptPage 原误读 `result.items`，现改为 `result.executors`。
2. 创建任务保存真实 `status/stage`，无 stage 时只回退 `queued`。
3. 每次轮询都将服务端任务结果写回 `shotVideoTasks`。
4. 历史/草稿恢复继续轮询所有非终态任务。
5. 只有 `generating` 显示“豆包正在生成视频”。
6. failed/cancelled 后允许重新生成。

验证阻塞：`34020329804 / 34020375585` 均为 GitHub Runner 未启动：`steps=[] / runner_id=0`。因此 Step 7 代码已完成，但尚未正式勾选 GREEN。

## Step 8 — acceptance / network / exact-media

已确认原有正确机制：

- `doubao-acceptance.js` 保守输出 accepted/unknown/not_accepted。
- unknown 最多 recover 3 次，恢复时不重新点击提交。
- 只有明确 not_accepted 才允许重新 submit，最多 3 次。
- `api.acceptance(...)` 成功后才允许 `progress('generating')`。
- Go/MySQL 状态机也强制 accepted → generating。
- human_verification / quota_exhausted / auth_required 会 hold 账号，不绕过验证。
- `bindExactMedia()` 无唯一精确匹配就失败，不取页面任意最新视频。

发现并修复风险：原 Network tracker 允许“当前 prompt + 旧 conversationId + 2xx”证明 accepted，并可能让同 conversation 旧视频参与绑定。

提交：

```text
257a5dbab6bc9c91eb814b9d7426da39d4c02148  conversation-only acceptance RED
a13d7761cc83c95c4b1e98ba38704964d727e9c5?  （历史记录中的前缀误写，真实修复 SHA 见下一行）
813d7761cc83c95c4b1e98ba38704964d727e9c5  require submission identity
d3753e84a6110fb004e3ea232cb6534e06c3fe34  reject same-conversation old media
```

新规则：

```text
上下文 stable IDs：conversation/message/task/generation/media/video
能证明本次接单的 submission IDs：message/task/generation
```

只有 messageId/taskId/generationId 能推进 network accepted；媒体候选也必须命中当前 submission IDs。

相关 Actions `34020644614 / 34020695665` 仍是 `runner_id=0 / steps=[]`，所以 Step 8 修复已落地但等待真实 CI。

## Step 9 — 关键边界结构化日志

### 审计结果

原执行器没有统一业务日志落盘；主要只有 updater/protocol 的 `console.error` 和 UI `lastError`，无法判断任务卡在准备、点击、接单、生成、下载还是回传。

### 新日志器

文件：

```text
local-executor/src/structured-logger.js
43e70cf9dbdd770dfa5972af2d15419ad2911408
```

Electron 本地路径：

```text
userData/logs/executor-events.jsonl
```

特性：

- 仅 Node 内置 `fs/path`，零第三方依赖。
- JSONL 追加写；串行写入避免行交叉。
- 字段白名单 + 长度限制。
- 日志写入失败只影响诊断，不允许打断视频任务。

禁止写入：

```text
完整 prompt
executor token
lease token
Cookie
Authorization
签名下载 URL/query
账号密码
```

允许的核心字段：timestamp/event/jobId/executorId/accountId/submissionId/mediaId/artifactId/stage/errorCode/errorMessage，以及安全的 model/duration/ratio/imageCount/promptLength/attempt。

### JobRunner 事件

测试：

```text
8ab7748b3bbbec213aea943fbb6bbfb51e377aa2
```

实现：

```text
6bb91ec15fefb6902cce894cd0885b9bfa5c40e1
```

事件：

```text
JOB_CLAIMED
ACCOUNT_ACQUIRED
ACCEPTANCE_UNKNOWN
ACCEPTANCE_DETECTED
GENERATION_STARTED
ARTIFACT_UPLOADED
JOB_COMPLETED
JOB_FAILED
```

### DoubaoAdapter 事件

测试：

```text
c3fef70dbdfbc3569e9acdcec657fbe1fac86785
```

实现：

```text
8b9d9603913a13f44546e9ea49d4f641dde0b2e2
```

事件：

```text
DOUBAO_PAGE_READY
VIDEO_OPTIONS_SELECTED
PROMPT_FILLED
SUBMIT_CLICKED
MEDIA_DETECTED
VIDEO_DOWNLOADED
```

`PROMPT_FILLED` 只记录 promptLength，不记录提示词正文。

### Electron wiring

测试：

```text
59fe7c034d98851e73e07438c9bcf502751b39f7
```

实现：

```text
065e06a64510e4069ac8c54bdc5969bd20b9adb8
```

同一个 logger 同时注入 `DoubaoAdapter` 和 `DesktopRuntime.runnerOptions → JobRunner`。

自查发现 wiring 测试属于 CommonJS 却使用 `import.meta.url`，已主动修正：

```text
33f8c0164244450ca971f1a349a069a03fd22020
```

新增提交语义测试：如果 `pageActions.submit()` 本身失败，不得记录 `SUBMIT_CLICKED`：

```text
5d17aa207c150edcbcdc88bfb6e91d05adfc577f
```

实现已将 `SUBMIT_CLICKED` 移到真实点击成功之后：

```text
8297bae21b703758715178e28b970adfba8bcdb7
```

Step 9 RED workflow `34020824393`、后续 `34021048780` 仍然没有分配 Runner，均为 `steps=[] / runner_id=0`。不能把它们算代码测试失败，也不能宣称 Step 9 GREEN。

## 当前执行：Step 10 / Step 11 准备

### Step 10 — 完整回归

目标必须真实执行：

```text
backend: go test ./...
Node route tests
local-executor npm test
local-executor syntax check
frontend npm test
frontend npm build
```

当前 GitHub Runner 未启动是唯一验证阻塞；在 Runner 恢复前继续做源码/契约/构建配置审计。

### Step 11 — Windows NSIS

接下来确认：

1. `local-executor/package.json` 当前 Windows build 脚本与 electron-builder 配置。
2. 是否已有 Windows GitHub Actions 构建 workflow。
3. NSIS 安装包是否仍为单安装目录覆盖安装。
4. 构建 artifact 输出路径、文件名、版本来源。
5. 增加可重复的 Windows build + SHA256 + size 产物记录，但不改 master。

## 后续顺序

- [x] Step 1：Go VIDEO 桥接 + stable 下载源
- [x] Step 2：SettingsPage 去旧版本硬编码
- [x] Step 3：当前/最新/最低版本状态
- [x] Step 4：`yizhan-executor://`
- [x] Step 5：Electron 单实例
- [x] Step 6：设置页“打开执行器”
- [ ] Step 7：`/script` 真实 stage（代码完成，等待真实 CI）
- [ ] Step 8：接单/网络/成片精确绑定（代码完成，等待真实 CI）
- [ ] Step 9：结构化日志（代码完成，等待真实 CI）
- [ ] Step 10：全套 Go / Node / Electron / Frontend 回归
- [ ] Step 11：Windows NSIS 构建
- [ ] Step 12：记录 installer 版本 / 字节数 / MiB / SHA-256
- [ ] Step 13：Windows 实机安装 / 覆盖更新 / 协议唤起 / 单实例
- [ ] Step 14：实机 `/script → executor → doubao → mp4 → upload → succeeded`
- [ ] Step 15：全部通过后合并到 `v88`，不合 master

## 安装包与更新硬约束

Phase 1 保留 Electron。早期 Windows 安装包约 79 MiB；本阶段不额外捆绑 Chromium/Playwright/Python/Node 副本/完整 FFmpeg，不用 UPX 强行压缩。继续复用 UpdateManager + NSIS 原地覆盖；更新临时文件不得堆到 Downloads；持久配对/设备/账号状态不得因覆盖更新丢失。

## 实时进度日志

- 进度 01：Step 1 stable 下载源 + VIDEO bridge GREEN `34017379066`。
- 进度 02：Step 2/3 Settings 动态版本 GREEN `34018080537`。
- 进度 03：Step 4/5 协议 + 单实例 GREEN `34018270271`。
- 进度 04：Step 6 打开执行器 GREEN `34018460735`。
- 进度 05：Step 7 helper RED `34018608427` → GREEN `34018665157`；页面 stage 链路代码完成，后续 Runner 故障阻塞。
- 进度 06：Step 8 修复 conversation-only 假接单/旧片误绑；Runner 故障阻塞完整验证。
- 进度 07：Step 9 JSONL 结构化日志、JobRunner/Adapter 边界事件、Electron 落盘 wiring 完成；修正 CommonJS 测试和 SUBMIT_CLICKED 语义；Runner 故障仍阻塞 GREEN。
