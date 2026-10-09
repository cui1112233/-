# 梵客视频 API 模型目录 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a manager-configured Fanke Open Video platform preset that fetches the account's permitted video models, persists one selected model safely, and runs its asynchronous jobs through the existing video workflows.

**Architecture:** The server owns the Fanke catalog fetch, API key, selected provider model and capability snapshot. `ApiConfigPage` only renders returned safe data. A dedicated adapter builds and parses the vendor standard API; the script-video router dispatches task IDs by provider prefix, while the existing runtime model resolver enforces manager/member model visibility.

**Tech Stack:** Node.js 18+, Express, native `node:test`, React/Ant Design, existing per-account model catalog.

## Global Constraints

- Work only in `/private/tmp/v88-h3-workflow-20261008`; never stage generated `frontend/dist`, `.release`, `RELEASE-SHA`, or `backend/.release` changes.
- Do not restart, replace, or rebuild public containers or images during implementation.
- Keep API keys server-side and redact them from every list/configuration response.
- Use only `https://ai.fanke2026.xyz/api/open/v1` `/models`, `/video/generate`, and `/video/status`.
- Never repeat a generation POST after an ambiguous network failure.
- Reuse manager/member runtime authorization. Do not make a real paid request without a separate explicit user authorization.

---

### Task 1: Model catalog schema and safe provider directory client

**Files:**
- Create: `lib/fanke-open-video-adapter.js`
- Modify: `lib/model-catalog.js`
- Test: `test/fanke-open-video-adapter.test.js`
- Test: `test/fanke-open-video-config.test.js`

**Interfaces:** Exports `FANKE_OPEN_VIDEO_MODEL_ID`, `FANKE_OPEN_VIDEO_BASE_URL`, `fetchFankeVideoModels`, `normalizeFankeVideoModel`, `buildFankeGeneratePayload`, `parseFankeSubmitResponse`, and `parseFankeStatusResponse`. Extends normalized `fanke-open-video` records with a safe `providerModel` capability snapshot.

- [ ] **Step 1: Write the failing adapter test**

```js
test('Fanke catalog retains only available video models and never exposes the credential', async () => {
  const models = await fetchFankeVideoModels({ apiKey: 'private-key', request: async request => {
    assert.equal(request.headers.Authorization, 'Bearer private-key');
    assert.equal(request.headers['X-Public-Model-Ids'], '1');
    return { statusCode: 200, text: JSON.stringify({ data: [
      { id: 'ft-video-v1-ready', name: 'Ready', type: 'video', status: 'available', durations: [5], resolutions: ['720p'], aspect_ratios: ['9:16'], max_image_refs: 9 },
      { id: 'ft-video-v1-waiting', name: 'Waiting', type: 'video', status: 'replenishing' }
    ] }) };
  }});
  assert.deepEqual(models, [{ id: 'ft-video-v1-ready', name: 'Ready', durations: [5], resolutions: ['720p'], aspectRatios: ['9:16'], maxImageRefs: 9, maxVideoRefs: null, maxAudioRefs: null, promptMaxChars: null, audioRequiresImage: false }]);
});
```

- [ ] **Step 2: Verify RED**

Run `node --test test/fanke-open-video-adapter.test.js` and expect a module-not-found failure for `lib/fanke-open-video-adapter.js`.

- [ ] **Step 3: Write the failing configuration test**

```js
test('Fanke preset retains selected provider model capabilities and redacts its credential', () => {
  const catalog = normalizeModelCatalog([{ id: 'fanke-open-video', kind: 'video', enabled: true, credential: 'private-key', providerModel: { id: 'ft-video-v1-ready', name: 'Ready', durations: [5], resolutions: ['720p'], aspectRatios: ['9:16'], maxImageRefs: 9 } }], { modelCatalogVersion: 1 });
  assert.equal(catalog[0].modelId, 'ft-video-v1-ready');
  assert.equal(catalog[0].providerModel.maxImageRefs, 9);
  assert.equal(publicModel(catalog[0]).credential, undefined);
});
```

- [ ] **Step 4: Verify RED**

Run `node --test test/fanke-open-video-config.test.js` and expect failure because the platform preset is absent.

- [ ] **Step 5: Implement GREEN**

Create the standalone HTTPS adapter. It must use the fixed base URL, send `Authorization: Bearer <key>` and `X-Public-Model-Ids: 1`, accept only `type=video,status=available` entries, and normalize only declared capability fields. Add `fanke-open-video` with `adapterKind: 'fanke_open_video'`; preserve `modelId` and `providerModel` only for that preset; reject enabled records with no valid selected provider model.

- [ ] **Step 6: Verify GREEN and commit**

