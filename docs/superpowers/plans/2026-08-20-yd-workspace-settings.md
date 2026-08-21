# 中转亚迪工作设置 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an account-scoped, encrypted “中转亚迪” API-key setting and use it for every YD2.0 Mini submission and asynchronous status poll.

**Architecture:** Store only encrypted per-user YD credentials in a dedicated MySQL table. The settings API returns configuration state but never the key. A YD credential resolver receives the task owner ID for both `Submit` and `Poll`, resolves that user’s decrypted credential, and rejects an unconfigured account before queueing a task.

**Tech Stack:** Go, MySQL migrations, AES-256-GCM, React, Ant Design, Go tests, Node contract tests.

---

### Task 1: Add server-side credential encryption

**Files:**
- Create: `backend/internal/credentials/cipher.go`
- Create: `backend/internal/credentials/cipher_test.go`
- Modify: `backend/internal/config/config.go`
- Test: `backend/internal/config/config_test.go`

- [ ] **Step 1: Write failing cipher and config tests**

```go
func TestCipherRoundTripUsesVersionedCiphertext(t *testing.T) {
    cipher, err := credentials.NewFromBase64(testKey)
    require.NoError(t, err)
    encrypted, err := cipher.Encrypt("sk-yadi-secret")
    require.NoError(t, err)
    assert.True(t, strings.HasPrefix(encrypted, "v1:"))
    assert.NotContains(t, encrypted, "sk-yadi-secret")
    assert.Equal(t, "sk-yadi-secret", must(cipher.Decrypt(encrypted)))
}

func TestLoadRejectsInvalidCredentialEncryptionKey(t *testing.T) {
    t.Setenv("QIANTIE_CREDENTIAL_ENCRYPTION_KEY", "not-base64")
    _, err := config.Load()
    assert.ErrorContains(t, err, "QIANTIE_CREDENTIAL_ENCRYPTION_KEY")
}
```

- [ ] **Step 2: Run test to verify failure**

Run: `go test ./backend/internal/credentials ./backend/internal/config`

Expected: compilation failure because the cipher package and configuration field do not exist.

- [ ] **Step 3: Implement the cipher boundary**

Implement `credentials.Cipher` with `Encrypt(string) (string, error)` and `Decrypt(string) (string, error)`. Decode exactly 32 bytes from `QIANTIE_CREDENTIAL_ENCRYPTION_KEY`, use AES-256-GCM with a random nonce, prefix stored values with `v1:`, and return generic errors that never include plaintext. Add `CredentialCipher *credentials.Cipher` to `config.Config`; leave it nil when the environment variable is absent, but reject malformed supplied values.

- [ ] **Step 4: Run test to verify success**

Run: `go test ./backend/internal/credentials ./backend/internal/config`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/credentials backend/internal/config/config.go backend/internal/config/config_test.go
git commit -m "feat: add encrypted account credential support"
```

### Task 2: Persist and expose only YD configuration state

**Files:**
- Modify: `backend/internal/storage/migrations.go`
- Create: `backend/internal/store/video_configs.go`
- Create: `backend/internal/store/video_configs_test.go`
- Modify: `backend/internal/httpapi/router.go`
- Modify: `backend/internal/httpapi/config_handlers.go`
- Modify: `backend/internal/httpapi/config_handlers_test.go`

- [ ] **Step 1: Write failing persistence and HTTP tests**

```go
func TestVideoConfigsSaveAndGetAreScopedToUser(t *testing.T) {
    // Save user 1 and user 2 values, then assert each Get returns only its own row.
}

func TestSaveConfigReturnsVideoStateWithoutCredential(t *testing.T) {
    // POST video.apiKey and assert video.hasApiKey=true,
    // no submitted key appears in the response, and blank saves preserve it.
}

