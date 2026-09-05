# 统一小说工作台与批量工厂实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `v88` 上把批量工厂升级为真实可执行的单本/批量小说生产工作台，统一后台提示词、内容幅度、编剧/导演/发布阶段、中文界面和帮助说明。

**Architecture:** 以服务端单本执行单元为唯一业务入口。服务端计算每本书的内容窗口、读取后台提示词、持久化编剧结果和视频任务；批量接口只接收书籍 ID 列表并调用相同的单本服务。前端负责选择范围、显示工作台、发起动作和呈现持久化状态，不在浏览器重新截取正文、拼接权威提示词或推断发布成功。

**Tech Stack:** Go V11 HTTP API、Go MySQL store、Node/Express 121 浏览器上传服务、React + Ant Design + Vite、Node `node:test`、Go `testing`、Docker Compose 候选环境。

## Global Constraints

- 所有开发只写在 `v88` 分支；不直接修改 `master`、公网旧容器或正式数据卷。
- 系统默认内容幅度为 5 行；单本书可保存覆盖值，工作台展示和 AI 输入必须使用同一服务端内容窗口。
- 用户可见文本必须是中文；不显示 `Director`、`Director revision`、`VIDEO` 等内部术语，内部 API/数据库字段保持兼容。
- 单本和批量必须调用同一套后台提示词、编剧、视频提交、状态轮询、合成和 121 发布服务。
- 121 发布必须经过真实登录会话、动态配置、用户确认、逐文件回执和后台记录核验；无法验证视频上传接口时，能力保持不可用并显示原因。
- 新功能必须同步更新集中式帮助目录、Obsidian 记录、测试证据和发布证据。
- 遵守 TDD：每个行为先写失败测试，确认失败后再写生产代码。

---

### Task 1: 服务端内容窗口、单本覆盖和小说元数据

**Files:**
- Create: `backend/internal/batchfactoryv11/content_window.go`
- Create: `backend/internal/batchfactoryv11/content_window_test.go`
- Modify: `backend/internal/batchfactoryv11/types.go`
- Modify: `backend/internal/batchfactoryv11/director_service.go`
- Modify: `backend/internal/batchfactoryv11/final_prompt.go`
- Modify: `backend/internal/batchfactoryv11/mysql_store.go`
- Modify: `backend/internal/batchfactoryv11/store_test.go`
- Modify: `backend/internal/httpapi/batch_factory_v11_slice1.go`
- Test: `backend/internal/httpapi/batch_factory_v11_slice1_test.go`

**Interfaces:**
- Produces `const DefaultContentLineLimit = 5`.
- Produces `func ResolveContentWindow(text string, limit int) (preview string, usedLines int, totalLines int, err error)`.
- Produces `func EffectiveContentLineLimit(batchPatch, bookPatch SettingsPatch) (int, error)`.
- Extends the read model with `contentPreview`, `contentLineLimit`, `contentLineCount`, `gender`, `type`, and `sourceLabel`; existing `sourceText` remains available to server code but is not used as the visible workbench body.

- [ ] **Step 1: Write failing content-window tests.**

```go
func TestResolveContentWindowUsesFiveLinesByDefault(t *testing.T) {
    preview, used, total, err := ResolveContentWindow("一\n二\n三\n四\n五\n六", 0)
    if err != nil { t.Fatal(err) }
    if preview != "一\n二\n三\n四\n五" || used != 5 || total != 6 { t.Fatalf("preview=%q used=%d total=%d", preview, used, total) }
}

func TestEffectiveContentLineLimitBookPatchOverridesBatchPatch(t *testing.T) {
    batch := SettingsPatch{"contentLineLimit": json.RawMessage(`5`)}
    book := SettingsPatch{"contentLineLimit": json.RawMessage(`7`)}
    got, err := EffectiveContentLineLimit(batch, book)
    if err != nil || got != 7 { t.Fatalf("got=%d err=%v", got, err) }
}
```

- [ ] **Step 2: Run the focused test to verify the intended failure.**

Run: `go test ./backend/internal/batchfactoryv11 -run 'TestResolveContentWindow|TestEffectiveContentLineLimit' -count=1`

Expected: FAIL because the content-window functions and fields do not exist.

- [ ] **Step 3: Implement deterministic server-side slicing.**

Normalize CRLF/CR to LF, split on logical newlines, discard trailing empty lines and consecutive blank lines, clamp the default to 5, reject values below 1 or above 10,000 with `ErrInvalid`, and return the full logical line count. Do not count browser visual wrapping.

