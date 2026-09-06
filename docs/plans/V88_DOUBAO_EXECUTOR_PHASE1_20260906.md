# V88 豆包执行器 Phase 1 执行计划与实时进度

> 项目：一战晟铭 V88  
> 模块：公网 `/script` → 豆包本地执行器 → 豆包网页 → 视频生成 → 回传公网  
> 基线分支：`v88`  
> 工作分支：`fix/v88-doubao-executor-phase1-20260906`  
> 执行原则：不修改 master；证据优先；TDD 红灯→最小修复→GREEN；每个关键步骤完成后实时更新本文件。

## 1. 最终目标

```text
公网 /script
→ Node 视频任务入口
→ Go 本地执行器任务服务
→ Windows 一战晟铭豆包执行器
→ 豆包账号/页面
→ 填写提示词/参考图/模型/时长/比例
→ 提交
→ 确认豆包真正接单
→ generating
→ 精确匹配成片
→ 下载 MP4
→ 上传公网
→ succeeded
→ /script 可播放
```

## 2. 状态机硬规则

继续复用现有状态：

```text
queued
leased
preparing
submitting
acceptance_unknown
accepted
generating
downloading
uploading
succeeded
failed
cancelled
```

中文显示：

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

**只有服务端已记录 `accepted` 后，才允许进入 `generating`。**

## 3. 已确认根因与修复

### 根因 A：Node → Go `/api/script-videos/*` 断链

Node `routes/script-video.js` 调用：

```text
POST /api/script-videos/local
GET  /api/script-videos/{taskId}
GET  /api/script-videos/{taskId}/download
```

原 V88 Go Router 未注册这组兼容路由。TDD 红灯：

```text
TestScriptVideoLocalCompatibilityRouteCreatesQueuedJob
status=404 body=404 page not found

TestScriptVideoLocalCompatibilityRouteReturnsRealStage
status=404 body=404 page not found
```

已新增 `backend/internal/httpapi/script_video_local.go`，并在 `backend/internal/httpapi/router.go` 注册：

```text
Node /api/script-video/*
→ Go /api/script-videos/*
→ existing localexecutor.Service
```

不创建第二套任务系统。

### 根因 B：公网执行器下载仍写死旧版本

原 `routes/local-executor-downloads.js` 使用固定版本，而执行器更新系统已经使用 `stable/beta manifest`。

TDD 红灯：

```text
actual   = 0.1.14
expected = 1.0.3
```

已改为：

```text
/downloads/local-executor/updates/stable/manifest.json
```

驱动 Windows 公网最新版。旧安装包仅作为 stable 清单缺失/无效时的兼容兜底。公共 manifest 返回：

```text
version
latestVersion
minimumVersion
downloads.windows
windows.sha256
windows.size
windows.publishedAt
```

## 4. 已验证 GREEN

### Step 1：stable manifest → 公网下载入口

修复提交：

```text
af69bbf90d7416069c7f8d62dd1c9c34f763505e
fix: drive public executor download from stable manifest
```

完整 GREEN：

```text
run_id: 34017379066
node-routes      success
local-executor   success
backend-go       success
frontend         success
```

### Step 2 + Step 3：SettingsPage 动态下载与版本状态

RED 1：

```text
run_id: 34017881181
ERR_MODULE_NOT_FOUND: executorRelease.js
```

新增：

```text
frontend/src/shared/api/executorRelease.js
commit: 0d495b7e18e95ab795808148745b2e1d68f23f67
```

实现：严格 `x.y.z` 数字比较、latest/minimum/current、updateAvailable/updateRequired/versionKnown、公共 manifest 读取和 fail-closed 校验。

独立 GREEN：

```text
run_id: 34017916203
conclusion: success
```

RED 2：

```text
run_id: 34017950137
frontend: failure
原因：SettingsPage 仍含旧版固定下载路径
```

正式页面修复：

```text
0847510b7f552087223412b3efbd0b5a72816e8a
feat: show dynamic local executor release status
```

完成：

```text
SettingsPage 不再写死执行器版本号
Windows/Mac 下载地址来自 manifest
显示最新稳定版 / 最低支持版
显示每台执行器 heartbeat 上报的当前 version
显示 已是最新 / 有新版本 / 必须更新 / 版本未知
manifest 不可用时不猜版本并禁用下载
```

完整 GREEN：

```text
run_id: 34018080537
backend-go       success
node-routes      success
local-executor   success
frontend tests   success
frontend build   success
```