Run `node --test test/fanke-open-video-adapter.test.js test/fanke-open-video-config.test.js`; expect PASS. Commit with `git add lib/fanke-open-video-adapter.js lib/model-catalog.js test/fanke-open-video-adapter.test.js test/fanke-open-video-config.test.js && git commit -m "feat: add fanke video catalog adapter"`.

### Task 2: Authenticated provider-directory endpoint and preset configuration UI

**Files:**
- Modify: `routes/config.js`
- Modify: `frontend/src/shared/api/modelCatalog.js`
- Modify: `frontend/src/user/pages/ApiConfigPage.jsx`
- Test: `test/fanke-open-video-config-route.test.js`
- Test: `test/fanke-open-video-ui.test.js`

**Interfaces:** Adds manager-only `POST /api/config/models/fanke-open-video/catalog` and `refreshFankeVideoModels({ credential })`. The configuration card has API Key input, refresh action, `Select`, enable state, and save action.

- [ ] **Step 1: Write the failing route test**

```js
test('Fanke catalog endpoint uses an unsaved key without persisting or returning it', async () => {
  const { router, configs, calls } = createHarness({ fetchFankeVideoModels: async input => { calls.push(input); return [{ id: 'ft-video-v1-ready', name: 'Ready' }]; } });
  const response = await request(router, 'POST', '/api/config/models/fanke-open-video/catalog', { credential: 'temporary-key' });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.models, [{ id: 'ft-video-v1-ready', name: 'Ready' }]);
  assert.equal(calls[0].apiKey, 'temporary-key');
  assert.equal(JSON.stringify(configs.get('manager')).includes('temporary-key'), false);
  assert.equal(JSON.stringify(response.body).includes('temporary-key'), false);
});
```

- [ ] **Step 2: Verify RED**

Run `node --test test/fanke-open-video-config-route.test.js`; expect 404 because the route is absent.

- [ ] **Step 3: Write the failing UI test**

```js
test('API config exposes Fanke refreshable model selection without an AutoDL workflow input', () => {
  assert.match(page, /fanke-open-video/);
  assert.match(page, /刷新可用模型/);
  assert.match(page, /refreshFankeVideoModels/);
  assert.doesNotMatch(page, /fanke-open-video[^]*AutoDL 工作流 ID/);
});
```

- [ ] **Step 4: Verify RED**

Run `node --test test/fanke-open-video-ui.test.js`; expect failure because the card is absent.

- [ ] **Step 5: Implement GREEN**

Inject the adapter directory reader into `createConfigRouter`. Require an API manager; use a posted non-empty credential or stored Fanke credential; return only safe models. In React retain fetched choices only in component state, clear newly entered Key after successful save, and save `{ id, kind, displayName, credential?, providerModel, enabled }` through existing model APIs. The enable switch remains disabled until the selected model is from the current directory response.

- [ ] **Step 6: Verify GREEN and commit**

Run `node --test test/fanke-open-video-config-route.test.js test/fanke-open-video-ui.test.js`; expect PASS. Commit with `git add routes/config.js frontend/src/shared/api/modelCatalog.js frontend/src/user/pages/ApiConfigPage.jsx test/fanke-open-video-config-route.test.js test/fanke-open-video-ui.test.js && git commit -m "feat: configure fanke video preset models"`.

### Task 3: Script-video submission, polling and no-duplicate-submit semantics

**Files:**
- Modify: `routes/script-video.js`
- Test: `test/script-video-fanke.test.js`

**Interfaces:** Adds public task ID `fanke:<jobId>` and routes `modelKey === 'fanke-open-video'` to the adapter while returning the standard `{ ok, taskId, status }` contract.

- [ ] **Step 1: Write the failing submission test**

```js
test('Fanke script video submits selected model and returns a prefixed job id', async () => {
  const { baseUrl, submitted } = await createFankeScriptVideoServer({ submit: async input => { submitted.push(input); return { statusCode: 202, text: '{"success":true,"jobId":"job-42","status":"submitted"}' }; } });
  const response = await fetch(`${baseUrl}/api/script-video`, { method: 'POST', headers: authJson, body: JSON.stringify({ modelKey: 'fanke-open-video', prompt: 'scene', duration: 5, resolution: '720p', aspectRatio: '9:16', imageUrls: ['https://media.example/frame.jpg'] }) });
  assert.equal(response.status, 202);
  assert.equal((await response.json()).taskId, 'fanke:job-42');
  assert.equal(submitted[0].payload.model, 'ft-video-v1-ready');
});
```

- [ ] **Step 2: Verify RED**

Run `node --test test/script-video-fanke.test.js --test-name-pattern "submits selected model"`; expect failure because no Fanke router branch exists.

- [ ] **Step 3: Write failing polling and ambiguous-submit tests**

