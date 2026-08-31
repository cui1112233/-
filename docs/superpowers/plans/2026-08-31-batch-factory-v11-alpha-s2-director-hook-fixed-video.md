# Batch Factory V11 Alpha Slice 2: Director, Hook, And Fixed Single VIDEO Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable Go-owned original Director, Viral/Hook review, Director revision persistence, and fixed single VIDEO behavior in the personal Alpha.

**Architecture:** Go builds the Hook/Director request from a frozen V11 snapshot, invokes the configured text provider through a narrow adapter, validates and normalizes the output, then persists immutable Director revisions and VIDEO identities. The UI only displays and edits data returned by Go; it does not assemble an alternate prompt or generate VIDEO records locally.

**Tech Stack:** Go 1.23, MySQL 8.4, configured Go text provider adapter, Node signed proxy, React 18/Ant Design.

## Global Constraints

- Slice 1 and its live rollback manifest must be accepted first.
- Director mode, model capabilities, prompt versions, and settings snapshot are frozen before provider invocation.
- Viral mode requires visible conflict/behavior escalation where source and safety boundaries permit; adding an adjective alone is not a valid implementation.
- Fixed single VIDEO persists exactly one immutable VIDEO identity, never a fake split list.
- A model/mode/configuration change invalidates the Director revision only. It preserves Book/VIDEO patches and labels obsolete VIDEO patches `orphaned` or `incompatible`.
- Node must not construct Hook/Director prompts or parse results.

---

## File Structure

- Create: `backend/internal/batchfactoryv11/director.go`, `director_contract.go`, `director_store.go`, `fixed_single_video.go`, `director_provider.go`.
- Create: `backend/internal/batchfactoryv11/director_test.go`, `director_store_test.go`, `fixed_single_video_test.go`.
- Create: `backend/internal/httpapi/batch_factory_v11_director.go`, `batch_factory_v11_director_test.go`.
- Modify: `backend/internal/batchfactoryv11/capabilities.go`, `settings.go`, `snapshots.go`, `backend/internal/storage/batch_factory_v11_schema.go`.
- Create: `frontend/src/user/pages/batch-factory-v11/DirectorPanel.jsx`, `HookReviewPanel.jsx`, `FixedSingleVideoControl.jsx`, `directorState.js`, `directorState.test.js`.
- Modify: `frontend/src/user/pages/batch-factory-v11/BatchFactoryV11Workbench.jsx`, `ProductionSettingsDrawer.jsx`, `BookSettingsCard.jsx`.

### Task 1: Define and test immutable Director revisions and VIDEO identities

**Files:**
- Create: `backend/internal/batchfactoryv11/director.go`, `director_store.go`, `fixed_single_video.go`
- Modify: `backend/internal/storage/batch_factory_v11_schema.go`
- Test: `backend/internal/batchfactoryv11/director_store_test.go`, `fixed_single_video_test.go`

**Interfaces:**
- `CreateDirectorRevision(ctx, DirectorRequest) (DirectorRevision, error)` stores `snapshot_id`, mode, output, and source digest.
- `ReplaceVideosForRevision(ctx, revisionID, []VideoDraft) ([]Video, []OrphanedOverride, error)` creates immutable VIDEO IDs and never reuses array indexes.
- `InvalidateDirector(ctx, batchID, reason) (ChangeImpact, error)` preserves patches and marks compatibility.

- [ ] **Step 1: Write failing identity and invalidation tests**

```go
func TestReDirectorPreservesOldVideoOverrideAsOrphaned(t *testing.T) {
    old := seedRevisionWithVideoPatch(t, "video-old", SettingsPatch{"quality": "cinematic"})
    result := reDirector(t, old.BookID, []VideoDraft{{VisualPrompt: "new", DurationSeconds: 8}})
    assert.Equal(t, "orphaned", result.OrphanedOverrides[0].State)
    assert.Equal(t, "video-old", result.OrphanedOverrides[0].VideoID)
}

func TestFixedSingleVideoCreatesExactlyOneVideoWithinModelLimit(t *testing.T) {
    result := normalizeDirector(t, DirectorInput{FixedSingleVideo: true, MaxDurationSeconds: 10})
    assert.Len(t, result.Videos, 1)
    assert.LessOrEqual(t, result.Videos[0].DurationSeconds, 10)
}
```