### Step 4 + Step 5：Windows URL 协议 + Electron 单实例

源码审计确认原实现缺失：

```text
app.requestSingleInstanceLock()
app.setAsDefaultProtocolClient(...)
second-instance
installer protocols registration
```

TDD RED：

```text
run_id: 34018196143
local-executor: failure
旧测试 94 个通过，新测试 3 个失败
```

明确失败原因：

```text
Cannot find module '../src/electron/protocol-handler'
main.js 不含 requestSingleInstanceLock
package.json build.protocols 不含 yizhan-executor
```

正式实现：

```text
local-executor/src/electron/protocol-handler.js
local-executor/src/electron/main.js
local-executor/package.json
```

关键提交：

```text
8db2615cc9445bd6a1d5bae4ed9dfd5c15aa14c6  safe protocol handler
f6742953c00e1c7465efbce6b274d493b4405542  single instance + protocol handling
9f9fd1fbc948d2fd3cf1dac8c057cddae9e1cc57  installer protocol registration
```

安全行为：

```text
仅允许 yizhan-executor://open
拒绝 http/https 与未知 action
拒绝 yizhan-executor://run?cmd=...
不把 URL 参数转为命令
不调用 PowerShell/CMD
```

单实例行为：

```text
首次启动 → 正常创建执行器
重复启动 → second-instance → 聚焦已有窗口
URL 冷启动 → 解析 open → 创建后聚焦
URL 热启动 → second-instance → 恢复/显示/聚焦已有窗口
```

安装器：

```text
electron-builder build.protocols
scheme = yizhan-executor
```

完整 GREEN：

```text
V88 Doubao Executor Verify
run_id: 34018270271
backend-go       success
node-routes      success
local-executor   success
frontend tests   success
frontend build   success
```

因此 Step 4、Step 5 已正式完成。

## 5. 当前正在执行

### Step 6：设置页增加“打开执行器”

目标：

```text
设置 → 豆包本地执行器
[打开执行器]
↓
yizhan-executor://open
↓
Windows 调起已安装执行器
```

实施规则：

1. 先增加 SettingsPage 源码契约测试，要求页面包含 `yizhan-executor://open`。
2. 只使用固定协议字符串，不拼接任意命令或用户输入。
3. “打开执行器”和“下载 Windows 版”并存：未安装用户仍可下载安装。
4. 前端 build + tests GREEN 后同步本文件。
5. 然后进入 Step 7：`/script` 真实 `stage`。

## 6. 后续严格顺序

- [x] Step 1：stable manifest → 公网下载入口 GREEN
- [x] Step 2：SettingsPage 去掉旧版硬编码
- [x] Step 3：设置页显示当前/最新/可升级/强制升级状态
- [x] Step 4：增加 `yizhan-executor://` Windows 自定义协议
- [x] Step 5：增加 Electron 单实例锁与二次唤起聚焦
- [ ] Step 6：设置页增加“打开执行器”
- [ ] Step 7：`/script` 保存并显示真实 `stage`
- [ ] Step 8：审计 `doubao-acceptance.js` 与 `doubao-network-tracker.js`
- [ ] Step 9：补关键边界结构化日志
- [ ] Step 10：完整 Go / Node / Electron / Frontend CI GREEN
- [ ] Step 11：Windows NSIS 构建
- [ ] Step 12：记录 installer 版本 / 实际大小 / SHA-256
- [ ] Step 13：Windows 实机安装、覆盖升级、协议唤起、单实例验证
- [ ] Step 14：实机完整 `/script → executor → doubao → mp4 → upload → succeeded`
- [ ] Step 15：全部通过后合并回 `v88`，不合 master

## 7. 豆包执行链审计标准

### 任务领取

```text
queued → leased
```

检查 executor token / owner / platform / heartbeat。

### 页面准备

必须确认：登录正常、非人机验证、额度正常、视频模式可用、输入框和提交按钮存在、请求的模型/时长/比例/图片能力可用。

### 提交与接单

`adapter.submit()` 只能返回：

```text
accepted
unknown
not_accepted
```

`unknown` 必须进入 `acceptance_unknown` 并有限次恢复。一直无法判断时失败为 `ACCEPTANCE_UNKNOWN`，不能无限卡住，也不能重复提交造成重复扣额度。

### 生成结果绑定

必须使用：

```text
submissionId
+ network media candidates
+ page media candidates
→ bindExactMedia()
```

