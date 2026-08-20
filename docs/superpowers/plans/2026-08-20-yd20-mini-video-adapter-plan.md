# YD2.0 Mini Video Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the server-side YD2.0 Mini one-second image-to-video model, fixed image ordering, public-URL validation, async result retrieval, catalog administration, and batch-video settings.

**Architecture:** A dedicated `yd_video` adapter owns fixed endpoints, `Bearer` credential usage, and `image_urls` ordering. Queued tasks store only public task choices and object keys. The worker resolves object keys to URLs; an adapter-keyed poller restores Vidu and YD jobs without duplicate media.

**Tech Stack:** Go, MySQL, Redis queue, `net/http`, existing object storage, React, Ant Design, Vite, Node test runner.

---

## File Structure

- `backend/internal/shuihuo/models/catalog.go`: adapter declaration and async video classification.
- `backend/internal/shuihuo/providers/async_video.go`: shared poll result and interface.
- `backend/internal/shuihuo/providers/yd.go`: YD HTTP adapter.
- `backend/internal/shuihuo/tasks/worker.go`: immutable video settings and reference URL assembly.
- `backend/internal/shuihuo/tasks/poller.go`: adapter-keyed polling.
- `backend/internal/httpapi/shuihuo_task_handlers.go`: request validation and task snapshots.
- `backend/internal/shuihuo/store/assets.go`: bounded character/prop reference query.
- `backend/internal/shuihuo/store/models.go`, `backend/internal/httpapi/shuihuo_admin_handlers.go`, and admin API/UI: persist stable catalog keys and configure YD.
- `frontend/src/user/pages/shuihuo/BatchTaskModal.jsx`: actual YD ratio selection.
- `frontend/src/user/pages/shuihuo/EngineSettingsModal.jsx`: truthful fixed YD settings display.

### Task 1: Repair stable model catalog creation before adding YD

**Files:**
- Modify: `backend/internal/shuihuo/models/catalog.go`
- Modify: `backend/internal/shuihuo/store/models.go`
- Modify: `backend/internal/httpapi/shuihuo_admin_handlers.go`
- Modify: `frontend/src/shared/api/shuihuoProduction.js`
- Modify: `frontend/src/admin/pages/ShuihuoModelCatalogPage.jsx`
- Test: `backend/internal/shuihuo/models/catalog_test.go`
- Test: `backend/internal/httpapi/shuihuo_handlers_test.go`

- [ ] **Step 1: Write failing catalog tests.** Require a new Vidu video model with `ModelID: "video-vidu-admin"` to validate, and require a posted `modelId` to survive the admin handler and store path. This establishes catalog persistence before the YD adapter exists.

```go
model := Definition{ModelID: "video-vidu-admin", Name: "Vidu", Kind: KindVideo, AdapterKind: AdapterViduImageToVideo, Enabled: true, CredentialRef: "vidu-api-key"}
if err := ValidateDefinition(model); err != nil { t.Fatal(err) }
```

- [ ] **Step 2: Run the focused test and confirm failure.**

Run: `go test ./backend/internal/shuihuo/models ./backend/internal/httpapi -run 'Test.*(ModelID|AdminModel)' -count=1`

Expected: FAIL because `model_key` is not carried from the admin form into `model_definitions`.

- [ ] **Step 3: Persist `modelId`.** Add `ModelID` to `shuihuoAdminModelRequest`, `model_key` to model store selects/scans/inserts, and an admin form field that sends a lower-case kebab-case key.

```go
definition := models.Definition{ModelID: strings.TrimSpace(req.ModelID), Name: strings.TrimSpace(req.Name), Kind: req.Kind, AdapterKind: req.AdapterKind, Enabled: req.Enabled, CredentialRef: strings.TrimSpace(req.CredentialRef)}
```

- [ ] **Step 4: Verify and commit.**

Run: `go test ./backend/internal/shuihuo/models ./backend/internal/httpapi -run 'Test.*(ModelID|AdminModel)' -count=1`

Expected: PASS.

```bash
git add backend/internal/shuihuo/models/catalog.go backend/internal/shuihuo/models/catalog_test.go backend/internal/shuihuo/store/models.go backend/internal/httpapi/shuihuo_admin_handlers.go backend/internal/httpapi/shuihuo_handlers_test.go frontend/src/shared/api/shuihuoProduction.js frontend/src/admin/pages/ShuihuoModelCatalogPage.jsx
git commit -m "fix: persist Shuihuo model catalog keys"
```

