# 水货生产真实生产闭环 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 qiantie 的“水货生产”从人工工作台变成可验证的文本分析、即梦生图、Vidu 图生视频任务闭环，所有生成结果由 qiantie 保存和展示。

**Architecture:** React 只调用 `/api/shuihuo-production`；Express 只验证平台会话并签名转发；Go 负责预设词快照、模型目录、队列、状态机、供应商协议、对象存储和权限。旧 ai-video 仅作为即梦/Vidu 请求协议参考，绝不作为运行时依赖、凭据来源或数据源。

**Tech Stack:** React + Ant Design, Express, Go, MySQL, Redis, Go `net/http`, 本地对象存储（开发）/ TOS 或 MinIO（部署）。

---

## 文件结构

| 路径 | 职责 |
| --- | --- |
| `backend/internal/shuihuo/providers/` | 文本、即梦、Vidu 受控服务端适配器及轮询协议；不暴露前端。 |
| `backend/internal/shuihuo/tasks/worker.go` | 执行同步图片任务或持久化异步视频上游任务，写入真实状态。 |
| `backend/internal/shuihuo/tasks/poller.go` | 扫描 `running` 的 Vidu 任务、轮询、下载结果、持久化素材。 |
| `backend/internal/shuihuo/store/tasks.go` | 原子更新上游任务 ID、查询待轮询任务、完成/失败幂等写入。 |
| `backend/internal/httpapi/shuihuo_*_handlers.go` | 健康状态、智能分段/候选、任务提交和管理员模型配置 API。 |
| `backend/internal/storage/migrations.go` | 为任务轮询时间和模型受控适配器增加迁移。 |
| `frontend/src/user/pages/shuihuo/*` | 显示依赖状态、智能候选审核、真实任务状态和失败原因。 |
| `frontend/src/admin/pages/ShuihuoModelCatalogPage.jsx` | 管理员配置三种受控模型，禁止普通用户接触密钥和请求模板。 |

## 前置条件与验收边界

- 运行时必须配置 Redis、MySQL、Go 服务、对象存储目录，以及管理员填写的文本、即梦、Vidu 凭据引用；缺少任一项时，系统返回明确的不可用原因，绝不伪造成功。
- 不读取 `/Users/ming/Downloads/ai-video/backend/.env`，不拷贝其中的值；所有旧第三方凭据由所有者轮换后，在 qiantie 自己的受控配置渠道重新录入。
- 第一阶段真实验收为一个已确认分段的“文本候选 -> 即梦图片 -> 主图 -> Vidu 视频”；配音任务在替换现有 HTTP TTS 代理为 HTTPS 提供方后接入，视频合并/剪映草稿是第二阶段。

### Task 1: 运行依赖与可诊断健康状态

**Files:**
- Modify: `backend/internal/config/config.go`
- Modify: `backend/internal/httpapi/router.go`
- Create: `backend/internal/httpapi/shuihuo_health_handlers.go`
- Create: `backend/internal/httpapi/shuihuo_health_handlers_test.go`
- Modify: `backend/internal/app/app.go`
- Modify: `backend/.env.example`

- [ ] **Step 1: 写健康状态失败测试**

```go
func TestShuihuoHealthReportsMissingRedisAndModels(t *testing.T) {
    api := New(Dependencies{Health: ShuihuoHealth{RedisConfigured: false}})
    rec := httptest.NewRecorder()
    api.Router().ServeHTTP(rec, bridgeRequest(t, http.MethodGet,
        "/api/shuihuo-production/health", "owner", true))
    if rec.Code != http.StatusServiceUnavailable || !strings.Contains(rec.Body.String(), "Redis") {
        t.Fatalf("health = %d %s", rec.Code, rec.Body.String())
    }
}
```

- [ ] **Step 2: 运行失败测试**

Run: `cd backend && go test ./internal/httpapi -run TestShuihuoHealthReportsMissingRedisAndModels -count=1`

Expected: FAIL because `ShuihuoHealth` and `/health` do not exist.

- [ ] **Step 3: 实现配置、探针与 API**

```go
type ShuihuoHealth struct {
    DatabaseConfigured bool     `json:"databaseConfigured"`
    RedisConfigured    bool     `json:"redisConfigured"`
    StorageConfigured  bool     `json:"storageConfigured"`
    EnabledKinds       []string `json:"enabledKinds"`
}

func (api *API) handleShuihuoHealth(w http.ResponseWriter, r *http.Request) {
    health := api.deps.Health
    ready := health.DatabaseConfigured && health.RedisConfigured && health.StorageConfigured
    if !ready { writeJSON(w, http.StatusServiceUnavailable, health); return }
    writeJSON(w, http.StatusOK, health)
}
```

