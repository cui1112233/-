# 公网 V88 性能与全功能可用性实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在隔离的 V88 候选环境中，修复公网静态资源传输慢、版本身份漂移和工作台首屏过重问题，并用认证态、持久化、重启恢复和浏览器回归证明现有入口与 V11 batch/provider/director 功能仍可用；只有所有门禁通过且远端运维访问可用时，才允许发布到公网 `:3000`。

**Architecture:** 以 `/Users/ming/Downloads/qiantie/.worktrees/v88-mainline` 作为唯一候选源码，保留 Node/Go 并存和内部 V78 工作台兼容层。新增由发布元数据驱动的顶层平台 release identity，将 Git revision、OCI image digest 和实际 served bundle hash 绑定起来；工作台 HTML 短缓存、带内容 hash 的 JS/CSS 长缓存，首屏核心和按需功能通过兼容现有全局函数的渐进 loader 加载；Nginx 只为工作台静态响应增加缓冲和连接复用，不改变 API、上传、流式任务和正式数据边界。

**Tech Stack:** Node.js/Express、React/Vite frontend、Go backend、MySQL 8.4、Docker Compose、Nginx、现有 `node:test`/前端测试、Go tests、浏览器自动化。

## Global Constraints

- [ ] 所有实现代码只在干净的 `/Users/ming/Downloads/qiantie/.worktrees/v88-mainline` 中进行；当前 `/Users/ming/Downloads/qiantie` 工作树中的 `data/`、锁文件、测试文件和文档改动均视为用户改动，不得 reset、checkout、清理、覆盖或混入候选镜像。
- [ ] 执行前记录 V88 worktree 的 branch、HEAD、完整 ancestry 和 `git status --short --branch`；任何脏状态都先停止候选构建并单独处理。
- [ ] 不修改公网 `115.190.156.223:3000`、旧容器、正式 MySQL、正式数据卷或线上 Nginx，直到候选环境的自动测试、浏览器回归、认证态业务闭环、持久化和重启恢复全部通过。
- [ ] 不把版本字符串写死为猜测的“V88”。最终 `app_version` 必须来自当前 V88 发布元数据/CI ref；测试只能使用明确的 fixture 版本，不能用旧 V78 作为顶层平台版本。
- [ ] 保留 `routes/novel-panel.js` 中内部 `V78_BUILD_INFO`、schema 校验和既有兼容行为；新增的 V88 平台身份必须与工作台内部兼容身份分层展示，不能用全局替换删除兼容语义。
- [ ] API、登录态、草稿、历史、用户数据、上传、AI/视频任务继续 `no-store` 或原有流式策略；只有带发布 hash 的工作台 JS/CSS 才允许 immutable 缓存。
- [ ] 不执行 `docker compose down -v`、`git reset --hard`、删除旧镜像、删除正式卷或未验证的批量重建；候选环境使用独立 Compose project、网络、MySQL 数据库、数据目录和端口。
- [ ] 每个任务先补/调整失败测试，再实现，再运行针对性测试；每个任务完成后单独提交，提交内容只包含该任务文件。
- [ ] 所有证据保存到带时间戳的 `/tmp/qiantie-v88-public-evidence-*` 或候选目录，并记录命令、branch、commit、镜像 digest、容器 ID、卷 ID、served hash、响应头和测试结果。

## Current Evidence and File Map

