# 小说获取统一运行时 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变公网小说获取视觉布局和既有功能的条件下，将后台模型目录变为唯一模型来源，并收口为一条可审计的执行链路。

**Architecture:** Node 负责模型目录解析、AI 编排和 121 服务端会话；Go 负责账户级 MySQL 配置、运行记录和迁移状态。先以兼容 UI 接入正式 `/api/novel-fetch/*`，逐项验证原有行为，再删除 iframe、`batch-rewrite` 与 V78 补丁资产。

**Tech Stack:** Node.js/Express, React/Ant Design, Go `net/http`, MySQL, node:test, Go testing, V88 Direct Stage/Cutover.

## Global Constraints

- 唯一维护线为 `v88`；每项完成后提交到 `codex/novel-fetch-unified-runtime`，经审查后合入 `v88`。
- `/novel-fetch` 的当前深色布局、六个栏目、任务表、真实日期筛选、批量操作、121、知识库、规则入口不得回退。
- 所有 AI 阶段只接受后台模型目录 ID；禁止读取或回退 `ai.model`、`ai_presets`、`ai_assignments`。
- API Key、Cookie、密码和完整认证头不可返回浏览器、不可写入审计日志。
- 原始全文 `originalRaw`、处理正文、现有任务、AI 版本和 121 会话必须保留。
- 日常发布使用 V88 Direct Stage -> Cutover；不得用旧 Docker/GHCR 发布入口。

---

### Task 1: Freeze the public contract and add model-resolution guardrails

**Files:**
- Create: `test/novel-fetch-model-resolution.test.js`
- Create: `test/novel-fetch-public-contract.test.js`
- Modify: `lib/model-catalog-runtime.js`
- Modify: `routes/novel-fetch.js`
- Modify: `routes/novel-fetch.test.js` (or create `test/novel-fetch-router.test.js` if no router test exists)

**Interfaces:**
- Produces `resolveNovelFetchTextModel({ username, textModelId, memberStore, configReader }) -> { id, displayName, modelId, baseUrl, credential, ownerUsername }`.
- Produces stable errors `NOVEL_FETCH_TEXT_MODEL_REQUIRED` and `NOVEL_FETCH_TEXT_MODEL_UNAVAILABLE`.
- Consumed by tasks 2 and 3; no caller is allowed to supply a raw model name or credential.

- [ ] **Step 1: Write failing resolution tests**

```js
test('uses the catalog entry identified by textModelId instead of legacy ai.model', () => {
  const model = resolveNovelFetchTextModel({
    username: 'alice', textModelId: 'gemini-3', memberStore, configReader
  });
  assert.equal(model.id, 'gemini-3');
  assert.equal(model.modelId, 'gemini-3');
  assert.notEqual(model.modelId, 'Gemini-3.8-flash');
});

test('rejects missing, disabled, and unknown text model ids without fallback', () => {
  assert.throws(() => resolveNovelFetchTextModel({ username: 'alice', textModelId: '' , memberStore, configReader }), { code: 'NOVEL_FETCH_TEXT_MODEL_REQUIRED' });
  assert.throws(() => resolveNovelFetchTextModel({ username: 'alice', textModelId: 'flash-disabled', memberStore, configReader }), { code: 'NOVEL_FETCH_TEXT_MODEL_UNAVAILABLE' });
});
```

- [ ] **Step 2: Run red tests**

Run: `node --test test/novel-fetch-model-resolution.test.js`

Expected: FAIL because `resolveNovelFetchTextModel` does not exist.

- [ ] **Step 3: Add the smallest dedicated resolver**

Implement the resolver in `lib/model-catalog-runtime.js` using `resolveRuntimeModel` with kind `text`. Reject blank IDs before resolution. Map generic catalog errors to the two Novel Fetch error codes while preserving safe user-facing messages. Return only the resolved catalog entry; do not inspect `ai`, presets, or assignments.

- [ ] **Step 4: Add public contract tests before UI migration**

```js
test('Novel Fetch has one public route and does not render the legacy iframe', () => {
  const page = read('frontend/src/user/pages/NovelFetchPage.jsx');
  assert.doesNotMatch(page, /<iframe/);
  assert.doesNotMatch(page, /batch-rewrite/);
});

test('the formal client calls only /api/novel-fetch paths', () => {
  const source = read('frontend/src/shared/api/novelFetch.js');
  assert.doesNotMatch(source, /\/api\/(batch-rewrite|novel-fetch-workshop)/);
});
```

Keep these tests failing until task 4; they establish the final contract and prevent temporary compatibility from being mistaken for completion.

- [ ] **Step 5: Run green resolution tests and existing model tests**

