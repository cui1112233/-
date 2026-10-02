# 换开头变体硬门禁 Implementation Plan
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
**Goal:** 让“换开头”输出兼容线上预设格式，并在任一要求变体失败时可靠阻断该书后续自动生产。
**Architecture:** Go 解析器兼容输入并生成持久化失败原因；导演服务以保存后的合并结果为唯一成功判定。Node 单书衔接按全部成功而非“至少一个成功”汇报，React 显示后端失败原因。
**Tech Stack:** Go、Go testing、Node.js node:test、React/Ant Design。
## Global Constraints
- 不调用模型、不重跑既有书、不修改数据库历史记录或数据卷。
- `openingCount` 包含原始分镜，要求变体数为 `openingCount - 1`。
- 已有成功变体不能被失败重试覆盖。
- 仅在全部要求变体成功时 `opening` 阶段成功；失败只阻断当前书。
---
### Task 1: 解析器兼容与失败原因
**Files:**
- Modify: `backend/internal/batchfactoryv11/opening.go`
- Modify: `backend/internal/batchfactoryv11/opening_test.go`
**Interfaces:** Produces `OpeningVariant.FailureReason string`；`parseOpeningVariants(raw, maxVideoDuration, variantCount)` 同时接受 `===VARIANT 1=== 时长：10秒` 和换行格式。
- [ ] **Step 1: Write the failing test** — add `TestParseOpeningVariantsAcceptsInlineMarkerAndDuration`; input `===VARIANT 1=== 时长：10秒\n开头正文` must produce a successful 10-second variant with prompt `开头正文`.
- [ ] **Step 2: Run test to verify it fails** — `go test ./internal/batchfactoryv11 -run TestParseOpeningVariantsAcceptsInlineMarkerAndDuration -count=1`; expected failure is the current line-anchored marker parser.
- [ ] **Step 3: Write minimal implementation** — locate `===VARIANT N===` in either form; initialize missing slots with concise failure reasons and replace only after duration/body validation.
- [ ] **Step 4: Run focused parser tests** — `go test ./internal/batchfactoryv11 -run 'TestParseOpeningVariants' -count=1`; newline, inline, missing and invalid-duration cases pass.
- [ ] **Step 5: Commit** — `git add backend/internal/batchfactoryv11/opening.go backend/internal/batchfactoryv11/opening_test.go && git commit -m 'fix(batch-factory): parse inline opening variants'`.
### Task 2: 后端硬门禁与稳定输出约定
**Files:**
- Modify: `backend/internal/batchfactoryv11/director_contract.go`
- Modify: `backend/internal/batchfactoryv11/director_service.go`
- Modify: `backend/internal/batchfactoryv11/opening_service_test.go`
**Interfaces:** Produces `RunOpeningVariants` success only when saved required variants are all successful; consumes the post-merge `openingVariants` result.
- [ ] **Step 1: Write failing tests** — `TestRunOpeningVariantsFailsWhenARequiredVariantIsMissing` (count 4, only variants 1/2 returned must error and persist failed slot 3) and `TestBuildOpeningVariantsContractAppendsCanonicalOutputFormat` (custom meta must still contain `===VARIANT 1===\n时长：10秒`).
- [ ] **Step 2: Run tests to verify they fail** — `go test ./internal/batchfactoryv11 -run 'TestRunOpeningVariantsFailsWhenARequiredVariantIsMissing|TestBuildOpeningVariantsContractAppendsCanonicalOutputFormat' -count=1`; partial results currently pass and custom meta has no canonical final format.
- [ ] **Step 3: Write minimal implementation** — return merged slots from `saveOpeningVariants`; validate every required index in `RunOpeningVariants`; append a final exact output example to every opening meta-prompt; return a reasoned error on missing/failed slots.
- [ ] **Step 4: Run focused service tests** — `go test ./internal/batchfactoryv11 -run 'TestRunOpeningVariants|TestBuildOpeningVariantsContract' -count=1`; verify old successes survive a bad retry and only a complete merged set succeeds.
- [ ] **Step 5: Commit** — `git add backend/internal/batchfactoryv11/director_contract.go backend/internal/batchfactoryv11/director_service.go backend/internal/batchfactoryv11/opening_service_test.go && git commit -m 'fix(batch-factory): block production on failed openings'`.
### Task 3: Node result semantics and UI failure explanation
**Files:**
- Modify: `routes/batch-factory-v11.js`
- Modify: `routes/batch-factory-v11.test.js`
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryNovelList.jsx`
**Interfaces:** Gateway success only when `generated === openingCount - 1`; failed cards display `failureReason`.
- [ ] **Step 1: Write failing Node test** — make a post-opening batch with one success and a required failure; `generateOpeningVariantsAfterSingleDirector` must return `{ succeeded: false }` and a reason mentioning 换开头.
- [ ] **Step 2: Run test to verify it fails** — `node --test routes/batch-factory-v11.test.js --test-name-pattern='required variant is missing'`; one current success incorrectly reports overall success.
- [ ] **Step 3: Write minimal implementation** — calculate required slots from effective settings; require every index to succeed; return the first stored failure reason; render it in React with a historical-record fallback.
- [ ] **Step 4: Run focused Node test and frontend build** — `node --test routes/batch-factory-v11.test.js && npm run build --prefix frontend`.
- [ ] **Step 5: Commit** — `git add routes/batch-factory-v11.js routes/batch-factory-v11.test.js frontend/src/user/pages/shuihuo/BatchFactoryNovelList.jsx && git commit -m 'fix(batch-factory): explain opening variant failures'`.
### Task 4: Integration verification and release handoff
**Files:** No source additions unless verification exposes a specific defect.
- [ ] **Step 1: Run complete targeted verification** — `go test ./internal/batchfactoryv11 -count=1 && node --test routes/batch-factory-v11.test.js && npm run build --prefix frontend`.
- [ ] **Step 2: Inspect final diff and push reviewed commits** — `git diff origin/v88...HEAD --check && git push origin HEAD:v88`.
- [ ] **Step 3: Direct SSH release and live verification** — use existing direct deployment layout, preserve MySQL/data volumes, and verify build identity plus authenticated batch-factory behavior without submitting a model job.