Add the effective fields to `Book` and have the batch read path decorate each book from batch/book settings before JSON serialization. Derive `gender`, `type`, and `sourceLabel` from `SourceMetadata` using stable aliases (`gender`, `style`, `type`, `platformName`, `sourceType`) without inventing values. Add `contentLineLimit: 5` to the server system settings fallback so old batches receive the new default without a migration rewrite.

- [ ] **Step 4: Route all AI contracts through the resolved window.**

Update `snapshotForBook`, `BuildHookContract`, `BuildDirectorContract`, and prompt compilation inputs so the user prompt and source digest use the same `contentPreview`. Keep the original text for source storage and future expansion, but never pass it to the current-window AI action. Add the preview fields to `GET /api/batch-factory/v11/batches/{batchId}` responses.

- [ ] **Step 5: Run focused and existing backend tests.**

Run: `go test ./backend/internal/batchfactoryv11 ./backend/internal/httpapi -run 'TestResolveContentWindow|TestEffectiveContentLineLimit|Test.*Batch.*Slice|Test.*Director|Test.*Prompt' -count=1`

Expected: PASS, including old batches that have no `contentLineLimit` key.

- [ ] **Step 6: Commit the vertical slice.**

```bash
git add backend/internal/batchfactoryv11 backend/internal/httpapi/batch_factory_v11_slice1.go
git commit -m "feat(v88): add server content windows and book metadata"
```

### Task 2: 后台提示词目录与“开启编剧”服务

**Files:**
- Create: `backend/internal/batchfactoryv11/prompt_catalog.go`
- Create: `backend/internal/batchfactoryv11/prompt_catalog_test.go`
- Modify: `backend/internal/batchfactoryv11/types.go`
- Modify: `backend/internal/batchfactoryv11/director_contract.go`
- Modify: `backend/internal/batchfactoryv11/director_service.go`
- Modify: `backend/internal/batchfactoryv11/final_prompt.go`
- Modify: `backend/internal/app/app.go`
- Modify: `backend/internal/httpapi/batch_factory_v11_slice1.go`
- Modify: `backend/internal/httpapi/batch_factory_v11_director.go`
- Modify: `backend/internal/httpapi/batch_factory_v11_director_test.go`
- Test: `backend/internal/batchfactoryv11/director_service_test.go`

**Interfaces:**
- Produces server prompt kinds `hook`, `script`, `asset`, and `video`.
- Produces `type PromptBundle struct { Hook, Script, Asset, Video Prompt }`.
- Produces `func ResolvePromptBundle(ctx context.Context, owner string, effective SettingsPatch) (PromptBundle, error)` using server catalog defaults plus owner-scoped prompt records.
- Keeps existing `/director` route and `directorRevision` JSON field for compatibility; the client-facing action is renamed to “开启编剧”.

- [ ] **Step 1: Write failing prompt-source tests.**

```go
func TestDirectorContractUsesServerPromptBundleAndContentWindow(t *testing.T) {
    bundle := PromptBundle{
        Script: Prompt{ID: "script-test", Kind: "script", Content: "脚本规则：必须保留原文冲突。"},
        Asset:  Prompt{ID: "asset-test", Kind: "asset", Content: "资产规则：人物、场景、道具分别给出稳定提示词。"},
        Video:  Prompt{ID: "video-test", Kind: "video", Content: "视频规则：每个片段给出可拍动作和镜头。"},
    }
    contract, err := BuildDirectorContract(Book{ID: "b1", Title: "测试", SourceText: "前五行"}, HookRevision{}, DirectorSnapshot{Mode: "original", MaxVideoDuration: 15, AspectRatio: "9:16"}, bundle)
    if err != nil { t.Fatal(err) }
    for _, want := range []string{"脚本规则", "资产规则", "视频规则", "前五行"} {
        if !strings.Contains(contract.SystemPrompt+contract.UserPrompt, want) { t.Fatalf("missing %q", want) }
    }
}

func TestPromptCatalogListsChineseAdminLabelsByKind(t *testing.T) {
    records := SystemPromptCatalog()
    for _, kind := range []string{"hook", "script", "asset", "video"} {
        if !hasPromptKind(records, kind) { t.Fatalf("missing kind %s", kind) }
    }
}
```

- [ ] **Step 2: Run the test to confirm the old hard-coded contract fails.**

Run: `go test ./backend/internal/batchfactoryv11 -run 'TestDirectorContractUsesServerPromptBundle|TestPromptCatalogListsChineseAdminLabels' -count=1`

