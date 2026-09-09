# H3 on Public V78 Incremental Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development when executing this plan task-by-task.

**Goal:** 在已发布的 V78 Node 基线之上增量加入 H3 视频生成、人物/场景 AI 生图或上传、主图选择、分镜参考图星标开关和个人中心 H3 配置，同时保持公网现有旧视频、小说获取、批量工厂和数据卷行为不变。

**Architecture:** 保留公网 Node 基线的现有路由和页面结构，只新增/局部扩展 H3 目录、脚本视频适配器、参考图能力 URL、实体图片交互和视频模型配置。人物/场景图片继续写入现有账号资产目录；H3 读取短时签名的只读图片 URL，避免把本机路径或需要登录的地址交给外部服务。Go 是公网部署中的独立 checkout，不与 Node 分支强行合并；先对照其公开接口能力，只有在能保持 V78 bridge 契约的情况下才增加 H3 兼容路由。

**Tech Stack:** Node.js/Express, React/Ant Design, Vite, Go HTTP API, Docker Compose, existing account auth and file-backed asset store.

## Global Constraints

- 开发基线只能是 `origin/ops/v78-public-115.190.156.223-v3`；不得把 `integration/h3-on-v78-20260909` 直接 merge 到本分支。
- 不修改主工作区、旧 H3 工作树、公网服务器、正式 Docker 项目、正式数据卷或任何 API Key。
- 旧 YD、本地豆包、小说获取、批量工厂和账号认证的现有行为必须保持兼容。
- 没有用户生成/上传的主图时，H3 请求必须不携带参考图；不生成兜底图片。
- 只使用用户明确选择的 `mainImageUrl`；分镜参考图按人物优先、场景其次、去重、最多 9 张和逐张星标开关处理。
- 任何测试日志、报告和最终回复都不得输出密钥或完整凭据。
- 公网发布必须等候选构建、认证接口检查、浏览器验证和远程部署权限都具备；本计划不把本地通过当成公网已发布。

## Task 1: Lock the public baseline and contract map

**Files:** `routes/script-video.js`, `frontend/src/user/pages/ScriptPage.jsx`, `frontend/src/user/components/ShotOutputCards.jsx`, `routes/novel-panel.js`, `lib/novel-panel/premium-store.js`, `deploy/v78-public/*`.

1. Add a baseline contract test that records the existing YD/local video routes, image asset routes, public build info, and deploy Go-source contract.
2. Run the baseline Node tests and frontend build, recording pre-existing failures separately from new failures.
3. Compare the H3 source branch file-by-file and make a port list; do not copy whole files whose public version already contains unrelated fixes.

## Task 2: Add the H3 model catalog and adapter

**Files:** `lib/video-model-catalog.js`, `lib/h3-video-adapter.js`, `tests/h3-video-adapter.test.js`.

1. Write failing tests for H3 model discovery, no-image/reference-image workflow selection, `ref_image_0` through `ref_image_8`, duration/resolution normalization, HTTPS validation, task ID parsing, status parsing, result URL parsing, and timeout/error mapping.
2. Add the H3 catalog as an additive model entry; keep the public YD and local model entries unchanged.
3. Add a small HTTPS-only adapter that submits and polls H3 tasks without exposing credentials or accepting arbitrary non-HTTPS external image URLs.
4. Run the focused adapter tests and verify the public legacy script-video tests still pass.

## Task 3: Extend the existing script-video route without breaking legacy models

**Files:** `routes/script-video.js`, `tests/h3-script-video-route.test.js`, `app.js`.

1. Write failing route tests for H3 submit/poll, no-image behavior, up to nine reference images, invalid image URLs, missing H3 credentials, and preservation of YD/local behavior.
2. Add H3 dispatch by `modelKey` to the existing route and keep the current bridge handling for local Doubao.
3. Read H3 credentials from the account configuration path used by the public baseline; never include the key in responses or logs.
4. Add a resolver hook for locally stored reference assets so external H3 receives a short-lived signed capability URL instead of a private `/app/data` path.
5. Run the focused Node route tests and the existing route/config tests.

## Task 4: Add signed, provider-readable reference asset URLs

**Files:** `lib/novel-panel/reference-asset-capability.js`, `routes/reference-assets-public.js`, `lib/novel-panel/premium-store.js`, `app.js`, related tests.

1. Write failing tests for signature scope, expiry, asset-type/id traversal rejection, wrong-user rejection, missing-file behavior, and `Cache-Control: private, no-store`.
2. Implement the smallest read-only signed route mounted outside the authenticated JSON API; preserve the existing authenticated asset route for the UI.
3. Make `referenceAssetPublicUrl` use the capability resolver when the H3 route is used, while preserving existing browser preview URLs.
4. Verify generated/uploaded bytes can be fetched by the signed URL and that expired or altered URLs return 404.