### Task 2: Add a dedicated YD provider and common async contract

**Files:**
- Modify: `backend/internal/shuihuo/models/catalog.go`
- Modify: `backend/internal/shuihuo/models/adapter.go`
- Create: `backend/internal/shuihuo/providers/async_video.go`
- Modify: `backend/internal/shuihuo/providers/vidu.go`
- Create: `backend/internal/shuihuo/providers/yd.go`
- Create: `backend/internal/shuihuo/providers/yd_test.go`
- Test: `backend/internal/shuihuo/models/catalog_test.go`
- Test: `backend/internal/shuihuo/models/reference_images_test.go`

- [ ] **Step 1: Write failing YD provider tests.** Mock the official create/status/result routes. Assert `Bearer token`, `model: yd2.0-mini`, `duration: "1"`, `resolution: "720p"`, and `[empty.png, reference, scene]`. Cover missing scene, fourth optional reference, invalid URL, failed status, and result URLs from `urls` and `outputs[].url`.

```go
want := []string{YDPlaceholderImageURL, "https://assets.example/hero.png", "https://assets.example/scene.png"}
if !reflect.DeepEqual(want, payload.ImageURLs) { t.Fatalf("image_urls = %#v, want %#v", payload.ImageURLs, want) }
```

- [ ] **Step 2: Run the tests and confirm failure.**

Run: `go test ./backend/internal/shuihuo/providers -run 'TestYD' -count=1`

Expected: FAIL because `NewYD` and `AdapterYDVideo` do not exist.

- [ ] **Step 3: Define shared polling types.** Create `AsyncVideoState`, `AsyncVideoTask`, and `AsyncVideoProvider`. Preserve Vidu test compatibility with aliases or equivalent constants.

```go
type AsyncVideoProvider interface {
    Poll(context.Context, models.Definition, string) (AsyncVideoTask, error)
}
```

- [ ] **Step 4: Implement `YD.Submit`.** Register `AdapterYDVideo = "yd_video"` in model validation, task execution, required-image, and async-video checks. Resolve only `model.CredentialRef`; validate every URL; prepend the fixed `https://tvmao-public.tos-cn-beijing.volces.com/tapnow/empty.png`; accept at most three optional references; append the scene URL last. Permit only `9:16` and `16:9`.

```go
imageURLs := append([]string{YDPlaceholderImageURL}, request.ReferenceImageURLs...)
imageURLs = append(imageURLs, request.ImageURL)
payload := ydCreateRequest{Model: "yd2.0-mini", Prompt: request.Prompt, Duration: "1", Resolution: "720p", AspectRatio: request.AspectRatio, ImageURLs: imageURLs}
```

- [ ] **Step 5: Implement `YD.Poll`.** Query `/tasks/{taskId}`; map `QUEUED`, `SUBMITTED`, and `RUNNING` to running; map `FAILED` with a safe `errorMessage`; on `SUCCESS` call `/result` and validate the first URL from `urls` or `outputs[].url`. Reject unknown statuses, oversized bodies, non-2xx responses, and non-public result URLs without response-body or secret leakage.

- [ ] **Step 6: Verify and commit.**

Run: `go test ./backend/internal/shuihuo/models ./backend/internal/shuihuo/providers -count=1`

Expected: PASS, including existing Vidu tests.

```bash
git add backend/internal/shuihuo/models/catalog.go backend/internal/shuihuo/models/adapter.go backend/internal/shuihuo/models/catalog_test.go backend/internal/shuihuo/models/reference_images_test.go backend/internal/shuihuo/providers/async_video.go backend/internal/shuihuo/providers/vidu.go backend/internal/shuihuo/providers/yd.go backend/internal/shuihuo/providers/yd_test.go
git commit -m "feat: add YD2 Mini video provider adapter"
```

### Task 3: Snapshot ratio and bounded user references on video tasks

**Files:**
- Modify: `backend/internal/httpapi/shuihuo_task_handlers.go`
- Modify: `backend/internal/shuihuo/store/assets.go`
- Modify: `backend/internal/shuihuo/tasks/worker.go`
- Test: `backend/internal/httpapi/shuihuo_handlers_test.go`
- Test: `backend/internal/shuihuo/tasks/worker_test.go`