Expected: FAIL because `PromptBundle` and the catalog resolver do not exist and the current contract has embedded rules.

- [ ] **Step 3: Add server-owned prompt definitions and resolution.**

Create stable default prompt IDs and Chinese names in `prompt_catalog.go`. Resolve an explicitly selected prompt ID from `Store.ListPrompts`; when a selected ID is absent, return a typed `ErrNotFound` rather than silently switching to another prompt. When no selection exists, use the server default for that kind. Keep prompt bodies on the Go side and use the existing V11 prompt tables for owner-created versions.

Add settings keys `hookPromptPresetId`, `scriptPromptPresetId`, `assetPromptPresetId`, and `videoPromptPresetId`. Update the settings snapshot and final-prompt source map so each selected prompt ID is recorded and the final compiled prompt remains reproducible.

- [ ] **Step 4: Refactor the director service without changing the public compatibility route.**

Inject the catalog into `DirectorService` and `PromptCompilerService` from `backend/internal/app/app.go`. Replace the hard-coded director body with the resolved bundle; keep schema, JSON validation, duration, aspect ratio, and asset-reference rules in code. Use the content preview from Task 1. Update `DirectorService.RunDirector` and `RunHook` to hash and persist the effective content window.

- [ ] **Step 5: Make batch and single actions share one selected-book executor.**

Add request decoding for optional `bookIds` to `POST /api/batch-factory/v11/batches/{batchId}/director`. An empty list means all books for backward compatibility; a non-empty list is validated against the owner’s batch and runs each selected book through the same `RunDirector` call. Return per-book successes and failures, preserving partial progress.

- [ ] **Step 6: Run prompt and route tests.**

Run: `go test ./backend/internal/batchfactoryv11 ./backend/internal/httpapi -run 'Test.*Prompt|Test.*Director|Test.*Director.*Route' -count=1`

Expected: PASS; tests must prove that the request body contains only the content window and that selected-book requests do not execute unselected books.

- [ ] **Step 7: Commit the prompt and writing stage.**

```bash
git add backend/internal/batchfactoryv11 backend/internal/httpapi backend/internal/app/app.go
git commit -m "feat(v88): route script and asset generation through backend prompts"
```

### Task 3: 直接导入识别与小说列表元数据

**Files:**
- Create: `backend/internal/batchfactoryv11/book_metadata.go`
- Create: `backend/internal/batchfactoryv11/book_metadata_test.go`
- Modify: `backend/internal/batchfactoryv11/intakes.go`
- Modify: `backend/internal/batchfactoryv11/mysql_store.go`
- Modify: `backend/internal/httpapi/batch_factory_v11_slice1.go`
- Modify: `frontend/src/user/pages/batch-factory-v11/BatchFactoryV11BatchManager.jsx`
- Modify: `frontend/src/shared/api/batchFactoryV11.js`
- Test: `backend/internal/httpapi/batch_factory_v11_slice1_test.go`
- Test: `frontend/src/user/pages/batch-factory-v11/manualImportApiContract.test.js`

**Interfaces:**
- Produces `POST /api/batch-factory/v11/intakes/manual/classify` with `{books:[{title,sourceText,bookId}]}` and returns per-book `{gender,type,status,reason}`.
- Produces `POST /api/batch-factory/v11/intakes/manual` behavior that only runs classification when `metadata.manualMetadataRecognitionEnabled === true`.
- Keeps fetched metadata untouched and preserves manual import source labels.

- [ ] **Step 1: Write failing classification tests.**

```go
func TestManualMetadataRecognitionIsDisabledByDefault(t *testing.T) {
    got, err := ClassifyManualBookMetadata(context.Background(), fakeClassifier{}, ManualBookMetadataInput{Title: "测试", Text: "正文"}, false)
    if err != nil { t.Fatal(err) }
    if got.Status != "未识别" { t.Fatalf("status=%s", got.Status) }
}

func TestManualMetadataRecognitionPersistsGenderAndTypeWhenEnabled(t *testing.T) {
    got, err := ClassifyManualBookMetadata(context.Background(), fakeClassifier{result: `{"gender":"女频","type":"现代言情"}`}, ManualBookMetadataInput{Title: "测试", Text: "正文"}, true)
    if err != nil || got.Gender != "女频" || got.Type != "现代言情" || got.Status != "已识别" { t.Fatalf("got=%+v err=%v", got, err) }
}
```

- [ ] **Step 2: Run focused tests and observe failure.**

