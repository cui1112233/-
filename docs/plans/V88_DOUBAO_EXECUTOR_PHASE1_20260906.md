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

原 V88 Go Router 未注册这组兼容路由，TDD 红灯明确为：

```text
TestScriptVideoLocalCompatibilityRouteCreatesQueuedJob
status=404 body=404 page not found

TestScriptVideoLocalCompatibilityRouteReturnsRealStage
status=404 body=404 page not found
```

已新增：

```text
backend/internal/httpapi/script_video_local.go
```

并在：

```text
backend/internal/httpapi/router.go
```

注册。目标链路：

```text
Node /api/script-video/*
→ Go /api/script-videos/*
→ existing localexecutor.Service
```

不创建第二套任务系统。

### 根因 B：公网执行器下载仍写死 0.1.14

原 `routes/local-executor-downloads.js` 用：

```text
RELEASE_VERSION = 0.1.14
```

而执行器更新系统已经使用 `stable/beta manifest`。TDD 红灯：

```text
actual   = 0.1.14
expected = 1.0.3
```

已改为：

```text
/downloads/local-executor/updates/stable/manifest.json
```

驱动 Windows 公网最新版；旧 0.1.14 仅在 stable 清单不存在/无效时作为兼容兜底。公共 manifest 同时返回：

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

验证工作流：

```text
V88 Doubao Executor Verify
run_id: 34017379066
conclusion: success
```

四个作业全部成功：

```text
node-routes      success
local-executor   success
backend-go       success
frontend         success
```

因此 Step 1 已正式完成，不再是“仅写代码未验证”。

## 5. 当前正在执行

### Step 2 + Step 3：设置页动态版本管理

当前 `frontend/src/user/pages/SettingsPage.jsx` 仍硬编码：

```text
yizhan-local-executor-0.1.14-mac-arm64.dmg
yizhan-local-executor-0.1.14-win-x64.exe
```

下一修改必须做到：

1. 页面读取 `/downloads/local-executor/manifest.json`。
2. Windows 下载按钮使用 manifest 的 `downloads.windows`，前端不再写死 0.1.14。
3. Mac 下载按钮也使用 manifest 的 `downloads.mac`，前端不再写死文件名。
4. 现有 `/api/shuihuo-production/local-executors` 已返回每台执行器 `version`，直接复用。
5. 页面显示：当前版本、最新稳定版、是否可升级、是否低于最低版本。
6. 版本比较只接受 `x.y.z`，不凭字符串大小比较。
7. 发布清单读取失败时不伪造“最新版”，按钮应安全降级/提示刷新。

## 6. 后续严格顺序

- [x] Step 1：stable manifest → 公网下载入口 GREEN
- [ ] Step 2：SettingsPage 去掉 0.1.14 硬编码
- [ ] Step 3：设置页显示当前/最新/可升级/强制升级状态
- [ ] Step 4：增加 `yizhan-executor://` Windows 自定义协议
- [ ] Step 5：增加 Electron 单实例锁与二次唤起聚焦
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

本阶段硬约束：

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

已新增：

```text
.github/workflows/v88-doubao-executor-verify.yml
```

覆盖：

```text
backend: go test ./...
Node executor/script-video route tests
local-executor npm test
local-executor syntax check
frontend npm build
```

## 11. Phase 1 完成标准

- [x] Go `/api/script-videos/*` 404 已由测试复现并修复
- [x] stable manifest 已成为 Windows 公网正式版本源并通过完整 CI
- [ ] SettingsPage 不再硬编码 0.1.14
- [ ] 网页显示真实执行器版本状态
- [ ] 网站可唤起本机执行器
- [ ] 执行器保持单实例
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
- 当前进入 Step 2/3：SettingsPage 动态版本/下载管理。
