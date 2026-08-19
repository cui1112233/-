# Account OpenAI-Compatible Image Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Add an account-scoped OpenAI-compatible image provider to /settings and make it available to Shuihuo image and asset-image tasks without exposing credentials.

**Architecture:** Node retains the account's separate image settings object and sends completed sections through its existing signed bridge. Go persists this object in image_api_configs; Shuihuo returns a synthetic image choice with numeric ID 0 only for accounts whose configuration is complete. Tasks selected with this ID store no catalog model snapshot, URL, or key; the Worker recognizes their provider and resolves the task owner's configuration at execution time.

**Tech Stack:** Express, React, Ant Design, Go, MySQL, standard net/http, signed Node-to-Go bridge, Node test runner, Go httptest.

---

## Invariants

~~~
const accountImageProviderOpenAICompatible = "openai_compatible"
const accountOpenAICompatibleImageModelID int64 = 0
const accountOpenAICompatibleImageAdapter = "account_openai_compatible_image"
~~~

- 0 is an API-only selector. It is never inserted in model_definitions and is never stored as a foreign key.
- A special task stores provider account_openai_compatible_image and model_id/model_version_id as NULL.
- Its input snapshot contains only prompt, segment/asset identifier, provider, and configured image model name.
- Version one accepts only openai_compatible; Nano Banana and Doubao require their own adapters and enabled provider values later.

## Files

- lib/shared.js, routes/config.js, routes/shuihuo-production.js, tests/shuihuo-gateway.test.js: Node account config, key redaction, signed bridge payload.
- backend/internal/storage/migrations.go, backend/internal/store/image_configs.go, backend/internal/store/image_configs_test.go: image config table/repository.
- backend/internal/httpapi/config_handlers.go, backend/internal/httpapi/router.go, backend/internal/httpapi/shuihuo_handlers_test.go: Go API and bridge configuration contract.
- backend/internal/shuihuo/models/adapter.go, backend/internal/shuihuo/providers/openai_compatible_image.go, backend/internal/shuihuo/providers/openai_compatible_image_test.go: owner-aware controlled image adapter.
- backend/internal/httpapi/shuihuo_task_handlers.go, backend/internal/httpapi/shuihuo_asset_generation_handlers.go, relevant HTTP tests: virtual model listing and task creation.
- backend/internal/shuihuo/tasks/worker.go, backend/internal/shuihuo/tasks/worker_test.go, backend/internal/app/app.go: Worker execution and dependency wiring.
- frontend/src/user/pages/SettingsPage.jsx, frontend/src/shared/styles/global.css, image-selector components, frontend contract test: visible settings and ID 0 picker support.

### Task 1: Separate Image Settings in Node and Bridge

**Files:**
- Modify: lib/shared.js
- Modify: routes/config.js
- Modify: routes/shuihuo-production.js
- Test: tests/shuihuo-gateway.test.js

- [ ] **Step 1: Write failing Node tests**

Add tests beside the existing account AI synchronization test. Save this body, then read it back through /api/config:

~~~
{
  provider: 'custom', baseUrl: 'https://text.example/v1', model: 'text-model', apiKey: 'text-secret',
  image: {
    provider: 'openai_compatible', baseUrl: 'https://images.example/v1',
    model: 'image-model', apiKey: 'image-secret'
  }
}
~~~

Assert readConfig(username).image.apiKey equals image-secret, every HTTP response excludes both secrets, response JSON reports image.hasApiKey true, and the bridge payload has image.provider, image.baseUrl, image.model, and image.apiKey. Post the same image fields with a blank key and assert the saved/forwarded key stays image-secret. A valid image-only save without a text key must return 200 and send only the image bridge section.

- [ ] **Step 2: Verify the tests fail**

Run: node --test tests/shuihuo-gateway.test.js

Expected: FAIL because nested image settings do not exist and publicConfig only strips the top-level key.

- [ ] **Step 3: Implement Node normalization and redaction**

In lib/shared.js, add the default:

~~~
image: { provider: 'openai_compatible', baseUrl: '', model: '', apiKey: '' }
~~~

Export normalizeImageConfig(value, fallback). It accepts only openai_compatible, trims scalar values, preserves fallback.apiKey for an empty submitted key, and otherwise returns the fallback object. Replace publicConfig with explicit nested redaction:

~~~
const { apiKey, image: rawImage, ...safeConfig } = config;
const image = normalizeImageConfig(rawImage, DEFAULT_CONFIG.image);
const { apiKey: imageKey, ...safeImage } = image;
return { ...safeConfig, hasApiKey: Boolean(apiKey), image: { ...safeImage, hasApiKey: Boolean(imageKey) } };
~~~