func TestSaveVideoConfigRejectsWhenCipherIsUnavailable(t *testing.T) {
    // POST a video key with a nil cipher and expect HTTP 503.
}
```

- [ ] **Step 2: Run test to verify failure**

Run: `go test ./backend/internal/store ./backend/internal/httpapi`

Expected: failure because `video_api_configs`, `VideoConfigs`, and the public `video` response do not exist.

- [ ] **Step 3: Add the table, store, and protected settings API**

Add this idempotent migration:

```sql
CREATE TABLE IF NOT EXISTS video_api_configs (
  user_id BIGINT PRIMARY KEY,
  provider VARCHAR(64) NOT NULL,
  api_key_ciphertext MEDIUMTEXT NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_video_api_configs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

Create `store.VideoAPIConfig` with provider `yd_video`, `Configured()`, and user-scoped `Get`/ `Save`. Extend `httpapi.Dependencies` with `VideoConfigs` and `CredentialCipher`; extend `configRequest` with `video`. On `POST /api/config`, encrypt a nonempty `video.apiKey`, preserve an existing value when blank, and return only `provider`, `displayName: "中转亚迪"`, and `hasApiKey`. Return 503 when a key is supplied but the cipher is unavailable.

- [ ] **Step 4: Run test to verify success**

Run: `go test ./backend/internal/store ./backend/internal/httpapi`

Expected: PASS, including no-secret response assertions.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/storage/migrations.go backend/internal/store/video_configs.go backend/internal/store/video_configs_test.go backend/internal/httpapi/router.go backend/internal/httpapi/config_handlers.go backend/internal/httpapi/config_handlers_test.go
git commit -m "feat: save account YD video credentials"
```

### Task 3: Resolve the account key throughout YD task lifetime

**Files:**
- Modify: `backend/internal/shuihuo/providers/async_video.go`
- Modify: `backend/internal/shuihuo/providers/yd.go`
- Modify: `backend/internal/shuihuo/providers/yd_test.go`
- Modify: `backend/internal/shuihuo/tasks/poller.go`
- Modify: `backend/internal/shuihuo/tasks/poller_test.go`
- Modify: `backend/internal/httpapi/shuihuo_task_handlers.go`
- Modify: `backend/internal/httpapi/shuihuo_handlers_test.go`
- Modify: `backend/internal/app/app.go`

- [ ] **Step 1: Write failing YD resolver and task creation tests**

```go
func TestYDSubmitUsesOwnerCredential(t *testing.T) {
    // Submit with OwnerID 17; assert Authorization used only user 17's decrypted key.
}

func TestYDPollUsesTaskOwnerCredential(t *testing.T) {
    // Poll a task for OwnerID 17; assert the status request used user 17's key.
}

func TestCreateYDTaskRejectsAccountWithoutYDCredential(t *testing.T) {
    // Enabled YD model plus no video configuration returns 409 and does not enqueue.
}
```

- [ ] **Step 2: Run test to verify failure**

Run: `go test ./backend/internal/shuihuo/providers ./backend/internal/shuihuo/tasks ./backend/internal/httpapi`

Expected: failure because `AsyncVideoProvider.Poll` lacks owner context and task creation does not require an account YD configuration.

- [ ] **Step 3: Pass owner ID to both submit and poll**

Change the async contract:

```go
type AsyncVideoProvider interface {
    models.Adapter
    Poll(context.Context, models.Definition, int64, string) (AsyncVideoTask, error)
}
```

Give `providers.YD` an account credential resolver that loads `VideoAPIConfig`, decrypts it, and uses `request.OwnerID` in `Submit` and `task.UserID` in `Poll`. Update all mocks, Vidu’s signature, `tasks.Poller.PollOnce`, and app wiring. At task creation, when the selected enabled model uses `AdapterYDVideo`, require a configured account video credential and configured cipher; return HTTP 409 with “请先在工作台设置中配置中转亚迪 API Key” before creating or enqueueing the task. Do not write the user key into task snapshots or model definitions.

- [ ] **Step 4: Run focused tests to verify success**

Run: `go test ./backend/internal/shuihuo/providers ./backend/internal/shuihuo/tasks ./backend/internal/httpapi`

Expected: PASS; Vidu polling remains unchanged apart from the ignored owner argument.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/shuihuo/providers backend/internal/shuihuo/tasks/poller.go backend/internal/shuihuo/tasks/poller_test.go backend/internal/httpapi/shuihuo_task_handlers.go backend/internal/httpapi/shuihuo_handlers_test.go backend/internal/app/app.go
git commit -m "feat: use account credentials for YD tasks"
```

### Task 4: Redesign the model service settings layout

**Files:**
- Modify: `frontend/src/shared/api/config.js`
- Modify: `frontend/src/user/pages/SettingsPage.jsx`
- Modify: `frontend/src/shared/styles/global.css`
- Create: `tests/settings-yd-video-contract.test.js`

- [ ] **Step 1: Write the failing UI contract**

```js
test('settings separates text, image, and YD video services', () => {
  const page = readFileSync('frontend/src/user/pages/SettingsPage.jsx', 'utf8');
  assert.match(page, /文本推理/);
  assert.match(page, /图片生成/);
  assert.match(page, /中转亚迪/);
  assert.match(page, /video.*apiKey|apiKey.*video/s);
  assert.doesNotMatch(page, /视频.*Base URL/s);
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `node --test tests/settings-yd-video-contract.test.js`

Expected: FAIL because the settings page has no video service section.

- [ ] **Step 3: Implement the three-service form**

Add `video` to `getConfig`/ `saveConfig` form values, clear `video.apiKey` after success, and render the `中转亚迪` password field with an `已配置/未配置` status. Reorganize the current fields into one “模型服务” area with ordered text, image, and video rows; retain storage and CM controls outside it. Use existing CSS variables, 8px maximum radius, dividers between service rows, one form save button, and one-column stacking below 700px. No YD connection-test button is added.

- [ ] **Step 4: Run frontend verification**

```bash
node --test tests/settings-yd-video-contract.test.js
npm --prefix frontend run build
```

Expected: contract test and production build PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/shared/api/config.js frontend/src/user/pages/SettingsPage.jsx frontend/src/shared/styles/global.css tests/settings-yd-video-contract.test.js
git commit -m "feat: add YD video workspace setting"
```

### Task 5: Validate the assembled application and deployment requirement

**Files:**
- Modify: `backend/README.md`
- Test: `backend/internal/...`
- Test: `tests/settings-yd-video-contract.test.js`

- [ ] **Step 1: Document only the server master-key requirement**

Document that operators set a base64-encoded 32-byte `QIANTIE_CREDENTIAL_ENCRYPTION_KEY`; users enter their `sk-yadi-...` key in “工作台设置 - 中转亚迪”. Do not document or expose a user API key in launchd, model records, browser logs, or command examples.

- [ ] **Step 2: Run the full verification suite**

```bash
go test ./...
go vet ./...
go build ./cmd/qiantie
node --test tests/settings-yd-video-contract.test.js tests/shuihuo-yd-video-ui-contract.test.js tests/shuihuo-model-catalog-contract.test.js
npm --prefix frontend run build
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 3: Restart locally and verify public API safety**

Run the normal local backend restart, authenticate as a test account, save a non-production test key, then verify `GET /api/config` reports `video.hasApiKey: true` without containing the test key. Verify an account without a YD key receives the pre-queue configuration error when submitting YD video.

- [ ] **Step 4: Commit verification documentation**

```bash
git add backend/README.md
git commit -m "docs: describe encrypted YD workspace setup"
```