- [ ] 以设计稿 `[docs/superpowers/specs/2026-09-06-public-v88-performance-and-functional-availability-design.md](/Users/ming/Downloads/qiantie/docs/superpowers/specs/2026-09-06-public-v88-performance-and-functional-availability-design.md)` 为验收基线；不得把历史 V78 发布记录直接当作 V88 发布证明。
- [ ] 记录当前公网基线：`/`、`/api/build-info`、`/novel-panel/workbench/index.html`、`/novel-panel/workbench/app.js`、批量工厂入口和关键 `/assets/*` 的状态码、TTFB、总耗时、Content-Encoding、Cache-Control、Content-Length、SHA-256。
- [ ] 将当前已知基线明确写入证据：顶层 `/api/build-info` 仍返回 V78；工作台 `app.js` 原始约 1.55 MB、gzip 约 455 KB；公网入口 TTFB 约 0.1 秒；不能把入口计算慢误判为主要瓶颈。
- [ ] 主要源码锚点固定为：`app.js` 的 Express 静态与顶层 `/api/build-info`、`routes/novel-panel-page.js` 的工作台响应头、`routes/novel-panel.js` 的内部兼容身份、`public/novel-panel/workbench/index.html` 的脚本顺序、`public/novel-panel/workbench/app.js` 的全局动作绑定、`tests/frontend-asset-cache-contract.test.js` 和 `tests/novel-panel-asset-contract.test.js`。
- [ ] 主要 V88/V11 回归锚点固定为：`frontend/src/user/pages/batch-factory-v11/`、`frontend/src/shared/api/batchFactoryV11.test.js`、`test/batch-factory-v11-manual-skills-route.test.js`、`test/batch-factory-v11-proxy.test.js`、`test/batch-factory-v11-alpha-release.test.js`、`tests/batch-factory-v11-provider-sync.test.js`、`tests/v88-compose.test.js`、`tests/novel-fetch-v88-mainline-version-config.test.js`。
- [ ] 明确批量工厂验收边界：`/batch-factory` 是真实 V11 业务入口，必须完成认证态和全链路验收；`/batch-factory-preview` 当前由 `BatchFactoryPreviewPage.jsx` 提供静态样稿数据，不接真实批次 API，本次只验路由可打开、资源无 404、样式和演示交互不报错，不把样稿状态当作生产成功证据。

## Task 1: Establish provenance and immutable candidate baseline

**Files:**

- Add `scripts/capture-v88-public-evidence.js`.
- Add `tests/v88-public-evidence-script.test.js`.
- Do not modify production configuration in this task.

- [ ] **1.1 Write the failing evidence-script tests first.** Test that the script accepts an explicit URL, output directory and fetch timeout; records status, selected headers, byte count, SHA-256 and timing for each requested resource; redacts cookies and authorization headers; and exits nonzero when a required resource is not HTTP 200.
- [ ] **1.2 Implement the baseline script.** Use only explicit URLs and output paths; include `/`, `/api/build-info`, workbench HTML/app/style, the public batch factory bundle and the candidate list of V11 endpoints. Save `manifest.json`, one response metadata JSON per URL and downloaded bytes only for bounded static resources.
- [ ] **1.3 Capture source provenance before any build.** Run `git status --short --branch`, `git rev-parse HEAD`, `git log -1 --format=fuller`, `git merge-base --is-ancestor origin/v88 HEAD`, `git worktree list --porcelain`, and record the results under the evidence directory. Abort if the V88 worktree is dirty or not on the expected V88 line.
- [ ] **1.4 Capture the live public baseline.** Run the script against `http://115.190.156.223:3000` and retain the exact `build-info` body, response headers, served bundle hashes and timing samples. Run at least five samples for the HTML and workbench app, recording median and p95 without changing the server.
- [ ] **1.5 Compare current public bytes with V88 source/dist bytes.** Report mismatched filenames, hashes, API path markers and compatibility markers; do not call the public service V88 merely because a bundle contains V11 strings.
- [ ] **1.6 Run `node --test tests/v88-public-evidence-script.test.js` and commit only this task as `test: capture V88 public provenance baseline`.

## Task 2: Replace hardcoded top-level release identity while preserving V78 compatibility

**Files:**

- Add `lib/release-info.js`.
- Add `release-info.schema.json` or an equivalent runtime schema fixture.
- Add `scripts/generate-release-info.js`.
- Modify `app.js` top-level `/api/build-info` handler.
- Modify `routes/novel-panel.js` only at the diagnostics/platform-identity boundary; preserve internal `V78_BUILD_INFO` and compatibility checks.
- Add `tests/release-info.test.js` and extend the existing top-level build-info tests.
- Update `tests/novel-panel-v78-routes.test.js` only where the assertion must distinguish platform identity from internal workbench compatibility.

