# V78 小说获取 V2 P1：Queue / Realtime / Scheduler / Task Operations 实施计划

**依赖：** P0 Fetch Contract / Runner Foundation 完成并通过 focused tests。  
**Branch:** `feat/v78-novel-fetch-v2-completion`

**Goal:** 在 V78 现有小说获取工作台上恢复原系统的无人值守队列、暂停/恢复、实时状态、定时任务与高级任务管理，同时保持 owner 隔离、Docker 适配和现有 API 鉴权。

## Task 1 — Owner-scoped queue store

**Files**
- Create: `lib/novel-fetch-workshop/queue-store.js`
- Create: `tests/novel-fetch-queue-store.test.js`

TDD 定义并实现：

- 每个 username 独立 `queue.json/runtime-status.json`。
- queue state：`idle/running/paused/stopping`。
- item state：`queued/running/waiting_retry/done/failed/stopped`。
- 原子写、损坏文件 fail-closed，不跨 owner。
- 服务重启时把遗留 `running` 恢复成 `queued` 并写 recovery event。

## Task 2 — Queue executor

**Files**
- Create: `lib/novel-fetch-workshop/queue.js`
- Create: `tests/novel-fetch-queue.test.js`

TDD 覆盖：

- start 只启动一个 owner runner。
- pause 不杀当前原子阶段，但阻止下一任务。
- resume 从 paused 继续。
- stop 在阶段边界停止并落 `stopped`。
- recoverable failure 进入 `waiting_retry`，2s/5s/10s bounded backoff。
- 达到 retries 上限后 failed。
- 两个 owner 的队列互不影响。

Executor 只调用 P0 `runNovelFetchBatch/run task primitive`，不复制业务链。

## Task 3 — HTTP queue/realtime contract

**Files**
- Modify: `routes/batch-rewrite.js`
- Create: `tests/batch-rewrite-queue-api.test.js`

新增：

```text
POST /process/queue/start
POST /process/queue/pause
POST /process/queue/resume
POST /process/queue/stop
GET  /process/queue/status
GET  /realtime/status
```

全部沿用 `apiAuth` 和 `req.username`。未运行时返回稳定空状态，不返回 fake progress。

## Task 4 — Scheduler store + executor

**Files**
- Create: `lib/novel-fetch-workshop/scheduler.js`
- Create: `tests/novel-fetch-scheduler.test.js`
- Modify: `routes/batch-rewrite.js`

第一版只支持 one-shot `runAt`：

```text
GET    /schedules
POST   /schedules
PATCH  /schedules/:id
DELETE /schedules/:id
```

TDD：future 不提前跑；due 跑一次；missed 启动补跑一次；cancelled 不跑；同 schedule 不并发双跑；owner 隔离。

## Task 5 — Tombstones / permanent delete

**Files**
- Create: `lib/novel-fetch-workshop/tombstones.js`
- Create: `tests/novel-fetch-tombstones.test.js`
- Modify: `lib/novel-fetch-workshop/tasks.js`
- Modify: `routes/batch-rewrite.js`

TDD：permanent delete 写 tombstone；随后 save/import 同 bookId 返回 `410 permanently_deleted`；restore 后允许再次保存；普通 delete 不写 tombstone。

API：

```text
POST /tasks/batch-delete-permanent
POST /tasks/:id/restore-tombstone
```

## Task 6 — Task list query semantics

**Files**
- Modify: `routes/batch-rewrite.js`
- Modify: `frontend/public/batch-rewrite/app.js`
- Modify: `frontend/public/batch-rewrite/index.html`
- Create: `tests/novel-fetch-task-list.test.js`

实现服务端 query/helper：默认 `today + historical unfinished`，并支持 `date/bookId/status`。前端补今天/前一天/后一天、Book ID 搜索、状态筛选。

不要让 UI 自己定义“未完成”；服务端 helper 统一判断。

## Task 7 — Batch AI count

**Files**
- Modify: `lib/novel-fetch-workshop/tasks.js`
- Modify: `routes/batch-rewrite.js`
- Modify: `frontend/public/batch-rewrite/*`
- Create: `tests/novel-fetch-batch-ai-count.test.js`

新增选中任务 aiCount=1..20 更新。已有 AI 文件时默认拒绝覆盖并返回 conflict；显式 regenerate 作为后续动作，不在本任务静默删除版本文件。

## Task 8 — P1 verification

Focused：queue/store/api/scheduler/tombstone/task list/AI count。  
Regression：全部现有 Node tests + frontend build。  
候选只能临时端口/临时数据，不部署 `:3000`。