In routes/config.js, persist image: normalizeImageConfig(body.image, oldConfig.image) without altering text fields.

In routes/shuihuo-production.js, change accountAIConfigPayload to return complete optional sections. Keep completed text fields at the existing top level; add image only when its provider/URL/model/key are all present. Return null when neither section is complete, and make syncAccountAIConfig skip the bridge request in that case. Do not log bridge bodies or upstream error bodies.

- [ ] **Step 4: Verify Node tests pass and commit**

Run: node --test tests/shuihuo-gateway.test.js

Expected: PASS.

~~~
git add lib/shared.js routes/config.js routes/shuihuo-production.js tests/shuihuo-gateway.test.js
git commit -m "feat: add account image provider settings"
~~~

### Task 2: Image Config Storage and Go Bridge API

**Files:**
- Modify: backend/internal/storage/migrations.go
- Create: backend/internal/store/image_configs.go
- Create: backend/internal/store/image_configs_test.go
- Modify: backend/internal/httpapi/config_handlers.go
- Modify: backend/internal/httpapi/router.go
- Test: backend/internal/httpapi/shuihuo_handlers_test.go

- [ ] **Step 1: Write failing storage and API tests**

Create recordingImageConfigStore implementing:

~~~
Get(context.Context, int64) (store.ImageAPIConfig, error)
Save(context.Context, int64, store.ImageAPIConfig) error
~~~

Add signed bridge tests with an image-only request:

~~~
{"image":{"provider":"openai_compatible","baseUrl":"https://images.example/v1","model":"image-model","apiKey":"image-secret"}}
~~~

Assert 200, saved user ID/provider/URL/model/key, hasApiKey true, and no image-secret in the response. Add 400 cases for provider doubao, a missing key for a new config, and partial fields. Add a repository SQL test: no row returns unconfigured; upsert takes user ID/provider/base URL/model/key.

- [ ] **Step 2: Verify the tests fail**

Run: go test ./internal/httpapi ./internal/store -run 'TestPlatformAccountAIConfigSyncPersistsImage|TestImageConfigs'

Expected: FAIL because the repository and nested request type do not exist.

- [ ] **Step 3: Add migration, repository, and API contract**

Append this migration:

~~~
CREATE TABLE IF NOT EXISTS image_api_configs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT, user_id BIGINT NOT NULL,
  provider VARCHAR(64) NOT NULL, base_url VARCHAR(512) NOT NULL,
  model VARCHAR(128) NOT NULL, api_key_ciphertext TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_image_api_config_user (user_id),
  CONSTRAINT fk_image_api_configs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
~~~

Implement store.ImageAPIConfig and ImageConfigs.Get/Save; Configured returns true only for openai_compatible plus nonempty URL/model/key. Add ImageConfigs ImageConfigStore to HTTP dependencies. Extend configRequest with Image *imageConfigRequest. saveImageConfig accepts only the version-one provider, preserves a prior key for blank updates, and rejects incomplete configurations. handleSaveBridgeAccountAIConfig saves only supplied complete sections so an image-only save never overwrites text. Public config responses include only provider, baseUrl, model, and hasApiKey under image.

- [ ] **Step 4: Verify tests pass and commit**

Run:

~~~
go test ./internal/httpapi ./internal/store -run 'TestPlatformAccountAIConfigSyncPersistsImage|TestImageConfigs|TestPlatformAccountAIConfigSyncPersistsCredential'
go test ./internal/storage
~~~

Expected: PASS; MySQL integration may report SKIP only when QIANTIE_MYSQL_DSN is unset.

~~~
git add backend/internal/storage/migrations.go backend/internal/store/image_configs.go backend/internal/store/image_configs_test.go backend/internal/httpapi/config_handlers.go backend/internal/httpapi/router.go backend/internal/httpapi/shuihuo_handlers_test.go
git commit -m "feat: persist account image configurations"
~~~

### Task 3: Controlled OpenAI-Compatible Image Adapter

**Files:**
- Modify: backend/internal/shuihuo/models/adapter.go
- Create: backend/internal/shuihuo/providers/openai_compatible_image.go
- Create: backend/internal/shuihuo/providers/openai_compatible_image_test.go

- [ ] **Step 1: Write failing fake-upstream tests**

With httptest.NewServer, resolve user 42 to Provider openai_compatible, BaseURL server.URL plus /v1, Model image-model, APIKeyCiphertext owner-secret. Call the new adapter with OwnerID 42 and prompt. Assert exactly:

~~~
POST /v1/images/generations
Authorization: Bearer owner-secret
{"model":"image-model","prompt":"雨夜车站"}
~~~

