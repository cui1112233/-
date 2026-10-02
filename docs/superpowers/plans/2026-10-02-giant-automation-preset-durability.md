# 巨量自动化预设耐久性 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 巨量素材选择预设后，创建批量、保存统一配置和自动化计划成为一个不可拆分的服务端动作，并在统一/单书配置中准确显示继承结果。

**Architecture:** 浏览器只发送预设 ID、执行方式和巨量 intake。V12 Node 路由从该账号的预设仓库读取并冻结快照，Go V11 Store 在 intake 消费事务中创建批量、写入 settings patch 与每本书的巨量自动化计划。之后才允许浏览器派发正文读取/OCR。自动恢复只使用已冻结的批量设置，删除原预设不影响已创建批量。

**Tech Stack:** React + Ant Design, Node/Express V12 compatibility router, Go V11 HTTP API and MySQL Store, Node test runner, Go testing.

## Global Constraints

- Git `v88` 是唯一维护主线；先提交 Git，再按 Node/Go 变更范围增量发布。
- 不重建 Docker 镜像，不重建 MySQL、Redis、数据卷，也不修改现有批量数据。
- 未成功冻结预设时，不得创建可执行的巨量批量、OCR 任务或自动生产任务。
- 已创建批量固定使用自己的配置快照；不得因原预设修改/删除而改变。
- 单书无覆盖时显示统一配置的有效值和“继承统一配置”，不伪造单书覆盖。

---

### Task 1: Go 批量创建事务同时保存配置与巨量计划

**Files:**
- Modify: `backend/internal/batchfactoryv11/types.go:114-117`
- Modify: `backend/internal/batchfactoryv11/memory_store.go:517-555`
- Modify: `backend/internal/batchfactoryv11/mysql_store.go:65-101,221-304`
- Modify: `backend/internal/httpapi/batch_factory_v11_slice1.go:124-139`
- Test: `backend/internal/batchfactoryv11/store_test.go`
- Test: `backend/internal/httpapi/batch_factory_v11_slice1_test.go`

**Interfaces:**
- Consumes: `CreateBatchFromIntake(ctx, owner, intakeID, CreateBatchInput)` and `SettingsPatch`.
- Produces: `CreateBatchInput.InitialBatchSettings SettingsPatch`, `CreateBatchInput.AutomationPreset map[string]any`, and `CreateBatchInput.GiantAutomationPlan map[string]any`; a returned `Batch` whose `SettingsState.Patch` is already hydrated.

- [ ] **Step 1: Write the failing Store test**

```go
func TestCreateBatchFromIntakeAtomicallySavesInitialSettingsAndGiantPlan(t *testing.T) {
  intake, _ := store.CreateIntake(ctx, "alice", NovelFetchIntakeInput{Books: []CreateBookInput{{Title: "巨量书", SourceMetadata: map[string]any{"sourceMode": "giant_material"}}}})
  batch, err := store.CreateBatchFromIntake(ctx, "alice", intake.ID, CreateBatchInput{
    Title: "巨量批量",
    InitialBatchSettings: SettingsPatch{"textModelId": json.RawMessage(`"text-1"`)},
    AutomationPreset: map[string]any{"id": "preset-1", "version": 2, "name": "全自动"},
    GiantAutomationPlan: map[string]any{"presetId": "preset-1", "runMode": "full_submit"},
  })
  if err != nil { t.Fatal(err) }
  if got := string(batch.SettingsState.Patch["textModelId"]); got != `"text-1"` { t.Fatalf("textModelId=%s", got) }
  if batch.Books[0].SourceMetadata["giantAutomationPlan"] == nil { t.Fatal("missing frozen giant plan") }
}
```

- [ ] **Step 2: Run the Store test to verify RED**

Run: `cd backend && go test ./internal/batchfactoryv11 -run TestCreateBatchFromIntakeAtomicallySavesInitialSettingsAndGiantPlan -count=1`

