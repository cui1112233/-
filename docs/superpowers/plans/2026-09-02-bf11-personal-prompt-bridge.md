# Batch Factory V11 Personal Prompt Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline execution in this session).

**Goal:** Make the existing personal-center constraint prompts selectable in Batch Factory V11 and ensure the selected prompt body is persisted into batch settings and used by the final prompt compiler.

**Architecture:** Keep the personal-center prompt store as the source for user-owned constraint prompts. The V11 UI loads the four existing categories (`prefix`, `quality`, `restriction`, `negative`) through the authenticated Node API, presents their real names and bodies, and writes the selected body plus source/id metadata into the V11 sparse batch patch. The Go compiler remains the execution authority: it compiles the persisted batch/book/VIDEO settings, while the selected personal prompt is frozen in the batch patch so later personal-center edits cannot silently change an already saved batch.

**Tech Stack:** React/Ant Design, Node test runner, Go 1.23 HTTP API and in-memory/MySQL stores.

**Spec:** Existing V11 settings, prompt-library, and final-prompt contracts in `backend/internal/batchfactoryv11` and `frontend/src/user/pages/batch-factory-v11`.

## Global Constraints

- Work only on `fix/bf11-personal-prompt-bridge-20260902`, based on `826d1d356f86bbc238df62ea81adafbc038b381a`.
- Do not modify `master`, production `:3000`, production MySQL volumes, or Novel Fetch/121 code.
- Keep personal prompt bodies server-authenticated; never expose API keys or credentials.
- Preserve sparse Batch/Book/VIDEO settings and revision conflict handling.
- Do not claim production release; only push the candidate and wait for CI/approved deployment.

### Task 1: Load personal-center prompts into V11 workbench state

**Files:**
- Modify: `frontend/src/user/pages/batch-factory-v11/bf11UiAdapter.js`
- Modify: `frontend/src/user/pages/batch-factory-v11/bf11Runtime.js`
- Modify: `frontend/src/user/pages/batch-factory-v11/BatchFactoryV11UiPage.jsx`
- Test: `frontend/src/user/pages/batch-factory-v11/bf11UiAdapter.test.js`

**Interfaces:**
- Consume the existing `listScriptConstraintPrompts(category)` API for the four supported categories.
- Produce `runtimeState.personalPrompts` as `{ prefix: Prompt[], quality: Prompt[], restriction: Prompt[], negative: Prompt[] }`.

- [ ] **Step 1: Write the failing test**

Add an adapter test that supplies `listScriptConstraintPrompts` responses and asserts `loadWorkbench()` returns category-keyed personal prompts.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --test frontend/src/user/pages/batch-factory-v11/bf11UiAdapter.test.js`

Expected: FAIL because the adapter currently does not load personal-center prompt categories.

- [ ] **Step 3: Implement the minimal loader**

Add a small category loader in the adapter, fetch the four categories in parallel, preserve an empty list on an unavailable category with an explicit `personalPromptsError`, and pass the result through runtime state.

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `node --test frontend/src/user/pages/batch-factory-v11/bf11UiAdapter.test.js`

Expected: PASS.

- [ ] **Step 5: Commit the task**

Commit message: `feat(batch-v11): load personal constraint prompts into workbench`

### Task 2: Make constraint selectors use real personal prompts

**Files:**
- Modify: `frontend/src/user/pages/batch-factory-v11/BatchFactoryV11SettingsDrawers.jsx`
- Modify: `frontend/src/user/pages/batch-factory-v11/BatchFactoryV11ConstraintEditor.jsx`
- Test: `frontend/src/user/pages/batch-factory-v11/settings-source.test.js`

**Interfaces:**
- Consume `personalPrompts` from workbench state.
- Persist `{key}PromptSource` and `{key}PromptId` alongside the selected `{key}` body.

- [ ] **Step 1: Write the failing source-contract tests**

Assert that the settings drawer passes `personalPrompts`, the constraint editor accepts it, and personal options are derived from actual prompt records rather than the placeholder `我的…01` option.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --test frontend/src/user/pages/batch-factory-v11/settings-source.test.js`

