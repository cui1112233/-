# Batch Factory V11 Alpha Slice 1: Workbench And Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the already completed V10 React/Ant Design workbench on the V11 data path while adding real Go/MySQL persistence for Batch, Book, VIDEO, settings, configuration snapshots, sparse overrides, prompt selections, and Drawer edits.

**Architecture:** Slice 1 builds the V11 aggregate and settings APIs in Go, exposes them through the signed Node proxy, and selectively ports the audited V10 page structure and AntD components into a V11 adapter layer. The UI source is reused as presentation only; all data and actions come from V11. The complete UI is visible, but capability-controlled Director, compiler, production, merge, 121, and Yadi actions remain unavailable with server-provided reasons.

**Worktree ownership:** This plan is split across two independent workstreams.
This worktree executes only the Go aggregate/settings/snapshot/prompt
implementation and HTTP contracts (Tasks 1-2). The V78/V11 frontend adapter
and UI migration (Task 3) is owned by a parallel worktree and must not be
implemented, copied, or cherry-picked here. Slice 1 release coordination (Task
4) starts only after both workstreams provide separate commits and test
reports.

**Tech Stack:** Go 1.23/chi/MySQL 8.4, Node 24/Express proxy, React 18/Ant Design/Vite 5, Docker Compose.

## Global Constraints

- Complete Foundation plan before this slice.
- Use only `/api/batch-factory/v11/*` from the browser; do not call legacy `/api/batch-factory/*` from V11.
- All V11 reads/writes, ownership, settings canonicalization, snapshots, prompt/draft storage, and capability decisions belong to Go.
- `system -> batch -> book -> VIDEO` patches are sparse; explicit false/empty values survive save/refresh, and restore removes only selected keys.
- Model/mode/config changes may invalidate Director only; they never delete Book/VIDEO patches.
- Reuse the audited V10 UI sources recorded in `docs/batch-factory/v11-provenance.tsv`; do not redraw an equivalent workbench.
- Historical files remain unchanged for rollback/reference. V11 files must not import `shared/api/batchFactory`, `shared/api/generation`, `shared/api/shuihuoProduction`, legacy `/api/batch-factory/*`, or legacy `/api/shuihuo-production/*`.
- `bf11_*` names are allowed for the new client/state/test adapter only; Go/MySQL remains authoritative under `batch_factory_v11_*` tables.
- First Alpha deployment replaces `/batch-factory` only after tests, backup, immutable web/Go tags, and rollback manifest exist.

---

## File Structure

- Create: `backend/internal/batchfactoryv11/domain.go`, `repository.go`, `service.go`, `intakes.go`, `settings.go`, `snapshots.go`, `prompts.go`, `capabilities.go`.
- Create: matching `*_test.go` files under `backend/internal/batchfactoryv11/`.
- Create: `backend/internal/httpapi/batch_factory_v11_intakes.go`, `batch_factory_v11_batches.go`, `batch_factory_v11_settings.go`, `batch_factory_v11_prompts.go`, `batch_factory_v11_types.go` and handler tests.
- Modify: `backend/internal/storage/batch_factory_v11_schema.go` - add Slice 1 tables and constraints.
- Parallel workstream (not touched in this worktree): `frontend/src/shared/api/batchFactoryV11.js`; the V78/V11 adapter files, route changes, and UI tests listed in Task 3.
- This worktree creates/modifies only the Go/Node/DB files in Tasks 1-2 and their tests. The frontend build remains a downstream integration check.

### Task 1: Persist the V11 Batch/Book/VIDEO aggregate and sparse settings

**Files:**
- Create: `backend/internal/batchfactoryv11/domain.go`, `repository.go`, `service.go`, `settings.go`, `snapshots.go`, `prompts.go`
- Modify: `backend/internal/storage/batch_factory_v11_schema.go`
- Test: `backend/internal/batchfactoryv11/service_test.go`, `settings_test.go`, `snapshots_test.go`, `prompts_test.go`

**Interfaces:**
- `CreateNovelFetchIntake(ctx, ownerID, NovelFetchIntakeInput) (Intake, error)` persists a deduplicated owner-scoped selected novel set without starting Director work.
- `CreateBatchFromIntake(ctx, ownerID, intakeID string, input CreateBatchInput) (Batch, error)` consumes an intake once and creates immutable `Batch.ID`, `Book.ID`, and initial `Video.ID` only when supplied.
- `SaveSettings(ctx, ownerID, batchID string, patch SettingsPatch, expectedRevision int64) (SettingsState, error)` writes the Batch scope.
- `SaveBookOverride` and `SaveVideoOverride` write sparse patches; `RestoreInheritance` deletes only requested keys.
- `SettingsState` returns stored patch, scope metadata, snapshot summary, and compatibility entries; it does not claim to be the Slice 3 final compiler output.