- [ ] **2.1 Write failing contract tests first.** Define the exact `loadReleaseInfo(env = process.env, filePath = defaultPath)` return shape: `{ app_version, build_id, git_revision, image_digest, release_channel, compatibility_components }`. Test valid metadata, missing required candidate fields, malformed JSON, environment override precedence, and no guessed V88 value.
- [ ] **2.2 Define metadata precedence.** Use an explicit generated release file as the primary source, then environment variables for deployment injection, then a development-only safe fallback that is visibly non-release. A candidate must fail closed if `git_revision` or `image_digest` is absent; source development may expose `release_channel: "development"` without pretending to be public release.
- [ ] **2.3 Implement `lib/release-info.js` with validation and redaction.** Validate semver/release text, nonempty build ID, full Git revision format, OCI digest format and a compatibility-components object. Never include secrets, database URLs, tokens or provider credentials in the response.
- [ ] **2.4 Implement `scripts/generate-release-info.js`.** Accept explicit `--version`, `--build-id`, `--git-revision`, `--image-digest`, `--channel` and output path; reject missing values in candidate mode; write deterministic JSON with sorted keys and a generated-at field only in evidence, not in identity comparison.
- [ ] **2.5 Wire only the top-level `/api/build-info`.** Remove its hardcoded old V78 response and return the validated platform identity. Keep `routes/novel-panel.js` internal V78 schema/version checks intact, but expose them under `compatibility_components.workbench` and include the platform release in diagnostics so the two identities are explicit.
- [ ] **2.6 Add identity consistency tests.** Given a fixture release file, assert that `/api/build-info` equals the file, its `git_revision` equals the candidate source revision, its `image_digest` equals the built image digest, and its compatibility component still reports the expected internal workbench contract. Assert that old V78 is not returned as the top-level platform version in candidate mode.
- [ ] **2.7 Run the targeted Node tests and existing novel-panel route/health/history/image/settings tests. Commit as `feat: make V88 release identity provenance-driven`.

## Task 3: Add versioned workbench asset manifest and safe caching

**Files:**

- Add `lib/novel-panel/workbench-assets.js`.
- Add `scripts/generate-workbench-manifest.js` if build-time generation is required.
- Modify `routes/novel-panel-page.js`.
- Modify `public/novel-panel/workbench/index.html` or its render/template source.
- Extend `tests/novel-panel-asset-contract.test.js` and add `tests/novel-panel-workbench-cache.test.js`.
- Preserve `tests/frontend-asset-cache-contract.test.js` expectations for `/assets/` and `/batch-rewrite`.

- [ ] **3.1 Write failing manifest tests first.** Define exact interfaces: `buildWorkbenchManifest(rootDir) -> { version, assets: { relativePath: { sha256, bytes } } }`, `renderVersionedAssetUrl(relativePath, manifest) -> /novel-panel/workbench/<relativePath>?v=<first-16-hash>`, and `assertSafeAssetPath(relativePath)`. Test deterministic output, path traversal rejection, missing assets, hash changes, and asset byte counts.
- [ ] **3.2 Implement deterministic manifest generation.** Hash only referenced JS/CSS resources under the workbench root; sort paths; do not hash API/data responses; write generated candidate metadata outside the user dirty worktree unless the build explicitly packages it.
- [ ] **3.3 Update workbench HTML delivery.** Keep HTML `no-store`/short cache and CSP. Rewrite only versioned JS/CSS references through the manifest, retaining current script order, inline V78 compatibility marker, bridge globals and all existing DOM IDs. If a manifest is absent or invalid, serve the old non-versioned URL with `private,max-age=0,must-revalidate` and emit an actionable diagnostic rather than serving a stale immutable URL.
- [ ] **3.4 Update asset headers.** For a matching hash query, return `public,max-age=31536000,immutable`; for non-versioned or mismatched URLs, return the existing revalidation policy. Keep API, history, save, upload and task routes uncached.
- [ ] **3.5 Add resource-integrity contract tests.** Parse the delivered HTML, request every local script/link, assert HTTP 200, nonempty content, expected SHA-256 and correct cache headers; assert no referenced chunk returns 404; assert the HTML itself remains short/no-store.
- [ ] **3.6 Run all asset/cache contract tests and commit as `perf: version workbench assets for immutable caching`.

## Task 4: Reduce workbench critical path with compatibility-preserving progressive loading

**Files:**

- Modify `public/novel-panel/workbench/index.html`.
- Add `public/novel-panel/workbench/modules/workbench-loader.js`.
- Add feature entry files under `public/novel-panel/workbench/modules/` for history/save/export, diagnostics/runtime, premium/image, and settings/instruction center.
- Modify `public/novel-panel/workbench/app.js` only at explicit feature boundaries and global registration bridges.
- Add `tests/novel-panel-workbench-loading.test.js`.
- Preserve all existing clean-core scripts and `public/novel-panel/workbench/bridge.js` contracts.

