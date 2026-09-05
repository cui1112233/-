# Batch Factory V11 Direct Content Skill Intake Implementation Plan
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with review checkpoints.

**Goal:** 在 `v88` 的正式 Batch Factory V11 中实现可用的直接内容导入链路：导入 TXT/MD 或粘贴内容，选择现有系统/用户技能，执行技能处理并展示可重试的结果，确认后创建正式 V11 manual intake 和正式批次；不再依赖演示页或旧 Node 批量工厂作为权威路径。

**Architecture:** 前端只负责导入、选择技能、预览确认和状态合并；Node 负责复用已登录账号的 Agent Skill 可见性校验和模型处理，但不创建 Agent 任务；Go V11 负责 manual intake、内容持久化、来源元数据、批次创建和一次性消费。技能处理结果与原文同时保存到 intake payload，正式批次沿用 V11 现有数据链路。

**Tech Stack:** React/Ant Design frontend, Express/Node, Go HTTP API, MySQL V11 store, Vitest-style Node tests, Docker Compose, public ECS deployment.

## Global Constraints

- 所有源码、测试、构建和部署变更只在 `/Users/ming/Downloads/qiantie/.worktrees/v88-mainline` 的 `v88` 分支进行。
- 不修改原始 checkout、`main`、现有公网数据卷，也不执行 `down -v`、破坏性 reset 或删除旧镜像。
- 公网只允许使用明确构建出的 immutable image tag；切换前保存 `.env` 和当前镜像回滚标签。
- 不把 demo、截图页、硬编码历史批次或旧 Node `/api/batch-factory` 路由当作生产成功证据。
- 原文不可被覆盖；每条处理结果必须带原文、处理文、技能 ID/版本、状态和错误信息。
- 技能最多选择 3 个；没有技能时仍允许直接导入，但必须经过显式预览/确认。
- 失败条目可单独重试；单条失败不得导致整批结果丢失。
- 前端、Node、Go 端都必须有测试；完成前必须做本地构建、接口回归和公网浏览器验收。

## Task 1: Lock the direct-import contracts with tests

**Files:** `frontend/src/user/pages/batch-factory-v11/manualContentImport.js`, its test, `frontend/src/shared/api/batchFactoryV11.js`, adapter/runtime tests.

1. Write failing parser tests for pasted content split by a line containing `---`, filename-derived titles, empty-input rejection, and TXT/MD extension filtering.
2. Implement pure import helpers that normalize `{title, sourceText, txtFileName}` without calling APIs or changing state.
3. Write failing API contract tests for `previewManualSkillProcessing` and `createManualIntake`, including the exact V11 paths and JSON payload shape.
4. Add the API functions and `bf11UiAdapter`/`bf11Runtime` wrappers while preserving existing novel-fetch intake behavior.
5. Run the focused frontend tests and commit the contract slice.

## Task 2: Add a real Go V11 manual intake endpoint

**Files:** `backend/internal/batchfactoryv11/types.go`, `intakes.go`, `memory_store.go`, `mysql_store.go` if needed, `backend/internal/httpapi/batch_factory_v11_slice1.go`, Go tests.

1. Write failing tests for `POST /api/batch-factory/v11/intakes/manual` with content that has no source task ID or book ID.
2. Implement manual normalization: assign a deterministic `manual-<sha256-prefix>` source ID from title and original text, preserve text and filename, set `sourceMetadata.sourceType=manual`, and deduplicate identical source IDs inside one intake.
3. Reuse the existing owner-scoped intake store and one-time `CreateBatchFromIntake` path; do not introduce a second persistence model.
4. Add tests for ownership isolation, stable IDs, metadata persistence, and one-time consumption.
5. Run `go test ./backend/internal/batchfactoryv11/... ./backend/internal/httpapi/...` (or the repository’s supported equivalent) and commit the backend slice.

## Task 3: Add isolated Node skill processing without Agent-task pollution

**Files:** `lib/batch-factory/manual-skill-processor.js`, `routes/batch-factory-v11.js`, `app.js`, Node tests.

1. Write failing processor tests with injected `skillStore.resolveForChat` and `respond` functions for: no skills, successful processing, invalid skill selection, one failed item, and retry-safe result metadata.
2. Implement a bounded processor that resolves visible system/user skills for the current account, invokes the existing team model responder directly, returns per-item `originalText`, `processedText`, `skillRuns`, `status`, and `error`, and never writes an Agent task or chat history.
3. Add `POST /api/batch-factory/v11/manual/skills/preview`, protected by the existing API auth, with clear 400/403/503 responses and no provider preflight on this route.
4. Make the processor preserve source facts, strip accidental markdown fences, avoid returning skill bodies to the browser, and isolate failures per item.
5. Run focused Node tests and the related existing agent/route tests, then commit the processing slice.

## Task 4: Replace the fake V11 source drawer with the usable direct-import flow

**Files:** `frontend/src/user/pages/batch-factory-v11/BatchFactoryV11BatchManager.jsx`, `BatchFactoryV11UiPage.jsx`, `bf11UiAdapter.js`, `bf11Runtime.js`, component/unit tests.

1. Write failing UI/state tests for paste import, TXT/MD import, skill selection capped at three, explicit process/preview, failed-item retry, confirm-to-manual-intake, and then create-batch-from-intake.
2. Remove the hardcoded demo `HISTORY` and disabled “备用导入方式” controls from the formal V11 path.
3. Add a controlled direct-import panel using the real API wrappers; display original and processed text side by side or in an explicit comparison, with per-item status and retry action.
4. On confirmation, call the manual intake endpoint with processed text plus original/skill metadata, then reload the real intake and expose the existing “创建 V11 批次” action. Do not auto-start Director or video generation.
5. Keep novel-fetch import as a separate source entry point and keep all batch history sourced from the V11 API.
6. Run focused frontend tests plus the complete frontend test/build commands supported by the repo, then commit the UI flow.

## Task 5: Local end-to-end verification and release artifact

1. Run the full relevant Go and Node test suites, frontend lint/build, and static searches for hardcoded demo history, old-route authority, and placeholder text in the formal page.
2. Start or use the isolated local V11 stack, verify authenticated API behavior for direct preview, manual intake, intake reload, batch creation, and restart/persistence where the repository supports it.
3. Record the exact commit SHA, frontend bundle, Node image revision, Go image revision, and test outputs in a release note under `docs/superpowers/reports/`.
4. Commit only the implementation, tests, and evidence required for this v88 release.

## Task 6: Update and verify the public deployment

1. Build linux/amd64 Node and Go images from the exact v88 commit with revision labels and immutable tags.
2. Transfer images to ECS, back up the public `.env`, tag the current images for rollback, update only the image tags and expected Go SHA, and run Compose config validation.
3. Recreate only the required public services with `--no-build --pull never`; preserve MySQL and all existing data volumes.
4. Verify container health, image digests, revision labels, public `/api/build-info` plus authenticated V11 behavior, and absence of the old optional-provider error toast.
5. Use the logged-in public browser to verify the real Batch Factory page shows no hardcoded demo history, the direct import controls are present, and the route transitions through preview/confirm/intake/batch creation. Do not claim video generation unless the public provider is configured and actually succeeds.
6. Run the verification-before-completion and finishing-a-development-branch checks; report exact public evidence and any remaining provider-bound boundary.

## Review checkpoints

- After Tasks 1–3: review API shapes and security boundaries before wiring UI.
- After Task 4: review that every button maps to a real V11 API and that no demo data remains.
- Before Task 6: review release images, Git SHA, volume preservation, and rollback tags.
- Before final response: re-run tests and public evidence checks; do not infer success from HTTP 200 alone.