- [ ] **Step 1: Write failing aggregate and override invariant tests**

```go
func TestSaveBatchSettingsPreservesBookAndVideoPatches(t *testing.T) {
    seed := seedBatchWithOverrides(t)
    _, err := service.SaveSettings(ctx, seed.OwnerID, seed.BatchID, SettingsPatch{"aspectRatio": "16:9"}, 1)
    require.NoError(t, err)
    assert.Equal(t, "custom-quality", loadBookPatch(t, seed).Get("quality"))
    assert.Equal(t, false, loadVideoPatch(t, seed).Get("negativeEnabled"))
}

func TestRestoreInheritanceRemovesOnlyRequestedOverrideKey(t *testing.T) {
    state := saveBookPatch(t, SettingsPatch{"quality": "x", "restriction": "y"})
    restored := restoreBookKeys(t, state, []string{"quality"})
    assert.False(t, restored.Patch.Has("quality"))
    assert.Equal(t, "y", restored.Patch.Get("restriction"))
}

func TestNovelFetchIntakeIsConsumedExactlyOnce(t *testing.T) {
    intake := createNovelFetchIntake(t, []NovelSource{{BookID: "207"}})
    require.NoError(t, createBatchFromIntake(t, intake.ID))
    assert.ErrorContains(t, createBatchFromIntake(t, intake.ID), "consumed")
}
```

- [ ] **Step 2: Run tests and confirm the V11 aggregate service is missing**

Run: `cd backend && go test ./internal/batchfactoryv11 -run 'TestSaveBatchSettingsPreservesBookAndVideoPatches|TestRestoreInheritanceRemovesOnlyRequestedOverrideKey|TestNovelFetchIntakeIsConsumedExactlyOnce' -count=1`

Expected: FAIL with missing package or symbols.

- [ ] **Step 3: Implement schema and transactional repository methods**

Create an owner-scoped V11 intake table with source-task/book deduplication and
an immutable consumed-at marker. Create foreign keys from Book to Batch and VIDEO to Book, owner-scoped indexes,
revision counters for optimistic save, `settings_json` JSON fields with explicit
scope identity, immutable snapshot records, versioned prompt definitions,
owner-scoped personal prompts, and drafts keyed by `(owner, scope, subject,
field)`. Store settings JSON exactly; normalize only in Go and never omit a
present false/empty field.

```go
type SettingsPatch map[string]any

type SettingsState struct {
    Patch         SettingsPatch       `json:"patch"`
    Revision      int64               `json:"revision"`
    Snapshot      ConfigSnapshotRef   `json:"snapshot"`
    Compatibility []CompatibilityNote `json:"compatibility"`
}
```

- [ ] **Step 4: Add snapshot/prompt persistence tests and run the package suite**

Run: `cd backend && go test ./internal/batchfactoryv11 -count=1`

Expected: PASS for aggregate ownership, sparse patches, false/empty values,
restore inheritance, immutable IDs, prompt owner isolation, and draft recovery.

- [ ] **Step 5: Commit the Slice 1 aggregate core**

```bash
git add backend/internal/batchfactoryv11 backend/internal/storage/batch_factory_v11_schema.go
git commit -m "feat(batch-v11): persist batches and sparse settings"
```

### Task 2: Expose Go-owned Slice 1 HTTP APIs and capabilities

**Files:**
- Create: `backend/internal/httpapi/batch_factory_v11_batches.go`, `batch_factory_v11_settings.go`, `batch_factory_v11_prompts.go`, `batch_factory_v11_types.go`
- Modify: `backend/internal/httpapi/router.go`, `backend/internal/httpapi/batch_factory_v11_capabilities.go`
- Test: `backend/internal/httpapi/batch_factory_v11_batches_test.go`, `batch_factory_v11_settings_test.go`, `batch_factory_v11_prompts_test.go`

**Interfaces:**
- `POST /api/batch-factory/v11/intakes/novel-fetch`; `GET /intakes/{intakeId}`; `POST /intakes/{intakeId}/batches`.
- `GET/POST /api/batch-factory/v11/batches`; `GET /batches/{batchId}`.
- `PUT /batches/{batchId}/settings`; `PUT /books/{bookId}/override`; `PUT /videos/{videoId}/override`.
- `GET /config-versions`; `POST /batches/{batchId}/change-impact`.
- `GET/POST /prompts`, `GET/PUT /drafts` are owner-scoped Go endpoints.

- [ ] **Step 1: Write failing handler tests for ownership, conflict, and capability unlock**