- [ ] **4.1 Write failing loader tests first.** Define `window.__QIANTE_WORKBENCH__.loadFeature(name) -> Promise`, deduplicate concurrent requests by feature name, reject with a user-safe error on load failure, expose a retry path, and leave already-loaded features unchanged. Test that core scripts remain ordered and that every feature entry URL exists in the manifest.
- [ ] **4.2 Add `defer` to classic script tags in the existing order.** Do not convert the legacy global app to ESM in this task. Add a browser/source test proving `bridge.js`, `app.js`, clean-core scripts and character/runtime scripts retain dependency order and no inline marker executes after a dependent script.
- [ ] **4.3 Implement the loader and fallback UI.** Use the existing CSP-compatible loading mechanism, keep a registry of `loading/loaded/failed` states, show a localized failure message with retry, and prevent one optional module failure from disabling core outline/input functionality.
- [ ] **4.4 Extract only non-first-paint boundaries.** Start with history/save/export, diagnostics, premium/image, and settings/instruction-center code. Keep initialization, input, outline core, existing bridge, authentication/session handling and required compatibility globals in the initial payload. Preserve exact IDs and action names such as `#historyBtn`, `#saveProjectBtn`, `#exportTxtBtn`, `#settingsBtn`, `#analyzeBtn`, `#outlineBtn`, `#generateTtsBtn`, `#mergeBtn`.
- [ ] **4.5 Add a legacy fallback.** If a feature bundle is absent or fails, load the old complete function path where available, display the actual failure state, and never silently mark a save/export/task as successful. Do not delete the old implementation until candidate browser smoke proves the extracted path.
- [ ] **4.6 Measure after each extraction.** Record compressed bytes, request count, TTFB, total transfer and interaction-ready timing for the workbench. Keep an extraction only when it reduces first-paint transfer and does not introduce a 404, console exception, duplicate download or regression; revert only the individual extraction if its contract fails.
- [ ] **4.7 Run source/loader tests plus the workbench browser smoke on the isolated candidate. Commit as `perf: progressively load non-critical workbench features`.

## Task 5: Tune Nginx delivery without changing API or stream semantics

**Files:**

- Modify the V88 ops deployment source `deploy/v78-public/nginx.conf` from the checked-out `origin/ops/v88-public-amd64-release-20260903` reference; the retained directory name is historical and must not be used as a V78 release claim.
- Extend or add `tests/v88-public-nginx-performance.test.js` based on the existing `tests/v78-public-nginx-performance.test.js` contract.
- Add candidate Nginx config validation to `tests/v88-compose.test.js` if the compose contract is the correct boundary.

- [ ] **5.1 Write failing Nginx contract tests first.** Assert gzip for JS/CSS, long immutable cache only for versioned static assets, a dedicated `location ^~ /novel-panel/workbench/` with response buffering and request buffering enabled, HTTP/1.1 connection reuse, and no `Upgrade` header forwarding. Assert generic API/stream/upload location retains existing long timeouts and non-buffered behavior.
- [ ] **5.2 Add the dedicated workbench location.** Use the candidate service name and network from `docker-compose.v88-review.yml`, preserve Host/X-Forwarded headers, clear `Connection`, and configure bounded proxy buffers (16k/16 or the measured equivalent). Do not add API caching or alter `/batch-rewrite`/streaming semantics.
- [ ] **5.3 Run `nginx -t` against the candidate config** when the binary is available, then run the contract tests and compose config validation. If Nginx is unavailable locally, run the containerized syntax check in the isolated candidate image and retain its output.
- [ ] **5.4 Commit the config and tests as `perf: buffer workbench static delivery in candidate nginx`.

## Task 6: Run automated V88/V11, migration, and stability regression gates

**Files:**

- No production source changes are allowed unless a failing test identifies a required compatibility fix; such fixes must be committed separately from test-only changes.
- Use the V88 worktree tests and the isolated Compose project only.

