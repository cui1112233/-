# Batch Factory V11 Alpha Slice 3: Effective Settings And Final Prompt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable one Go-owned effective-settings resolver and final VIDEO Prompt compiler for inspection now and production reuse later.

**Architecture:** The resolver accepts persisted system, Batch, Book, and immutable VIDEO scope IDs, preserves sparse semantic values, records compatibility, and produces a frozen effective-settings result. The compiler consumes only that result plus the Director revision; its identical serialized output is later passed to Production rather than reconstructed in React or Node.

**Tech Stack:** Go 1.23, MySQL 8.4, React 18, Node signed proxy.

## Global Constraints

- Slice 2 must be released and its Director revisions must be durable.
- `system -> batch -> book -> VIDEO` is the only settings precedence order.
- Preview and future submission must call the exact same `CompileFinalPrompt` function with the same snapshot hash.
- Orphaned/incompatible VIDEO patches are visible but never applied silently.
- Compiler output includes visual prompt, assets, prefix, quality, restriction, negative, subtitle policy, aspect ratio, and duration where active.
- Extend the Slice 1 V10-derived settings UI and existing Drawer/Modal presentation; do not create a second workbench shell for effective settings or final prompt inspection.

---

## File Structure

- Create: `backend/internal/batchfactoryv11/effective_settings.go`, `final_prompt.go`, `compiler_snapshot.go` and tests.
- Create: `backend/internal/httpapi/batch_factory_v11_compiler.go`, `batch_factory_v11_compiler_test.go`.
- Modify: `backend/internal/batchfactoryv11/capabilities.go`, `director.go`, `settings.go`.
- Create: `frontend/src/user/pages/batch-factory-v11/EffectiveSettingsPanel.jsx`, `FinalPromptDrawer.jsx`, `compilerState.js`, `compilerState.test.js` as thin additions using the existing V10-derived Card/Drawer/Modal styles.
- Modify: `frontend/src/shared/api/batchFactoryV11.js`, `frontend/src/user/pages/batch-factory-v11/BatchFactoryV11Workbench.jsx`, `V11SettingsDrawers.jsx`, `V11ConstraintSettings.jsx`.

### Task 1: Implement and prove settings precedence plus compatibility behavior

**Files:**
- Create: `backend/internal/batchfactoryv11/effective_settings.go`, `effective_settings_test.go`
- Modify: `backend/internal/batchfactoryv11/settings.go`, `director.go`

**Interfaces:**
- `ResolveEffectiveSettings(ctx, ownerID, batchID, bookID, videoID string) (EffectiveSettings, error)`.
- `EffectiveSettings` includes `Values`, `SourceByField`, `Compatibility`, `SnapshotHash`, and `DirectorRevisionID`.

- [ ] **Step 1: Write failing resolution tests**

```go
func TestResolveEffectiveSettingsUsesAllFourScopes(t *testing.T) {
    state := seedScopes(t, SettingsPatch{"quality": "system"}, SettingsPatch{"quality": "batch"}, SettingsPatch{"quality": "book"}, SettingsPatch{"quality": "video"})
    got := resolve(t, state)
    assert.Equal(t, "video", got.Values["quality"])
    assert.Equal(t, "video", got.SourceByField["quality"])
}

func TestIncompatibleOrphanedVideoPatchIsRetainedButNotApplied(t *testing.T) {
    got := resolve(t, seededOrphanedVideoPatch(t))
    assert.NotEqual(t, "old-value", got.Values["quality"])
    assert.Equal(t, "orphaned", got.Compatibility[0].State)
}
```

- [ ] **Step 2: Run tests and confirm no V11 resolver exists**

Run: `cd backend && go test ./internal/batchfactoryv11 -run 'TestResolveEffectiveSettingsUsesAllFourScopes|TestIncompatibleOrphanedVideoPatchIsRetainedButNotApplied' -count=1`

Expected: FAIL with missing resolver.

- [ ] **Step 3: Implement resolver and snapshot hash**

Load only Go-owned rows in one read transaction. Merge patches by explicit key
presence, not truthiness. Exclude disabled constraint text from active compiler
values while retaining it in the stored patch. Sort canonical keys and hash the
canonical snapshot JSON so the same inputs yield the same `SnapshotHash`.

- [ ] **Step 4: Run resolution suite**

Run: `cd backend && go test ./internal/batchfactoryv11 -run 'Test.*EffectiveSettings|Test.*Orphaned|Test.*False|Test.*Empty' -count=1`

Expected: PASS; false/empty values, restore inheritance, compatibility, and
field provenance are deterministic.

- [ ] **Step 5: Commit resolver core**

```bash
git add backend/internal/batchfactoryv11
git commit -m "feat(batch-v11): resolve effective settings in Go"
```

### Task 2: Build one Final Prompt compiler and read-only Go endpoints

**Files:**
- Create: `backend/internal/batchfactoryv11/final_prompt.go`, `compiler_snapshot.go`, `final_prompt_test.go`
- Create: `backend/internal/httpapi/batch_factory_v11_compiler.go`, `batch_factory_v11_compiler_test.go`
- Modify: `backend/internal/httpapi/router.go`, `backend/internal/batchfactoryv11/capabilities.go`