```go
func TestSaveVideoOverrideRejectsAnotherOwnersVideo(t *testing.T) {
    response := signedJSON(api, otherOwner, http.MethodPut, "/api/batch-factory/v11/batches/b1/books/k1/videos/v1/override", map[string]any{"patch": map[string]any{"quality": "x"}})
    assert.Equal(t, http.StatusNotFound, response.Code)
}

func TestSliceOneCapabilitiesUnlockOnlySettings(t *testing.T) {
    got := getCapabilities(t, api)
    assert.True(t, got["batch.read"].Available)
    assert.True(t, got["settings.edit"].Available)
    assert.False(t, got["director.run"].Available)
}

func TestCreateBatchFromOtherOwnersIntakeReturnsNotFound(t *testing.T) {
    response := signedJSON(api, otherOwner, http.MethodPost, "/api/batch-factory/v11/intakes/i1/batches", map[string]any{})
    assert.Equal(t, http.StatusNotFound, response.Code)
}
```

- [ ] **Step 2: Run handler tests and confirm they fail before handlers are registered**

Run: `cd backend && go test ./internal/httpapi -run 'TestSaveVideoOverrideRejectsAnotherOwnersVideo|TestSliceOneCapabilitiesUnlockOnlySettings|TestCreateBatchFromOtherOwnersIntakeReturnsNotFound' -count=1`

Expected: FAIL with `404` or missing handler symbols.

- [ ] **Step 3: Implement handlers with Go validation and revision conflict responses**

Validate intake source-task/book duplication, path IDs, ownership, JSON size, and expected revision in Go. Return
`409` with the newest `SettingsState` when a revision is stale. Route
`change-impact` through Go, returning zero Director effects before Slice 2 but
never a hard-coded count. Mark only `batch.read`, `batch.create`,
`settings.edit`, `snapshot.read`, and `override.edit` available.

- [ ] **Step 4: Run HTTP and database tests**

Run:

```bash
cd backend
go test ./internal/httpapi -run 'Test.*V11|TestSaveVideoOverrideRejectsAnotherOwnersVideo' -count=1
go test ./internal/batchfactoryv11 -count=1
```

Expected: PASS; unauthorized, cross-owner, stale-revision, and unsupported
capability paths are all explicit.

- [ ] **Step 5: Commit the Slice 1 Go API**

```bash
git add backend/internal/httpapi backend/internal/batchfactoryv11
git commit -m "feat(batch-v11): expose settings and snapshot APIs"
```

### Task 3: Parallel frontend workstream handoff (do not execute here)

**Owner:** Parallel V78/V11 frontend worktree.

**Files:** The V78 base files and selective historical UI sources recorded in
`docs/batch-factory/v11-provenance.tsv`; the new `batchFactoryV11.js` client,
adapter/state modules, and route wiring described below. None of these files
may be edited from this Go/Foundation worktree.

**Interfaces:**
- `loadWorkbench()` calls capabilities then lists/selects V11 batches; if `?intake=<id>` is present it reads the Go intake and creates a Batch only after explicit user confirmation; no demo fallback is allowed.
- `bf11UiAdapter` maps Go V11 aggregate/settings/capability responses to the existing V10 view props and maps view events to V11 request functions; it never computes effective settings or status.
- `saveDrawer(scope, patch, revision)` calls the relevant V11 PUT endpoint and replaces state with the server response.
- `CapabilityAction` receives `{capability, capabilities, onClick}` and is enabled only if `capabilities[capability].available === true`.

The parallel owner must preserve the V78 workbench, selectively migrate the
Drawer/Inline Constraints/Book settings UI, and connect only to the Go API.
The handoff acceptance is the source guard, state tests, and frontend build
listed below; it is not a task for this branch.

- [ ] **Step 1 (parallel owner): Write failing pure UI-state tests for server capability gating**

```js
test('unreleased action remains disabled from server capability', () => {
  assert.equal(actionState({ 'director.run': { available: false, reason: 'not released' } }, 'director.run').disabled, true);
});

test('selecting a Book changes the current Book identity', () => {
  assert.equal(selectBook({ selectedBookId: 'a' }, 'b').selectedBookId, 'b');
});

test('intake handoff does not start Director automatically', () => {
  assert.equal(intakeCreateState({ id: 'i1', consumedAt: '' }).startsDirector, false);
});
```

- [ ] **Step 2 (parallel owner): Run the source guard and state tests before the adapter exists**

Run: `node --test frontend/src/user/pages/batch-factory-v11/v11-ui-source-guard.test.js frontend/src/user/pages/batch-factory-v11/batchFactoryV11State.test.js`

Expected: FAIL because the V11 adapter files do not exist and the guard has no clean import surface.

- [ ] **Step 3 (parallel owner): Port only the audited presentation and replace its data seam**

