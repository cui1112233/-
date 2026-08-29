# Batch Factory Go Config Snapshots Phase 2A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Batch Factory config-snapshot computation and frozen system-preset resolution from Node business logic into Go while keeping the Node preset store only as a temporary raw-history transport.

**Architecture:** Phase 2A does not migrate the general preset admin store itself and does not move script/asset selection yet. Node sends raw `batch-factory` preset history server-to-server to authenticated Go compatibility endpoints; Go alone computes snapshot revisions/latest state and resolves pinned-or-published system preset bodies. Existing director and production orchestration remain in Node, but their system-preset lookup is changed to the Go resolver so runtime behavior no longer depends on `lib/batch-factory/config-version.js` business rules.

**Tech Stack:** Go 1.23, chi v5, Node.js + Express compatibility gateway, existing Node preset store as temporary raw data transport, React + Ant Design unchanged.

**Spec:** `docs/superpowers/specs/2026-08-29-batch-factory-go-api-migration-design.md`

## Global Constraints

- API / service backend target is Golang.
- Admin UI remains React + Ant Design.
- User UI remains React + Ant Design.
- No big-bang rewrite; migrate one verified slice at a time.
- Node/Express remains compatibility only and receives no new Batch Factory business rules.
- Existing frozen `systemPresetVersions` must keep resolving after newer preset versions are published.
- Snapshot revision must stay compatible with the existing 12-character SHA-256 revision contract.
- The current Node preset store is temporary transport only in 2A; Node must not compute snapshot history or choose the authoritative pinned preset after cutover.
- Script/asset prompt selection and prefix category selection remain Phase 2B; 2A only changes generic versioned system-preset resolution already selected by existing orchestration.
- Director parsing/generation policy, effective settings, prompt compiler, production submission, merge and publish stay outside 2A.

---

### Task 1: Go config snapshot and frozen preset resolver

**Files:**
- Create: `backend/internal/shuihuo/batchfactory/config_snapshots.go`
- Create: `backend/internal/shuihuo/batchfactory/config_snapshots_test.go`

**Interfaces:**
- Consumes: raw historical preset rows from the compatibility payload.
- Produces:
  - `type PresetVersion struct`
  - `type ConfigSnapshot struct`
  - `type ConfigSnapshotCatalog struct`
  - `func ResolveConfigSnapshots(rows []PresetVersion) ConfigSnapshotCatalog`
  - `func ResolveVersionedPreset(rows []PresetVersion, id string, version int) (PresetVersion, bool)`

- [ ] **Step 1: Write failing snapshot-history tests**

Use the same history contract as `test/batch-factory-config-version.test.js`:

```go
rows := []PresetVersion{
    {ID:"director", Module:"batch-factory", Version:1, Status:"archived", Body:"director-v1", PublishedAt:"2026-08-20T00:00:00.000Z"},
    {ID:"assets", Module:"batch-factory", Version:1, Status:"archived", Body:"assets-v1", PublishedAt:"2026-08-20T00:01:00.000Z"},
    {ID:"director", Module:"batch-factory", Version:2, Status:"published", Body:"director-v2", PublishedAt:"2026-08-21T00:00:00.000Z"},
    {ID:"assets", Module:"batch-factory", Version:2, Status:"published", Body:"assets-v2", PublishedAt:"2026-08-22T00:00:00.000Z"},
}
```

Assert three snapshots with pins:

```text
assets@1 + director@1
assets@1 + director@2
assets@2 + director@2
```

Assert labels `配置 v1..v3`, and latest equals the final current published state.

- [ ] **Step 2: Run focused test and verify RED**

Run:

```bash
cd backend && go test ./internal/shuihuo/batchfactory -run 'TestResolveConfigSnapshots|TestResolveVersionedPreset' -v
```

Expected: FAIL because the resolver does not exist.

- [ ] **Step 3: Write failing frozen-preset resolution tests**

Assert:

```text
requested version 1 -> archived director v1 body
missing requested version -> current published director v2
version 0 -> current published director v2
wrong module / blank body -> ignored
```

The resolver must never select a draft as the published fallback, but an explicitly pinned historical version may be archived.

- [ ] **Step 4: Implement minimal Go resolver**

Implement deterministic helpers:

```text
stable pins: trim id, positive versions only, ASCII id sort
revision: sha256 of `id@version|...`, first 12 lowercase hex chars
published time: RFC3339/RFC3339Nano accepted, invalid omitted from replay events
required ids: ids whose current row has status=published
history replay: same event ordering as existing Node contract
```

`ResolveVersionedPreset` must filter to `module == "batch-factory"` and non-empty body. If a positive requested version exists, return it regardless of `published/archived`; otherwise return the current `published` row.

- [ ] **Step 5: Run package tests and verify GREEN**

Run:

