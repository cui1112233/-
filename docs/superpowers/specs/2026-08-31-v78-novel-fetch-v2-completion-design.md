# V78 小说获取 V2 补全设计

**日期：** 2026-08-31  
**适用基线：** V78.3.0.3  
**起始源码：** `hotfix/production-v78.3.0.3-novel-fetch-timeout@c909369283d756e3a3f659db05af156a5efb4523`  
**实施分支：** `feat/v78-novel-fetch-v2-completion`

## 1. 目标

在不破坏 V78.3.0.3 现有生产行为、不进入 Batch Factory V11 Slice 2、不触碰生产 `:3000` 的前提下，把原始“批量原文改文系统”中仍有价值但当前 V78 小说获取缺失或未真正接线的能力，按 V78 Node/React/Docker 架构重新实现。

本设计不追求逐字节照搬旧 Python/Windows 实现，而是保留其业务语义：可靠抓取、可恢复队列、定时执行、任务管理、敏感词策略、121 真实网页登录与会话复用。

## 2. 不做的事情

- 不修改 `master`。
- 不直接修改 `feat/batch-factory-v11-layout-showcase` 或 `release/production-v78.3.0.3-batch-factory-go-first`。
- 不进入 Director / Hook / Production / Merge / Yadi 的 V11 实现。
- 不部署或切换生产 `:3000`。
- 不读取或修改生产卷、生产 MySQL、生产账号数据。
- 不把旧 Python 桌面 UI、Windows Wake Timer、Windows Task Scheduler 原样搬进 Docker。
- 不恢复旧系统自己的账号体系；继续使用 Qiantie V78 鉴权。
- 不在浏览器前端直接把 121 凭据发送给 121 网站。
- 不继续把 `/tttadmin/api/login.php` 当作唯一或权威登录契约。

## 3. 现状与问题

当前 `/novel-fetch` 的核心兼容工作台由 `frontend/public/batch-rewrite/` 提供，后端由 `routes/batch-rewrite.js`、`lib/novel-fetch-workshop/*`、`lib/target-upload.js` 等组成。

已经存在并继续保留的能力：

- 多种批量清单解析模式。
- 风格/男女频分类。
- 原文抓取、原始备份和处理后原文。
- AI1/AI2/AI3 等多版本改文。
- 高仿、爆款开头、指令模板、知识库。
- 敏感词基础处理。
- 规则处理、批量重试、批量删除。
- 121 配置档/风格同步、提交预览、提交、后台记录核验。
- 小说获取任务进入 Batch Factory 的现有 bridge。

当前缺口分为两类：

1. **缺失能力：** 自动队列、暂停/恢复、实时状态、定时任务、任务高级筛选、永久删除 tombstone、敏感词高级模式、121 浏览器会话等。
2. **伪接线能力：** 页面上有配置但后端没有完整执行，例如抓取 retries/timeout/platform 语义。

## 4. 总体架构

系统分成四个可独立验收的子项目，按顺序实施：

### A. Fetch Contract / Runner Foundation

负责把当前页面已经存在的抓取配置真正落实到后端，并建立可测试的单任务执行原语。

核心模块：

- `lib/novel-fetch-workshop/fetch-policy.js`
- `lib/novel-fetch-workshop/runner.js`
- 现有 `tasks.js` / `mysql-store.js` / `routes/batch-rewrite.js`

### B. Queue / Scheduler / Task Operations

负责无人值守执行、暂停/恢复、失败退避、实时状态、定时任务和任务管理。

核心模块：

- `lib/novel-fetch-workshop/queue.js`
- `lib/novel-fetch-workshop/scheduler.js`
- `lib/novel-fetch-workshop/tombstones.js`
- `routes/batch-rewrite.js`
- `frontend/public/batch-rewrite/*`

### C. Advanced Workflow / Sensitive Modes

负责原文最短字数、无效风格重分类、自动同步 121 风格、旧任务清理、自动提交批/flush、强制串行、敏感词三种模式及独立模型选择。

### D. 121 Browser Worker

负责真实网页登录、storage state、会话恢复和可见浏览器验收。它不嵌入 V78 主 Node 镜像，而是独立 Browser Worker。

V78 主服务与 Browser Worker 的边界：

```text
V78 Node
  ├─ 普通小说获取 / 改文 / 任务状态
  ├─ 121 HTTP 上传与后台核验
  └─ 121 Browser Worker client
        └─ Playwright + Chromium
             ├─ 网页登录
             ├─ storage_state
             ├─ session refresh
             └─ visible test
```

## 5. 抓取契约

### 5.1 平台语义

V78 第一版恢复原系统稳定语义：**用户/解析结果确定的 `platformId` 是抓取时使用的平台，不自动跨平台尝试。**

现有 `fetch.auto_detect_platform` 不再作为一个“看起来开启但实际无权威语义”的开关。兼容读取旧值，但 UI 第一阶段隐藏/标记为不可用；未来若需要自动探测，应新增明确枚举：