Use the exact audited source commits from the design document, preserving the
V10 JSX structure, AntD cards, Drawers, Book/VIDEO settings affordances, status
presentation, and CSS tokens. Extract or rename only enough to create V11-owned
files. Replace every legacy API import and callback with `bf11UiAdapter` or
`batchFactoryV11.js`; a V11 file must contain no legacy route string. Keep
`workspace-layout.js` pure and allow it to persist only layout preference in
browser storage. Make `V11ConstraintSettings` controlled: Go supplies system
presets, personal prompts, drafts, stored text, enabled flags, and revisions;
the component emits patches and does not call old generation prompt APIs. The
production and status components may render in Slice 1, but their mutating
controls remain capability-gated until their Go slices release.

Replace the early `return <BatchFactoryPreviewPage />` in `BatchFactoryPage.jsx`
with `BatchFactoryV11Workbench`. Preserve `/batch-factory-preview` as the old
static page. The new page must use a real empty state when no V11 batch exists,
a real selected Book detail when one is selected, and server data for every
count/status. Change the Batch Rewrite handoff and Novel Fetch page only to
POST selected source items to the Go V11 intake endpoint and redirect to
`/batch-factory?intake=<id>`; Node forwards the request without interpreting the
items. The V11 intake page must not start Director automatically.

Implement the wide production Drawer in this exact order: configuration
version, basic settings, inline constraints. Book and VIDEO Drawers show sparse
patches, version choice, compatibility notes, and explicit restore inheritance.
The Drawer save path calls Go; it must not write browser storage as an
authoritative state. Full Director/production/merge/publish panels remain
visible through `CapabilityAction` but are unavailable until later slices.

- [ ] **Step 4 (parallel owner): Run UI state tests, build, and browser smoke checks**

Run:

```bash
node --test frontend/src/user/pages/batch-factory-v11/v11-ui-source-guard.test.js frontend/src/user/pages/batch-factory-v11/bf11UiAdapter.test.js frontend/src/user/pages/batch-factory-v11/batchFactoryV11State.test.js
npm --prefix frontend run build
```

Manual smoke in an isolated stack: login; open `/batch-factory`; create an
empty/manual Batch only when `batch.create` is available; save Batch, Book, and
VIDEO patches; refresh; restart the web/Go services; confirm all patches and
selected snapshot remain. Confirm Director/production/merge controls explain
their unavailable state instead of sending a legacy request. Compare the V11
screenshot/layout against the audited V10 page; differences must be limited to
server data, capability labels, and the V11 route/API namespace.

- [ ] **Step 5 (parallel owner): Commit the V11 workbench**

```bash
git add frontend/src/user/App.jsx frontend/src/user/pages/BatchFactoryPage.jsx frontend/src/user/pages/batch-factory-v11 frontend/src/shared/api/batchFactoryV11.js
git commit -m "feat(batch-v11): add persisted settings workbench"
```

### Task 4: Publish Slice 1 to the personal Alpha and verify rollback (coordination only)

**Files:**
- Modify: `docs/batch-factory/BATCH_FACTORY_COMPLETE_DESIGN_AND_BRANCH_MAP.md`, `docs/batch-factory/v11-provenance.tsv`
- Create: `docs/batch-factory/alpha-releases/<release>.md`

**Interfaces:**
- Input: completed Slice 1 SHA and Foundation release script.
- Output: Alpha manifest with previous image pair, new image digests, database backup ID, migration checksum report, capability response, and rollback command.

- [ ] **Step 1 (after both workstreams): Run full pre-release verification against a fresh test stack**

Run:

```bash
npm ci
npm --prefix frontend ci
npm --prefix frontend run build
node --test test/batch-factory-v11-proxy.test.js frontend/src/user/pages/batch-factory-v11/batchFactoryV11State.test.js
cd backend && go test ./...
```

Expected: PASS; run the MySQL 8.4 migration matrix from Foundation again if the
Slice 1 schema changed.

- [ ] **Step 2 (release owner, after explicit approval): Produce backup, immutable images, and deploy using the release script**

Run the non-dry-run Foundation script with the exact preceding images captured
from the running Alpha. Record both image digests and the V11 schema backup ID
before Compose applies the release.

- [ ] **Step 3 (release owner, after explicit approval): Verify the live `:3000` Alpha behavior**

Check `/api/build-info`, authenticated `GET /api/batch-factory/v11/capabilities`,
and the real `/batch-factory` workbench. Confirm no hard-coded sample novels
appear, Drawer data survives refresh/restart, and unreleased actions do not
call legacy Batch Factory endpoints.

- [ ] **Step 4 (release owner): Exercise rollback in a non-production rehearsal and record it**

Use the generated manifest in an isolated Compose project to restore the
previous images and backup. The rehearsal must prove the command is executable
before the live release is reported as complete.

- [ ] **Step 5 (release owner): Commit release evidence and stop for Alpha review**

```bash
git add docs/batch-factory
git commit -m "docs(batch-v11): record alpha slice one release"
```

Stop after reporting the SHA, image digests, backup ID, capabilities, smoke
result, rollback command, and remaining disabled actions. Do not start Slice 2
without review.
