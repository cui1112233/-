# 巨量素材公网 OCR 统一 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让巨量素材的正文回填不再依赖浏览器页面常驻：公网任务由已绑定的 Mac/Windows 执行器完成后，服务端可靠保存正文、展示精确状态，并使已启动的自动化逐书继续。

**Architecture:** 保留“书城直取优先、失败自动 OCR”的入口。巨量执行器控制面为任务持久化批量绑定与结果投递状态，完成 OCR 后通过受控的服务端 ResultSink 回填 Batch Factory 同一 MySQL 书记录；前端只负责创建带绑定的任务、显示真实进度和重试，不再是正文回填唯一执行者。Mac Vision 与 Windows PaddleOCR 不强行改成同一 OCR 库，而是共享同一任务协议、错误码、文本清理契约和验收夹具。

**Tech Stack:** Go、MySQL migrations、React + Ant Design、Node node:test、Python worker protocol tests、Swift Package tests。

## Global Constraints

- `v88` 是唯一正式源码；先入 Git，再按 Direct Stage -> Cutover 发布并用精确 SHA 验证。
- 不把青语令牌、Cookie、视频或帧图写入前端、日志、数据库或 Git。
- OCR 仍由在线的 macOS / Windows 执行器完成，公网不做常驻 OCR。
- 一台电脑重新配对或升级不能新增设备；沿用已确认的平台偏好、失败冷却和领取规则。
- 浏览器可关闭、刷新或切换页面；正文回填与自动化续跑不得依赖前端轮询。
- 完整自动制作会调用付费模型；先验收正文链，用户当次明确确认后才验收付费制作。

---

## File Structure

| 文件 | 职责 |
|---|---|
| `backend/internal/storage/giant_material_executor_schema.go` | 为巨量任务添加批量书绑定和结果投递状态 migration。 |
| `backend/internal/giantmaterialexecutor/{types.go,store.go,memory_store.go,mysql_store.go,service.go}` | 保存/查询投递状态，OCR complete 后调用并重试 ResultSink。 |
| `backend/internal/giantmaterialintake/{result_sink.go,text.go}` | 独立的正文回填器和跨平台文本清理，避免包循环依赖。 |
| `backend/internal/app/{app.go,giant_result_delivery.go}` | 装配 ResultSink 并运行取消安全的投递恢复循环。 |
| `frontend/src/shared/api/giantMaterialExecutorPublic.js` | 传递批量绑定，读取投递与设备状态。 |
| `frontend/src/user/pages/shuihuo/giantMaterialOriginalState.js` | 纯前端状态映射，不发请求。 |
| `BatchFactoryCreateModal.jsx` / `BatchFactoryGiantMaterialPendingProgress.jsx` / `BatchFactoryNovelList.jsx` | 创建绑定任务、紧凑列表状态和详情诊断。 |
| `giant-material-executor/fixtures/scroll-text-contract.json` | Mac、Win 和本机测试共同的 OCR 文字/协议金样本。 |

### Task 1: 为 OCR 任务建立“批量书绑定 + 回填投递”数据契约

**Files:**
- Modify: `backend/internal/storage/giant_material_executor_schema.go`
- Modify: `backend/internal/giantmaterialexecutor/{types.go,store.go,memory_store.go,mysql_store.go,service.go}`
- Test: `backend/internal/giantmaterialexecutor/result_delivery_test.go`
- Test: `backend/internal/storage/giant_material_executor_schema_test.go`

**Interfaces:**
- Consumes: `CreateJobInput`、`JobRecord`、`CompleteJob` 和 `ResultInput`。
- Produces: `CreateJobInput.BatchID`、`CreateJobInput.BatchBookID`、`JobView.Delivery`、`JobView.LeaseExecutorName`、`JobView.LeaseExecutorOS`、`Service.PendingDeliveries(ctx, limit)`、`Service.DeliverPending(ctx, limit)`。

- [ ] **Step 1: Write the failing test**

~~~go
job, err := service.CreateJob(ctx, "alice", CreateJobInput{
  Platform: PlatformGiantMaterial, MaterialID: "7683728935785873458",
  PlatformBookID: "558154", Title: "测试书",
  VideoURL: "https://material.hnqingyuwen.top/n8_videos/a.mp4",
  DurationSeconds: 12, ModelVersion: "macos-vision-v1",
  BatchID: "batch-1", BatchBookID: "book-1",
})
if err != nil { t.Fatal(err) }
if job.Delivery.State != DeliveryPending { t.Fatalf("delivery = %q", job.Delivery.State) }
~~~