Run: `node --test test/novel-fetch-model-resolution.test.js routes/config.test.js`

Expected: PASS; the public-contract test remains intentionally failing until task 4.

- [ ] **Step 6: Commit**

```bash
git add lib/model-catalog-runtime.js test/novel-fetch-model-resolution.test.js test/novel-fetch-public-contract.test.js
git commit -m "feat: resolve novel fetch models from catalog"
```

### Task 2: Persist a normalized config and audited runs in Go

**Files:**
- Modify: `backend/internal/storage/novel_fetch_workshop_schema.go`
- Modify: `backend/internal/novelfetchworkshop/store.go`
- Modify: `backend/internal/novelfetchworkshop/mysql_store.go`
- Modify: `backend/internal/httpapi/novel_fetch_workshop.go`
- Modify: `backend/internal/httpapi/novel_fetch_workshop_test.go`

**Interfaces:**
- Config contains only `textModelId` and non-secret Novel Fetch settings.
- `RunRecord` stores owner, run ID, book ID, stage, status, attempts, `textModelId`, resolved model display name/model ID, timestamps, safe error and request ID.
- Go bridge exposes signed `GET/PUT /api/novel-fetch-workshop/config` and `GET/POST /api/novel-fetch-workshop/runs` for Node internal use only.

- [ ] **Step 1: Write failing Go tests for audit persistence**

```go
func TestRunAuditPersistsSelectedAndResolvedModelWithoutCredential(t *testing.T) {
    // write a run record, reload it, assert ids/names survive and serialized JSON lacks api_key/cookie.
}
```

- [ ] **Step 2: Run red Go tests**

Run: `go test ./internal/novelfetchworkshop ./internal/httpapi -run TestRunAudit -count=1`

Expected: FAIL because run types and bridge routes do not exist.

- [ ] **Step 3: Add schema migration and store methods**

Add a new monotonic migration version. Create owner-scoped run/audit storage with indexes on owner/run/stage/time. Extend the store interface with put/list run methods. Preserve the existing JSON config row and documents; write normalized fields into settings JSON and migration metadata rather than deleting legacy data in-place.

- [ ] **Step 4: Implement signed internal run endpoints and run tests**

Add bridge-authenticated endpoints only; validate owner from the signature, reject empty stage/model values, redact sensitive fields before storage, and test cross-owner isolation plus invalid signatures.

- [ ] **Step 5: Run Go regression suite**

Run: `go test ./internal/novelfetchworkshop ./internal/httpapi ./internal/storage -count=1`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/storage/novel_fetch_workshop_schema.go backend/internal/novelfetchworkshop backend/internal/httpapi/novel_fetch_workshop.go backend/internal/httpapi/novel_fetch_workshop_test.go
git commit -m "feat: persist novel fetch runs and normalized config"
```

### Task 3: Make Node execute all AI stages through the catalog resolver

**Files:**
- Create: `lib/novel-fetch-runtime.js`
- Create: `lib/novel-fetch-runtime.test.js`
- Modify: `lib/novel-fetch-workshop/ai.js`
- Modify: `lib/novel-fetch-workshop/classifier.js`
- Modify: `lib/novel-fetch-workshop/rewrite.js`
- Modify: `lib/novel-fetch-workshop/sensitive.js`
- Modify: `routes/novel-fetch.js`

**Interfaces:**
- `createNovelFetchRuntime({ resolveTextModel, auditStore, chatCompletion })` accepts `textModelId` and produces per-stage audit entries.
- `executeStage({ username, textModelId, stage, ... })` resolves the catalog once, builds a provider settings object from it, executes exactly one stage, and persists its audit result.

- [ ] **Step 1: Write failing end-to-end runtime tests**

```js
test('classifier, rewrite and sensitive stages use the same selected catalog model', async () => {
  const calls = [];
  const runtime = createNovelFetchRuntime({ resolveTextModel: () => gemini3, chatCompletion: settings => { calls.push(settings.model); return { text: '{"results":[]}' }; }, auditStore });
  await runtime.executeStage({ username: 'alice', textModelId: 'gemini-3', stage: 'classifier', input });
  await runtime.executeStage({ username: 'alice', textModelId: 'gemini-3', stage: 'rewrite', input });
  await runtime.executeStage({ username: 'alice', textModelId: 'gemini-3', stage: 'sensitive_fix', input });
  assert.deepEqual(calls, ['gemini-3', 'gemini-3', 'gemini-3']);
});

