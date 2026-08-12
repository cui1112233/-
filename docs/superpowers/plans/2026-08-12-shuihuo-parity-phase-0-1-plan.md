# 水货生产运行恢复与六列编辑器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 恢复 qiantie 当前 Go 水货生产 API 的运行，并将“分段生产台”升级为不跳出 qiantie 的六列分镜编辑器，支持持久化编辑、主图选择、单段媒体查看下载和受控批量任务提交。

**Architecture:** 3000 Express 保持统一登录并继续为 `/api/shuihuo-production/*` 签名转发；4000 必须运行由当前 `backend/cmd/qiantie` 构建的二进制。React 的六列工作面基于已存在的项目、分段、资产、媒体和任务表实现，不迁移旧 Vue/Python。批量任务由 Go 在同一所有者/项目范围内逐段创建，已生成的媒体和人工锁定提示词绝不被覆盖。

**Tech Stack:** Node.js + Express, React 18 + Ant Design + Lucide, Go + Chi, MySQL, Redis, local/TOS/MinIO object storage, Node test, Go test, Vite build, browser DOM/console verification.

---

## Preflight: Protect The Existing Worktree

Do this before every task in this plan.

- [ ] **Step 1: Record current repository state without modifying it**

Run:

```bash
git -C /Users/ming/Downloads/qiantie status --short
git -C /Users/ming/Downloads/qiantie log --oneline -8
```

Expected: many unrelated tracked and untracked changes may exist. Do not run `git reset`, `git checkout`, `git clean`, mass formatting, or dependency upgrades.

- [ ] **Step 2: Confirm the deployed 4000 process is stale before replacing it**

Run:

```bash
curl -i --max-time 5 http://127.0.0.1:4000/healthz
curl -i --max-time 5 http://127.0.0.1:4000/api/shuihuo-production/health
ps -p "$(lsof -tiTCP:4000 -sTCP:LISTEN)" -o pid,ppid,lstart,command
```

Expected before recovery: `/healthz` returns `200`, the Shuihuo health route returns `404`, and the listener is the stale `/tmp/qiantie-new` process.

### Task 1: Make The Go Runtime Rebuildable And Safely Restartable

**Files:**
- Create: `backend/scripts/run-qiantie-backend.sh`
- Create: `backend/scripts/restart-qiantie-backend.sh`
- Modify: `backend/README.md`
- Test: `backend/scripts/restart-qiantie-backend.sh` through a temporary test port only

- [ ] **Step 1: Write the failing shell contract test**

Create `backend/scripts/restart-qiantie-backend.test.sh` with this exact contract. It uses a throwaway port and data directory; it must not terminate the real 4000 service.

```bash
#!/bin/zsh
set -euo pipefail
ROOT="${0:A:h:h}"
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

QIANTIE_ADDR=127.0.0.1:4019 \
QIANTIE_MYSQL_DSN='invalid-for-contract-test' \
QIANTIE_STORAGE_DRIVER=local \
QIANTIE_STORAGE_LOCAL_DIR="$TMPDIR/objects" \
"$ROOT/scripts/run-qiantie-backend.sh" --check-config 2>&1 | grep -F 'QIANTIE_MYSQL_DSN'
```

The test only proves the wrapper passes environment values to the binary and surfaces Go configuration failure; it does not start MySQL or use credentials.

- [ ] **Step 2: Run the contract test to verify failure**

Run:

```bash
chmod +x /Users/ming/Downloads/qiantie/backend/scripts/restart-qiantie-backend.test.sh
/Users/ming/Downloads/qiantie/backend/scripts/restart-qiantie-backend.test.sh
```

Expected: FAIL because `run-qiantie-backend.sh` does not exist.

- [ ] **Step 3: Add a focused Go runner wrapper**

Create `backend/scripts/run-qiantie-backend.sh`:

```bash
#!/bin/zsh
set -euo pipefail

ROOT="${0:A:h:h}"
cd "$ROOT"

if [[ "${1:-}" == "--check-config" ]]; then
  go run ./cmd/qiantie 2>&1 | sed -n '1,1p'
  exit 1
fi

exec go run ./cmd/qiantie
```

Create `backend/scripts/restart-qiantie-backend.sh`:

```bash
#!/bin/zsh
set -euo pipefail

ROOT="${0:A:h:h}"
PID_FILE="${QIANTIE_PID_FILE:-$ROOT/.qiantie-backend.pid}"
LOG_FILE="${QIANTIE_LOG_FILE:-$ROOT/.qiantie-backend.log}"

if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  kill "$(cat "$PID_FILE")"
  for _ in {1..50}; do
    kill -0 "$(cat "$PID_FILE")" 2>/dev/null || break
    sleep 0.1
  done
fi

nohup "$ROOT/scripts/run-qiantie-backend.sh" >>"$LOG_FILE" 2>&1 &
echo $! >"$PID_FILE"
```

Do not source `.env`, do not print environment variables, and do not include any credential values in scripts or logs.

- [ ] **Step 4: Add operational instructions**

Append this section to `backend/README.md`:

```markdown
### Restarting the local Go service

Start required services and export server-side configuration in the current shell. Then restart only the qiantie Go process:

```bash
cd /Users/ming/Downloads/qiantie/backend
./scripts/restart-qiantie-backend.sh
curl -sS http://127.0.0.1:4000/healthz
```

The running binary must be built from this checkout. Verify the signed platform route separately after signing into qiantie; never place provider keys in browser storage, this README, or the scripts above.
```

- [ ] **Step 5: Run shell, Go, and gateway regression checks**

Run:

```bash
zsh -n backend/scripts/run-qiantie-backend.sh
zsh -n backend/scripts/restart-qiantie-backend.sh
backend/scripts/restart-qiantie-backend.test.sh
cd backend && go test ./internal/app ./internal/httpapi -count=1
cd .. && node --test tests/shuihuo-gateway.test.js
```

Expected: shell syntax succeeds; the config contract exposes only the expected missing-DSN error; Go and Node tests pass.

- [ ] **Step 6: Commit the runtime wrapper only**

```bash
git add backend/scripts/run-qiantie-backend.sh backend/scripts/restart-qiantie-backend.sh backend/scripts/restart-qiantie-backend.test.sh backend/README.md
git commit -m "ops: add qiantie Go runtime restart wrapper"
```

### Task 2: Replace The Stale 4000 Process And Verify The Signed Route

**Files:**
- Modify: no source files
- Verify: running process, Express gateway, browser state

- [ ] **Step 1: Verify required local service configuration before restart**

Run:

```bash
cd /Users/ming/Downloads/qiantie/backend
test -n "${QIANTIE_MYSQL_DSN:-}" || { echo 'QIANTIE_MYSQL_DSN is not configured'; exit 1; }
test -n "${QIANTIE_BRIDGE_SECRET:-}" || { echo 'QIANTIE_BRIDGE_SECRET is not configured'; exit 1; }
```

Expected: values are present only in the server shell or managed service environment. Do not echo their values.

- [ ] **Step 2: Stop only the listener currently bound to 4000**

Run:

```bash
STALE_PID="$(lsof -tiTCP:4000 -sTCP:LISTEN)"
ps -p "$STALE_PID" -o pid,command
kill "$STALE_PID"
```

Expected: the command shown is the previously inspected stale Go binary. If a different process owns 4000, stop and inspect it rather than killing it.

- [ ] **Step 3: Start the current checkout's Go server**

Run:

```bash
cd /Users/ming/Downloads/qiantie/backend
./scripts/restart-qiantie-backend.sh
for _ in {1..30}; do curl -fsS http://127.0.0.1:4000/healthz && break; sleep 1; done
```

Expected: `{"ok":true}` and `ps` shows `go run ./cmd/qiantie` or the corresponding current-checkout binary, not `/tmp/qiantie-new`.

- [ ] **Step 4: Verify the internal route signature path through Express**

Run:

```bash
curl -i --max-time 5 http://127.0.0.1:4000/api/shuihuo-production/health
curl -i --max-time 5 http://127.0.0.1:3000/api/shuihuo-production/health
```

Expected: direct 4000 call is `401` because it has no signed platform identity; 3000 call is `401` because it has no platform browser token. Neither response is `404`. After signing in, opening `/shuihuo-production` displays a real readiness response or a controlled `503` dependency explanation.

- [ ] **Step 5: Record browser-level evidence**

Use the existing signed-in in-app page `http://127.0.0.1:3000/shuihuo-production` and capture:

```js
await tab.playwright.domSnapshot()
await tab.dev.logs({ levels: ['error', 'warn'] })
```

Expected: no `404 page not found` in the dependency strip; no browser error related to the Shuihuo gateway. A displayed Redis/model/storage warning is acceptable when configuration is genuinely absent.

### Task 3: Define Batch Task Submission As A Backend Contract

**Files:**
- Modify: `backend/internal/httpapi/router.go`
- Modify: `backend/internal/httpapi/shuihuo_task_handlers.go`
- Modify: `backend/internal/httpapi/shuihuo_handlers_test.go`
- Modify: `frontend/src/shared/api/shuihuoProduction.js`
- Test: `tests/shuihuo-production-ui-contract.test.js`

- [ ] **Step 1: Write failing Go tests for project-scoped batches**

Add these tests to `backend/internal/httpapi/shuihuo_handlers_test.go` using the existing `bridgeRequest` helper and test SQL repository fixture pattern:

```go
func TestBatchTasksRejectsSegmentFromAnotherProject(t *testing.T) {
    response := requestBatchTasks(t, []int64{11, 99})
    if response.Code != http.StatusNotFound || !strings.Contains(response.Body.String(), "分段不存在") {
        t.Fatalf("batch = %d %s", response.Code, response.Body.String())
    }
}

func TestBatchTasksReturnsOneResultPerRequestedSegment(t *testing.T) {
    response := requestBatchTasks(t, []int64{11, 12})
    if response.Code != http.StatusCreated {
        t.Fatalf("batch = %d %s", response.Code, response.Body.String())
    }
    var payload struct { Results []struct { SegmentID int64 `json:"segmentId"`; Task *domain.Task `json:"task"`; Error string `json:"error"` } `json:"results"` }
    if err := json.NewDecoder(response.Body).Decode(&payload); err != nil || len(payload.Results) != 2 || payload.Results[0].Task == nil || payload.Results[1].Task == nil {
        t.Fatalf("payload=%s err=%v", response.Body.String(), err)
    }
}
```

The local request helper must post `{"segmentIds":[11,12],"kind":"image","modelId":7}` to `/api/shuihuo-production/projects/1/tasks/batch` under a bridge identity.

- [ ] **Step 2: Run the focused Go test to verify failure**

Run:

```bash
cd /Users/ming/Downloads/qiantie/backend
go test ./internal/httpapi -run 'TestBatchTasksRejectsSegmentFromAnotherProject|TestBatchTasksReturnsOneResultPerRequestedSegment' -count=1
```

Expected: FAIL because the batch endpoint and helper do not exist.

- [ ] **Step 3: Implement a shared task-creation function and batch handler**

In `backend/internal/httpapi/shuihuo_task_handlers.go`, introduce these request/response types:

```go
type shuihuoBatchTaskRequest struct {
    SegmentIDs []int64 `json:"segmentIds"`
    Kind       string  `json:"kind"`
    ModelID    int64   `json:"modelId"`
}

type shuihuoBatchTaskResult struct {
    SegmentID int64        `json:"segmentId"`
    Task      *domain.Task `json:"task,omitempty"`
    Error     string       `json:"error,omitempty"`
}
```

Extract the existing validation/create/enqueue logic from `handleCreateShuihuoTask` into:

```go
func (api *API) createShuihuoTask(ctx context.Context, user store.User, project domain.Project, segmentID, modelID int64, kind string) (domain.Task, error)
```

`handleCreateShuihuoTask` calls this helper and preserves its current single-task response. Add `handleCreateShuihuoBatchTasks` that rejects an empty list, duplicate IDs, unsupported `kind`, and more than 50 segment IDs. It calls the helper once per requested ID, preserves result order, and returns `201` only when every item succeeds. If any item fails, return `207 Multi-Status` with one `results` row per requested segment. Do not roll back successful tasks, and do not enqueue a duplicate task for a failed segment.

Add this exact route next to the single task route in `router.go`:

```go
r.Post("/shuihuo-production/projects/{id}/tasks/batch", api.handleCreateShuihuoBatchTasks)
```

- [ ] **Step 4: Add the frontend API and contract coverage**

Add to `frontend/src/shared/api/shuihuoProduction.js`:

```js
export function createBatchTasks(projectId, payload) {
  return apiRequest(`${base}/projects/${projectId}/tasks/batch`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}
```

Add this Node contract test to `tests/shuihuo-production-ui-contract.test.js`:

```js
test('production API exposes a project-scoped batch task endpoint', () => {
  assert.match(api, /export function createBatchTasks\(projectId, payload\)/);
  assert.match(api, /projects\/\$\{projectId\}\/tasks\/batch/);
});
```

- [ ] **Step 5: Run backend and frontend verification**

Run:

```bash
cd /Users/ming/Downloads/qiantie/backend
go test ./internal/httpapi ./internal/shuihuo/tasks -count=1
cd ..
node --test tests/shuihuo-production-ui-contract.test.js tests/shuihuo-gateway.test.js
```

Expected: all tests pass. The batch endpoint remains protected by `requirePlatformAuth` and does not return credentials, provider templates, or raw upstream payloads.

- [ ] **Step 6: Commit the batch API**

```bash
git add backend/internal/httpapi/router.go backend/internal/httpapi/shuihuo_task_handlers.go backend/internal/httpapi/shuihuo_handlers_test.go frontend/src/shared/api/shuihuoProduction.js tests/shuihuo-production-ui-contract.test.js
git commit -m "feat: add shuihuo batch task submission"
```

### Task 4: Build The Reusable Six-Column Segment Card

**Files:**
- Create: `frontend/src/user/pages/shuihuo/SegmentProductionCard.jsx`
- Modify: `frontend/src/user/pages/shuihuo/StudioView.jsx`
- Modify: `frontend/src/user/pages/shuihuo-production.css`
- Test: `tests/shuihuo-production-ui-contract.test.js`

- [ ] **Step 1: Write failing UI contract tests**

Add to `tests/shuihuo-production-ui-contract.test.js`:

```js
const productionCard = read('frontend/src/user/pages/shuihuo/SegmentProductionCard.jsx');

test('segment production card preserves the six-column production layout', () => {
  for (const label of ['内容', '角色', '图片提示词', '图片', '视频提示词', '视频']) {
    assert.match(productionCard, new RegExp(`>${label}<`));
  }
  assert.match(productionCard, /imagePromptLocked/);
  assert.match(productionCard, /videoPromptLocked/);
  assert.match(productionCard, /setPrimaryMedia/);
  assert.match(productionCard, /downloadMedia/);
});
```

- [ ] **Step 2: Run the UI contract test to verify failure**

Run:

```bash
cd /Users/ming/Downloads/qiantie
node --test tests/shuihuo-production-ui-contract.test.js
```

Expected: FAIL because `SegmentProductionCard.jsx` does not exist.

- [ ] **Step 3: Create the focused card component**

Create `SegmentProductionCard.jsx` with this public contract:

```jsx
export function SegmentProductionCard({
  index,
  segment,
  assets,
  media,
  onEdit,
  onBindAssets,
  onSetPrimary,
  onDeleteMedia,
  onPreviewMedia,
  onDownloadMedia
}) {
  // Render exactly six .shuihuo-production-column elements in this order:
  // 内容, 角色, 图片提示词, 图片, 视频提示词, 视频.
}
```

Implementation rules:

- The card reads `segment.sourceText`, `subtitleText`, `imagePrompt`, `videoPrompt`, `imagePromptLocked`, and `videoPromptLocked`; prompt text is displayed with a lock indicator when the corresponding flag is true.
- The content and prompt columns use buttons that call `onEdit(segment)` rather than mutating local copies. Existing `SegmentEditorModal` remains the only persistence editor in this task.
- The role column renders bound asset names and calls `onBindAssets(segment)`.
- Image and video columns filter the passed `media` by `kind`. Each media thumbnail/preview has accessible buttons for preview, download, deletion, and “设为主图” for images. Only an image calls `onSetPrimary(media.id)`.
- The card does not render a fake progress bar, fabricated duration, model parameters, or an enabled export action.
- Import download helper as `downloadMedia` from `shuihuoProduction.js`; add it there as:

```js
export async function downloadMedia(mediaId) {
  return apiRequest(`${base}/media/${mediaId}/download`, { responseType: 'blob' });
}
```

- [ ] **Step 4: Replace the current table rendering with card rendering**

In `StudioView.jsx`:

```jsx
import { SegmentProductionCard } from './SegmentProductionCard';
```

Replace the `.shuihuo-table` map with a `.shuihuo-production-list` that renders one `SegmentProductionCard` per confirmed segment. Pass `assetsFor(segment)`, `mediaFor(segment)`, `setEditing`, `openAssets`, `changeMedia`, and an `openMediaPreview` handler that creates a temporary object URL using the existing authenticated `apiRequest(..., { responseType: 'blob' })` pattern. Keep `SegmentEditorModal`, `SegmentAssetsModal`, and `MediaModal` mounted below the list.

Add a CSS grid rule with stable six columns and a responsive horizontal scroll wrapper:

```css
.shuihuo-production-list { display: grid; gap: 12px; min-width: 1120px; }
.shuihuo-production-card { display: grid; grid-template-columns: minmax(160px, 1.1fr) minmax(120px, .8fr) minmax(170px, 1fr) minmax(170px, 1fr) minmax(170px, 1fr) minmax(170px, 1fr); border: 1px solid var(--sh-line); background: var(--sh-panel); }
.shuihuo-production-column { min-width: 0; padding: 10px; border-right: 1px solid var(--sh-line); }
.shuihuo-production-column:last-child { border-right: 0; }
.shuihuo-production-scroll { overflow-x: auto; }
```

Use existing CSS variables only; do not add gradients, nested cards, or raw JSON controls.

- [ ] **Step 5: Run UI, build, and existing integration tests**

Run:

```bash
cd /Users/ming/Downloads/qiantie
node --test tests/shuihuo-production-ui-contract.test.js tests/shuihuo-gateway.test.js
npm --prefix frontend run build
```

Expected: Node tests and Vite build pass. The new build must produce a `ShuihuoProductionPage-*.js` asset.

- [ ] **Step 6: Commit the six-column card**

```bash
git add frontend/src/shared/api/shuihuoProduction.js frontend/src/user/pages/shuihuo/SegmentProductionCard.jsx frontend/src/user/pages/shuihuo/StudioView.jsx frontend/src/user/pages/shuihuo-production.css tests/shuihuo-production-ui-contract.test.js
git commit -m "feat: add shuihuo six-column production editor"
```

### Task 5: Add A Batch Toolbar With Actual Eligibility Checks

**Files:**
- Create: `frontend/src/user/pages/shuihuo/BatchTaskModal.jsx`
- Modify: `frontend/src/user/pages/shuihuo/StudioView.jsx`
- Modify: `frontend/src/user/pages/shuihuo-production.css`
- Test: `tests/shuihuo-production-ui-contract.test.js`

- [ ] **Step 1: Write failing UI contract tests**

Add:

```js
const batchModal = read('frontend/src/user/pages/shuihuo/BatchTaskModal.jsx');

test('batch task modal sends only selected eligible segments to the batch endpoint', () => {
  assert.match(batchModal, /createBatchTasks/);
  assert.match(batchModal, /eligibleSegmentIds/);
  assert.match(batchModal, /segmentIds/);
  assert.match(batchModal, /主图片/);
  assert.doesNotMatch(batchModal, /setInterval\(.*progress/i);
});
```

- [ ] **Step 2: Run the test to verify failure**

Run:

```bash
cd /Users/ming/Downloads/qiantie
node --test tests/shuihuo-production-ui-contract.test.js
```

Expected: FAIL because the batch modal does not exist.

- [ ] **Step 3: Implement the batch modal**

Create `BatchTaskModal.jsx` with these props:

```jsx
export function BatchTaskModal({ open, projectId, segments, media, kind, models, onClose, onSubmitted }) {
  // kind is either 'image' or 'video'; audio is deliberately excluded in phase 0-1.
}
```

Behavior:

- Fetch enabled models with `listModels()` only while open, filter by `kind`, and never display private provider fields.
- `eligibleSegmentIds` starts with confirmed segments; when `kind === 'video'`, filter further to segments with an image media record where `isPrimary === true`.
- Render selectable segment rows with the reason `缺少主图片` for excluded video segments.
- Submit `createBatchTasks(projectId, { segmentIds: selectedIds, kind, modelId })` only after a model and at least one eligible segment are selected.
- A `201` result shows all submitted count; a `207` result shows per-segment safe error text and calls `onSubmitted()` so the task drawer can show actual backend state.
- The modal must never claim progress before the task status API reports it.