Add `QIANTIE_REDIS_ADDR=127.0.0.1:6379` and redacted credential-reference examples to `.env.example`; never add live values. Wire a Redis `PING` at app startup and expose only booleans/kinds, never addresses, templates, or credentials.

- [ ] **Step 4: 验证健康 API**

Run: `cd backend && go test ./internal/httpapi ./internal/app ./internal/config -count=1`

Expected: PASS; missing Redis yields 503 with a Chinese-readable reason and no secret fields.

- [ ] **Step 5: 提交**

```bash
git add backend/internal/config/config.go backend/internal/app/app.go backend/internal/httpapi/router.go backend/internal/httpapi/shuihuo_health_handlers.go backend/internal/httpapi/shuihuo_health_handlers_test.go backend/.env.example
git commit -m "feat: report shuihuo runtime readiness"
```

### Task 2: 受控模型目录与安全的管理员配置

**Files:**
- Modify: `backend/internal/shuihuo/models/catalog.go`
- Modify: `backend/internal/shuihuo/store/models.go`
- Modify: `backend/internal/httpapi/shuihuo_admin_handlers.go`
- Modify: `backend/internal/httpapi/shuihuo_task_handlers.go`
- Modify: `frontend/src/admin/pages/ShuihuoModelCatalogPage.jsx`
- Modify: `frontend/src/shared/api/shuihuoProduction.js`
- Test: `backend/internal/shuihuo/models/catalog_test.go`
- Test: `backend/internal/httpapi/shuihuo_handlers_test.go`

- [ ] **Step 1: 写受控适配器拒绝测试**

```go
func TestValidateDefinitionRejectsUnapprovedAdapter(t *testing.T) {
    err := ValidateDefinition(Definition{Name: "x", Kind: KindImage, AdapterKind: "arbitrary_shell"})
    if err == nil || !strings.Contains(err.Error(), "unsupported") { t.Fatalf("err = %v", err) }
}
func TestPublicModelNeverIncludesCredentialOrTemplate(t *testing.T) {
    body, _ := json.Marshal(ToPublic(Definition{CredentialRef: "JIMENG_KEY", RequestTemplate: "secret"}))
    if strings.Contains(string(body), "JIMENG_KEY") || strings.Contains(string(body), "secret") { t.Fatal("secret leaked") }
}
```

- [ ] **Step 2: 运行失败测试**

Run: `cd backend && go test ./internal/shuihuo/models -run 'TestValidateDefinitionRejectsUnapprovedAdapter|TestPublicModelNeverIncludesCredentialOrTemplate' -count=1`

Expected: FAIL until allowed adapters and public projection are explicit.

- [ ] **Step 3: 实现受控模型契约**

Allow exactly `text_completion`, `jimeng_image`, `vidu_image_to_video`, plus existing `generic_http` for future owner-only use. Model rows store `CredentialRef` only; config resolves it through `QIANTIE_MODEL_CREDENTIALS`. Reject model enablement unless its required credential references and provider parameters are valid. The admin UI uses an adapter select with the three labels, a credential-reference input, public parameters, and a “test configuration” button; it never displays complete templates or secret values.

- [ ] **Step 4: 验证授权边界**

Run: `cd backend && go test ./internal/shuihuo/models ./internal/httpapi -count=1 && npm test -- --test-name-pattern='shuihuo|gateway'`

Expected: PASS; normal users list only enabled public models, non-owners cannot create/update/test models.

- [ ] **Step 5: 提交**

```bash
git add backend/internal/shuihuo/models backend/internal/shuihuo/store/models.go backend/internal/httpapi/shuihuo_admin_handlers.go backend/internal/httpapi/shuihuo_task_handlers.go frontend/src/admin/pages/ShuihuoModelCatalogPage.jsx frontend/src/shared/api/shuihuoProduction.js
git commit -m "feat: add controlled shuihuo model catalog"
```

### Task 3: 文本候选、资产候选和提示词快照

**Files:**
- Create: `backend/internal/shuihuo/providers/text_completion.go`
- Create: `backend/internal/shuihuo/providers/text_completion_test.go`
- Modify: `backend/internal/httpapi/shuihuo_segmentation_handlers.go`
- Create: `backend/internal/httpapi/shuihuo_analysis_handlers.go`
- Modify: `backend/internal/httpapi/router.go`
- Modify: `backend/internal/shuihuo/prompts/service.go`
- Modify: `frontend/src/user/pages/shuihuo/StudioView.jsx`
- Modify: `frontend/src/user/pages/shuihuo/AssetsView.jsx`