test('a legacy flash field cannot be used as fallback', async () => {
  await assert.rejects(() => runtime.executeStage({ username: 'alice', textModelId: 'missing', stage: 'rewrite', legacyConfig: { ai: { model: 'Gemini-3.8-flash' } } }), { code: 'NOVEL_FETCH_TEXT_MODEL_UNAVAILABLE' });
});
```

- [ ] **Step 2: Run red runtime tests**

Run: `node --test lib/novel-fetch-runtime.test.js`

Expected: FAIL because the unified runtime does not exist.

- [ ] **Step 3: Implement runtime and adapt AI helpers**

Create provider settings only from the resolved catalog model. Leave `ai.js` payload construction as a transport helper, but remove `resolveAiSettings` from all formal Novel Fetch execution paths. Inject the resolved settings into classifier/rewrite/sensitive operations and write queued/running/succeeded/failed audit transitions to the Go bridge. Preserve existing per-book retry semantics: successful stages are skipped and only the last failed stage retries.

- [ ] **Step 4: Add authenticated `/api/novel-fetch` API handlers**

Move formal process/task/retry/audit operations into `routes/novel-fetch.js`; this router alone is mounted publicly. Return `textModelId`, resolved model name and safe audit information. Do not expose credentials or use the old route as a fallback.

- [ ] **Step 5: Run Node regression tests**

Run: `node --test lib/novel-fetch-runtime.test.js test/novel-fetch-model-resolution.test.js test/novel-fetch-workshop-platforms.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/novel-fetch-runtime.js lib/novel-fetch-runtime.test.js lib/novel-fetch-workshop routes/novel-fetch.js
git commit -m "feat: run novel fetch AI through catalog models"
```

### Task 4: Rebuild the formal React workbench behind the frozen public contract

**Files:**
- Modify: `frontend/src/user/pages/NovelFetchPage.jsx`
- Modify: `frontend/src/shared/api/novelFetch.js`
- Create: `frontend/src/shared/api/novelFetch.test.js`
- Create: `frontend/src/user/pages/NovelFetchPage.source.test.js`
- Modify: `frontend/src/user/pages/novel-fetch.css`
- Modify: `app.js`
- Modify: `routes/pages.js`

**Interfaces:**
- Browser calls only `/api/novel-fetch/*`.
- Configuration uses `{ textModelId }` and displays returned `{ textModelId, displayName, modelId }`.
- Six frozen visible areas are `处理`, `任务`, `配置`, `知识库`, `处理规则`, `记录`; 121 submission remains available from task actions/record detail without a removed capability.

- [ ] **Step 1: Write failing UI/API contract tests**

```js
test('configuration uses a catalog-backed text selector and contains no raw credential fields', () => {
  const source = read('frontend/src/user/pages/NovelFetchPage.jsx');
  assert.match(source, /textModelId/);
  assert.match(source, /实际模型/);
  assert.doesNotMatch(source, /api_key|AI 基础接口|当前预设/);
});

test('keeps the frozen navigation labels and task actions', () => {
  for (const label of ['处理', '任务', '配置', '知识库', '处理规则', '记录']) assert.match(source, new RegExp(label));
  for (const label of ['刷新', '重试', '抓原文', '生成AI文案', '提交']) assert.match(source, new RegExp(label));
});
```

- [ ] **Step 2: Run red UI tests**

Run: `node --test frontend/src/user/pages/NovelFetchPage.source.test.js frontend/src/shared/api/novelFetch.test.js test/novel-fetch-public-contract.test.js`

Expected: FAIL because the current page is an iframe and its client uses legacy endpoints.

- [ ] **Step 3: Implement the page without changing its user contract**

Replace the iframe with a React workbench that preserves the frozen navigation, labels, task table fields, date behavior and actions. Port one view at a time in the order configuration -> tasks -> process -> knowledge/rules -> records/121 actions. For each view, use the formal client only and preserve status wording including `分类信息已就绪`, `正在执行中…`, and processed/raw counts. Render model ID and actual model name from server readback; disable AI actions when binding is required.

- [ ] **Step 4: Delete formal reliance on legacy browser assets**

Remove `/batch-rewrite` static mounting and the iframe-only page path after all tests are green. Do not delete Batch Factory files that reference 121 shared services; replace only their accidental references to obsolete static novel-fetch assets with the retained service API where needed.

- [ ] **Step 5: Run frontend build and contract suite**

Run: `node --test frontend/src/user/pages/NovelFetchPage.source.test.js frontend/src/shared/api/novelFetch.test.js test/novel-fetch-public-contract.test.js && npm --prefix frontend run build`

Expected: PASS and the built entry contains no `batch-rewrite` or `v78-` references for Novel Fetch.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/user/pages/NovelFetchPage.jsx frontend/src/user/pages/novel-fetch.css frontend/src/shared/api/novelFetch.js frontend/src/shared/api/novelFetch.test.js frontend/src/user/pages/NovelFetchPage.source.test.js app.js routes/pages.js
git commit -m "feat: replace novel fetch legacy workbench"
```

### Task 5: Migrate, verify, release, and remove the retired public routes

**Files:**
- Create: `scripts/novel-fetch-migrate-config.js`
- Create: `scripts/novel-fetch-migrate-config.test.js`
- Create: `tests/novel-fetch-public-release-contract.test.js`
- Modify: `app.js`
- Modify: `docs/V88_PROJECT_EXECUTION_MEMORY.md`

**Interfaces:**
- `node scripts/novel-fetch-migrate-config.js --dry-run` outputs per-owner counts without writes.
- `node scripts/novel-fetch-migrate-config.js --apply` requires an explicit backup manifest path and writes only normalized model binding/migration status.

- [ ] **Step 1: Write failing migration-script tests**

```js
test('dry run reports binding-required records and performs no writes', async () => {
  const result = await migrate({ dryRun: true, rows: legacyRows, lookup });
  assert.equal(result.updated, 0);
  assert.equal(result.bindingRequired, 1);
});

test('apply is idempotent and never copies legacy credentials', async () => {
  const first = await migrate({ apply: true, rows: legacyRows, lookup });
  const second = await migrate({ apply: true, rows: first.rows, lookup });
  assert.deepEqual(second.rows, first.rows);
  assert.doesNotMatch(JSON.stringify(first.rows), /api_key|credential/i);
});
```

- [ ] **Step 2: Run red migration tests**

Run: `node --test scripts/novel-fetch-migrate-config.test.js`

Expected: FAIL because the migration script does not exist.

- [ ] **Step 3: Implement backup-gated migration and release checks**

Require `--backup-manifest` for apply mode, validate the manifest describes the target MySQL configuration snapshot, and reject apply otherwise. The Node script reads each account model catalog, then applies the four specified outcomes: valid ID retained; unique old raw model mapping selected; ambiguous/missing mapping becomes `model_binding_required`; no API keys/presets/assignments copied into the new execution configuration. Node writes only normalized fields through the signed Go bridge; Go never receives a catalog credential or performs model lookup. Add release-contract tests for no iframe/legacy assets, one API prefix, and model audit fields. Update the execution memory with the formal route, migration command, exact Direct Stage/Cutover order and rollback data boundary.

- [ ] **Step 4: Run full relevant verification**

Run: `node --test test/novel-fetch-model-resolution.test.js test/novel-fetch-public-contract.test.js tests/novel-fetch-public-release-contract.test.js scripts/novel-fetch-migrate-config.test.js && npm --prefix frontend run build && go test ./internal/novelfetchworkshop ./internal/httpapi ./internal/storage -count=1 && git diff --check`

Expected: all commands pass.

- [ ] **Step 5: Stage and verify without cutover**

Run the formal V88 Direct Stage workflow for the exact Git SHA. On stage, take the required account-config/MySQL backup, run migration dry-run, then a limited apply only after counts are reviewed. Verify a logged-in account selects `gemini-3`; run a new task and confirm classifier/rewrite/sensitive audit entries all show `textModelId=gemini-3` and the resolved catalog model, while the visual/function checklist passes.

- [ ] **Step 6: Cut over and externally verify**

Submit the same staged SHA to V88 Direct Cutover. Verify `/api/build-info` exact SHA, authenticated `/novel-fetch` behavior, all frozen UI areas, real dates, task history, and no requests/assets under `/batch-rewrite` or `/api/novel-fetch-workshop`. If any gate fails, roll back the Node SHA and restore only the configuration snapshot named by the manifest.

- [ ] **Step 7: Commit**

```bash
git add scripts/novel-fetch-migrate-config.js scripts/novel-fetch-migrate-config.test.js tests/novel-fetch-public-release-contract.test.js app.js docs/V88_PROJECT_EXECUTION_MEMORY.md
git commit -m "chore: release unified novel fetch runtime"
```

## Plan Self-Review

- Spec coverage: Task 1 covers catalog-only model binding; task 2 covers Go persistence/migration; task 3 covers the three executing AI stages and audit; task 4 covers the frozen UI and removal of public legacy assets; task 5 covers data safety, staged release, cutover and rollback.
- Placeholder scan: no `TODO`, `TBD`, deferred implementation, or unspecified error handling remains.
- Type consistency: all Node callers consume `textModelId`; Go stores audit records; the browser never obtains raw provider credentials.