禁止“页面出现任意视频就算当前任务完成”。

### 下载/上传

```text
generating
→ downloading
→ uploading
→ succeeded
```

服务端继续验证 MP4、lease、文件大小、SHA-256。

## 8. 结构化日志目标

关键事件：

```text
JOB_CLAIMED
ACCOUNT_ACQUIRED
DOUBAO_PAGE_READY
VIDEO_OPTIONS_SELECTED
PROMPT_FILLED
SUBMIT_CLICKED
ACCEPTANCE_DETECTED
GENERATION_STARTED
MEDIA_DETECTED
VIDEO_DOWNLOADED
ARTIFACT_UPLOADED
JOB_COMPLETED
JOB_FAILED
```

至少包含：jobId、executorId、accountId、submissionId、stage、errorCode、errorMessage、timestamp。

## 9. 安装/更新与体积约束

Phase 1 继续 Electron，不立即 Go 重写。已知早期 Windows 安装包约 79 MiB；Electron 自带 Chromium，因此本阶段 15–25 MB 不现实。

硬约束：

- 不额外捆绑第二套 Chromium/Chrome。
- 不捆绑 Playwright 浏览器。
- 不捆绑 Python/Node 独立运行时副本。
- 不捆绑完整 FFmpeg，除非真实链路需要。
- 不使用 UPX 只为省几 MB，避免杀毒误报。
- 继续复用现有 UpdateManager + NSIS 覆盖安装。
- 更新临时包放程序数据/临时目录，不让 Downloads 堆 `(1)(2)(3)`。
- 配对、设备、账号状态、日志等持久数据不得因覆盖更新丢失。
- Windows 构建后必须记录真实 installer size 和 SHA-256。

## 10. CI

`.github/workflows/v88-doubao-executor-verify.yml` 当前覆盖：

```text
backend: go test ./...
Node executor/script-video route tests
local-executor npm test
local-executor syntax check
frontend npm test
frontend npm build
```

## 11. Phase 1 完成标准

- [x] Go `/api/script-videos/*` 404 已由测试复现并修复
- [x] stable manifest 已成为 Windows 公网正式版本源并通过完整 CI
- [x] SettingsPage 不再硬编码旧版下载地址
- [x] 网页显示真实执行器版本状态
- [ ] 网站可唤起本机执行器（底层协议已完成，待 Step 6 页面按钮）
- [x] 执行器保持单实例
- [ ] `/script` 显示真实任务阶段
- [ ] 未确认豆包接单时绝不显示 generating
- [ ] 豆包确认接单后进入 generating
- [ ] 当前任务成片精确匹配
- [ ] MP4 下载/上传成功
- [ ] 服务端任务 succeeded
- [ ] 公网页面可播放结果
- [ ] Windows NSIS 构建成功
- [ ] 安装包大小/SHA-256 已记录
- [ ] 覆盖更新不产生多份正式安装
- [ ] Windows 实机完整 VIDEO 闭环通过

## 12. 实时进度日志

### 2026-09-06 · 进度 01

- 完成 Node → Go 本地视频兼容路由 TDD 修复。
- 完成 stable manifest 驱动公网 Windows 下载源。
- CI `34017379066` 四项全部 GREEN。

### 2026-09-06 · 进度 02

- 新增 `executorRelease.js` 与严格版本比较/最低版本逻辑。
- RED `34017881181`：缺少 release helper。
- GREEN `34017916203`：release helper 通过。
- RED `34017950137`：SettingsPage 仍含旧版硬编码。
- 修复 SettingsPage：`0847510b7f552087223412b3efbd0b5a72816e8a`。
- GREEN `34018080537`：四项完整验证通过。

### 2026-09-06 · 进度 03

- 审计确认 Electron 原先没有自定义 URL 协议和单实例。
- RED `34018196143`：新增协议/单实例测试 3 项按预期失败，旧测试 94 项通过。
- 新增安全 `protocol-handler.js`，只允许 `yizhan-executor://open`。
- 主进程增加 `requestSingleInstanceLock`、`second-instance`、冷/热启动聚焦和 packaged Windows 协议注册。
- electron-builder/NSIS 注册 `yizhan-executor` scheme。
- GREEN `34018270271`：backend-go、node-routes、local-executor、frontend tests/build 全部通过。
- Step 4、Step 5 完成；当前进入 Step 6：设置页“打开执行器”。