Run: `go test ./backend/internal/batchfactoryv11 ./backend/internal/httpapi -run 'TestManualMetadataRecognition' -count=1`

Expected: FAIL because the manual metadata classifier and setting gate do not exist.

- [ ] **Step 3: Implement classification using the existing server AI/provider boundary.**

Use a strict JSON contract with `gender` and `type`; accept only configured platform/gender/type values, persist the result in `SourceMetadata`, and save an explicit error/status for malformed or unavailable AI responses. The disabled path must not call the provider. Fetched books keep the metadata already supplied by the novel-fetch intake.

- [ ] **Step 4: Expose and render the six list fields.**

Extend the V11 batch read model with normalized values for title, gender, book ID, type, source, and status. Add the manual setting to the batch intake form and show “未识别 / 识别失败 / 已识别” rather than empty fake values. Update API contract tests for both fetched and direct-import books.

- [ ] **Step 5: Run backend and frontend focused tests.**

Run: `go test ./backend/internal/batchfactoryv11 ./backend/internal/httpapi -run 'TestManualMetadata|Test.*Intake' -count=1` and `npm test -- --test-name-pattern='manual|intake'` from `frontend`.

Expected: PASS with classification disabled and enabled branches covered.

- [ ] **Step 6: Commit metadata support.**

```bash
git add backend/internal/batchfactoryv11 backend/internal/httpapi frontend/src/shared/api/batchFactoryV11.js frontend/src/user/pages/batch-factory-v11/BatchFactoryV11BatchManager.jsx
git commit -m "feat(v88): expose book metadata and optional manual classification"
```

### Task 4: 选中范围的编剧、导演和任务幂等执行

**Files:**
- Modify: `backend/internal/batchfactoryv11/production.go`
- Modify: `backend/internal/batchfactoryv11/production_test.go`
- Modify: `backend/internal/httpapi/batch_factory_v11_production.go`
- Modify: `backend/internal/httpapi/batch_factory_v11_production_test.go`
- Modify: `frontend/src/shared/api/batchFactoryV11.js`
- Modify: `frontend/src/user/pages/batch-factory-v11/bf11UiAdapter.js`
- Modify: `frontend/src/user/pages/batch-factory-v11/bf11Runtime.js`
- Create: `frontend/src/user/pages/batch-factory-v11/selectionState.js`
- Create: `frontend/src/user/pages/batch-factory-v11/selectionState.test.js`

**Interfaces:**
- Extends `POST /api/batch-factory/v11/batches/{batchId}/production` input with optional `bookIds`; empty means all books.
- Produces `SubmitBatchProductionForBooks(ctx, owner, batchID, requestID, provider, bookIDs)` while retaining the old all-books wrapper.
- Produces selection helpers `toggleBookSelection`, `toggleAllBooks`, `selectedBookIds`, and `selectionScopeLabel`.

- [ ] **Step 1: Write failing selected-production and selection tests.**

```go
func TestSubmitBatchProductionForBooksSkipsUnselectedBooks(t *testing.T) {
    status, err := service.SubmitBatchProductionForBooks(ctx, "alice", batch.ID, "request-1", "personal_api", []string{batch.Books[0].ID})
    if err != nil { t.Fatal(err) }
    for _, job := range status.Jobs {
        if job.BookID != batch.Books[0].ID { t.Fatalf("unexpected job for %s", job.BookID) }
    }
}
```

```js
test('selection state supports one book, all books, and filtered scope', () => {
  const books = [{ id: 'b1' }, { id: 'b2' }, { id: 'b3' }];
  assert.deepEqual(toggleBookSelection([], 'b2'), ['b2']);
  assert.deepEqual(toggleAllBooks([], books), ['b1', 'b2', 'b3']);
  assert.equal(selectionScopeLabel(['b2'], books), '已选 1 本');
});
```

- [ ] **Step 2: Run tests and verify failure.**

Run: `go test ./backend/internal/batchfactoryv11 ./backend/internal/httpapi -run 'TestSubmitBatchProductionForBooks' -count=1` and `npm test -- --test-name-pattern='selection state'` from `frontend`.

Expected: FAIL because production has only the all-books operation and selection helpers do not exist.

- [ ] **Step 3: Add owner-validated selected-book production.**

Implement the new service method by validating requested IDs against the loaded batch, calling the existing idempotent `SubmitBookProductionWithProvider` for each selected book, retaining successful/running task protection, and returning partial failures in a batch status response. Do not submit a second task for a video already queued, running, or succeeded for the active revision.