**Interfaces:**
- `CompileFinalPrompt(ctx, ownerID, batchID, bookID, videoID string) (FinalPrompt, error)`.
- `FinalPrompt` returns `Text`, `Payload`, `SnapshotHash`, `DirectorRevisionID`, and `CompilerVersion`.
- `GET /.../effective-settings` and `GET /.../final-prompt` are read-only and require `compiler.preview` capability.

- [ ] **Step 1: Write failing compiler completeness and determinism tests**

```go
func TestFinalPromptIncludesEveryActiveLayer(t *testing.T) {
    prompt := compileFixture(t)
    for _, want := range []string{"visual prompt", "character", "scene", "prop", "prefix", "quality", "restriction", "negative", "subtitle", "9:16", "10s"} {
        assert.Contains(t, prompt.Text, want)
    }
}

func TestFinalPromptHasStableSnapshotHash(t *testing.T) {
    assert.Equal(t, compileFixture(t).SnapshotHash, compileFixture(t).SnapshotHash)
}
```

- [ ] **Step 2: Run tests and confirm compiler endpoints are missing**

Run: `cd backend && go test ./internal/batchfactoryv11 ./internal/httpapi -run 'TestFinalPromptIncludesEveryActiveLayer|TestFinalPromptHasStableSnapshotHash' -count=1`

Expected: FAIL with missing compiler.

- [ ] **Step 3: Implement compiler and HTTP endpoints**

Compile from the stored Director video plus `ResolveEffectiveSettings`. Include
only enabled constraints but retain their non-active text in the settings
response. Serialize an explicit provider-neutral payload whose snapshot hash
will be required by Slice 4. Do not call a provider in this slice.

- [ ] **Step 4: Run Go compiler and handler tests**

Run: `cd backend && go test ./internal/batchfactoryv11 ./internal/httpapi -run 'Test.*FinalPrompt|Test.*EffectiveSettings|Test.*Compiler' -count=1`

Expected: PASS; cross-owner reads fail and output is deterministic.

- [ ] **Step 5: Commit compiler API**

```bash
git add backend/internal/batchfactoryv11 backend/internal/httpapi
git commit -m "feat(batch-v11): compile final prompts in Go"
```

### Task 3: Add effective-settings inspection and Final Prompt Drawer

**Files:**
- Create: `frontend/src/user/pages/batch-factory-v11/EffectiveSettingsPanel.jsx`, `FinalPromptDrawer.jsx`, `compilerState.js`, `compilerState.test.js`
- Modify: `frontend/src/shared/api/batchFactoryV11.js`, `frontend/src/user/pages/batch-factory-v11/BatchFactoryV11Workbench.jsx`, `VideoSettingsDrawer.jsx`

**Interfaces:**
- `loadEffectiveSettings(batchId, bookId, videoId)` and `loadFinalPrompt(...)` call Go endpoints.
- `FinalPromptDrawer` renders Go-returned text/payload/hash only; no client-side concatenation.

- [ ] **Step 1: Write failing UI tests for server-owned compiler data**

```js
test('final prompt drawer uses returned compiler text verbatim', () => {
  assert.equal(finalPromptView({ text: 'GO OUTPUT', snapshotHash: 'abc' }).text, 'GO OUTPUT');
});

test('orphaned override renders as warning not active value', () => {
  assert.equal(compatibilityTone({ state: 'orphaned' }), 'warning');
});
```

- [ ] **Step 2: Run state tests and confirm missing modules**

Run: `node --test frontend/src/user/pages/batch-factory-v11/compilerState.test.js`

Expected: FAIL with missing module.

- [ ] **Step 3: Add read-only inspection to the reused workbench UI**

Add effective field source labels, compatibility messages, snapshot hash, and a
right-side Final Prompt Drawer. The action is available only from the server
capability map. Reuse the existing V10-derived Drawer/Card surface and do not
expose a "send" button in this slice.

- [ ] **Step 4: Run tests, build, and manual compiler acceptance**

Run: `node --test frontend/src/user/pages/batch-factory-v11/compilerState.test.js && npm --prefix frontend run build`

Acceptance: alter Batch/Book/VIDEO settings; inspect exact field provenance;
confirm disabled constraints omit text from final prompt; refresh/restart and
reopen to see identical hash for unchanged input.

- [ ] **Step 5: Commit Slice 3 UI**

```bash
git add frontend/src/shared/api/batchFactoryV11.js frontend/src/user/pages/batch-factory-v11
git commit -m "feat(batch-v11): show effective settings and final prompt"
```

### Task 4: Publish Slice 3 Alpha evidence and stop

- [ ] **Step 1: Run `cd backend && go test ./...`, Node proxy/state tests, and `npm --prefix frontend run build`**

Expected: PASS.

- [ ] **Step 2: Release with immutable Slice 3 web/Go tags and a V11 database backup**

Use `scripts/batch-factory-v11-alpha-release.sh`; record compiler version and
capability map in the release manifest.

- [ ] **Step 3: Smoke-test live final prompt parity precondition**

On `:3000`, inspect a VIDEO final prompt and record its snapshot hash. Confirm
production remains unavailable, so no external provider task was submitted.

- [ ] **Step 4: Commit release evidence and stop**

```bash
git add docs/batch-factory
git commit -m "docs(batch-v11): record alpha slice three release"
```