Also assert: one binding field alone returns `ErrInvalidInput`; unbound probe jobs use `DeliveryNotBound`; a sink failure after `Complete` preserves the OCR result and records `DeliveryRetryable`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && go test ./internal/giantmaterialexecutor -run 'Test(CreateJobRequiresCompleteBatchBinding|CompletedJobKeepsRetryableDelivery)' -count=1`

Expected: FAIL because bindings and delivery state do not yet exist.

- [ ] **Step 3: Write the minimal implementation**

Add migration columns and index:

~~~sql
ALTER TABLE giant_executor_jobs
  ADD COLUMN batch_id VARCHAR(64) NULL AFTER content_range_lines,
  ADD COLUMN batch_book_id VARCHAR(64) NULL AFTER batch_id,
  ADD COLUMN delivery_state VARCHAR(32) NOT NULL DEFAULT 'not_bound' AFTER state,
  ADD COLUMN delivery_error_code VARCHAR(96) NULL AFTER delivery_state,
  ADD COLUMN delivery_attempts INT NOT NULL DEFAULT 0 AFTER delivery_error_code,
  ADD COLUMN delivered_at DATETIME(6) NULL AFTER delivery_attempts,
  ADD KEY idx_giant_executor_jobs_delivery (delivery_state, updated_at);
~~~

Define:

~~~go
type DeliveryState string
const (
  DeliveryNotBound DeliveryState = "not_bound"
  DeliveryPending DeliveryState = "pending"
  DeliveryRetryable DeliveryState = "retryable"
  DeliveryDelivered DeliveryState = "delivered"
)
type DeliveryRecord struct {
  State DeliveryState `json:"state"`
  ErrorCode string `json:"errorCode,omitempty"`
  Attempts int `json:"attempts"`
  DeliveredAt *time.Time `json:"deliveredAt,omitempty"`
}
~~~

Extend `JobRecord` and `JobView` with `BatchID`, `BatchBookID`, and `Delivery`. Add `LeaseExecutorName` and `LeaseExecutorOS` to `JobView`; add `LookupExecutor(ctx, owner, id)` to Store, and replace the package-level `jobView(record)` call with a Service method that hydrates those two fields from the leased executor without failing a completed job whose old executor record was deleted. Add Store methods:

~~~go
ListPendingDeliveries(ctx context.Context, limit int) ([]JobRecord, error)
MarkDelivery(ctx context.Context, jobID string, next DeliveryRecord, now time.Time) (JobRecord, error)
~~~

Only query succeeded, bound jobs whose delivery state is `pending` or `retryable`. Include a nonempty `batch_id + batch_book_id` in `jobKey`, preventing reuse of a result for a different batch book.

- [ ] **Step 4: Run the targeted tests**

Run: `cd backend && go test ./internal/giantmaterialexecutor ./internal/storage -count=1`

Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add backend/internal/storage/giant_material_executor_schema.go   backend/internal/storage/giant_material_executor_schema_test.go   backend/internal/giantmaterialexecutor
git commit -m "feat(giant): persist OCR result delivery bindings"
~~~

### Task 2: 服务端回填正文并持续补偿失败投递

**Files:**
- Create: `backend/internal/giantmaterialintake/{result_sink.go,result_sink_test.go,text.go,text_test.go}`
- Modify: `backend/internal/giantmaterialexecutor/{types.go,service.go}`
- Modify: `backend/internal/app/app.go`
- Create: `backend/internal/app/giant_result_delivery.go`
- Test: `backend/internal/app/giant_result_delivery_test.go`

**Interfaces:**
- Consumes: Task 1 `JobRecord.Delivery` and `batchfactoryv11.Store.CaptureBookSource`.
- Produces: `giantmaterialexecutor.ResultSink`, `giantmaterialintake.ResultSink.Deliver`, and `startGiantResultDeliveryLoop`.

- [ ] **Step 1: Write the failing ResultSink tests**

~~~go
err := sink.Deliver(ctx, giantmaterialexecutor.CompletedResult{
  Owner: "alice", JobID: "gme_job_1", BatchID: "batch-1", BatchBookID: "book-1",
  Text: "修改中&nbsp;\n。\n第一段正文\n第一段正文\n第二段正文",
  WordCount: 16,
})
if err != nil { t.Fatal(err) }
// sourceText must equal "第一段正文\n第二段正文".
~~~

Cover: already-present source is idempotent success; one revision conflict refreshes and retries; absent book gives `GIANT_BATCH_BOOK_NOT_FOUND`; cleaned-empty input gives `GIANT_OCR_EMPTY_RESULT`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && go test ./internal/giantmaterialintake -run 'Test(ResultSink|CleanGiantOCRText)' -count=1`