- [ ] **Step 1: Write failing task tests.** Assert that YD batch tasks snapshot `aspectRatio`, `videoReferenceObjectKeys`, and `sourceImageObjectKey`; reject `1:1` and a missing primary scene image; assert the worker turns up to three reference keys into URLs before the scene URL and remains `running` after an async acceptance.

```go
input := decodeTaskInput(t, created.Input)
if got := input["aspectRatio"]; got != "9:16" { t.Fatalf("ratio = %v", got) }
```

- [ ] **Step 2: Run tests and confirm failure.**

Run: `go test ./backend/internal/httpapi ./backend/internal/shuihuo/tasks -run 'Test.*(YD|VideoReference|AsyncVideo)' -count=1`

Expected: FAIL because video settings and video reference keys are not in task input.

- [ ] **Step 3: Add typed video settings.** Add `shuihuoVideoTaskSettings{AspectRatio string}` to single and batch requests. For YD, validate `9:16` or `16:9`, default omitted legacy callers to `9:16`, and snapshot the selected value.

```go
if model.AdapterKind == models.AdapterYDVideo && ratio != "9:16" && ratio != "16:9" {
    return domain.Task{}, taskCreationError("YD 视频比例仅支持 9:16 或 16:9")
}
```

- [ ] **Step 4: Query only segment-bound character and prop images.** Add `ListVideoReferenceObjectKeysBySegment(ctx, ownerID, segmentID, 3)` with the existing deterministic asset order. It must exclude unrelated project assets and scene assets because the storyboard primary image is always the final scene image.

- [ ] **Step 5: Resolve only the snapshot in `Worker`.** Parse and validate `videoReferenceObjectKeys` and `aspectRatio`, resolve URLs once per key, put references in `models.Request.ReferenceImageURLs`, put the primary scene URL in `ImageURL`, and use `models.IsAsyncVideoAdapter` before saving `ProviderTaskID`.

- [ ] **Step 6: Verify and commit.**

Run: `go test ./backend/internal/httpapi ./backend/internal/shuihuo/tasks -run 'Test.*(YD|VideoReference|AsyncVideo)' -count=1`

Expected: PASS.

```bash
git add backend/internal/httpapi/shuihuo_task_handlers.go backend/internal/httpapi/shuihuo_handlers_test.go backend/internal/shuihuo/store/assets.go backend/internal/shuihuo/tasks/worker.go backend/internal/shuihuo/tasks/worker_test.go
git commit -m "feat: snapshot YD video references and ratio"
```

### Task 4: Route pending asynchronous tasks by adapter key

**Files:**
- Modify: `backend/internal/shuihuo/tasks/poller.go`
- Modify: `backend/internal/shuihuo/tasks/poller_test.go`
- Modify: `backend/internal/app/app.go`

- [ ] **Step 1: Write failing mixed-provider polling tests.** Create Vidu and YD running tasks. Assert `PollDue` calls each matching provider, finishes each media record at most once, and writes the safe YD failure message when its task fails.

```go
poller := Poller{Providers: map[string]providers.AsyncVideoProvider{
    models.AdapterViduImageToVideo: vidu, models.AdapterYDVideo: yd,
}}
```

- [ ] **Step 2: Run polling tests and confirm failure.**

Run: `go test ./backend/internal/shuihuo/tasks -run 'Test.*(Poll|Async).*' -count=1`

Expected: FAIL because `Poller` has one Vidu-only provider and scans only the Vidu adapter key.

- [ ] **Step 3: Generalize `Poller`.** Replace the single Vidu provider field with `Providers map[string]providers.AsyncVideoProvider`. Sort registered keys in `PollDue`, call `ListRunningByProvider` for each, and use `task.Provider` to select the provider in `PollOnce`. Reject a task/model adapter mismatch as `invalid_async_task`.

- [ ] **Step 4: Register YD at startup.** Create `yd := providers.NewYD(nil, cfg.ModelCredential)`, add it to `AdapterRouter`, and register it with the existing Vidu instance in the poller provider map.