- [ ] **Step 4: Wire the selected IDs through the API and runtime.**

Update the production request decoder, API client, adapter, and runtime action result. Keep request IDs stable per batch action and append the book ID only inside the server service so repeated clicks remain idempotent.

- [ ] **Step 5: Add the shared selection state module and tests.**

Use stable book IDs, preserve order from the displayed list, prune IDs removed by a reload, and distinguish “已选范围” from “全部范围”. This module must not send source text to the server.

- [ ] **Step 6: Run production regression tests and commit.**

Run: `go test ./backend/internal/batchfactoryv11 ./backend/internal/httpapi -run 'Test.*Production|TestSubmitBatchProductionForBooks' -count=1` and `npm test` from `frontend`.

```bash
git add backend/internal/batchfactoryv11 backend/internal/httpapi frontend/src/shared/api/batchFactoryV11.js frontend/src/user/pages/batch-factory-v11
git commit -m "feat(v88): add selected-book stage execution"
```

### Task 5: 121 正文与视频发布适配

**Files:**
- Modify: `backend/internal/batchfactoryv11/external/types.go`
- Modify: `backend/internal/httpapi/batch_factory_v11_external.go`
- Modify: `backend/internal/batchfactoryv11/external/provider.go`
- Modify: `backend/internal/batchfactoryv11/external/publish_authority_test.go`
- Modify: `routes/batch-factory-v11.js`
- Create: `routes/batch-factory-v11-121.js`
- Modify: `lib/novel-fetch-workshop/121-web-submit-service.js`
- Modify: `lib/target-upload.js`
- Create: `tests/batch-factory-v11-121-publish.test.js`
- Modify: `frontend/src/shared/api/batchFactoryV11.js`
- Modify: `frontend/src/user/pages/batch-factory-v11/ExternalPublishPanel.jsx`
- Modify: `frontend/src/user/pages/batch-factory-v11/externalState.js`

**Interfaces:**
- Extends publish intent input with owner-validated `bookIds` while keeping browser-supplied media URLs non-authoritative.
- Produces an internal Node 121 adapter that reuses the existing logged-in browser session, upload profile selection, retry, receipt parsing, and remote record verification.
- Produces explicit statuses `已提交`, `待确认`, `已确认`, `失败`; only `已确认` is a terminal publish-success status.

- [ ] **Step 1: Establish the real 121 video upload contract before implementation.**

Use the existing authenticated 121 browser session and the current novel-fetch upload service to inspect the exact request path, multipart field names, file naming rule, response fields, and record-verification path for adding a video artifact. Record the observed contract in `tests/batch-factory-v11-121-publish.test.js` as a fixture. If the current target endpoint accepts only TXT and exposes no video field/API, keep `publish.121` unavailable with the server reason `121 视频上传接口尚未验证`; do not send guessed fields.

- [ ] **Step 2: Write failing authority and state tests.**

```go
func TestCreateIntentAcceptsSelectedBooksButRejectsUnselectedBooks(t *testing.T) {
    intent, err := service.CreateIntentForBooks(ctx, "alice", "121", "batch-1", []string{"book-1"}, payloadWithBooks("book-1"))
    if err != nil || intent.BookID != "" { t.Fatalf("intent=%+v err=%v", intent, err) }
    _, err = service.CreateIntentForBooks(ctx, "alice", "121", "batch-1", []string{"book-1"}, payloadWithBooks("book-2"))
    if !errors.Is(err, ErrConflict) { t.Fatalf("expected conflict, got %v", err) }
}
```

```js
test('publish state does not call a successful terminal state for pending remote verification', () => {
  assert.equal(nextSubmissionState({ phase: 'submitting' }, { status: 'accepted_pending' }).phase, 'awaiting-confirmation');
});
```

- [ ] **Step 3: Add selected-book intent authority.**

Pass an explicit selected ID set into `CreateIntent`; have server-side payload normalization require exactly those books, use only owner-scoped successful video/merge artifacts, reject duplicates and missing videos, and bind the digest to selected IDs, prompt hashes, and publish settings. Preserve the existing confirmation-before-submit rule.

- [ ] **Step 4: Reuse the novel-fetch 121 session service for book and video artifacts.**

Add a Node route behind the V11 proxy that resolves the account’s existing 121 browser session and upload profiles, builds the exact observed multipart body, submits TXT plus verified video files/URLs according to the observed contract, retries only safe failures, parses the remote receipt, and runs the existing remote-record check. Do not expose credentials or cookies to the browser or Go response.