- [ ] **Step 1: 写结构化文本候选测试**

```go
func TestTextCompletionRejectsNonJSONArray(t *testing.T) {
    _, err := ParseSegmentCandidates(`{"subtitle":"not array"}`)
    if err == nil { t.Fatal("accepted non-array response") }
}
func TestPromptSnapshotRecordsRenderedTextWithoutPublicLeak(t *testing.T) {
    snap, err := service.Assemble(ctx, selection, AssembleInput{NovelText: "原文"})
    if err != nil || snap.BaseVersionID == 0 || snap.Rendered == "" { t.Fatalf("snap=%+v err=%v", snap, err) }
}
```

- [ ] **Step 2: 运行失败测试**

Run: `cd backend && go test ./internal/shuihuo/providers ./internal/shuihuo/prompts -run 'TestTextCompletionRejectsNonJSONArray|TestPromptSnapshotRecordsRenderedTextWithoutPublicLeak' -count=1`

Expected: FAIL until parser/provider exists.

- [ ] **Step 3: 实现候选而非自动写入**

Use the selected enabled text model plus server-only prompt preset to return JSON candidates. Add `POST /projects/{id}/segmentation/smart` and `POST /projects/{id}/analysis/assets`; both return reviewable candidates only. Preserve `manuallyEdited` assets/prompts unless request has `overwriteManual: true`. Persist the prompt version ID and rendered prompt in task/analysis snapshots; list APIs return names and version IDs but never body text.

- [ ] **Step 4: 验证用户审核门禁**

Run: `cd backend && go test ./internal/httpapi ./internal/shuihuo/providers ./internal/shuihuo/prompts -count=1`

Expected: PASS; no segment, asset, or prompt changes until confirm/save endpoint is explicitly called.

- [ ] **Step 5: 提交**

```bash
git add backend/internal/shuihuo/providers/text_completion.go backend/internal/shuihuo/providers/text_completion_test.go backend/internal/httpapi/shuihuo_segmentation_handlers.go backend/internal/httpapi/shuihuo_analysis_handlers.go backend/internal/httpapi/router.go backend/internal/shuihuo/prompts/service.go frontend/src/user/pages/shuihuo/StudioView.jsx frontend/src/user/pages/shuihuo/AssetsView.jsx
git commit -m "feat: add reviewed shuihuo text analysis"
```

### Task 4: 即梦图片适配器和真实图片任务

**Files:**
- Create: `backend/internal/shuihuo/providers/jimeng.go`
- Create: `backend/internal/shuihuo/providers/jimeng_test.go`
- Modify: `backend/internal/shuihuo/models/adapter.go`
- Modify: `backend/internal/shuihuo/tasks/worker.go`
- Modify: `backend/internal/shuihuo/tasks/worker_test.go`
- Modify: `backend/internal/app/app.go`

- [ ] **Step 1: 写即梦签名和同步结果测试**

```go
func TestJimengSignsCanonicalRequestWithoutLeakingSecret(t *testing.T) {
    signed := SignVolcengineRequest("AKID", "secret", fixedTime, body)
    if !strings.HasPrefix(signed.Authorization, "HMAC-SHA256 Credential=AKID/") { t.Fatal(signed.Authorization) }
    if strings.Contains(signed.Authorization, "secret") { t.Fatal("secret leaked") }
}
func TestJimengMapsProviderTaskToResultURL(t *testing.T) {
    result, err := ParseJimengResult(`{"code":10000,"data":{"image_urls":["https://cdn.example/a.png"]}}`)
    if err != nil || result.ResultURL == "" { t.Fatalf("result=%+v err=%v", result, err) }
}
```

- [ ] **Step 2: 运行失败测试**

Run: `cd backend && go test ./internal/shuihuo/providers -run 'TestJimengSignsCanonicalRequestWithoutLeakingSecret|TestJimengMapsProviderTaskToResultURL' -count=1`

Expected: FAIL because the provider does not exist.

- [ ] **Step 3: 实现最小真实图片链路**

Implement `jimeng_image` as a TLS-verified `net/http` provider that reads only `VOLCENGINE_ACCESS_KEY_ID`/`VOLCENGINE_SECRET_ACCESS_KEY` through credential references, signs the documented request, validates public result URLs, downloads at most 64 MiB, writes object storage first, then creates `source=generated` media and transitions the task to `succeeded`. Do not copy Python SSL bypass code. Keep worker error codes (`model_submit_failed`, `download_result_failed`, `store_result_failed`) visible in task response.

- [ ] **Step 4: 验证图片任务状态机**