```bash
cd backend && go test ./internal/shuihuo/batchfactory -v
```

Expected: PASS, including Phase 1 settings/store tests.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/shuihuo/batchfactory/config_snapshots.go backend/internal/shuihuo/batchfactory/config_snapshots_test.go
git commit -m "feat: resolve batch factory config snapshots in Go"
```

---

### Task 2: Authenticated Go compatibility endpoints

**Files:**
- Create: `backend/internal/httpapi/shuihuo_batch_factory_config_handlers.go`
- Create: `backend/internal/httpapi/shuihuo_batch_factory_config_handlers_test.go`
- Modify: `backend/internal/httpapi/router.go`

**Interfaces:**
- Consumes: Task 1 resolvers.
- Produces:
  - `POST /api/shuihuo-production/batch-factory/config-snapshots/resolve`
  - `POST /api/shuihuo-production/batch-factory/presets/resolve`

Snapshot request:

```json
{"presets":[{"id":"director","module":"batch-factory","version":1,"status":"archived","body":"...","publishedAt":"..."}]}
```

Snapshot response:

```json
{"latest":{"revision":"...","label":"配置 v3","publishedAt":"...","presetVersions":{}},"versions":[]}
```

Preset request:

```json
{"presets":[],"id":"director","version":1}
```

Preset response:

```json
{"preset":{"id":"director","name":"导演","version":1,"status":"archived","body":"director-v1","publishedAt":"..."}}
```

- [ ] **Step 1: Write failing HTTP tests**

Cover:

```text
invalid JSON -> 400
authenticated snapshot request -> exact 3-snapshot catalog
authenticated pinned preset version -> historical body
missing preset -> 404
wrong-module row cannot be resolved
```

Use existing `bridgeRequest` platform-auth test helpers. No database or provider call is required.

- [ ] **Step 2: Run HTTP tests and verify RED**

Run:

```bash
cd backend && go test ./internal/httpapi -run 'TestBatchFactoryConfigSnapshots|TestBatchFactoryPresetResolve' -v
```

Expected: 404 because routes do not exist.

- [ ] **Step 3: Implement handlers and routes**

Handlers only decode bounded payloads, call Task 1, and return JSON. Register adjacent to existing Batch Factory settings compatibility routes:

```go
r.Post("/shuihuo-production/batch-factory/config-snapshots/resolve", api.handleResolveBatchFactoryConfigSnapshots)
r.Post("/shuihuo-production/batch-factory/presets/resolve", api.handleResolveBatchFactoryPreset)
```

Reject an excessively large compatibility payload (more than 1000 preset rows) with 400.

- [ ] **Step 4: Run focused Go tests and verify GREEN**

Run:

```bash
cd backend && go test ./internal/shuihuo/batchfactory ./internal/httpapi -run 'BatchFactory|ResolveConfigSnapshots|ResolveVersionedPreset' -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/httpapi/router.go backend/internal/httpapi/shuihuo_batch_factory_config_handlers.go backend/internal/httpapi/shuihuo_batch_factory_config_handlers_test.go
git commit -m "feat: expose Go batch factory config snapshot API"
```

---

### Task 3: Node compatibility bridge with no snapshot business logic

**Files:**
- Create: `lib/batch-factory/config-snapshot-bridge.js`
- Create: `test/batch-factory-go-config-bridge.test.js`

**Interfaces:**
- Consumes:
  - `presetStore.listAll('batch-factory')` only as raw rows
  - existing `requestProductionBridge`
- Produces:
  - `resolveConfigCatalogWithGo({ username, isOwner, presetStore, shuihuoGateway })`
  - `resolvePresetWithGo({ username, isOwner, presetStore, id, version, shuihuoGateway })`
  - `resolvePresetBodyWithGo(...)`

- [ ] **Step 1: Write failing bridge tests**

Inject a fake bridge request and prove:

```text
all raw batch-factory rows are sent unchanged to Go
snapshot response is returned unchanged
pinned preset resolver sends id + integer version + raw rows
Go 4xx/5xx status and message propagate
missing/invalid preset response becomes 502, not Node fallback
```

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
node --test test/batch-factory-go-config-bridge.test.js
```

Expected: FAIL because bridge module does not exist.

- [ ] **Step 3: Implement the bridge**

The bridge must not calculate revisions, labels, current published versions, or fallback versions. Its only local transformation is reading `presetStore.listAll('batch-factory')` and validating that Go returned an object.

- [ ] **Step 4: Run bridge test and verify GREEN**