- [ ] **Step 5: Wire publish scope and status into the panel.**

Replace the generic “上传待上传 / 外部发布” copy with Chinese 121 wording. Display selected-book count, TXT/video file count, target profile, confirmation digest, per-book result, and a recheck button for `待确认`. Disable submission when login, profile, successful video, or verified upload capability is missing.

- [ ] **Step 6: Run adapter tests against fixtures and commit only verified behavior.**

Run: `npm test -- --test-name-pattern='121|publish'` from `frontend`, `node --test tests/batch-factory-v11-121-publish.test.js`, and `go test ./backend/internal/batchfactoryv11/external ./backend/internal/httpapi -run 'Test.*Publish|Test.*Intent' -count=1`.

Expected: all simulated branches pass; a missing/unverified video API remains unavailable rather than falsely successful.

```bash
git add backend/internal/batchfactoryv11/external backend/internal/httpapi routes lib tests frontend/src/shared/api/batchFactoryV11.js frontend/src/user/pages/batch-factory-v11
git commit -m "feat(v88): bind selected publish intents to verified 121 artifacts"
```

### Task 6: 前端提示词、内容幅度和中文工作台

**Files:**
- Create: `frontend/src/user/pages/batch-factory-v11/batchFactoryHelp.js`
- Create: `frontend/src/user/pages/batch-factory-v11/HelpButton.jsx`
- Create: `frontend/src/user/pages/batch-factory-v11/batchFactoryHelp.test.js`
- Modify: `frontend/src/user/pages/batch-factory-v11/BatchFactoryV11Workbench.jsx`
- Modify: `frontend/src/user/pages/batch-factory-v11/BatchFactoryV11SettingsDrawers.jsx`
- Modify: `frontend/src/user/pages/batch-factory-v11/BatchFactoryV11ScopedSettings.jsx`
- Modify: `frontend/src/user/pages/batch-factory-v11/BatchFactoryV11BatchManager.jsx`
- Modify: `frontend/src/user/pages/batch-factory-v11/DirectorPanel.jsx`
- Modify: `frontend/src/user/pages/batch-factory-v11/HookReviewPanel.jsx`
- Modify: `frontend/src/user/pages/batch-factory-v11/FinalPromptPreviewDrawer.jsx`
- Modify: `frontend/src/user/pages/batch-factory-v11/OverrideCompatibilityDetails.jsx`
- Modify: `frontend/src/user/pages/batch-factory-v11/batchFactoryV11State.js`
- Modify: `frontend/src/user/pages/batch-factory-v11/detail-ui-source.test.js`
- Modify: `frontend/src/user/pages/batch-factory-v11/workbench-source.test.js`
- Modify: `frontend/src/user/pages/batch-factory-v11/v11-ui-source-guard.test.js`
- Modify: `frontend/src/user/pages/batch-factory-v11/batch-factory-v11-theme.css`

**Interfaces:**
- `batchFactoryHelp.js` exports one entry for every visible navigation/card key and `getHelpEntry(key)`.
- `HelpButton` renders an accessible `?` button and a Chinese popover/drawer from the registry.
- The workbench receives `onRunWriter`, `onRunVideo`, and `onOpenPublish` callbacks with `{scope:'selected'|'all', bookIds}`.

- [ ] **Step 1: Write failing help and naming tests.**

```js
test('help registry covers every workbench navigation key', () => {
  for (const key of ['book-list', 'source', 'writer', 'assets', 'videos', 'production', 'publish', 'merge']) {
    const entry = getHelpEntry(key);
    assert.ok(entry?.title && entry?.steps?.length, key);
  }
});

test('visible V11 labels contain no internal English workflow names', () => {
  const source = fs.readFileSync(path.join(here, 'BatchFactoryV11Workbench.jsx'), 'utf8');
  assert.doesNotMatch(source, />[^<]*(Director revision|Director|VIDEO)[^<]*</);
});
```

- [ ] **Step 2: Run tests to confirm the current English labels and missing help fail.**

Run: `npm test -- --test-name-pattern='help registry|visible V11 labels'` from `frontend`.

Expected: FAIL because the current page contains visible English labels and no complete help registry.

- [ ] **Step 3: Add the centralized help registry and accessible buttons.**

Define help entries for source content, content amplitude, writer, hook review, assets, video prompts, video generation, merge, and 121 publish. Add a `?` icon to every card header and every collapsible workbench navigation label. The popover must include purpose, prerequisites, exact steps, success state, and retry path; use `aria-label`, keyboard focus, and a button rather than a decorative icon.