Expected: FAIL because `CreateBatchInput` does not yet accept initial settings or a giant plan.

- [ ] **Step 3: Write the minimal transaction implementation**

```go
type CreateBatchInput struct {
  Title string `json:"title"`
  Books []CreateBookInput `json:"books,omitempty"`
  InitialBatchSettings SettingsPatch `json:"initialBatchSettings,omitempty"`
  AutomationPreset map[string]any `json:"automationPreset,omitempty"`
  GiantAutomationPlan map[string]any `json:"giantAutomationPlan,omitempty"`
}
```

In `createBatchTx`, merge `GiantAutomationPlan` only into books whose `sourceMode` is `giant_material`; attach immutable preset metadata to `InitialBatchSettings`. Insert the batch patch and advance the batch revision inside the existing MySQL transaction before consuming the intake. Mirror that behavior in `MemoryStore`; do not call `SaveSettings` after commit.

- [ ] **Step 4: Write the failing HTTP contract test**

```go
rec := signedJSONRequest(t, api, now, "alice", http.MethodPost,
  "/api/batch-factory/v11/intakes/"+intake.ID+"/batches",
  map[string]any{"title":"巨量批量", "initialBatchSettings":map[string]any{"textModelId":"text-1"}, "automationPreset":map[string]any{"id":"preset-1","version":2}, "giantAutomationPlan":map[string]any{"presetId":"preset-1"}})
if rec.Code != http.StatusCreated || !strings.Contains(rec.Body.String(), `"textModelId":"text-1"`) { t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String()) }
```

- [ ] **Step 5: Run the Go tests to verify GREEN**

Run: `cd backend && go test ./internal/batchfactoryv11 ./internal/httpapi -run 'Test(CreateBatchFromIntakeAtomicallySavesInitialSettingsAndGiantPlan|V11.*Initial.*Settings)' -count=1`

Expected: PASS; an intake is consumed only with settings and plan persisted in the same returned batch.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/batchfactoryv11/types.go backend/internal/batchfactoryv11/memory_store.go backend/internal/batchfactoryv11/mysql_store.go backend/internal/batchfactoryv11/store_test.go backend/internal/httpapi/batch_factory_v11_slice1.go backend/internal/httpapi/batch_factory_v11_slice1_test.go
git commit -m "fix(batch-factory): atomically freeze giant presets on creation"
```

### Task 2: V12 Node route resolves the actual account preset before creation

**Files:**
- Modify: `routes/batch-factory-v12.js:180-430`
- Modify: `routes/batch-factory-v12.test.js`
- Modify: `frontend/src/user/pages/ShuihuoProductionPage.jsx:179-223`
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryCreateModal.jsx:328-430`
- Test: `frontend/src/user/pages/shuihuo/BatchFactoryCreateModal.source.test.js`

**Interfaces:**
- Consumes: V12 `POST /intakes/:intakeId/batches`, owner-scoped `automationPresetStore.get(owner, presetId)`, and the Go `initialBatchSettings` contract.
- Produces: V12 creation response with saved settings; UI only dispatches OCR after that response.

- [ ] **Step 1: Write the failing Node route test**

```js
test('V12 giant intake creation resolves and freezes the owner preset before it reaches Go', async () => {
  const upstream = [];
  const router = createBatchFactoryV12Router({ automationPresetStore: { get: async () => ({ id:'preset-1', name:'全自动', version:2, config:{ textModelId:'text-1' } }) }, fetchImpl: captureUpstream(upstream) });
  const response = await signedRequest(router, 'POST', '/api/batch-factory/v12/intakes/intake-1/batches', { title:'巨量', presetId:'preset-1', giantAutomationPlan:{ runMode:'full_submit' } });
  assert.equal(response.status, 201);
  assert.deepEqual(upstream[0].payload.initialBatchSettings, { textModelId:'text-1' });
  assert.equal(upstream[0].payload.automationPreset.id, 'preset-1');
});
```

