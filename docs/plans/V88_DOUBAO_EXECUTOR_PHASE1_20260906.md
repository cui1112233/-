# V88 豆包执行器 Phase 1 执行计划

> 项目：一战晟铭 V88  
> 模块：公网 `/script` → 豆包本地执行器 → 豆包网页 → 视频生成 → 回传公网  
> 基线分支：`v88`  
> 工作分支：`fix/v88-doubao-executor-phase1-20260906`  
> 原则：不修改 master；先证据、先测试、再修复、最后验收。

## 1. 最终目标

完整链路必须跑通：

```text
公网 /script
→ Node 视频任务入口
→ Go 本地执行器任务服务
→ Windows 一战晟铭豆包执行器
→ 绑定豆包账号窗口
→ 进入豆包视频生成页面
→ 填写提示词 / 图片 / 模型 / 时长 / 比例
→ 提交任务
→ 确认豆包真正接单
→ 监控生成状态
→ 精确识别当前任务结果
→ 下载 MP4
→ 上传公网
→ succeeded
→ /script 显示视频完成
```

## 2. 状态机硬规则

后端现有状态继续复用：

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

中文展示建议：

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

**只有确认 `accepted` 后才能进入 `generating`。**

禁止：

```text
点击生成按钮
→ 直接标记 generating
```

## 3. 已确认根因 1：Node → Go 本地视频接口断链

Node `routes/script-video.js` 在本地豆包模式调用：

```text
POST /api/script-videos/local
GET  /api/script-videos/{taskId}
GET  /api/script-videos/{taskId}/download
```

原 V88 Go Router 未注册 `/api/script-videos/*`，因此公网链路会在 Node → Go 边界出现：

```text
404 page not found
```

### TDD 红灯证据

已新增测试并确认失败：

```text
TestScriptVideoLocalCompatibilityRouteCreatesQueuedJob
status=404 body=404 page not found

TestScriptVideoLocalCompatibilityRouteReturnsRealStage
status=404 body=404 page not found
```

### 已实施修复

新增：

```text
backend/internal/httpapi/script_video_local.go
```

修改：

```text
backend/internal/httpapi/router.go
```

目标架构：

```text
Node /api/script-video/*
→ Go /api/script-videos/*
→ 现有 localexecutor.Service
```

不创建第二套任务系统。

## 4. 已确认根因 2：网站下载入口仍硬编码 0.1.14

原：

```text
routes/local-executor-downloads.js
RELEASE_VERSION = '0.1.14'
```

但现有执行器更新系统已经使用 `stable/beta manifest`，维护版本已到 1.0.x。

这造成：

```text
自动更新源 = 新版本
网站下载入口 = 旧 0.1.14
```

### TDD 红灯证据

已新增测试，要求 stable manifest 驱动公网下载入口。

明确失败：

```text
actual   = 0.1.14
expected = 1.0.3
```

### 目标设计

稳定版唯一来源：

```text
/downloads/local-executor/updates/stable/manifest.json
```

网站公共 manifest 也必须读取 stable manifest，不再手写版本号。

## 5. 版本/下载/更新最终设计

稳定清单示例：

```json
{
  "schemaVersion": 1,
  "channel": "stable",
  "version": "1.0.4",
  "platform": "win32",
  "arch": "x64",
  "file": "yizhan-local-executor-v88-1.0.4-win-x64.exe",
  "sha256": "...",
  "size": 123456789,
  "publishedAt": "..."
}
```

设置页需要展示：

```text
当前版本
最新稳定版本
是否存在更新
是否强制更新
```

服务端已有 heartbeat/version，优先复用，不重复建字段。

目标返回能力：

```text
currentVersion
latestVersion
minimumVersion
updateAvailable
updateRequired
```

## 6. 覆盖更新要求

用户第一次安装后，后续更新必须覆盖原安装，不在 Downloads 里一直堆：

```text
执行器 (1).exe
执行器 (2).exe
执行器新版.exe
```

现有 `UpdateManager` 继续复用：