- [ ] **Step 2: Run tests and confirm current V11 has no Director revision store**

Run: `cd backend && go test ./internal/batchfactoryv11 -run 'TestReDirectorPreservesOldVideoOverrideAsOrphaned|TestFixedSingleVideoCreatesExactlyOneVideoWithinModelLimit' -count=1`

Expected: FAIL with missing package symbols.

- [ ] **Step 3: Add revision/video tables and transactional service behavior**

Create `batch_factory_v11_director_revisions`, `batch_factory_v11_videos`, and
`batch_factory_v11_orphaned_overrides`. Require a single transaction for a new
revision, replacement VIDEO rows, and orphaned-patch audit entries. Store a
reference to the exact snapshot and source digest. `fixed_single_video` rejects
an output with zero or more than one retained VIDEO after normalization.

- [ ] **Step 4: Run the domain package suite**

Run: `cd backend && go test ./internal/batchfactoryv11 -run 'Test.*Director|Test.*FixedSingle|Test.*Orphaned' -count=1`

Expected: PASS; a new Director revision never deletes or silently reapplies
the old VIDEO patch.

- [ ] **Step 5: Commit Director persistence**

```bash
git add backend/internal/batchfactoryv11 backend/internal/storage/batch_factory_v11_schema.go
git commit -m "feat(batch-v11): persist director revisions and video identities"
```

### Task 2: Build Go Hook and Director contracts, provider invocation, and normalization

**Files:**
- Create: `backend/internal/batchfactoryv11/director_contract.go`, `director_provider.go`, `director_test.go`
- Create: `backend/internal/httpapi/batch_factory_v11_director.go`, `batch_factory_v11_director_test.go`
- Modify: `backend/internal/httpapi/router.go`, `backend/internal/batchfactoryv11/capabilities.go`

**Interfaces:**
- `RunHook(ctx, ownerID, bookID) (HookRevision, error)` creates a reviewable Hook for Viral mode.
- `ApproveHook(ctx, ownerID, bookID, hookRevisionID) (Book, error)` records explicit review acceptance.
- `RunDirector(ctx, ownerID, batchID, bookID) (DirectorRevision, error)` requires valid frozen input.
- Provider interface: `Complete(ctx context.Context, model FrozenTextModel, prompt string) (string, error)`.

- [ ] **Step 1: Write failing contract tests for Viral emotion and Hook review**

```go
func TestViralDirectorContractRequiresBehavioralEmotionalEscalation(t *testing.T) {
    contract := buildContract(t, ModeViral, "她被当众羞辱后沉默离开")
    assert.Contains(t, contract.Instructions, "visible conflict")
    assert.Contains(t, contract.Instructions, "behavior escalation")
}

func TestDirectorRejectsUnapprovedViralHook(t *testing.T) {
    err := runDirectorExpectError(t, viralBookWithoutApprovedHook())
    assert.ErrorContains(t, err, "Hook")
}
```

- [ ] **Step 2: Run tests and verify absence of V11 Hook/Director API**

Run: `cd backend && go test ./internal/batchfactoryv11 ./internal/httpapi -run 'TestViralDirectorContractRequiresBehavioralEmotionalEscalation|TestDirectorRejectsUnapprovedViralHook' -count=1`

Expected: FAIL with missing V11 contract and routes.

- [ ] **Step 3: Implement Go-only contract and provider path**

Resolve every selected system/personal prompt version and the snapshot in Go.
The provider adapter receives only the frozen contract. Parse string-wrapped JSON
and JSON responses, validate required source coverage, clamp duration to the
frozen model capability, then call the revision store. A feature gate for
Director is checked before model credential lookup or provider transport.

- [ ] **Step 4: Add handler tests and run the focused suite**

Run:

```bash
cd backend
go test ./internal/batchfactoryv11 -run 'Test.*Hook|Test.*Director|Test.*FixedSingle' -count=1
go test ./internal/httpapi -run 'Test.*V11Director|Test.*V11Hook' -count=1
```