## Task 5: Add entity image generation/upload/preview/delete to the public script editor

**Files:** `frontend/src/user/pages/ScriptPage.jsx`, `frontend/src/user/pages/scriptEntityImages.js`, `frontend/src/shared/api/novelPanel.js`, `frontend/src/shared/styles/global.css`, related tests.

1. Write failing UI/helper tests for character versus scene request parameters, prompt construction from the current fields and novel context, upload, generated image merge, explicit main-image selection, preview enlargement, deletion, and the single-image default-main rule.
2. Add “AI 生成图片” and “上传图片” to the existing character/scene editor. Keep manual URL input out of the primary workflow; retain only supported upload/generation paths.
3. Make thumbnails clickable and open a preview modal/lightbox; do not replace an existing main image when adding another image.
4. Persist `imageUrls` and `mainImageUrl` through the existing entity save path, and make delete use the current editor state rather than stale saved fields.
5. Run focused frontend tests and build the frontend.

## Task 6: Show H3 reference names as star-like tags on every eligible shot

**Files:** `frontend/src/user/components/ShotOutputCards.jsx`, `frontend/src/user/pages/scriptVideoReferences.js`, `frontend/src/user/pages/ScriptPage.jsx`, `frontend/src/user/pages/scriptVideoDuration.js`, CSS and tests.

1. Write failing tests for matching entities by name/alias, character-first ordering, scene fallback, URL deduplication, nine-image cap, no-image omission, and per-shot/per-image star state.
2. Add compact colored name tags to each eligible shot instead of displaying the actual images in the card. Blue/lit means included; gray means excluded. There is no global on/off switch.
3. Pass only the current shot’s active main images to H3. If there are no selected main images, send `imageUrls: []` and use H3’s no-image workflow.
4. Preserve normal card selection/copy/video controls and ensure toggling a tag does not mutate entity data.
5. Run focused helper/UI tests and visually verify `/script` against the supplied tag reference.

## Task 7: Complete account configuration for H3

**Files:** `lib/shared.js`, `routes/config.js`, `frontend/src/user/pages/ApiConfigPage.jsx`, `routes/shuihuo-production.js`, tests.

1. Write failing tests for independent text/image/H3 video saves, masked public responses, partial saves, member-managed configuration, and bridge synchronization without secret leakage.
2. Add an H3 video provider/base URL/model/key configuration section using the public account-config contract; do not make text or image saves depend on unrelated fields.
3. Ensure both `/script` H3 and any supported Shuihuo H3 bridge use the same account-scoped credential source.
4. Run config and auth tests, then inspect response bodies for accidental key fields.

## Task 8: Go compatibility audit and additive H3 bridge (only if contract-compatible)

**Files:** separate Go checkout based on `origin/feat/v78-novel-fetch-go-bridge`, `backend/internal/httpapi/*`, `backend/internal/storage/*`, `backend/internal/shuihuo/*` only if the public Go architecture supports it, plus contract tests.

1. Confirm the public Go baseline’s router and database schema before editing; it currently does not contain the H3 Shuihuo domain/provider tree.
2. If an additive route can be implemented without replacing V78 bridge behavior, add the H3 provider/config/task contract and tests in a separate Go integration branch.
3. If the required Shuihuo domain is absent, record the exact compatibility blocker and keep `/script` H3 complete without pretending Shuihuo H3 is deployed.
4. Run `go test ./...` in the Go candidate and keep the source SHA explicit for deployment review.

## Task 9: Candidate release verification

**Files:** `deploy/v78-public/CODEX_RUNBOOK.md`, `deploy/v78-public/verify.sh`, release notes/tests as needed.

1. Run focused Node tests, frontend build, and Go tests for the candidate.
2. Build an isolated Docker candidate with a unique Compose project and fresh non-production mounts; do not touch the existing `:3000` container or public volumes.
3. Verify authenticated browser flows: login, `/script`, extract/edit entity, upload or generate image, enlarge/delete/select main image, generate a shot with blue tags, generate a shot with all tags gray, and confirm old video routes still work at contract level.
4. Capture Git SHA, image digest, served bundle marker, and behavior evidence. Do not claim public release from a local 200 response.

## Task 10: Public deployment gate

1. Review the final diff against `origin/ops/v78-public-115.190.156.223-v3` and the separate Go SHA.
2. Require valid remote shell/deployment access before changing `115.190.156.223`; the current probe is not authorized because SSH authentication is unavailable.
3. Use the existing runbook’s candidate-first deploy and rollback procedure. Never use `docker compose down -v`.
4. Verify externally through the public entrypoint and report Node SHA, Go SHA, image digests, browser behavior, persistence/restart behavior, and any remaining provider E2E limitation.