Expected: FAIL because the current editor has no personal prompt prop and uses a hard-coded option.

- [ ] **Step 3: Implement selector behavior**

For each constraint category, show the real prompt name and body. When a user selects a personal prompt, immediately copy its body into the current sparse patch and persist source/id metadata. Keep “当前草稿” editing available and clear stale personal IDs when the user switches source.

- [ ] **Step 4: Run focused tests and the complete V11 UI test set**

Run: `node --test frontend/src/user/pages/batch-factory-v11/settings-source.test.js frontend/src/user/pages/batch-factory-v11/*.test.js`

Expected: PASS.

- [ ] **Step 5: Commit the task**

Commit message: `feat(batch-v11): bind personal prompts to constraint selectors`

### Task 3: Ensure Director and final compiler honor selected prompt identities

**Files:**
- Modify: `backend/internal/batchfactoryv11/director_contract.go`
- Modify: `backend/internal/batchfactoryv11/director_service.go`
- Modify: `backend/internal/batchfactoryv11/final_prompt.go`
- Test: `backend/internal/batchfactoryv11/director_service_test.go`
- Test: `backend/internal/batchfactoryv11/final_prompt_test.go`

**Interfaces:**
- Use `Store.ListPrompts(ctx, owner, kind)` to resolve selected V11 prompt IDs owner-scoped.
- Reject a selected personal prompt ID that is missing or owned by another user instead of silently falling back.
- Include resolved script/asset prompt text in the Director system contract and expose prompt source/id in effective settings for auditability.

- [ ] **Step 1: Write failing Go tests**

Add tests that create an owner-scoped prompt, select its ID in batch settings, assert the Director provider receives its unique marker, assert final prompt metadata contains the selected IDs, and assert a cross-owner/missing ID returns `ErrNotFound`.

- [ ] **Step 2: Run the focused Go tests and verify they fail**

Run: `go test ./internal/batchfactoryv11 -run 'Test(DirectorUsesSelectedPrompt|FinalPromptIncludesSelectedPrompt|RejectsUnknownSelectedPrompt)' -count=1`

Expected: FAIL because the current Director contract and compiler ignore `scriptPromptPresetId`/`assetPromptPresetId` and personal prompt IDs.

- [ ] **Step 3: Implement owner-scoped prompt resolution**

Add a helper that resolves a selected prompt from `Store.ListPrompts`, validates the expected category, freezes its body into the Director snapshot/effective settings, and appends clearly labeled sections to the Director system prompt. Keep existing built-in behavior when no personal ID is selected.

- [ ] **Step 4: Run focused and complete Go tests**

Run: `go test ./internal/batchfactoryv11 -count=1`

Expected: PASS.

- [ ] **Step 5: Commit the task**

Commit message: `feat(batch-v11): apply selected personal prompts in director`

### Task 4: Verify, push candidate branch, and report release gate

**Files:**
- Modify: `docs/superpowers/plans/2026-09-02-bf11-personal-prompt-bridge.md`

- [ ] **Step 1: Run all available local frontend tests**

Run: `node --test frontend/src/user/pages/batch-factory-v11/*.test.js`

- [ ] **Step 2: Push the exact candidate tree to GitHub**

Create blobs/tree/commit from the verified files, then move only `fix/bf11-personal-prompt-bridge-20260902` to the new commit. Do not modify `master` or deploy `:3000`.

- [ ] **Step 3: Inspect CI**

Fetch the workflow run for the new commit and report the actual Go/frontend/node-proxy results. If CI fails, fix with another red-green cycle.

- [ ] **Step 4: Report remaining release blockers**

State exactly whether personal-center prompt selection is now wired, whether all tests passed, and that production deployment remains blocked until the approved deployment workflow and real provider E2E credentials are available.
