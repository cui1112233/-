# AutoDL H3 Transparent Reference Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Submit the public transparent PNG as `ref_image_0` when the selected AutoDL H3 image workflow has no user reference image.

**Architecture:** Keep the behavior inside `AutoDLH3VideoAdapter.Submit`, where final prompt images are already normalized and the provider payload is constructed. Preserve real user images and the explicit text-only workflow; no database, frontend, or retry behavior changes.

**Tech Stack:** Go, `net/http`, `httptest`, existing Batch Factory V11 provider adapter.

## Global Constraints

- Use Git `v88` lineage as the source of truth and release the committed SHA only.
- Do not put provider credentials in code, test output, Git, or logs.
- Do not replay existing failed provider tasks during this repair.
- `minimax_h3_lightx2v_no_pic` must continue to omit `ref_image_N` fields.

---

### Task 1: Add and prove the H3 fallback payload behavior

**Files:**

- Modify: `backend/internal/batchfactoryv11/autodl_h3_video_adapter.go`
- Modify: `backend/internal/batchfactoryv11/autodl_h3_video_adapter_test.go`

**Interfaces:**

- Consumes: `AutoDLH3VideoAdapter.Submit(ctx, model, prompt)` and `FinalPrompt.ReferenceImageURLs`.
- Produces: a provider JSON payload with `ref_image_0` for a configured image workflow with no source image.

- [ ] **Step 1: Write the failing tests**

Add `httptest` cases for these observable HTTP payloads:

```go
// configured minimax_h3_zm_u24 without references must receive:
// {"ref_image_0":"https://tvmao-public.tos-cn-beijing.volces.com/tapnow/empty.png"}
// configured minimax_h3_zm_u24 with https://assets.example/user.png must receive:
// {"ref_image_0":"https://assets.example/user.png"}
// configured minimax_h3_lightx2v_no_pic without references must not include a ref_image_ key.
```

Name the protected break: omitting the required image input for a configured
image workflow, replacing a user image, or changing explicit text-only
behavior.

- [ ] **Step 2: Run the focused tests to verify RED**

Run `go test ./internal/batchfactoryv11 -run 'TestAutoDLH3VideoAdapter.*(Transparent|ConfiguredWorkflow)' -count=1`.

Expected: the transparent-reference case fails because the current payload
has no `ref_image_0`.

- [ ] **Step 3: Implement the smallest adapter change**

Add a named constant for the verified transparent PNG. After collecting all
three existing image sources and before the image-count and URL-validation
loop, append that URL only when the list is empty and the configured workflow
is neither empty nor `AutoDLH3NoImageWorkflow`. Leave the configured workflow
selection unchanged.

- [ ] **Step 4: Run focused tests to verify GREEN**

Run the Step 2 command. Expected: all named cases pass, proving the HTTP
payload and workflow path, rather than an internal helper value.

- [ ] **Step 5: Run package and repository Go regression tests**

Run `go test ./internal/batchfactoryv11 -count=1` and `go test ./... -count=1`.

Expected: no test regression and no credentials in output.

- [ ] **Step 6: Commit the source and test change**

Run `git add backend/internal/batchfactoryv11/autodl_h3_video_adapter.go backend/internal/batchfactoryv11/autodl_h3_video_adapter_test.go` followed by `git commit -m "fix(h3): supply transparent image fallback"`.

### Task 2: Release the exact committed Go change

**Files:**

- No source files beyond Task 1.

**Interfaces:**

- Consumes: the Task 1 commit SHA on the V88 lineage.
- Produces: an ECS Go API process reporting the same release SHA and serving healthy Batch Factory APIs.

- [ ] **Step 1: Rebase the feature commit on current `origin/v88`**

Run `git fetch origin v88` then `git rebase origin/v88`. Resolve only direct
conflicts in the Task 1 files; abort rather than discarding unrelated V88
changes.

- [ ] **Step 2: Integrate the tested commit into V88 and push**

Fast-forward or merge the tested commit into the local `v88` worktree, then
push `v88` without force-pushing. Record both the prior and new SHA.

- [ ] **Step 3: Build and activate only the Go API release artifact**

Use the existing direct-release process for the exact pushed SHA. Do not
restart MySQL, Redis, Browser Worker, or replay production tasks. Verify the
Go API health check before any public route cutover.

- [ ] **Step 4: Verify the runtime boundary**

Confirm the public API build identity equals the pushed SHA and the Go API is
healthy. Then use one separately authorized, failed `minimax_h3_zm_u24` task
for a provider-receipt and media-readback check before considering any other
retry.