- [ ] **Step 4: Wire explicit toolbar buttons and remove fake availability**

In `StudioView.jsx`, add a compact toolbar above the production list:

```jsx
<div className="shuihuo-editor-toolbar">
  <Button onClick={() => setSegmentOpen(true)}>调整分镜</Button>
  <Button onClick={onAssets}>人物场景预设</Button>
  <Button disabled={!taskReady} onClick={() => setBatchKind('image')}>批量生成图片</Button>
  <Button disabled={!taskReady} onClick={() => setBatchKind('video')}>批量生成视频</Button>
  <Button disabled title="阶段 4 接入导出任务">导出</Button>
</div>
```

Mount `BatchTaskModal` only for image/video. Keep the export button disabled and labelled as phase 4; do not add an export endpoint in this plan.

- [ ] **Step 5: Run all phase checks**

Run:

```bash
cd /Users/ming/Downloads/qiantie/backend
go test ./internal/httpapi ./internal/shuihuo/tasks -count=1
cd ..
node --test tests/shuihuo-production-ui-contract.test.js tests/shuihuo-gateway.test.js
npm --prefix frontend run build
```

Expected: all checks pass; a disabled batch button is only shown when runtime readiness or enabled models are genuinely missing.

- [ ] **Step 6: Commit batch toolbar UI**

```bash
git add frontend/src/user/pages/shuihuo/BatchTaskModal.jsx frontend/src/user/pages/shuihuo/StudioView.jsx frontend/src/user/pages/shuihuo-production.css tests/shuihuo-production-ui-contract.test.js
git commit -m "feat: add shuihuo batch production toolbar"
```

### Task 6: Verify The Complete Phase 0-1 Path In A Browser

**Files:**
- Modify: no source files unless a verified defect is found
- Verify: frontend build, 3000 Express, 4000 Go, browser DOM, browser console

- [ ] **Step 1: Build and restart the Node frontend service**

Run:

```bash
cd /Users/ming/Downloads/qiantie
npm --prefix frontend run build
curl -fsS http://127.0.0.1:3000/shuihuo-production >/dev/null
```

Expected: build succeeds and the qiantie route responds `200`.

- [ ] **Step 2: Verify the authenticated page visually**

In the signed-in browser at `http://127.0.0.1:3000/shuihuo-production`:

1. Open an existing confirmed project.
2. Confirm all six headers appear in this exact order: 内容、角色、图片提示词、图片、视频提示词、视频。
3. Edit a segment through the existing editor modal, save, reload, and verify the change persists.
4. Bind an asset, reload, and verify it persists.
5. Upload or select an image as the main image, reload, and verify the primary marker remains.
6. Open the batch-image modal and verify only selected segments are submitted.
7. Open the batch-video modal and verify a segment without a primary image is excluded with `缺少主图片`.

- [ ] **Step 3: Capture independent verification evidence**

Run through browser control:

```js
await tab.playwright.domSnapshot()
await tab.dev.logs({ levels: ['error', 'warn'] })
```

Expected: the DOM contains the six-column editor and the dependency strip has no route `404`; console has no React exception. Record provider/model configuration failures separately from UI failures.

- [ ] **Step 4: Run final static regressions**

Run:

```bash
cd /Users/ming/Downloads/qiantie/backend
go test ./... -count=1
cd ..
node --test tests/shuihuo-gateway.test.js tests/shuihuo-production-ui-contract.test.js
npm --prefix frontend run build
git diff --check
```

Expected: all pass. This proves structure and local interactions only; it does not prove a live text, Jimeng, Vidu, or TTS provider call without valid operator-owned HTTPS credentials.

## Phase Boundaries After This Plan

Do not start these from this plan. Create and approve separate designs/plans first:

1. Phase 2: TXT/Markdown/SRT/audio upload, asset type/template library, reference images, project prefix/suffix, and preset snapshot UI.
2. Phase 3: public model parameter schemas, prompt-only modes, text-to-video, HTTPS TTS adapter, audio task lifecycle and persisted user preferences.
3. Phase 4: ZIP export task, safe server-side merge, subtitle/audio composition, and Jianying draft package validation.