Return standard data[0].url and assert the result. Add cases for missing config, non-2xx, malformed JSON, missing data[0].url, and owner ID forwarding. None of the failure strings may contain owner-secret.

- [ ] **Step 2: Verify failure**

Run: go test ./internal/shuihuo/providers -run TestOpenAICompatibleImage

Expected: FAIL because the adapter and Request.OwnerID are absent.

- [ ] **Step 3: Implement the adapter**

Add AdapterAccountOpenAICompatibleImage and OwnerID int64 to the adapter model contract. Implement NewOpenAICompatibleImage(client, imageConfigStore) in providers. It requires image kind, exact adapter kind, positive owner ID, prompt, and Configured image config. Trim trailing URL slashes, append /images/generations unless already present, validate the final URL with models.ValidateOutboundURL, use a bounded response read, and return only model returned HTTP status for non-2xx results. Decode only standard data[0].url.

- [ ] **Step 4: Verify success and commit**

Run:

~~~
go test ./internal/shuihuo/providers -run TestOpenAICompatibleImage
go test ./internal/shuihuo/models
~~~

Expected: PASS.

~~~
git add backend/internal/shuihuo/models/adapter.go backend/internal/shuihuo/providers/openai_compatible_image.go backend/internal/shuihuo/providers/openai_compatible_image_test.go
git commit -m "feat: add account openai compatible image adapter"
~~~

### Task 4: List and Create Account Image Tasks

**Files:**
- Modify: backend/internal/httpapi/shuihuo_task_handlers.go
- Modify: backend/internal/httpapi/shuihuo_asset_generation_handlers.go
- Test: backend/internal/httpapi/shuihuo_handlers_test.go
- Create: backend/internal/httpapi/shuihuo_asset_generation_handlers_test.go

- [ ] **Step 1: Write failing HTTP tests**

For an authenticated account with complete image settings, assert GET /api/shuihuo-production/models appends:

~~~
{"id":0,"modelId":"current-account-openai-compatible-image","name":"当前账号 OpenAI 兼容生图","kind":"image","adapterKind":"account_openai_compatible_image"}
~~~

Assert no such model for incomplete settings. Submit segmentId 5, kind image, modelId 0 and assert provider is the account adapter, model pointers are nil, and input has prompt/model/provider but no image URL/key. Assert configuration absence gives 409 with the settings guidance; modelId 0 for video gives 400. Add the same checks to asset-image task creation.

- [ ] **Step 2: Verify failure**

Run: go test ./internal/httpapi -run 'TestShuihuoModels|TestAccountOpenAICompatibleImage|TestAsset.*Account'

Expected: FAIL because model ID zero is rejected and the model list lacks a synthetic option.

- [ ] **Step 3: Implement synthetic model behavior**

In list models, query current-user ImageConfigs and append a fixed safe PublicModel only when configured. In createShuihuoTask, branch on modelID equals zero before catalog lookup. It is valid only for image kind and a complete owner config. Create a task with nil model pointers and the account adapter provider. Preserve every existing positive model ID catalog code path unchanged. Apply the same resolver to asset generation. Never accept endpoint/key/model overrides from the request body.

- [ ] **Step 4: Verify success and commit**

Run: go test ./internal/httpapi -run 'TestShuihuoModels|TestAccountOpenAICompatibleImage|TestAsset.*Account'

Expected: PASS.

~~~
git add backend/internal/httpapi/shuihuo_task_handlers.go backend/internal/httpapi/shuihuo_asset_generation_handlers.go backend/internal/httpapi/shuihuo_handlers_test.go backend/internal/httpapi/shuihuo_asset_generation_handlers_test.go
git commit -m "feat: expose account image model to shuihuo"
~~~

### Task 5: Worker Execution and Application Wiring

**Files:**
- Modify: backend/internal/shuihuo/tasks/worker.go
- Modify: backend/internal/shuihuo/tasks/worker_test.go
- Modify: backend/internal/app/app.go

- [ ] **Step 1: Write failing Worker tests**

Create a queued special-provider task with nil model IDs and UserID 17. Use a recording adapter and assert request.OwnerID equals 17, the model kind is image, and normal media persistence succeeds. Add tests that reject a special task with catalog model pointers and a non-special task with nil model pointers.

- [ ] **Step 2: Verify failure**

Run: go test ./internal/shuihuo/tasks -run 'TestWorker.*AccountImage|TestWorkerRejectsCatalogTaskWithoutModelSnapshot'

Expected: FAIL because Worker rejects nil model snapshots before provider dispatch.

- [ ] **Step 3: Implement Worker branch and wiring**