Run: `cd backend && go test ./internal/shuihuo/providers ./internal/shuihuo/tasks ./internal/httpapi -count=1`

Expected: PASS; a mocked provider produces a stored image, while a provider failure produces a failed task without media.

- [ ] **Step 5: 提交**

```bash
git add backend/internal/shuihuo/providers/jimeng.go backend/internal/shuihuo/providers/jimeng_test.go backend/internal/shuihuo/models/adapter.go backend/internal/shuihuo/tasks/worker.go backend/internal/shuihuo/tasks/worker_test.go backend/internal/app/app.go
git commit -m "feat: run shuihuo jimeng image tasks"
```

### Task 5: Vidu 异步轮询、恢复与幂等结果保存

**Files:**
- Create: `backend/internal/shuihuo/providers/vidu.go`
- Create: `backend/internal/shuihuo/providers/vidu_test.go`
- Create: `backend/internal/shuihuo/tasks/poller.go`
- Create: `backend/internal/shuihuo/tasks/poller_test.go`
- Modify: `backend/internal/shuihuo/store/tasks.go`
- Modify: `backend/internal/shuihuo/tasks/worker.go`
- Modify: `backend/internal/app/app.go`
- Modify: `backend/internal/storage/migrations.go`

- [ ] **Step 1: 写异步任务不失败测试**

```go
func TestWorkerKeepsAsyncVideoRunning(t *testing.T) {
    worker.Adapter = fakeAdapter{response: models.Response{ProviderTaskID: "vidu-42"}}
    if err := worker.Process(ctx, task.ID); err != nil { t.Fatal(err) }
    if repo.task.Status != domain.TaskRunning || repo.task.ProviderTaskID != "vidu-42" { t.Fatalf("task=%+v", repo.task) }
}
func TestPollerPersistsCompletedVideoExactlyOnce(t *testing.T) {
    err := poller.PollOnce(ctx, task.ID)
    if err != nil || media.CreateCount != 1 || repo.task.Status != domain.TaskSucceeded { t.Fatalf("err=%v count=%d status=%s", err, media.CreateCount, repo.task.Status) }
}
```

- [ ] **Step 2: 运行失败测试**

Run: `cd backend && go test ./internal/shuihuo/tasks -run 'TestWorkerKeepsAsyncVideoRunning|TestPollerPersistsCompletedVideoExactlyOnce' -count=1`

Expected: FAIL because Worker currently marks provider task IDs as failed.

- [ ] **Step 3: 实现持久化轮询**

Add task repository methods `SetProviderTask`, `ListRunningByProvider`, and compare-and-set completion. The worker records Vidu task ID and leaves status `running`. `Poller` runs from `App.New`, checks due Vidu tasks at a bounded interval, maps provider states to running/succeeded/failed, downloads only HTTPS public results, and ignores duplicate callbacks/polls after terminal transition. Add a migration for `next_poll_at` and an index on `(provider,status,next_poll_at)`.

- [ ] **Step 4: 验证重启恢复与主图门禁**

Run: `cd backend && go test ./internal/shuihuo/tasks ./internal/shuihuo/providers ./internal/shuihuo/store -count=1`

Expected: PASS; video without primary image fails, provider task remains running after submit, restart scan completes it once.

- [ ] **Step 5: 提交**

```bash
git add backend/internal/shuihuo/providers/vidu.go backend/internal/shuihuo/providers/vidu_test.go backend/internal/shuihuo/tasks/poller.go backend/internal/shuihuo/tasks/poller_test.go backend/internal/shuihuo/store/tasks.go backend/internal/shuihuo/tasks/worker.go backend/internal/app/app.go backend/internal/storage/migrations.go
git commit -m "feat: poll shuihuo vidu video tasks"
```

### Task 6: 生产台状态、错误和管理员可操作性

**Files:**
- Modify: `frontend/src/shared/api/shuihuoProduction.js`
- Modify: `frontend/src/user/pages/ShuihuoProductionPage.jsx`
- Modify: `frontend/src/user/pages/shuihuo/StudioView.jsx`
- Modify: `frontend/src/user/pages/shuihuo/TaskDrawer.jsx`
- Modify: `frontend/src/admin/pages/ShuihuoModelCatalogPage.jsx`
- Modify: `frontend/src/user/pages/shuihuo-production.css`
- Test: `tests/shuihuo-production-ui-contract.test.js`

- [ ] **Step 1: 写 UI 合同测试**

```js
test('production page exposes real dependency state and task errors', () => {
  const source = fs.readFileSync('frontend/src/user/pages/shuihuo/TaskDrawer.jsx', 'utf8');
  assert.match(source, /errorMessage/);
  assert.match(source, /running/);
  assert.doesNotMatch(source, /生成成功.*queued/);
});
```