Run the same command; expect PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/batch-factory/config-snapshot-bridge.js test/batch-factory-go-config-bridge.test.js
git commit -m "refactor: bridge batch factory config snapshots to Go"
```

---

### Task 4: Cut runtime config snapshot and system-preset resolution to Go

**Files:**
- Modify: `routes/batch-factory.js`
- Modify: `routes/batch-factory-production.js`
- Create: `test/batch-factory-go-config-runtime.test.js`

**Interfaces:**
- Consumes Task 3 bridge.
- Keeps browser endpoint shapes unchanged.
- Does not change `resolveScriptPrompt` / `resolveAssetPrompt` yet; those belong to Phase 2B.

- [ ] **Step 1: Write failing runtime contract tests**

Assert source/runtime contracts:

```text
`routes/batch-factory.js` no longer imports listBatchFactoryConfigVersions, resolveVersionedPreset, or resolveVersionedSystemPresetBody
prompt-catalog calls resolveConfigCatalogWithGo
new batch creation gets latest systemConfigRevision/Label/PresetVersions from Go catalog
hook/director system preset body comes from resolvePresetBodyWithGo
prompt version metadata comes from resolvePresetWithGo
manual VIDEO compile uses Go-resolved prefix body
production compile uses Go-resolved prefix body
```

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
node --test test/batch-factory-go-config-runtime.test.js
```

Expected: FAIL because runtime still imports Node config-version business functions.

- [ ] **Step 3: Convert config catalog reads to async Go bridge**

Make `/prompt-catalog` async and obtain:

```js
const configCatalog = await resolveConfigCatalogWithGo({
  username: req.auth.account.username,
  isOwner: req.auth.account.isOwner === true,
  presetStore,
  shuihuoGateway
});
```

For batch creation, resolve the latest catalog before freezing config metadata. If no latest snapshot exists, preserve the current empty-snapshot behavior rather than inventing a revision.

- [ ] **Step 4: Convert generic system-preset resolution to Go**

Change the existing system-preset consumers to await the bridge:

```text
generateHook
generateDirector / director base preset metadata
manual compiled-prompt endpoint
production compileItemVideos
```

Background director jobs may authenticate the server-to-server resolver using the known username and `isOwner=false`; config resolution itself is not role-sensitive. User-request handlers should pass the real owner flag.

Do not call `resolveSystemPresetBody`, `resolveVersionedPreset`, or `resolveVersionedSystemPresetBody` as a fallback after Go cutover. Missing required system preset must surface as an error.

- [ ] **Step 5: Run runtime + existing regression tests**

Run:

```bash
node --test test/batch-factory-go-config-runtime.test.js
node --test test/batch-factory-go-config-bridge.test.js
node --test test/batch-factory-config-version.test.js
node --test test/batch-factory-settings-inheritance.test.js
node --test test/batch-factory.test.js
```

The old `config-version.test.js` remains as rollback compatibility coverage, but runtime routes must no longer use that implementation.

- [ ] **Step 6: Commit**

```bash
git add routes/batch-factory.js routes/batch-factory-production.js test/batch-factory-go-config-runtime.test.js
git commit -m "refactor: use Go config snapshots in batch factory runtime"
```

---

### Task 5: CI checkpoint and diff review

**Files:**
- Modify: `.github/workflows/batch-factory-verify.yml`

**Interfaces:**
- Produces fresh Phase 2A verification evidence.

- [ ] **Step 1: Add focused Go config and Node bridge/runtime checks**

Add before general regressions:

```yaml
- name: Test Go Batch Factory config snapshots
  working-directory: backend
  run: go test ./internal/shuihuo/batchfactory ./internal/httpapi -run 'BatchFactoryConfigSnapshots|BatchFactoryPresetResolve|ResolveConfigSnapshots|ResolveVersionedPreset'

- name: Test Go config compatibility bridge
  run: node --test test/batch-factory-go-config-bridge.test.js test/batch-factory-go-config-runtime.test.js
```

Keep all existing Phase 1B checks and frontend build.

- [ ] **Step 2: Push CI change and verify full workflow GREEN**

Required evidence:

```text
Go settings/store/migration/HTTP: pass
Go config snapshot resolver/HTTP: pass
Node settings bridge/hydration/lazy migration: pass
Node config bridge/runtime: pass
sparse overrides: pass
settings inheritance: pass
existing Batch Factory regression suite: pass
frontend npm ci + Vite build: pass
```

- [ ] **Step 3: Compare branch to pre-2A head**

Pre-2A head is `a5e24c1a96ca8369684472982ecd05b67b3beacb`.

Expected Phase 2A scope only:

```text
new Go config snapshot resolver/tests
new Go config compatibility handlers/tests
one or two new Go router lines
new Node config bridge/tests
Batch Factory runtime config lookup edits
CI additions
this plan document
```

No unrelated UI redesign, task executor, credential, merge or publish changes.

- [ ] **Step 4: Verify master remains unchanged**

Expected master SHA remains `3a6528881b043a27f6afbd4401336a94b07ee930` unless the user explicitly requested integration.