Expected: FAIL because the package does not exist.

- [ ] **Step 3: Write the minimal implementation**

Create:

~~~go
type ResultSink interface {
  Deliver(context.Context, CompletedResult) error
}
type CompletedResult struct {
  Owner, JobID, BatchID, BatchBookID, Text string
  WordCount int
}
func CleanGiantOCRText(raw string) string
~~~

`CleanGiantOCRText` standardizes line breaks, unescapes HTML, removes blank and punctuation-only lines, removes adjacent identical lines, but never deletes a line containing Han/letter/digit text.

`ResultSink.Deliver` reads the owner batch, finds the exact `BatchBookID`, returns nil if source already exists, otherwise calls `CaptureBookSource` up to three times with refreshed revision. Merge metadata: `sourceCompleteness='video_excerpt'`, `requiresProofreading=true`, `giantOcrState='succeeded'`, `originalReadStage='ocr_returned'`, `originalReadError=''`, `contentPending=false`, `giantOcrCharacters`, `giantOcrCompletedAt`.

`Service.Complete` persists OCR output first, then calls the sink. A sink error marks `retryable` with only a stable error code and still returns success to the executor, so the executor never reuploads the full text. In app construction inject `giantmaterialintake.ResultSink{Store: store}`. A 5-second `ctx.Done()`-aware loop runs once immediately and then delivers at most 20 pending results per tick. Do not start a paid job from ResultSink: the existing batch automation job was saved and started at batch creation, and its next Node controller tick must see the newly saved `sourceText` and advance that one book.

- [ ] **Step 4: Run the targeted tests**

Run: `cd backend && go test ./internal/giantmaterialintake ./internal/giantmaterialexecutor ./internal/app -count=1`

Expected: PASS, including a test where no browser request exists.

- [ ] **Step 5: Commit**

~~~bash
git add backend/internal/giantmaterialintake backend/internal/giantmaterialexecutor backend/internal/app
git commit -m "feat(giant): deliver OCR results to batch books server-side"
~~~

### Task 3: 新建与重试任务必须带批量绑定并保存精确派发阶段

**Files:**
- Modify: `frontend/src/shared/api/{giantMaterialExecutorPublic.js,giantMaterialExecutorPublic.test.js}`
- Modify: `frontend/src/user/pages/shuihuo/{BatchFactoryCreateModal.jsx,BatchFactoryCreateModal.source.test.js}`
- Modify: `frontend/src/user/pages/shuihuo/{BatchFactoryGiantMaterialPendingProgress.jsx,BatchFactoryGiantMaterialPendingProgress.source.test.js}`

**Interfaces:**
- Consumes: Task 1 `batchId`, `batchBookId`, `deliveryState`.
- Produces: `direct_reading`, `direct_read_failed`, `ocr_dispatching`, `ocr_queued`, `ocr_dispatch_failed` metadata states.

- [ ] **Step 1: Write the failing API and flow tests**

~~~js
createGiantMaterialJob({
  materialId: '1', platformBookId: '2', title: '书',
  videoUrl: 'https://material.hnqingyuwen.top/x.mp4', durationSeconds: 2,
  batchId: 'batch-1', batchBookId: 'book-1'
});
assert.match(request.body, /"batchId":"batch-1"/);
assert.match(request.body, /"batchBookId":"book-1"/);
~~~

