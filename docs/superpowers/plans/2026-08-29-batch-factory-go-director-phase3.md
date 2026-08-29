# Batch Factory Go Director Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Batch Factory hook/director orchestration and director-output normalization from Node business logic into Go while preserving the current React API behavior.

**Architecture:** Add focused Go domain helpers for director JSON parsing/normalization and request/prompt assembly, expose compatibility HTTP endpoints under the existing Shuihuo Go service, then reduce Node routes to transport/queue compatibility only. Existing text-model credentials remain server-side; Node may temporarily perform the upstream text-model call until the final compatibility cutover in this phase, but it must receive the system/user prompt contract and validate returned director output through Go.

**Tech Stack:** Go 1.23, chi HTTP API, Node.js compatibility routes/tests, React + Ant Design unchanged.

**Spec:** `docs/superpowers/specs/2026-08-29-batch-factory-go-api-migration-design.md`

## Global Constraints

- API / service backend: Golang.
- Admin UI: React + Ant Design.
- User UI: React + Ant Design.
- Node / Express is compatibility-only and receives no new Batch Factory business rules.
- Preserve fixed-single-VIDEO semantics and model max-duration validation.
- Preserve source coverage metadata and explicit prompt-version metadata.
- No provider keys or credentials may move into React or Batch Factory records.

---

### Task 1: Go director output parser and normalizer

**Files:**
- Create: `backend/internal/shuihuo/batchfactory/director_output.go`
- Create: `backend/internal/shuihuo/batchfactory/director_output_test.go`
- Modify: `.github/workflows/batch-factory-verify.yml`

**Interfaces:**
- Produces: `NormalizeDirectorOutput(raw json.RawMessage, settings DirectorSettings) (DirectorResult, error)` and `ParseDirectorJSON(string) (json.RawMessage, error)`.
- Preserves Node semantics for named prompts, storyboard duration, contiguous shot timelines, name references, allowed prefix keys, fixed-single mode and source coverage defaults.

- [ ] **Step 1: Write failing Go parity tests** covering valid multi-VIDEO output, fixed-single rejection, non-integer durations, discontinuous shots, unknown character/scene/prop references, invalid prefix key, fenced JSON, and source coverage defaults.
- [ ] **Step 2: Run `go test ./internal/shuihuo/batchfactory -run 'TestDirector'` and confirm compile/behavior failure because the Go implementation does not exist.**
- [ ] **Step 3: Implement the minimal Go parser/normalizer with the same JSON field names returned by the current Node API.**
- [ ] **Step 4: Re-run the targeted Go tests and existing Batch Factory Go package tests; all must pass.**
- [ ] **Step 5: Commit the implementation.**

### Task 2: Go director prompt contract and prompt-version metadata

**Files:**
- Create: `backend/internal/shuihuo/batchfactory/director_prompt.go`
- Create: `backend/internal/shuihuo/batchfactory/director_prompt_test.go`
- Modify: `backend/internal/httpapi/shuihuo_task_handlers.go`
- Modify: `backend/internal/httpapi/router.go`
- Create or modify: focused HTTP tests in `backend/internal/httpapi/`

**Interfaces:**
- Consumes: Phase 2 Go config/preset resolver and Task 1 director settings/result types.
- Produces authenticated compatibility endpoints that accept batch/item settings + raw preset history and return the exact hook/director system prompt, user prompt, resolved preset metadata and normalization settings.

- [ ] **Step 1: Write failing domain tests proving Go resolves hook/director/script/asset frozen preset versions and builds current duration/aspect/source contract.**
- [ ] **Step 2: Verify RED.**
- [ ] **Step 3: Implement the prompt-contract builder using the Phase 2 Go preset resolver.**
- [ ] **Step 4: Write failing HTTP tests for the compatibility endpoints and verify 404 before route registration.**
- [ ] **Step 5: Register handlers, verify authenticated response shape and error behavior, then run targeted Go HTTP tests.**
- [ ] **Step 6: Commit.**

### Task 3: Node runtime cutover to Go director APIs

**Files:**
- Create: `lib/batch-factory/director-bridge.js`
- Modify: `routes/batch-factory.js`
- Add: `test/batch-factory-go-director-bridge.test.js`
- Add: `test/batch-factory-go-director-runtime.test.js`
- Modify: `.github/workflows/batch-factory-verify.yml`

**Interfaces:**
- Node sends username/owner identity, batch/item data and preset history to Go.
- Go returns prompt contracts and canonical normalized director results.
- Node queue/file compatibility code may persist job status/results temporarily, but no longer parses/normalizes director JSON or constructs Batch Factory director business prompts.

- [ ] **Step 1: Add RED bridge tests proving raw history/input is sent to Go and Go errors propagate without Node fallback.**
- [ ] **Step 2: Implement the thin director bridge and turn tests GREEN.**
- [ ] **Step 3: Add RED runtime contract tests requiring `routes/batch-factory.js` to stop importing `director-output` for runtime normalization and to use the Go bridge for hook/director prompt contracts and output normalization.**
- [ ] **Step 4: Cut runtime over minimally while retaining queue/status persistence.**
- [ ] **Step 5: Run the full workflow: Go settings/config/director tests, Node compatibility/regression tests and React production build.**
- [ ] **Step 6: Compare branch against master and confirm only intended migration files changed.**