```text
platform_mode = fixed | auto
```

本次不实现 `auto`。

### 5.2 timeout

`fetch.timeout_seconds` 必须成为真实单次请求 wall-clock 上限。默认 30 秒，最小 1 秒，最大 120 秒。

底层抓取函数接收 `timeoutMs`，不能继续写死 20 秒。

### 5.3 retries

`fetch.retries` 表示首次尝试失败后额外重试次数：

- `0` = 只尝试 1 次。
- `1` = 最多 2 次。
- 上限 5。

重试只针对网络/超时/空正文等可恢复抓取失败，不对输入校验错误重试。

每次失败必须记录 attempt、error、nextRetryMs。

## 6. Runner 与队列

### 6.1 单任务 Runner

Runner 是队列和手动 `process` 共用的唯一业务编排入口，不再让自动队列复制 `routes/batch-rewrite.js` 里的整条流程。

Runner 阶段：

```text
parse/save
→ classify（需要时）
→ fetch
→ rules
→ sensitive
→ rewrite
→ optional submit
```

返回结构：

```js
{
  status: 'done' | 'failed' | 'waiting_retry' | 'stopped',
  stage: 'classify' | 'fetch' | 'rules' | 'sensitive' | 'rewrite' | 'submit',
  bookId,
  attempts,
  error
}
```

### 6.2 Queue 状态

每个用户独立队列，不跨账号共享运行状态。

队列状态：

- `idle`
- `running`
- `paused`
- `stopping`

任务运行状态增加：

- `queued`
- `running`
- `waiting_retry`
- `done`
- `failed`
- `stopped`

### 6.3 API

在现有 `/api/batch-rewrite` 下增加：

```text
POST /process/queue/start
POST /process/queue/pause
POST /process/queue/resume
POST /process/queue/stop
GET  /process/queue/status
GET  /realtime/status
```

所有接口继续使用现有 V78 `apiAuth`，不创建新鉴权层。

### 6.4 重试退避

自动队列使用 bounded backoff：

- 第一次：2 秒
- 第二次：5 秒
- 第三次及以后：10 秒

达到配置重试上限后转 `failed`，不无限循环。

## 7. 定时任务

不实现 Windows 唤醒。定时任务由 V78 Node 内部 scheduler 执行。

单条 schedule：

```js
{
  id,
  owner,
  enabled,
  runAt,
  inputSnapshot,
  status: 'scheduled' | 'running' | 'done' | 'failed' | 'cancelled',
  createdAt,
  updatedAt,
  lastRunAt,
  lastError
}
```

接口：

```text
GET    /schedules
POST   /schedules
PATCH  /schedules/:id
DELETE /schedules/:id
```

服务启动时加载未完成 schedule；如果 `runAt` 已过去且任务仍 enabled/scheduled，则执行一次补跑。补跑必须幂等：同一 schedule 不并发执行两次。

第一版只支持一次性 `runAt`，不增加 cron/复杂重复规则。

## 8. 任务管理

### 8.1 默认列表

默认显示：

- 今天创建/更新的任务；
- 加上所有历史未完成任务。

避免昨天失败的任务因为日期过滤从默认视图消失。

### 8.2 UI 能力

保留日期框，并补：

- 今天
- 上一天
- 下一天
- Book ID 搜索
- 状态筛选

### 8.3 批量 AI 数量

新增受限接口，把选中任务 `aiCount` 改为 1..20。只允许尚未开始 AI 或用户明确要求重新生成的任务改变，不静默覆盖已经生成的 AI 文件。

### 8.4 永久删除

普通删除继续删除任务文件/索引。

“永久删除”额外写 tombstone：

```js
{ bookId, deletedAt, reason }
```

后续自动导入/保存同 BookID 时返回 `410 permanently_deleted`，除非用户显式执行 restore tombstone。

## 9. 高级自动化配置

新增/恢复：

```text
fetch.min_original_chars
fetch.skip_short_original
workflow.auto_sync_site_styles
workflow.auto_reclassify_invalid_style
storage.cleanup_enabled
storage.retention_days
workflow.auto_submit_after_rewrite
web_submit.batch_size
web_submit.flush_seconds
ai.force_serial_batch
```

所有值必须在后端 normalize 后使用，不能只在页面保存 JSON。

自动网站提交继续要求明确 `auto_submit_confirmed === true`，避免配置迁移后意外上传。

## 10. 敏感词模式

正式模式：

- `replace`：直接规则替换。
- `ai_each`：逐命中/小段 AI 修复，可并发。
- `ai_group`：按任务聚合后一次 AI 修复。

继续保留 AI 失败回退机制，但回退必须在日志中明确标记，不能把 AI 失败伪装成 AI 成功。

`ai_assignments.sensitive_fix` 在 UI 中恢复独立模型选择。

## 11. 121 Browser Worker

### 11.1 原则