Assert the direct-first failure path writes `direct_read_failed`, then `ocr_dispatching`; only a successful response writes `ocr_queued` and `executorJobId`; an API or metadata failure writes `ocr_dispatch_failed` and stable `originalReadError`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test frontend/src/shared/api/giantMaterialExecutorPublic.test.js frontend/src/user/pages/shuihuo/BatchFactoryCreateModal.source.test.js frontend/src/user/pages/shuihuo/BatchFactoryGiantMaterialPendingProgress.source.test.js`

Expected: FAIL because the binding fields and stage sequence are missing.

- [ ] **Step 3: Write the minimal implementation**

Serialize `batchId` and `batchBookId` in `createGiantMaterialJob`. In both CreateModal dispatch paths, fetch current book revision, persist `ocr_dispatching`, call the job API with both bindings, and persist `ocr_queued` only after a job ID exists. Retry 409 metadata conflicts at most three times.

Direct fetch failure automatically calls the dispatch helper. Replace generic `failed` with `direct_read_failed` or `ocr_dispatch_failed`. New tasks must not write text, classify metadata, or start automation in PendingProgress; the Task 2 ResultSink owns persistence. Preserve a clearly named `legacy_client_recovery` fallback only for old unbound jobs, without overwriting existing source.

- [ ] **Step 4: Run the targeted tests**

Run: same command as Step 2.

Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add frontend/src/shared/api/giantMaterialExecutorPublic.*   frontend/src/user/pages/shuihuo/BatchFactoryCreateModal.*   frontend/src/user/pages/shuihuo/BatchFactoryGiantMaterialPendingProgress.*
git commit -m "fix(giant): bind OCR jobs to batch books"
~~~

### Task 4: 集中状态映射并修复小说列表窄列布局

**Files:**
- Create: `frontend/src/user/pages/shuihuo/{giantMaterialOriginalState.js,giantMaterialOriginalState.test.js}`
- Modify: `frontend/src/user/pages/shuihuo/{BatchFactoryGiantMaterialPendingProgress.jsx,BatchFactoryNovelList.jsx}`
- Modify: related `.source.test.js` files.

**Interfaces:**
- Consumes: metadata stage and public job `state`, `progress`, `delivery`, `errorCode`, `leaseExecutorName`, `leaseExecutorOS`.
- Produces: `giantMaterialOriginalPresentation({ metadata, job }) -> { tone, label, detail, percent, action }`.

- [ ] **Step 1: Write the failing pure function tests**

~~~js
assert.equal(giantMaterialOriginalPresentation({
  metadata: { originalReadStage: 'ocr_queued' },
  job: { state: 'queued', delivery: { state: 'pending' } }
}).label, '等待本机执行器');

assert.equal(giantMaterialOriginalPresentation({
  metadata: { originalReadStage: 'ocr_queued' },
  job: { state: 'running', progress: { percent: 62 },
         leaseExecutorName: 'ming', leaseExecutorOS: 'darwin' }
}).detail, '由 ming 的 macOS 执行器识别中 62%');
~~~

Also test direct-read failure, dispatch failure, OCR worker failure, retryable delivery, and returned source states.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test frontend/src/user/pages/shuihuo/giantMaterialOriginalState.test.js`

Expected: FAIL because the mapper does not exist.

- [ ] **Step 3: Write the minimal implementation**

Use a safe error-code map:

~~~js
const ERROR_COPY = {
  GIANT_BATCH_BOOK_NOT_FOUND: '批量中的小说记录不存在',
  GIANT_OCR_EMPTY_RESULT: '未识别出可用正文',
  OCR_VIDEO_READ_FAILED: '执行器无法读取素材视频',
  OCR_RUNTIME_NOT_READY: '执行器 OCR 运行环境尚未准备好'
};
~~~

The list cell renders one compact status/action only; it must not contain a full Alert or a narrow vertical two-button card. Detail view renders progress, job ID, device name, platform, and non-sensitive error. `direct_read_failed` offers only retry direct read; dispatch or worker failure offers retry OCR; `delivery.retryable` says “正文已识别，正在保存”.

- [ ] **Step 4: Run the targeted tests**