- [ ] **6.1 Run frontend and Node contracts.** Run the workbench asset/loading/cache tests, `tests/frontend-asset-cache-contract.test.js`, novel-panel asset/runtime/routes/health/history/export tests, all `frontend/src/user/pages/batch-factory-v11/*.test.*`, `frontend/src/shared/api/batchFactoryV11.test.js`, `test/batch-factory-v11-manual-skills-route.test.js`, `test/batch-factory-v11-proxy.test.js`, `test/batch-factory-v11-alpha-release.test.js`, and `tests/batch-factory-v11-provider-sync.test.js` using the repository’s existing test commands.
- [ ] **6.2 Run V88 composition and version contracts.** Run `tests/v88-compose.test.js`, `tests/novel-fetch-v88-mainline-version-config.test.js`, Nginx performance contracts and the release-info/served-hash tests. Record exact command lines and pass/fail output.
- [ ] **6.3 Run Go tests.** From the V88 worktree backend, run `go test ./...` and the repository’s migration tests. Treat compile-only success as insufficient; retain migration logs and schema inspection output.
- [ ] **6.4 Validate MySQL migration behavior on temporary databases.** Use MySQL 8.4.11 in a disposable candidate-only Compose project to run fresh install, partial-upgrade, repeat/idempotent upgrade and restart paths. Assert expected columns/tables with `SHOW COLUMNS`/`SHOW TABLES`; never point tests at the formal volume.
- [ ] **6.5 Build frontend and backend from the clean V88 worktree.** Confirm output hashes, asset manifest, release-info fixture, Go binary revision and Docker build context all resolve to the recorded HEAD; fail if unrelated dirty files enter the build context.
- [ ] **6.6 Commit only required compatibility fixes, each with a focused test and message such as `fix: preserve V88 workbench compatibility contract`; do not combine unrelated formatting or cleanup.

## Task 7: Bring up the isolated candidate and perform authenticated browser acceptance

**Files:**

- Use `docker-compose.v88-review.yml` from the V88 ops source.
- Create an untracked candidate env file outside the repository, for example `/tmp/qiantie-v88-review-<timestamp>.env`.
- Add `scripts/verify-v88-candidate.js` and `tests/v88-candidate-verification.test.js` only if the existing `scripts/verify-v88-cm-release.js` cannot express the required checks.

- [ ] **7.1 Validate candidate Compose before startup.** Run `docker compose -f docker-compose.v88-review.yml --env-file <candidate-env> config --quiet`; assert isolated project name, `127.0.0.1:${QIANTIE_V88_HOST_PORT:-13188}:18081`, separate `qiantie_v88` database/data directories, `v88-review` network and no reference to public `:3000` volumes or production container names.
- [ ] **7.2 Build and start candidate only.** Use pinned source revision and image tags/digests, start MySQL/backend/platform/worker, wait for health, and capture container IDs, image digests, network IDs, volume IDs and logs. Do not use `--build` on the public host.
- [ ] **7.3 Validate release identity end-to-end.** Compare generated release-info, `/api/build-info`, Git HEAD, OCI image labels/digest, served HTML and all key bundle hashes. Stop before browser acceptance if any identity differs.
- [ ] **7.4 Run anonymous and authenticated browser smoke.** On `http://127.0.0.1:13188`, verify home, login/session renewal, iframe/session behavior, novel fetch, novel panel, script generation, Shuihuo, Agent, batch factory, preview, settings, TTS, history, issue logs, personal center and logout. Capture console errors, failed requests and response timing.
- [ ] **7.5 Exercise the real `/batch-factory` V11/V88 business flow with isolated records.** Perform batch intake, TXT/MD import, batch creation, list/detail/status, restart recovery, provider/director task creation, polling, failure receipt, retry, video/merge/upload/publish boundary, settings snapshot and permission persistence. External providers must use candidate-only controlled config; no guessed production credentials.
- [ ] **7.6 Treat `/batch-factory-preview` as a separate static-route check.** Assert its HTML/JS/CSS return 200, its hardcoded sample state renders without console errors, its buttons do not issue unexpected production writes, and the report labels it as a preview prototype rather than a functional V11 acceptance result.
- [ ] **7.7 Exercise the workbench feature matrix.** Verify original text input, outline/analysis, character/relationship functions, save, restore, history, TXT/result export, TTS, merge, settings, premium/image path and diagnostics. Confirm deferred modules load once, errors show retry, and already-loaded functionality remains usable after a failed optional module.
- [ ] **7.8 Test persistence and restart.** Create records, restart backend/platform/worker without deleting volumes, then verify login/session behavior, batch status, settings, history, novel data and queued/retry state. Retain before/after IDs and MySQL inspection output.
- [ ] **7.9 Measure candidate performance.** Compare at least five samples against the recorded public baseline: homepage/API TTFB, workbench HTML TTFB, compressed critical bytes, first usable timing, route-switch duplicate downloads, cache hits and p95. Candidate must meet the design target or document an evidence-based exception; any >20% regression is a release blocker.
- [ ] **7.10 Commit candidate verifier/tests separately as `test: verify isolated V88 candidate acceptance` and keep all candidate env/secrets outside Git.