Expected: PASS; provider-disabled calls fail before adapter invocation, and
approved Viral Hook plus original mode each produce persisted revisions.

- [ ] **Step 5: Commit the Go Director slice**

```bash
git add backend/internal/batchfactoryv11 backend/internal/httpapi
git commit -m "feat(batch-v11): add Go hook and director workflow"
```

### Task 3: Connect the V11 Director UI and fixed single VIDEO controls

**Files:**
- Create: `frontend/src/user/pages/batch-factory-v11/DirectorPanel.jsx`, `HookReviewPanel.jsx`, `FixedSingleVideoControl.jsx`, `directorState.js`, `directorState.test.js`
- Modify: `frontend/src/user/pages/batch-factory-v11/BatchFactoryV11Workbench.jsx`, `ProductionSettingsDrawer.jsx`, `BookSettingsCard.jsx`

**Interfaces:**
- `DirectorPanel` receives `{book, capabilities, onRunDirector, onApproveHook}`.
- `FixedSingleVideoControl` receives a server-returned model duration capability and only submits a settings patch.
- UI obtains affected counts and compatibility warning from Go `change-impact`; it never computes them from a local list.

- [ ] **Step 1: Write failing UI-state tests**

```js
test('Viral mode requires approved Hook before Director action is available', () => {
  assert.equal(directorActionState({ mode: 'viral', hook: { status: 'draft' } }).disabled, true);
});

test('fixed single VIDEO displays server maximum duration', () => {
  assert.equal(fixedVideoLabel({ maxDurationSeconds: 10 }), '固定单 VIDEO，最长 10 秒');
});
```

- [ ] **Step 2: Run tests and confirm missing Director UI helpers**

Run: `node --test frontend/src/user/pages/batch-factory-v11/directorState.test.js`

Expected: FAIL with missing module.

- [ ] **Step 3: Implement Drawer and workbench behavior**

Show original/Viral selection, configuration impact warning, fixed single
VIDEO, Hook review, Director revision state, and retained orphaned override
notice. Use `CapabilityAction` for all controls. A Go failure is rendered as a
failure state; do not transition a Book locally to completed.

- [ ] **Step 4: Run tests, build, and isolated browser acceptance**

Run:

```bash
node --test frontend/src/user/pages/batch-factory-v11/directorState.test.js
npm --prefix frontend run build
```

Acceptance: original Director; Viral Hook generation/review/approval; a
fixed-single result; model/mode change warning; orphaned VIDEO override
visible; refresh and service restart keep revision/audit state.

- [ ] **Step 5: Commit the V11 Director UI**

```bash
git add frontend/src/user/pages/batch-factory-v11
git commit -m "feat(batch-v11): add director and hook workbench controls"
```

### Task 4: Release Slice 2 to :3000 Alpha and stop for review

**Files:**
- Modify: `docs/batch-factory/v11-provenance.tsv`, `docs/batch-factory/BATCH_FACTORY_COMPLETE_DESIGN_AND_BRANCH_MAP.md`
- Create: `docs/batch-factory/alpha-releases/<release>.md`

- [ ] **Step 1: Run pre-release tests and fresh MySQL verification**

Run: `npm --prefix frontend run build && node --test frontend/src/user/pages/batch-factory-v11/directorState.test.js && cd backend && go test ./...`

Expected: PASS; repeat migration verification if schema changed.

- [ ] **Step 2: Use the Alpha release script with new immutable images and a database backup**

Capture the Slice 1 image pair, create the V11 schema backup, build the Slice 2
web/Go SHA tags, and record the Director feature gate state in the manifest.

- [ ] **Step 3: Run live Alpha smoke checks**

Verify `/batch-factory` shows real data; Director and Hook operate only after
their Go capability is true; production, merge, 121, and Yadi remain correctly
unavailable; no V11 browser request reaches a legacy Batch Factory route.

- [ ] **Step 4: Commit release evidence and stop**

```bash
git add docs/batch-factory
git commit -m "docs(batch-v11): record alpha slice two release"
```

Do not begin compiler work until the Slice 2 Alpha evidence is reviewed.