- [ ] **Step 4: Translate all visible V11 text without changing internal contracts.**

Use “导演分镜”“导演分镜版本”“视频片段”“视频片段编号”“视频设置”“生成导演分镜”等中文 labels. Translate helper descriptions, preview labels, error copy, buttons, empty states, loading text, and capability reasons shown to users. Leave route paths, JSON keys, test fixture field names, and Go identifiers unchanged.

- [ ] **Step 5: Add content amplitude controls.**

In `ProductionSettingsDrawer`, add a number field labeled “内容幅度”，defaulting to 5 and saving `contentLineLimit` at batch scope. In `BookSettingsModal`, add a number field labeled “本书内容幅度”，with “跟随统一设置” restore behavior and revision-aware save. In the source panel display `book.contentPreview`, the used line count, and the effective source label; never slice `book.sourceText` in React.

- [ ] **Step 6: Load prompt choices from the backend.**

Add `listPrompts(kind)` to the API client and runtime. Replace hardcoded prompt option arrays with server-returned Chinese names/IDs. Show prompt source and version in the settings drawer; when the server catalog fails, disable the selector and explain that no local fallback will be used.

- [ ] **Step 7: Run front-end focused tests and build.**

Run: `npm test` and `npm run build` from `frontend`.

Expected: PASS; build warnings may remain only for existing non-blocking brand assets or chunk size notices, not for unresolved imports or runtime errors.

- [ ] **Step 8: Commit the Chinese UI and help system.**

```bash
git add frontend/src/user/pages/batch-factory-v11 frontend/src/shared/api/batchFactoryV11.js
git commit -m "feat(v88): add Chinese workbench help and content controls"
```

### Task 7: 小说列表选择与三个动作入口

**Files:**
- Modify: `frontend/src/user/pages/batch-factory-v11/BatchFactoryV11Workbench.jsx`
- Modify: `frontend/src/user/pages/batch-factory-v11/BatchFactoryV11UiPage.jsx`
- Modify: `frontend/src/user/pages/batch-factory-v11/bf11Runtime.js`
- Modify: `frontend/src/user/pages/batch-factory-v11/bf11UiAdapter.js`
- Modify: `frontend/src/user/pages/batch-factory-v11/ExternalPublishPanel.jsx`
- Modify: `frontend/src/user/pages/batch-factory-v11/batch-factory-v11-workbench.css`
- Create: `frontend/src/user/pages/batch-factory-v11/stageActionState.js`
- Create: `frontend/src/user/pages/batch-factory-v11/stageActionState.test.js`
- Test: `frontend/src/user/pages/batch-factory-v11/live-wiring-source.test.js`

**Interfaces:**
- `stageActionState({scope, books, capabilities})` returns `{disabled, reason, readyBookIds}` for writer, video, and publish actions.
- `runWriter({batchId, bookIds})` calls the compatibility `/director` endpoint with selected IDs.
- `runVideo({batchId, bookIds, provider})` calls selected production.
- `openPublish({batchId, bookIds})` opens the real confirmation panel with the selected scope.

- [ ] **Step 1: Write failing stage readiness tests.**

```js
test('writer is enabled for selected books with source windows', () => {
  const state = stageActionState({ scope: 'selected', books: [{ id: 'b1', contentPreview: '前五行' }], capabilities: { 'director.run': { available: true } } });
  assert.equal(state.writer.disabled, false);
});

test('video requires a generated script and publish requires completed media', () => {
  const state = stageActionState({ scope: 'selected', books: [{ id: 'b1', contentPreview: '前五行', directorRevision: null, videos: [] }], capabilities: {} });
  assert.equal(state.video.disabled, true);
  assert.equal(state.publish.disabled, true);
});
```

- [ ] **Step 2: Run the tests and confirm missing action state fails.**

Run: `npm test -- --test-name-pattern='writer is enabled|video requires'` from `frontend`.

Expected: FAIL because the stage action state module and selected scope are absent.

- [ ] **Step 3: Implement the list without changing its list form.**

Keep one row per book. Put the checkbox at the start of each row and display exactly the required fields: book name, gender, book ID, type, source, and status. Preserve the current click-to-open behavior on the non-checkbox area, add all/none controls, and show the selected count. Use stable IDs and keep selection after a reload when the ID still exists.

- [ ] **Step 4: Add the three action groups.**