```go
Providers: map[string]providers.AsyncVideoProvider{
    shuihuomodels.AdapterViduImageToVideo: vidu,
    shuihuomodels.AdapterYDVideo: yd,
}
```

- [ ] **Step 5: Verify and commit.**

Run: `go test ./backend/internal/shuihuo/tasks -count=1`

Expected: PASS, including Vidu restart recovery.

```bash
git add backend/internal/shuihuo/tasks/poller.go backend/internal/shuihuo/tasks/poller_test.go backend/internal/app/app.go
git commit -m "feat: poll asynchronous video models by adapter"
```

### Task 5: Add YD catalog and batch-video controls

**Files:**
- Modify: `frontend/src/admin/pages/ShuihuoModelCatalogPage.jsx`
- Modify: `frontend/src/user/pages/shuihuo/BatchTaskModal.jsx`
- Modify: `frontend/src/user/pages/shuihuo/EngineSettingsModal.jsx`
- Test: `tests/shuihuo-production-ui-contract.test.js`

- [ ] **Step 1: Write failing UI contract tests.** Require `yd_video`, `YD2.0 Mini 图生视频`, `videoSettings`, `aspectRatio`, `9:16`, `16:9`, `1 秒`, and `720p`. Require that YD paths do not offer `1:1`, `5秒`, `8秒`, or `10秒`.

```js
assert.match(batchModal, /videoSettings:\s*\{\s*aspectRatio/);
assert.match(catalog, /yd_video/);
```

- [ ] **Step 2: Run UI contract tests and confirm failure.**

Run: `node --test tests/shuihuo-production-ui-contract.test.js`

Expected: FAIL because the UI cannot submit a YD ratio or configure its adapter.

- [ ] **Step 3: Add model-aware batch settings.** When the selected model's `adapterKind` is `yd_video`, show only a `9:16` / `16:9` ratio selector, fixed `1 秒` duration, and `720p` resolution. Default to `9:16` and include `videoSettings: { aspectRatio }` in the batch request. Non-YD submissions remain unchanged.

- [ ] **Step 4: Correct engine-settings display.** For a selected YD model, show non-editable `1 秒` and `720p`, filter ratios to the two supported values, and do not display incompatible choices. Batch task settings remain the persisted source of truth.

- [ ] **Step 5: Verify and commit.**

Run: `node --test tests/shuihuo-production-ui-contract.test.js && npm --prefix frontend run build`

Expected: PASS.

```bash
git add frontend/src/admin/pages/ShuihuoModelCatalogPage.jsx frontend/src/user/pages/shuihuo/BatchTaskModal.jsx frontend/src/user/pages/shuihuo/EngineSettingsModal.jsx tests/shuihuo-production-ui-contract.test.js
git commit -m "feat: configure YD2 Mini video generation"
```

### Task 6: Non-billable integration verification

**Files:**
- Modify: `docs/superpowers/specs/2026-08-20-yd20-mini-video-adapter-design.md`
- Test: `backend/internal/shuihuo/providers/yd_test.go`
- Test: `backend/internal/shuihuo/tasks/poller_test.go`
- Test: `tests/shuihuo-production-ui-contract.test.js`

- [ ] **Step 1: Run backend tests and static checks.**

Run: `go test ./... && go vet ./... && git diff --check`

Expected: PASS. Vidu, images, assets, model visibility, and YD tests must remain green.

- [ ] **Step 2: Build and restart after tests pass.**

Run: `go build -o .qiantie-backend-server ./cmd/qiantie && launchctl kickstart -k "gui/$(id -u)/com.ming.qiantie-backend" && curl --fail http://127.0.0.1:4000/healthz`

Expected: `{"ok":true}`.

- [ ] **Step 3: Verify browser controls without paying the provider.** At `http://127.0.0.1:3000/shuihuo-production`, select a disabled or mock YD model, confirm `1 秒`, `720p`, `9:16`, and `16:9`, and confirm no-primary-scene validation. Do not supply an `sk-yadi-*` key or submit a provider task.

- [ ] **Step 4: Record storage boundary and commit only changed documentation.** Verify local `127.0.0.1` object URLs remain unsuitable for YD; retain the TOS/MinIO public HTTPS requirement.

```bash
git add docs/superpowers/specs/2026-08-20-yd20-mini-video-adapter-design.md
git commit -m "docs: record YD adapter verification"
```