## Task 8: Public promotion gate, post-cutover validation, and rollback

**Files:**

- Use the reviewed candidate Compose/Nginx/release manifest only.
- Add an evidence/rollback runbook under `docs/superpowers/runbooks/2026-09-06-v88-public-promotion.md` only after candidate acceptance passes.
- Do not edit formal production data or configuration before the gate below is satisfied.

- [ ] **8.1 Verify the promotion gate.** Require all automated tests green, candidate browser matrix green, migration fresh/partial/repeat green, release identity matched, no missing resources/console errors, authenticated save/restore/export green, provider/director controlled loop green, restart persistence green, candidate performance not >20% worse, and remote SSH/ops access available.
- [ ] **8.2 If SSH remains `Permission denied`, stop at candidate.** Record the exact failure and report that public promotion is blocked; do not claim that V88 is public or use an alternate unverified deployment path.
- [ ] **8.3 Back up before promotion.** On the remote host, record disk usage, Compose/Nginx files, running container IDs/image digests, formal volume IDs, and current top-level/build/served hashes. Copy configs to a timestamped backup without deleting or stopping unrelated services.
- [ ] **8.4 Promote immutably.** Use the verified image digest and release manifest, `--no-build`/`--pull never` where applicable, and recreate only the intended platform/Nginx service. Preserve formal MySQL/data volumes, old images and rollback references. Never run `down -v`.
- [ ] **8.5 Run post-cutover checks immediately.** Verify public `/api/build-info`, Git/image/bundle provenance, home/login/session, all required routes, V11 batch/provider/director flows, workbench resource 200s/cache headers, save/restore/export, no new 404/console errors, and timing against the candidate baseline.
- [ ] **8.6 Roll back on any blocker.** Blockers include core入口 failure, identity drift, asset 404, save/restore/export failure, provider/director failure, unexpected container/volume changes or >20% performance regression. Restore the previous image/config and only the changed service, then verify old IDs/volumes and critical user workflows.
- [ ] **8.7 Commit the runbook/evidence references as `docs: add V88 public promotion and rollback runbook`; the runbook must state whether promotion actually occurred and must not call a candidate “public”.

## Definition of Done

- [ ] Top-level `/api/build-info` is generated from release metadata and matches the V88 candidate’s Git revision, OCI image digest, release channel and served bundle hashes; internal V78 workbench compatibility is explicit and still passes its own tests.
- [ ] Workbench HTML is short/no-store, versioned JS/CSS are immutable and hash-verified, unversioned fallback is revalidated, APIs/data remain uncached, and all HTML-referenced resources return 200.
- [ ] Critical workbench transfer and usable timing meet the design target on the measured network, route changes do not redownload cached versioned resources, and optional feature failure has a visible retry path without disabling core work.
- [ ] Nginx syntax and delivery contracts pass; workbench static responses are buffered/compressed while APIs/uploads/streams retain their original semantics.
- [ ] Node/frontend/Go tests, MySQL fresh/partial/repeat migration tests, Compose validation and authenticated browser acceptance pass in isolated resources.
- [ ] Batch intake/import/create/list/detail/status/restart, provider/director create/poll/failure/retry, video/merge/upload boundary, settings/permissions, novel fetch, novel panel save/history/export, TTS, Shuihuo, Agent, account and logout all have evidence of successful operation.
- [ ] If public promotion occurred, old images/config/volumes remain available for rollback and post-cutover evidence proves the same gates. If remote access was unavailable, the final status explicitly says “candidate verified; public promotion not performed”.

## Commit Sequence

- [ ] `test: capture V88 public provenance baseline`
- [ ] `feat: make V88 release identity provenance-driven`
- [ ] `perf: version workbench assets for immutable caching`
- [ ] `perf: progressively load non-critical workbench features`
- [ ] `perf: buffer workbench static delivery in candidate nginx`
- [ ] Focused compatibility fixes, one test-backed commit per fix
- [ ] `test: verify isolated V88 candidate acceptance`
- [ ] `docs: add V88 public promotion and rollback runbook`

## Execution Notes

This is one coordinated plan rather than independent feature branches because release identity, asset URLs, Nginx caching, browser loading, candidate image provenance and functional acceptance must describe the same immutable V88 candidate. Parallel work is safe only for read-only evidence collection and independent test review; source changes to release metadata, asset URLs, loader boundaries and deployment config remain ordered and must be revalidated together.
