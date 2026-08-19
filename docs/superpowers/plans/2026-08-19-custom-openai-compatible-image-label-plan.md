# Custom OpenAI-Compatible Image Provider Label Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users give their OpenAI-compatible image service a custom display name while preserving the existing protocol.

**Architecture:** Keep `openai_compatible` as the only executable provider identifier. Add a non-secret `displayName` to the account image configuration, synchronize it from Node to Go, and use it only when exposing the synthetic account image model.

**Tech Stack:** Express, React, Ant Design, Go, MySQL migrations, node:test, Go testing.

---

### Task 1: Define the visible settings contract

**Files:**
- Modify: `tests/account-image-settings-ui-contract.test.js`
- Modify: `tests/shuihuo-gateway.test.js`
- Modify: `frontend/src/user/pages/SettingsPage.jsx`
- Modify: `lib/shared.js`
- Modify: `routes/shuihuo-production.js`

- [ ] Write a failing UI contract asserting the image `mode` and `displayName` fields, the Custom OpenAI-compatible label, and an empty API key after config load.
- [ ] Run `node --test tests/account-image-settings-ui-contract.test.js` and confirm it fails for the missing fields.
- [ ] Add `mode` and `displayName` to the settings form. Store the canonical provider as `openai_compatible`, preserve an empty API key, and only show the display-name input in custom mode.
- [ ] Extend the gateway regression test so the bridge payload includes a custom display name but no browser response contains the API key.
- [ ] Run `node --test tests/account-image-settings-ui-contract.test.js tests/shuihuo-gateway.test.js` and confirm all tests pass.

### Task 2: Persist and expose the safe display name in Go

**Files:**
- Modify: `backend/internal/storage/migrations.go`
- Modify: `backend/internal/store/image_configs.go`
- Modify: `backend/internal/httpapi/config_handlers.go`
- Modify: `backend/internal/httpapi/shuihuo_task_handlers.go`
- Modify: `backend/internal/httpapi/shuihuo_handlers_test.go`

- [ ] Write a failing HTTP API test that saves `displayName`, checks the public config has it, and checks the synthetic account model uses it.
- [ ] Run `go test ./internal/httpapi -run Test.*Account.*Image` and confirm the new test fails.
- [ ] Add the nullable-safe `display_name` migration and read/write it with `ImageAPIConfig`.
- [ ] Accept and return `displayName` from the config bridge. Keep provider validation canonical and use the configured label only as the synthetic model name.
- [ ] Run `go test ./internal/store ./internal/storage ./internal/httpapi ./internal/shuihuo/providers ./internal/shuihuo/tasks` and confirm all tests pass.

### Task 3: Build and runtime verification

**Files:**
- Verify: `frontend/src/user/pages/SettingsPage.jsx`
- Verify: `backend/cmd/qiantie/main.go`

- [ ] Run `npm --prefix frontend run build`.
- [ ] Run `go test ./...`.
- [ ] Run `git diff --check`.
- [ ] Rebuild the backend, restart the known Qiantie listeners, and verify `GET /settings` returns 200 and `/healthz` returns `{"ok":true}`.
