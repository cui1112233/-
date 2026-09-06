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

## 当前执行：Step 7 — `/script` 真实 VIDEO stage

### 已确认 UI 根因

当前 `ScriptPage` 创建任务后只保存：

```text
{ taskId, status: 'processing' }
```

轮询只在 `succeeded / failed` 时写回任务，中间 stage 没有更新。`ShotOutputCards` 又把所有 `processing` 统一显示为“视频生成中”，导致用户无法知道任务真实卡点。

### Step 7 TDD 进度

RED：CI `34018608427`

```text
Frontend: 12 个旧测试通过；新增 stage 测试因 scriptVideoStage.js 不存在而失败
Go / Node / Electron：success
```

已新增：

```text
frontend/src/shared/api/scriptVideoStage.js
commit: 52ff1d55b7ea20a1f4df6a03b183e93485e3cb36
```

已锁定文案：

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
```

GREEN：CI `34018665157`

```text
backend-go       success
node-routes      success
local-executor   success
frontend tests   success
frontend build   success
```

### Step 7 新发现的确定断点

Go 正式接口 `GET /api/shuihuo-production/local-executors` 明确返回：

```json
{"executors": [...]}
```

但 `ScriptPage.generateVideoForShot()` 当前读取：

```text
result.items
```

因此剧本页可能把真实在线执行器误判成“未连接”，直接阻止任务提交。这个字段错误会在 Step 7 同一轮用 RED 测试锁死并修复。

### Step 7 接下来

1. [进行中] 加页面集成 RED：必须读取 `result.executors`；必须保存/刷新真实 `stage`；ShotOutputCards 必须使用 `scriptVideoStageLabel`。
2. 修复 `ScriptPage`：创建本地任务默认最多假设 `queued`，绝不假设 generating。
3. 每次轮询成功都写回 `stage/status`，由现有 effect 同步历史。
4. 历史/草稿恢复时使用 `isScriptVideoTaskActive()` 恢复所有非终态任务。
5. 修复 `ShotOutputCards`：只有 `stage=generating` 显示“豆包正在生成视频”。
6. 完整 CI GREEN 后勾选 Step 7，并进入 Step 8 acceptance/network 审计。

## 后续顺序

- [x] Step 1：Go VIDEO 桥接 + stable 下载源
- [x] Step 2：SettingsPage 去掉旧下载版本硬编码
- [x] Step 3：当前/最新/最低版本状态
- [x] Step 4：`yizhan-executor://`
- [x] Step 5：Electron 单实例
- [x] Step 6：设置页“打开执行器”
- [ ] Step 7：`/script` 真实 stage + 修复 `items/executors` 字段错误
- [ ] Step 8：审计 `doubao-acceptance.js` / `doubao-network-tracker.js`
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
- 进度 05：Step 7 阶段 helper RED `34018608427` → GREEN `34018665157`；确认 `ScriptPage` 误读 `result.items`，正式接口字段为 `result.executors`。