```text
检查 manifest
→ 后台下载到程序数据/临时目录
→ 校验文件大小
→ 校验 SHA-256
→ 等待 VIDEO 非关键阶段
→ 退出旧程序
→ NSIS 原地覆盖安装
→ 重启新版本
→ 清理临时安装包
```

用户配置、配对信息、账号状态、日志不能被覆盖删除。

## 7. 网页唤起执行器

新增 Windows 自定义协议：

```text
yizhan-executor://
```

至少支持：

```text
yizhan-executor://open
```

设置页增加：

```text
[打开豆包执行器]
```

如果执行器已经启动：

```text
不再启动第二个实例
→ 唤醒原窗口
→ 置前
```

Electron 增加单实例锁：

```text
app.requestSingleInstanceLock()
second-instance
```

## 8. `/script` 必须展示真实阶段

当前页面创建任务后直接写：

```js
status: 'processing'
```

这会把：

```text
queued
leased
preparing
submitting
```

都表现成“正在生成视频”。

目标：前端任务保留：

```text
status
stage
```

例如：

```json
{
  "taskId": "lej_xxx",
  "status": "processing",
  "stage": "preparing"
}
```

UI 优先显示 `stage` 的真实中文阶段。

## 9. 豆包执行链排查顺序

### 9.1 任务领取

```text
POST /api/local-executor/v1/jobs/claim
queued → leased
```

失败重点：

```text
executor token
owner
platform
heartbeat
任务 owner/platform
```

### 9.2 账号获取

```text
accountPool.acquire()
```

没有 available 账号时：

```text
release job
reason = no available local doubao account
```

不能显示 generating。

### 9.3 豆包页面准备

`adapter.prepare()` 必须确认：

```text
豆包已登录
不是人机验证
额度未耗尽
已进入视频生成模式
提示词输入框存在
生成按钮存在
所需图片上传能力存在
所需模型/时长/比例可用
```

### 9.4 提交

`adapter.submit()`：

```text
启动 network tracker
→ 点击生成
→ 必要时确认普通生成
→ 页面探测
→ 网络证据
→ determineSubmissionOutcome()
```

只允许：

```text
accepted
unknown
not_accepted
```

### 9.5 acceptance_unknown

```text
unknown
→ recoverAcceptance()
```

结果：

```text
accepted      → 继续生成
not_accepted  → release / 重新排队
一直 unknown  → failed / ACCEPTANCE_UNKNOWN
```

不能无限卡住。

### 9.6 生成结果精确绑定

禁止“页面出现任意视频就算当前任务完成”。

必须使用：

```text
submissionId
+ network media candidates
+ page media candidates
→ bindExactMedia()
```

避免并发任务串视频。

### 9.7 下载/上传/完成

```text
generating
→ downloading
→ fetchArtifact()
→ uploading
→ POST artifact
→ artifactId
→ POST result
→ succeeded
```

服务端必须验证：

```text
video/mp4
leaseToken
leaseGeneration
MP4 ftyp
文件大小
SHA256
```

## 10. 结构化日志

关键边界建议统一日志事件：

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

每条至少带：

```text
jobId
executorId
accountId
submissionId
stage
errorCode
errorMessage
timestamp
```

以后排查只找“第一个没有成功日志的边界”。

## 11. EXE/安装包体积约束

当前第一阶段继续 Electron，不立刻 Go 重写。

已知早期 Windows 安装包约 79 MiB，Electron 自带 Chromium，因此 15–25 MB 在当前架构下不现实。

第一阶段要求：

- 不额外打包第二套 Chromium/Chrome。
- 不捆绑 Playwright 浏览器。
- 不捆绑 Python/Node 独立运行时副本。
- 不捆绑完整 FFmpeg，除非真实需要。
- 不使用 UPX 仅为了省几 MB，避免 Defender/杀毒误报增加。
- 构建后记录实际 installer size 与 SHA-256。

第二阶段再评估：

```text
Go 薄客户端
+ 外置/复用豆包浏览环境
```

## 12. CI

已新增：

```text
.github/workflows/v88-doubao-executor-verify.yml
```

统一验证：

```text
backend Go tests
Node route tests
local-executor tests
local-executor syntax check
frontend build
```