Run: `node --test frontend/src/user/pages/shuihuo/giantMaterialOriginalState.test.js frontend/src/user/pages/shuihuo/BatchFactoryGiantMaterialPendingProgress.source.test.js frontend/src/user/pages/shuihuo/BatchFactoryNovelList.source.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add frontend/src/user/pages/shuihuo/giantMaterialOriginalState.*   frontend/src/user/pages/shuihuo/BatchFactoryGiantMaterialPendingProgress.*   frontend/src/user/pages/shuihuo/BatchFactoryNovelList.*
git commit -m "feat(giant): show durable original-read states"
~~~

### Task 5: 固化 Mac、Windows 与本机测试的共同 OCR 行为契约

**Files:**
- Create: `giant-material-executor/fixtures/scroll-text-contract.json`
- Modify: `lib/giant-material/scroll-extractor.test.mjs`
- Modify: `giant-material-executor/worker/protocol_test.py`
- Modify: `giant-material-executor/macos/Tests/ScrollTextSelfTest.swift`
- Modify: `giant-material-executor/internal/worker/protocol_test.go`

**Interfaces:**
- Consumes: Node 测试抽取器、Windows Python Paddle worker、macOS Vision worker、Go NDJSON protocol.
- Produces: common fixture for overlap merge, cleaning, host allowlist, and `progress/complete/failed/idle` events.

- [ ] **Step 1: Write a failing golden fixture**

~~~json
{
  "frames": ["修改中&nbsp;\n。\n第一段正文", "第一段正文\n第二段正文"],
  "expectedText": "第一段正文\n第二段正文",
  "expectedCharacters": 10
}
~~~

Include duplicate frames, invalid URL, empty output, and progress-with-text rejection samples.

- [ ] **Step 2: Run all contract tests and verify at least one fails**

~~~bash
node --test lib/giant-material/scroll-extractor.test.mjs
python3 giant-material-executor/worker/protocol_test.py
(cd giant-material-executor/macos && swift test)
(cd giant-material-executor && go test ./internal/worker -count=1)
~~~

Expected: at least one cleaning/overlap assertion fails before alignment.

- [ ] **Step 3: Align contract behavior without replacing platform OCR engines**

Keep Vision on macOS and PaddleOCR on Windows. Align only allowed hosts, NDJSON command/event fields, overlap merge, final cleanup, and non-whitespace character count. Add Swift HTML entity and punctuation-only-line cleanup; align Python and Node adjacent duplicate behavior.

- [ ] **Step 4: Run all contract tests**

Run: same four commands as Step 2.

Expected: PASS on each platform contract.

- [ ] **Step 5: Commit**

~~~bash
git add giant-material-executor/fixtures giant-material-executor/worker/protocol_test.py   giant-material-executor/macos/Tests/ScrollTextSelfTest.swift   giant-material-executor/internal/worker/protocol_test.go   lib/giant-material/scroll-extractor.test.mjs
git commit -m "test(giant): enforce cross-platform OCR text contract"
~~~

### Task 6: 端到端验证、合并与增量发布

**Files:**
- Test: `backend/internal/httpapi/giant_material_executor_test.go`
- Test: files from Tasks 1-5
- Modify only after real verification: `docs/superpowers/handoffs/` with SHA and non-sensitive acceptance evidence.

**Interfaces:**
- Consumes: Tasks 1-5.
- Produces: exact Git SHA, staged release evidence, and a public non-paid original-read acceptance record.

- [ ] **Step 1: Write the failing HTTP E2E test**

Simulate create bound job -> executor claim -> progress -> result -> ResultSink delivery. Assert:

~~~go
if got := storedBook.SourceText; got != "第一段正文\n第二段正文" { t.Fatalf("source = %q", got) }
if stage := storedBook.SourceMetadata["originalReadStage"]; stage != "ocr_returned" { t.Fatalf("stage = %v", stage) }
if job.Delivery.State != DeliveryDelivered { t.Fatalf("delivery = %q", job.Delivery.State) }
~~~

The test must make no browser `GET /jobs/{id}` request, then assert that the existing automation controller sees the stored source and no longer leaves that book at `waiting/source`.

- [ ] **Step 2: Run the E2E test to verify it fails**

Run: `cd backend && go test ./internal/httpapi -run TestGiantMaterialResultDeliveryE2E -count=1`

Expected: FAIL until Tasks 1-4 are connected.

- [ ] **Step 3: Run focused verification**

~~~bash
cd backend && go test ./internal/giantmaterialexecutor ./internal/giantmaterialintake ./internal/httpapi ./internal/app ./internal/storage -count=1
cd ../giant-material-executor && go test ./... -count=1
cd .. && node --test lib/giant-material/scroll-extractor.test.mjs frontend/src/shared/api/giantMaterialExecutorPublic.test.js frontend/src/user/pages/shuihuo/giantMaterialOriginalState.test.js frontend/src/user/pages/shuihuo/BatchFactoryCreateModal.source.test.js frontend/src/user/pages/shuihuo/BatchFactoryGiantMaterialPendingProgress.source.test.js frontend/src/user/pages/shuihuo/BatchFactoryNovelList.source.test.js
cd frontend && npm run build
~~~

Expected: PASS. Report unrelated suite failures separately.

- [ ] **Step 4: Commit and merge to current v88**

~~~bash
git add backend frontend giant-material-executor lib docs/superpowers/handoffs
git commit -m "test(giant): verify server-side OCR intake flow"
git fetch origin v88
git rebase origin/v88
git push origin HEAD:v88
~~~

- [ ] **Step 5: Release and public acceptance**

Use V88 Direct Deploy Node Stage with the exact SHA, then Direct Deploy Node Cutover after Stage health succeeds; do not use retired Docker/GHCR release workflows or edit ECS directly. Verify build-info exact SHA. With one online executor, create one giant job but do not start paid production: validate status sequence, refresh/close browser, reopen, and confirm source text persists. Only after fresh user confirmation, run one full paid automation and separately record any model-token failure as an AI stage error.