Add “开启编剧”“开启导演”“开启发布” controls, each with “已选小说” and “全部小说” scope options. “开启编剧” calls the selected writer endpoint; “开启导演” uses the selected production endpoint and current video settings; “开启发布” opens the selected 121 confirmation panel. Every action shows a confirmation dialog for multiple books and reports per-book failures without hiding successes.

- [ ] **Step 5: Connect single-book workbench actions.**

Make the current selected book use the same writer and production callbacks as the batch buttons. Editing a book’s content window, asset prompt, video prompt, or video settings reloads the book and keeps the same action state. Single-book buttons must not call a separate legacy batch-factory API.

- [ ] **Step 6: Run wiring tests and build.**

Run: `npm test` and `npm run build` from `frontend`.

Expected: PASS with source guards confirming that all actions use the V11 API client and that no showcase data or legacy batch route is used.

- [ ] **Step 7: Commit the executable workbench actions.**

```bash
git add frontend/src/user/pages/batch-factory-v11
git commit -m "feat(v88): add selectable writer video and publish actions"
```

### Task 8: Obsidian 记录、全量回归和候选公网验收

**Files:**
- Create: `/Users/ming/Documents/Obsidian Vault/剧本设计思维资料库/Memory/Decisions/2026-09-06-qiantie批量工厂统一工作台与内容幅度.md`
- Create: `/Users/ming/.codex/memories/extensions/ad_hoc/notes/2026-09-06-qiantie-unified-batch-workbench.md`
- Create: `docs/superpowers/handoffs/2026-09-06-unified-batch-workbench-handoff.md`

**Interfaces:**
- Obsidian decision note records the confirmed user workflow, default 5-line behavior, single-book override, backend prompt rule, list fields, three stage actions, and 121 acceptance boundary.
- Handoff records exact commits, tests, candidate image digests, public URL, and any capability left unavailable.

- [ ] **Step 1: Add memory records after implementation evidence exists.**

Use the Obsidian project template style and do not include credentials, cookies, API keys, raw prompt secrets, or user-private content. State clearly that “内容幅度” counts logical source lines and defaults to 5, and that a saved 6/7-line book override changes both visible source and AI input.

- [ ] **Step 2: Run the full local test matrix.**

Run from the repository root with each tool's module directory:

```bash
(cd backend && go test ./...)
npm test --prefix frontend
npm run build --prefix frontend
```

Also run the V11 migration tests against a temporary MySQL 8.4 instance, including fresh schema, partial upgrade, rerun, and restart recovery. Existing unrelated baseline failures must be reported separately instead of being called green.

- [ ] **Step 3: Run isolated authenticated workflow checks.**

Create a temporary batch with one direct-import book and one fetched book. Verify: default 5-line preview, single-book change to 6 then 7 lines, prompt selection from backend, single writer action, selected writer action, selected video action, refresh recovery, one provider failure retry, and publish confirmation. For 121, verify login/session, profile/style resolution, TXT receipt, video receipt if the endpoint is verified, remote record lookup, and `待确认` behavior.

- [ ] **Step 4: Build and publish only the candidate V11 images.**

Build from the clean `v88` worktree, pin immutable image digests, preserve old images and volumes, and deploy to the isolated V11 candidate Compose project. Do not make ECS perform an uncached full build and do not remove old images as cleanup.

- [ ] **Step 5: Verify public evidence before claiming release.**

Confirm the formal `/batch-factory` entry, served frontend bundle, Go and Node image digests, migration state, authenticated batch read, one real writer action, one real selected video submission, refresh persistence, and verified 121 result. If any external video or 121 step is unavailable, report the exact blocked capability and keep the public capability disabled.

- [ ] **Step 6: Commit documentation and handoff evidence.**

```bash
git add docs/superpowers/handoffs docs/superpowers/specs
git commit -m "docs(v88): record unified workbench verification evidence"
```

## Plan self-review

- Spec coverage: content window and per-book override are Task 1 and Task 6; backend prompts are Task 2; direct import metadata is Task 3; selected single/batch execution is Tasks 4 and 7; 121 is Task 5; help and Chinese labels are Task 6; Obsidian and release evidence are Task 8.
- Placeholder scan: no implementation step relies on an unspecified fallback; the 121 task explicitly treats an unverified remote contract as unavailable instead of inventing it.
- Type consistency: selected IDs are `[]string` in Go request/service boundaries and `string[]` in the frontend; content setting key is `contentLineLimit`; visible preview field is `contentPreview`; action names are `runWriter`, `runVideo`, and `openPublish`.
- Scope check: all tasks belong to one vertical workbench capability and each task has its own red/green test cycle and commit boundary.