原始系统的网页登录行为是 golden reference：访问真实管理页面、检测登录表单、填写账号密码、点击登录、确认进入登录后状态、保存 browser storage state。

主 V78 Node 不再把 `POST /tttadmin/api/login.php` 当作唯一登录方式。

### 11.2 Worker 接口

Worker 只监听内部网络，不暴露公网：

```text
POST /session/login
POST /session/test
POST /session/refresh
DELETE /session
```

主 Node 发送 owner-scoped session key 与凭据；Worker 自己负责加密/受限文件权限存储 storage state。

返回只包含状态，不回传明文密码：

```js
{
  ok,
  authenticated,
  sessionId,
  checkedAt,
  errorCode,
  message
}
```

### 11.3 会话恢复

- storage state 能正常进入后台：复用。
- 被重定向到登录页：标记 expired，重新登录。
- state 文件损坏：隔离为 `.bad-<timestamp>`，不覆盖后继续尝试新登录。

### 11.4 可见浏览器测试

“test-visible”必须真的调用 Browser Worker 以 headed/visible 模式完成一次登录态检查；不能继续仅用 cookie GET 页面却命名为 visible。

## 12. V78 UI 兼容

继续使用 `frontend/public/batch-rewrite/index.html`、`app.js`、`styles.css` 作为工作台主体，不在本项目重写整套 React 页面。

React `/novel-fetch` 外壳和进入 Batch Factory 的 `postMessage` bridge 保持兼容。

所有新 UI 只在旧工作台现有六个 tab 中渐进加入：

- 处理：队列开关、实时动态、定时执行入口。
- 任务：搜索、日期导航、状态筛选、批量 AI 数量、永久删除。
- 配置：真实 timeout/retries、自动化设置、敏感词模式/模型。
- 网站提交区域：Browser Worker 登录状态和真实 visible test。

## 13. 数据存储

优先复用现有用户级工作台存储。新增状态使用用户隔离路径，不放入系统全局配置：

```text
data/users/<username>/novel-fetch-workshop/
  queue.json
  schedules.json
  tombstones.json
  runtime-status.json
```

如果当前 MySQL workshop store 已成为该环境的 source of truth，则实现层可用相同接口落 MySQL；业务 API 不依赖具体后端。

系统级默认配置仍留在 `data/system/novel-fetch-workshop/`。

## 14. 错误与安全

- 队列、schedule、tombstone 全部 owner scoped。
- 不在日志、issues、前端状态里记录 121 明文密码。
- Browser Worker storage state 不提交 Git。
- 所有外部网络请求都有明确 wall-clock timeout。
- `pause` 不杀掉正在执行的原子步骤，只阻止下一任务开始；`stop` 使当前 runner 在阶段边界尽快停止。
- 重启后不把 `running` 任务直接当 done；恢复为 queued 或 failed-recoverable，并记录 recovery event。
- 任何 121 session 失败都不能导致“无限验证中”。

## 15. 测试与验收

每个子项目按 RED → GREEN 执行，并独立提交。

必须覆盖：

### Fetch Foundation

- timeout 配置真正传到底层请求。
- retries 次数正确。
- fixed platform 不切换。
- 空正文会重试后失败。
- 非网络输入错误不重试。

### Queue

- start / pause / resume / stop。
- waiting_retry backoff。
- 不跨 owner。
- 重启恢复。
- realtime status 与真实执行一致。

### Scheduler

- future schedule 不提前运行。
- due schedule 执行一次。
- missed schedule 启动后补跑一次。
- cancelled 不运行。

### Task Management

- 默认视图包含历史未完成。
- Book ID 搜索。
- 永久删除阻止自动复活。
- restore tombstone 可恢复。

### Sensitive

- replace / ai_each / ai_group。
- sensitive_fix 独立模型。
- AI 失败回退有明确日志。

### 121 Worker

- 正常登录。
- storage state 复用。
- expired session 重新登录。
- damaged state 隔离。
- visible test 真正调用 browser worker。
- 15 秒左右失败可收敛，前端按钮恢复。

### V78 回归

至少运行：

```bash
node --test tests/*.test.js routes/*.test.js lib/**/*.test.js
npm --prefix frontend run build
```

如果仓库现有通配命令与 shell 不兼容，则使用明确文件列表，但必须记录实际执行的命令。

最终候选只在临时端口、临时数据目录/卷、独立镜像验收；本设计本身不授权切换 `:3000`。

## 16. 分阶段停止点

每个子项目完成后都可以独立停下，不要求一次提交全部功能：

1. **P0：Fetch Contract / Runner Foundation**
2. **P1：Queue / Realtime / Scheduler / Task Operations**
3. **P2：Advanced Workflow / Sensitive Modes**
4. **P3：121 Browser Worker**
5. **Final：V78 isolated candidate verification**

任何阶段如果发现需要修改 Batch Factory V11、Go/MySQL V11 schema、生产 Docker/卷，立即停止并报告，不在本项目扩展。