```js
test('Fanke task maps status success with HTTPS videoUrl to succeeded', async () => {
  const { baseUrl } = await createFankeScriptVideoServer({ status: async () => ({ statusCode: 200, text: '{"success":true,"status":"success","videoUrl":"https://media.example/final.mp4"}' }) });
  const response = await fetch(`${baseUrl}/api/script-video/fanke:job-42`, { headers: authHeaders });
  assert.deepEqual(await response.json(), { ok: true, taskId: 'fanke:job-42', status: 'succeeded', videoUrl: 'https://media.example/final.mp4', provider: 'fanke_open_video' });
});
test('Fanke transport failure makes exactly one POST and never auto-resubmits', async () => {
  let attempts = 0;
  const { baseUrl } = await createFankeScriptVideoServer({ submit: async () => { attempts += 1; throw new Error('socket timeout'); } });
  const response = await fetch(`${baseUrl}/api/script-video`, { method: 'POST', headers: authJson, body: JSON.stringify({ modelKey: 'fanke-open-video', prompt: 'scene', duration: 5, resolution: '720p', aspectRatio: '9:16' }) });
  assert.equal(response.status, 502);
  assert.equal(attempts, 1);
});
```

- [ ] **Step 4: Verify RED**

Run `node --test test/script-video-fanke.test.js --test-name-pattern "maps status|never auto"`; expect failure because Fanke status handling is absent.

- [ ] **Step 5: Implement GREEN**

Resolve the runtime model, convert project assets with the existing public-reference helper, validate prompt/ratio/duration/resolution/reference limits against `providerModel`, and submit exactly once. Parse `jobId`; map `submitted` to `processing`, `failed` to `failed`, and `success` with a validated HTTPS `videoUrl` to `succeeded`. Network errors from submit return an unknown result error without resubmitting; polling respects a minimum 30-second provider interval.

- [ ] **Step 6: Verify GREEN and commit**

Run `node --test test/script-video-fanke.test.js`; expect PASS. Commit with `git add routes/script-video.js test/script-video-fanke.test.js && git commit -m "feat: submit script videos through fanke"`.

### Task 4: Batch Factory V11/V12 Go provider, bridge sync and manager inheritance

**Files:**
- Modify: `routes/batch-factory-v11.js`
- Modify: `routes/batch-factory-v12.js`
- Create: `backend/internal/batchfactoryv11/fanke_open_video_adapter.go`
- Modify: `backend/internal/batchfactoryv11/video_provider.go`
- Modify: `backend/internal/httpapi/batch_factory_v11_production.go`
- Test: `backend/internal/batchfactoryv11/fanke_open_video_adapter_test.go`
- Test: `backend/internal/httpapi/batch_factory_v11_production_test.go`
- Test: `routes/batch-factory-v11.test.js`
- Test: `routes/batch-factory-v12.test.js`

**Interfaces:** Maps `fanke-open-video` and `fanke_open_video` to one provider key, validates runtime availability before job creation, and synchronizes the manager-resolved Key, selected provider model and safe capability snapshot across the signed Node-to-Go bridge. The Go adapter owns `/video/generate` and `/video/status` calls.

- [ ] **Step 1: Write failing V11 manager-inheritance test**

```js
test('V11 forwards manager-selected Fanke provider model for a bound member without its key', async () => {
  const response = await runV11ProviderRequest({ username: 'member', memberStore: boundMemberStore, configReader: managerFankeConfigReader });
  assert.equal(response.status, 202);
  assert.equal(bridgeCalls[0].payload.video.provider, 'fanke_open_video');
  assert.equal(bridgeCalls[0].payload.video.providerModel.id, 'ft-video-v1-ready');
  assert.equal(JSON.stringify(bridgeCalls[0].payload).includes('manager-private-key'), false);
});
```

- [ ] **Step 2: Verify RED**

Run `node --test routes/batch-factory-v11.test.js --test-name-pattern "Fanke provider model"`; expect failure because provider normalization lacks Fanke.

- [ ] **Step 3: Write failing V12 disabled-model test**

```js
test('V12 rejects disabled Fanke model before it creates a production job', async () => {
  const response = await runV12ProductionRequest({ modelCatalog: [{ id: 'fanke-open-video', kind: 'video', enabled: false, credential: 'private-key', providerModel: { id: 'ft-video-v1-ready', name: 'Ready' } }] });
  assert.equal(response.status, 422);
  assert.equal((await response.json()).code, 'BATCH_FACTORY_MODEL_UNAVAILABLE');
  assert.equal(bridgeCalls.length, 0);
});
```

- [ ] **Step 4: Verify RED**

Run `node --test routes/batch-factory-v12.test.js --test-name-pattern "disabled Fanke"`; expect failure because Fanke preflight is absent.

- [ ] **Step 5: Write failing Go adapter tests**