- [ ] **Step 2: Run the Node route test to verify RED**

Run: `node --test routes/batch-factory-v12.test.js`

Expected: FAIL because V12 currently forwards the creation request unchanged to V11.

- [ ] **Step 3: Implement the V12 creation boundary**

Add the explicit V12 `POST /intakes/:intakeId/batches` handler before the fallback router. For requests with `presetId`, resolve the owner preset on the server, reject missing/empty presets with `400/404`, build `initialBatchSettings` and `automationPreset`, and forward only the server-built snapshot plus validated plan to Go. For requests without `presetId`, preserve existing non-automation intake behavior.

Update `handleCreateBatch` to pass the automation fields to `createBatchFromIntake`. Remove the browser-side `saveBatchSettings` retry loop from `submitGiantMaterial`; construct the plan before `onCreated`, and dispatch OCR only after its successful response already has a non-empty `settingsState.patch`.

- [ ] **Step 4: Run Node/UI tests to verify GREEN**

Run: `node --test routes/batch-factory-v12.test.js frontend/src/user/pages/shuihuo/BatchFactoryCreateModal.source.test.js`

Expected: PASS; the source test asserts there is no post-create `saveBatchSettings` call and that the saved settings response gates OCR dispatch.

- [ ] **Step 5: Commit**

```bash
git add routes/batch-factory-v12.js routes/batch-factory-v12.test.js frontend/src/user/pages/ShuihuoProductionPage.jsx frontend/src/user/pages/shuihuo/BatchFactoryCreateModal.jsx frontend/src/user/pages/shuihuo/BatchFactoryCreateModal.source.test.js
git commit -m "fix(batch-factory): gate giant OCR on frozen preset creation"
```

### Task 3: Recovery and configuration panels consume the frozen snapshot

**Files:**
- Modify: `routes/batch-factory-v11.js:2014-2044,2089-2110`
- Modify: `test/batch-factory-automation.test.js`
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryUnifiedSettingsModal.jsx:280-340`
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryBookSettingsModal.jsx:296-655`
- Test: `frontend/src/user/pages/shuihuo/BatchFactoryUnifiedSettingsModal.source.test.js`
- Test: `frontend/src/user/pages/shuihuo/BatchFactoryBookSettingsModal.source.test.js`

**Interfaces:**
- Consumes: batch `settingsState.patch.automationPresetSnapshot` and book `sourceMetadata.giantAutomationPlan`.
- Produces: recovery runs from frozen batch settings; configuration modals accurately label source and inheritance.

- [ ] **Step 1: Write the failing recovery test**

```js
test('giant recovery keeps running after the original automation preset is deleted', async () => {
  const setup = recoveryFixture({ savedPlan: { presetId:'deleted-preset', runMode:'full_submit' } });
  setup.batch.settingsState.patch = { textModelId:'text-1', automationPresetSnapshot:{ id:'deleted-preset', version:2 } };
  setup.automationPresets.get = async () => null;
  await setup.controller.runRecovery();
  assert.equal(setup.recoveries.length, 1);
  assert.equal(setup.recoveries[0].configSnapshot.textModelId, 'text-1');
});
```

- [ ] **Step 2: Run the recovery test to verify RED**

Run: `node --test test/batch-factory-automation.test.js --test-name-pattern='original automation preset is deleted'`

Expected: FAIL with `AUTOMATION_PRESET_NOT_FOUND` because recovery currently re-reads the live preset store.

- [ ] **Step 3: Implement snapshot-first recovery and explicit UI labels**

Change recovery and manual `/automation/start` to prefer the complete batch `settingsState.patch` snapshot. A `presetId` is provenance only; it must not be a runtime dependency once a snapshot exists.

In the unified modal, render an info alert when `automationPresetSnapshot` exists: `来源预设：{name} · v{version} · 已冻结`.