目的：防止以前只测 Electron/Node，而 Go 桥接缺路由却没人发现。

## 13. 当前实际进度

### 已完成

- [x] 创建隔离分支 `fix/v88-doubao-executor-phase1-20260906`
- [x] 确认 Node → Go `/api/script-videos/*` 接口断链
- [x] 写 Go 红灯测试并确认 404
- [x] 新增 `backend/internal/httpapi/script_video_local.go`
- [x] 在 Go Router 注册兼容路由
- [x] Go CI 已确认修复后测试成功
- [x] 确认网站下载入口硬编码 `0.1.14`
- [x] 写 stable manifest 驱动下载的红灯测试
- [x] 红灯明确确认 `0.1.14 !== 1.0.3`
- [x] 新增 V88 豆包执行器完整 CI
- [x] 修正新 CI 中 local-executor 无 lockfile 却使用 `npm ci` 的问题
- [ ] 完成 stable manifest → 公网下载入口 GREEN
- [ ] SettingsPage 去掉 0.1.14 硬编码
- [ ] 设置页显示当前/最新/强制更新状态
- [ ] 增加 `yizhan-executor://`
- [ ] 增加 Electron 单实例
- [ ] `/script` 展示真实 stage
- [ ] 审计 acceptance 证据识别
- [ ] 增加边界日志
- [ ] Windows NSIS 构建
- [ ] 记录安装包真实体积/SHA256
- [ ] Windows 实机覆盖更新验证
- [ ] 公网完整 VIDEO 闭环验证
- [ ] 验证通过后合并回 `v88`

## 14. 下一步严格执行顺序

1. 完成 `stable manifest → 公网下载 manifest`，让 Node 测试 GREEN。
2. 修改 `SettingsPage.jsx`，去掉 0.1.14 硬编码。
3. 设置页显示当前版本 / 最新版本 / 更新可用 / 强制升级。
4. 增加 `yizhan-executor://` 协议。
5. 增加 Electron 单实例。
6. 设置页增加“打开执行器”。
7. 修改 `/script` 视频任务 UI，显示真实 stage。
8. 审计 `doubao-acceptance.js` 和 `doubao-network-tracker.js`。
9. 补关键边界结构化日志。
10. 跑完整 Go / Node / Electron / Frontend CI。
11. 运行 Windows NSIS 构建。
12. 记录版本、安装包大小、SHA-256。
13. Windows 实机安装/覆盖更新/协议唤起/单实例测试。
14. 实机跑完整 `/script → executor → doubao → mp4 → upload → succeeded`。
15. 全部通过后合并到 `v88`，不合 master。

## 15. Phase 1 完成标准

- [ ] `/script` 本地豆包任务不再出现 Go 404
- [ ] 执行器可以领取任务
- [ ] 网页显示真实任务阶段
- [ ] 未确认豆包接单时绝不显示 generating
- [ ] 豆包确认接单后进入 generating
- [ ] 当前任务成片可精确绑定
- [ ] MP4 下载成功
- [ ] MP4 上传成功
- [ ] 服务端状态 succeeded
- [ ] 公网页面可以播放结果
- [ ] 网站不再硬编码 0.1.14
- [ ] stable manifest 是统一正式版本源
- [ ] 网站可打开本机执行器
- [ ] 执行器单实例
- [ ] 自动升级原地覆盖
- [ ] 更新不在 Downloads 堆多个安装包
- [ ] Windows NSIS 构建成功
- [ ] 记录真实安装包大小与 SHA-256
- [ ] Go 测试通过
- [ ] Node 测试通过
- [ ] local-executor 测试通过
- [ ] frontend build 通过
- [ ] Windows 实机验证通过

## 16. 开发方法

每一个改动必须遵循：

```text
找到证据
→ 写失败测试
→ 确认 RED
→ 最小修复
→ 确认 GREEN
→ 再进入下一问题
```

禁止：

```text
看到卡住
→ 猜原因
→ 连续改一堆代码
→ 最后不知道哪个改动有效
```

本文件是本次 Phase 1 的唯一执行计划与进度基准。后续每推进一个步骤，应同步更新本文件的“当前实际进度”和必要的验收结果。