Before the current model snapshot guard, allow nil model pointers only when task.Provider equals the account adapter, kind is image or asset_image, and both pointers are nil. Build a synthetic image Definition; all other tasks retain current snapshot lookup. Set OwnerID task.UserID on every adapter request. In app.go, create imageConfigs with store.NewImageConfigs(db), inject it into HTTP dependencies, and register providers.NewOpenAICompatibleImage(nil, imageConfigs) in the Worker adapter router while leaving existing adapters intact.

- [ ] **Step 4: Verify success and commit**

Run:

~~~
go test ./internal/shuihuo/tasks -run 'TestWorker.*Image'
go test ./internal/httpapi ./internal/shuihuo/providers
~~~

Expected: PASS.

~~~
git add backend/internal/shuihuo/tasks/worker.go backend/internal/shuihuo/tasks/worker_test.go backend/internal/app/app.go
git commit -m "feat: execute account image generation tasks"
~~~

### Task 6: Settings and Selector UX

**Files:**
- Modify: frontend/src/user/pages/SettingsPage.jsx
- Modify: frontend/src/shared/styles/global.css
- Modify: frontend/src/user/pages/shuihuo/TaskDrawer.jsx
- Modify: frontend/src/user/pages/shuihuo/BatchTaskModal.jsx
- Modify: frontend/src/user/pages/shuihuo/AssetsView.jsx
- Create: tests/account-image-settings-ui-contract.test.js

- [ ] **Step 1: Write a failing frontend contract test**

Assert SettingsPage.jsx contains the four independent fields image provider, base URL, key, and model, plus OpenAI compatible labeling. Assert initialization explicitly sets image key blank, not from config.image.apiKey. Assert every image model loader keeps numeric zero using typeof model.id === number instead of truthiness filtering. Assert picker placeholder text is neutral selection text rather than administrator-only.

- [ ] **Step 2: Verify failure**

Run: node --test tests/account-image-settings-ui-contract.test.js

Expected: FAIL because no independent image section exists and current truthiness filters remove ID zero.

- [ ] **Step 3: Implement UI**

Add a third settings section titled 生图服务 with provider select containing only openai_compatible / OpenAI compatible, independent image Base URL, password key, and model fields. Load provider/URL/model plus a blank key; preserve nested image values on save. Use the existing responsive grid styling with no hard-coded theme colors. Update task, batch, and asset image model selectors to retain model zero and use neutral selection text. Do not add browser-side generation or a real-provider test button.

- [ ] **Step 4: Verify success and commit**

Run:

~~~
node --test tests/account-image-settings-ui-contract.test.js
npm --prefix frontend run build
~~~

Expected: PASS.

~~~
git add frontend/src/user/pages/SettingsPage.jsx frontend/src/shared/styles/global.css frontend/src/user/pages/shuihuo/TaskDrawer.jsx frontend/src/user/pages/shuihuo/BatchTaskModal.jsx frontend/src/user/pages/shuihuo/AssetsView.jsx tests/account-image-settings-ui-contract.test.js
git commit -m "feat: configure account image provider in settings"
~~~

### Task 7: Verification and Operations Record

**Files:**
- Modify: docs/superpowers/specs/2026-08-19-account-openai-compatible-image-settings-design.md
- Modify: docs/superpowers/plans/2026-08-19-account-openai-compatible-image-settings-plan.md

- [ ] **Step 1: Run targeted verification**

Run:

~~~
node --test tests/shuihuo-gateway.test.js tests/account-image-settings-ui-contract.test.js
go test ./internal/store ./internal/storage ./internal/httpapi ./internal/shuihuo/models ./internal/shuihuo/providers ./internal/shuihuo/tasks
npm --prefix frontend run build
git diff --check
~~~

Then run go test ./... once. Record any failures as current baseline or regressions by comparing packages and stack traces to the pre-change baseline; do not claim full Go-suite success unless that command passes in the current checkout.

- [ ] **Step 2: Perform non-provider HTTP smoke checks**

Use a disposable local account and verify GET /api/config returns image.hasApiKey but not a key, and GET /api/shuihuo-production/models returns the synthetic model only after complete settings. Do not submit a real image generation request.

- [ ] **Step 3: Record runtime contract and commit**

Append to the design: version one provider is OpenAI-compatible only; endpoint is POST baseUrl/images/generations and requires data[0].url; configuration is account-scoped and task snapshots exclude URL/key; Nano Banana and Doubao require registered adapters; fake-upstream tests do not prove provider quota/model compatibility.

~~~
git add docs/superpowers/specs/2026-08-19-account-openai-compatible-image-settings-design.md docs/superpowers/plans/2026-08-19-account-openai-compatible-image-settings-plan.md
git commit -m "docs: verify account image provider rollout"
~~~