```go
func TestFankeOpenVideoAdapterSubmitsSelectedModelAndPollsJobID(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/open/v1/video/generate" {
			if got := r.Header.Get("Authorization"); got != "Bearer fanke-private-key" { t.Fatalf("authorization=%q", got) }
			if got := r.Header.Get("X-Public-Model-Ids"); got != "1" { t.Fatalf("model ids header=%q", got) }
			_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "jobId": "fanke-job-1", "status": "submitted"})
			return
		}
		if r.URL.Path == "/api/open/v1/video/status" { _ = json.NewEncoder(w).Encode(map[string]any{"success": true, "jobId": "fanke-job-1", "status": "success", "videoUrl": "https://media.example/final.mp4"}); return }
		t.Fatalf("unexpected path %s", r.URL.Path)
	}))
	defer server.Close()
	adapter := &FankeOpenVideoAdapter{BaseURL: server.URL + "/api/open/v1", APIKey: "fanke-private-key", Model: "ft-video-v1-ready", Client: server.Client(), ValidateURL: func(raw string) (*url.URL, error) { return url.Parse(raw) }}
	ref, err := adapter.Submit(context.Background(), FrozenVideoModel{ID: "ft-video-v1-ready", MaxDuration: 15}, FinalPrompt{CompiledPrompt: "scene", DurationSeconds: 5})
	if err != nil || ref.ProviderTaskID != "fanke-job-1" { t.Fatalf("ref=%+v err=%v", ref, err) }
	ref, err = adapter.Poll(context.Background(), FrozenVideoModel{ID: "ft-video-v1-ready"}, ref)
	if err != nil || ref.State != ProductionSucceeded || ref.MediaURL != "https://media.example/final.mp4" { t.Fatalf("ref=%+v err=%v", ref, err) }
}
```

- [ ] **Step 6: Verify Go RED**

Run `cd backend && go test ./internal/batchfactoryv11 -run TestFankeOpenVideoAdapterSubmitsSelectedModelAndPollsJobID -count=1`; expect compile failure because `FankeOpenVideoAdapter` does not exist.

- [ ] **Step 7: Implement GREEN**

Add the Go provider constant and config validation, preserving existing H3 branches. Extend the signed configuration payload with `ProviderModel` capability data. Implement `FankeOpenVideoAdapter` with host validation, one submit POST, `jobId` persistence, and query-only retry semantics. Wire the provider registry/factory so V11/V12 use the Go adapter. In Node, add aliases only where provider types are normalized, reuse `resolveRuntimeModel`, and sync the manager-resolved configuration without exposing it to the browser.

- [ ] **Step 8: Verify GREEN and commit**

Run `node --test routes/batch-factory-v11.test.js routes/batch-factory-v12.test.js --test-name-pattern "Fanke" && (cd backend && go test ./internal/batchfactoryv11 ./internal/httpapi -run Fanke -count=1)`; expect PASS. Commit with `git add routes/batch-factory-v11.js routes/batch-factory-v12.js routes/batch-factory-v11.test.js routes/batch-factory-v12.test.js backend/internal/batchfactoryv11/fanke_open_video_adapter.go backend/internal/batchfactoryv11/video_provider.go backend/internal/httpapi/batch_factory_v11_production.go backend/internal/batchfactoryv11/fanke_open_video_adapter_test.go backend/internal/httpapi/batch_factory_v11_production_test.go && git commit -m "feat: support fanke video in batch factory"`.

### Task 5: Regression verification and unified-release gate

**Files:** No source changes unless a verified regression requires a focused repair.

- [ ] **Step 1: Run new and adjacent suites**

Run `node --test test/fanke-open-video-adapter.test.js test/fanke-open-video-config.test.js test/fanke-open-video-config-route.test.js test/fanke-open-video-ui.test.js test/script-video-fanke.test.js test/h3-workflow-config.test.js test/h3-workflow-switch.test.js test/h3-workflow-ui.test.js`; expect PASS.

- [ ] **Step 2: Run syntax and frontend production checks**

Run `node --check lib/fanke-open-video-adapter.js && node --check lib/model-catalog.js && node --check routes/config.js && node --check routes/script-video.js && (cd frontend && npm run build)`; expect zero exit status.

- [ ] **Step 3: Verify source-only change set**

Run `git diff --check && git status --short && git log --oneline --max-count=8`; generated distribution files must remain untouched.

- [ ] **Step 4: Obtain explicit billable-test authorization if real provider validation is desired**

Do not send `/video/generate` in this task. If user later authorizes one billable run, submit exactly one selected-model job, record `jobId`, poll without a second submit to terminal state, and validate final `videoUrl`.

- [ ] **Step 5: Perform one unified deployment only after all verification**

Use the existing V88 unified-release flow; record running SHA and persistent volume mounts before change, then verify exact build identity, authenticated API-config card, catalog refresh, save/enable, manager/member visibility, existing H3 behavior, and public readback. Container health alone is insufficient.