In the book modal, retain `effectiveValues(batchPatch, bookPatch)` and add a visible `继承统一配置` alert/tag when the relevant region has no book override. For legacy giant batches with neither snapshot nor settings, render a warning that the old preset was never stored and must be manually selected; never infer or start production.

- [ ] **Step 4: Write and run UI source tests**

```js
test('book configuration shows inherited effective values instead of an unconfigured state', () => {
  assert.match(source, /继承统一配置/);
  assert.match(source, /effectiveValues\(batchPatch, bookPatch\)/);
});
test('unified configuration identifies its frozen automation preset', () => {
  assert.match(source, /automationPresetSnapshot/);
  assert.match(source, /已冻结/);
});
```

Run: `node --test test/batch-factory-automation.test.js frontend/src/user/pages/shuihuo/BatchFactoryUnifiedSettingsModal.source.test.js frontend/src/user/pages/shuihuo/BatchFactoryBookSettingsModal.source.test.js`

Expected: PASS; recovery does not require the original preset and both modals distinguish frozen inheritance from a missing configuration.

- [ ] **Step 5: Commit**

```bash
git add routes/batch-factory-v11.js test/batch-factory-automation.test.js frontend/src/user/pages/shuihuo/BatchFactoryUnifiedSettingsModal.jsx frontend/src/user/pages/shuihuo/BatchFactoryBookSettingsModal.jsx frontend/src/user/pages/shuihuo/BatchFactoryUnifiedSettingsModal.source.test.js frontend/src/user/pages/shuihuo/BatchFactoryBookSettingsModal.source.test.js
git commit -m "fix(batch-factory): retain and show frozen automation settings"
```

### Task 4: Full verification, integration and incremental public acceptance

**Files:**
- Verify: all files from Tasks 1–3
- Verify: `docs/superpowers/specs/2026-10-02-giant-automation-preset-durability-design.md`

**Interfaces:**
- Consumes: committed Task 1–3 changes.
- Produces: an exact V88 SHA and a public non-model acceptance result.

- [ ] **Step 1: Run targeted Node tests**

Run: `NODE_PATH=/Users/ming/Documents/ChatGPT/一战晟铭/node_modules node --test routes/batch-factory-v12.test.js test/batch-factory-automation.test.js frontend/src/user/pages/shuihuo/BatchFactoryCreateModal.source.test.js frontend/src/user/pages/shuihuo/BatchFactoryUnifiedSettingsModal.source.test.js frontend/src/user/pages/shuihuo/BatchFactoryBookSettingsModal.source.test.js`

Expected: all selected tests pass.

- [ ] **Step 2: Run targeted Go tests and frontend build**

Run: `cd backend && go test ./internal/batchfactoryv11 ./internal/httpapi -count=1`

Run: `npm --prefix frontend run build`

Expected: both commands exit 0.

- [ ] **Step 3: Inspect, commit and merge to V88**

```bash
git diff --check
git status --short
git log --oneline origin/v88..HEAD
git push origin HEAD:v88
```

Expected: only the planned files are present; `v88` receives the exact verified SHA.

- [ ] **Step 4: Incrementally deploy only affected application services**

Deploy the exact V88 SHA through the approved direct ECS path. Update/restart Node and Go only if their respective committed code changed; retain all Docker infrastructure and persistent volumes. Verify `/api/build-info` reports the new SHA.

- [ ] **Step 5: Public non-model acceptance**

Create a disposable, no-OCR/no-model intake using a saved test preset and verify through the authenticated V12 API that the returned batch has `settingsState.patch.automationPresetSnapshot`, the stored batch settings survive a fresh `GET`, and a book reads the same effective settings. Delete only that explicitly created disposable batch after verification.

- [ ] **Step 6: Record release evidence**

Report the Git SHA, previous SHA, exact service(s) restarted, targeted test/build outputs, and the authenticated persistence readback. Do not claim giant OCR or video generation as verified by this no-model test.