- [ ] **Step 2: 运行失败测试**

Run: `node --test tests/shuihuo-production-ui-contract.test.js`

Expected: FAIL until the health/readiness API and UI behavior are implemented.

- [ ] **Step 3: 实现真实可见状态**

Load `/health` once on page entry and show an unframed readiness strip listing missing Redis, storage, text/image/video models. Keep project creation available, but disable only actions whose dependency is unavailable. In the task drawer show model readiness, provider task state, retryable error, and completed media link. Do not add a fake progress percentage; only show queued/running/succeeded/failed/cancelled returned by Go. Preserve existing production-table layout and theme classes.

- [ ] **Step 4: 构建与浏览器验证**

Run: `npm run build && node --test tests/shuihuo-production-ui-contract.test.js`

Expected: build and test PASS. Then, in browser: create/open an existing project, confirm one segment, verify health strip, submit a configured image task, set its result as main image, submit video task, and observe real status transition or a server-reported configuration failure.

- [ ] **Step 5: 提交**

```bash
git add frontend/src/shared/api/shuihuoProduction.js frontend/src/user/pages/ShuihuoProductionPage.jsx frontend/src/user/pages/shuihuo/StudioView.jsx frontend/src/user/pages/shuihuo/TaskDrawer.jsx frontend/src/admin/pages/ShuihuoModelCatalogPage.jsx frontend/src/user/pages/shuihuo-production.css tests/shuihuo-production-ui-contract.test.js
git commit -m "feat: show shuihuo production readiness"
```

### Task 7: 启动、端到端验收与第二阶段边界

**Files:**
- Modify: `backend/README.md`
- Modify: `backend/.env.example`
- Create: `docs/shuihuo-production-operations.md`
- Test: `tests/shuihuo-gateway.test.js`

- [ ] **Step 1: 写启动配置校验测试**

```js
test('gateway surfaces Go readiness failure without hiding it', async () => {
  const response = await request(app, { requestPath: '/api/shuihuo-production/health', token });
  assert.equal(response.status, 503);
  assert.match(response.body, /redisConfigured/);
});
```

- [ ] **Step 2: 运行失败测试**

Run: `node --test tests/shuihuo-gateway.test.js`

Expected: FAIL until the health endpoint forwards response correctly.

- [ ] **Step 3: 写操作文档与启动命令**

Document only variable names and commands, never live values:

```bash
brew services start redis
export QIANTIE_REDIS_ADDR='127.0.0.1:6379'
export QIANTIE_MODEL_CREDENTIALS='TEXT_PROVIDER_TOKEN=...,VOLCENGINE_ACCESS_KEY_ID=...,VOLCENGINE_SECRET_ACCESS_KEY=...,VIDU_API_TOKEN=...'
cd /Users/ming/Downloads/qiantie/backend && go run ./cmd/qiantie
curl -s http://127.0.0.1:4000/healthz
```

The document must define the first live acceptance record: UTC timestamp, project ID, segment ID, model version IDs, task IDs, final media IDs, and redacted failures. State that the current HTTP TTS proxy is not a worker provider; add a separate HTTPS TTS adapter before enabling audio tasks. Put video merge, zip download, and Jianying draft in a separately approved second-phase plan.

- [ ] **Step 4: 全量验证**

Run:

```bash
cd backend && go test ./...
cd .. && npm test && npm run build
curl -s http://127.0.0.1:4000/healthz
```

Expected: all local tests/build pass; health check is `{"ok":true}`. Record separately whether external model credentials were supplied and whether one real image/video was produced; do not claim live generation from mocks or unit tests.

- [ ] **Step 5: 提交**

```bash
git add backend/README.md backend/.env.example docs/shuihuo-production-operations.md tests/shuihuo-gateway.test.js
git commit -m "docs: add shuihuo production operations"
```

## Plan Self-Review

- Spec coverage: Tasks 1-2 cover runtime and administration; Task 3 covers user-confirmed text/asset/prompt candidates; Tasks 4-5 cover the confirmed 即梦/Vidu image-video chain; Task 6 covers UI truthfulness; Task 7 covers deployment and evidence. Audio/export are explicitly deferred because the existing TTS provider is HTTP and export is a second-phase feature.
- Placeholder scan: no `TBD`, no secret values, no instruction to copy the old `.env`, and all failure behavior is concrete.
- Type consistency: `models.Response.ProviderTaskID`, `domain.Task.Status`, `TaskRunning`, `SetProviderTask`, `ListRunningByProvider`, and `PollOnce` use the same vocabulary throughout.
