# Batch Factory V11 Phase 3 Director, Effective Settings And Compiler Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox syntax and each task ends at an independently reviewable commit.

**Goal:** 让 Go 成为 Hook、Director contract、Director result normalization、system-to-VIDEO effective settings 和 Final Prompt 的唯一权威，并让“查看最终 Prompt”与以后生产提交复用完全相同的编译器。

**Architecture:** 在 V11 MySQL 中持久化不可变的 Director run、输入快照、normalized result 和 compiler snapshot。Go 从系统 catalog、用户 Prompt/Draft、batch/book/video sparse patch 解析有效设置；Node 仍只签名并转发。没有 Go executor、已批准 Hook 或有效 Director revision 时，相关 capability 必须保持不可用或请求失败关闭，绝不回退到旧 Node contract 或 compiler。

**Tech Stack:** Go 1.23、database/sql、MySQL 8.4、net/http、Node 24/Express 5 HMAC proxy、React 18/Ant Design V11 client。

## Global Constraints

- 前置输入是 Phase 2 审核通过的 Go Settings/Snapshot SHA；本阶段只以 `origin/10-batch-factory-go-api-migration@b02632d77d299f3106483b6b37621019cd9ca1dc` 中的 `director_prompt.go`、`director_output.go`、`settings.go`、`config_snapshots.go` 与对应测试作为行为参考。
- 不恢复 `backend/internal/shuihuo/*`、旧 Node `lib/batch-factory/director-*`、`effective-settings.js` 或 `video-prompt-compiler.js`；新实现只位于 `backend/internal/batchfactoryv11`、`backend/internal/httpapi`、`backend/internal/storage`。
- 新 schema 只新增 Migration `1100005`；不得编辑 `1100001` 到 `1100004` 的 SQL、callback checksum 或已记录 checksum。Phase 1 的导入审计保留给 Migration `1100007`，不得抢占该版本。
- 所有 V11 规则仍由 Go/MySQL 负责：Node 不组装 Prompt、不解析 Director JSON、不判定 Hook 审核、不计算继承，也不持久化结果。
- `system -> batch -> book -> video` 是唯一继承顺序。`false`、空字符串与 `0` 是合法的显式值；模型、模式、配置版本、画幅、时长策略或 fixed-single-VIDEO 改变只使 Director 失效，不能删除 Book/VIDEO patch。
- VIDEO identity 改变时，旧 patch 和旧 compiled snapshot 都保留；服务端返回 `orphaned` 或 `incompatible`，且 `prompt.compile` 与 `production.submit` 不得使用不兼容 VIDEO。
- 系统预设的文本与版本只能由 Go `SystemPresetCatalog` 读取；我的提示词与草稿只能由 Phase 2 的 Go/MySQL owner-scoped Store 读取。请求体不得提交 system prompt body、模型最大时长或 API key 作为权威值。
- `production.run` 不得存在。为本阶段增加 `settings.resolve`、`prompt.compile`；仅完整 Hook/Director 路径可将 `hook.review`、`director.run` 设为 available。`production.submit`、`merge.run`、`publish.121`、`publish.yadi` 在本阶段仍为 unavailable。
- 候选运行必须由 feature gate、无生产凭据和 egress 阻断共同保护。未配置 Go Director executor 时，`director.run` 返回 unavailable 的明确原因，不能把静态 UI 或 contract 200 说成已能执行 Director。

## File Structure

- Create: `backend/internal/storage/batch_factory_v11_director_schema.go` and `batch_factory_v11_director_schema_test.go` for Migration `1100005` and immutable run/result/compiler tables.
- Create: `backend/internal/batchfactoryv11/director_types.go`, `director_store.go`, `director_prompt.go`, `director_output.go`, `director_service.go`, `effective_settings.go`, `final_prompt.go`, and focused `_test.go` files.
- Modify: `backend/internal/batchfactoryv11/types.go`, `memory_store.go`, `mysql_store.go`, `settings.go`, `backend/internal/app/app.go`, `backend/internal/config/config.go`, `backend/internal/httpapi/router.go`, `batch_factory_v11_capabilities.go`, and `batch_factory_v11_slice1.go` only where the V11 interfaces require it.
- Create: `backend/internal/httpapi/batch_factory_v11_director_test.go` and `batch_factory_v11_compiler_test.go`.
- Modify later, after Go endpoint tests pass: `frontend/src/shared/api/batchFactoryV11.js` and the Phase 5 V11 UI worktree. This phase does not mount or redesign React components.

### Task 1: Persist immutable Hook and Director revisions

**Interfaces:**

- `DirectorRunKind` has exactly `hook` and `director`; `DirectorRunStatus` has exactly `draft`, `queued`, `running`, `awaiting_review`, `approved`, `succeeded`, `failed`, and `invalidated`.
- `DirectorRun{ID, Owner, BatchID, BookID, Kind, Status, InputSnapshotID, SettingsHash, ResultRevision, FailureCode, CreatedAt, UpdatedAt}` contains no provider credential or raw access token.
- `DirectorRevision{ID, RunID, Revision, NormalizedJSON, PromptContractJSON, CatalogVersionsJSON, CreatedAt}` is append-only. `SaveDirectorRevision` never updates an older revision.
- `DirectorRepository` exposes `CreateRun`, `GetLatestRun`, `AppendRevision`, `MarkInvalidated`, and `ApproveHook`; both MemoryStore and MySQLStore implement the same owner-scoped behavior.

- [ ] **Step 1: Write failing persistence tests**

Create `backend/internal/batchfactoryv11/director_store_test.go` with a fixture for one owner, one Batch, one Book, and one VIDEO. Test that a Hook run is isolated from a second owner, an approved Hook creates revision one, a later Director result creates revision one without mutating the Hook result, and the earlier serialized JSON is byte-for-byte unchanged after a later append.

Add `backend/internal/storage/batch_factory_v11_director_schema_test.go` that asserts `V11Migrations()` contains exactly one migration with `Version == 1100005`, its checksum is non-empty, and its SQL creates `batch_factory_v11_director_runs`, `batch_factory_v11_director_revisions`, `batch_factory_v11_compiler_snapshots`, and an owner/batch/book index for each owner-facing query.

Run:

~~~bash
go -C backend test ./internal/batchfactoryv11 ./internal/storage -run 'Test(DirectorRun|DirectorRevision|V11DirectorSchema)' -count=1
~~~

Expected: FAIL because the V11 Director repository and migration do not exist.

- [ ] **Step 2: Add the append-only migration and Store methods**

Migration `1100005` creates these rows with foreign keys to V11 Batch and Book records:

~~~text
batch_factory_v11_director_runs
  id, owner_username, batch_id, book_id, run_kind, status,
  input_snapshot_id, settings_hash, failure_code, created_at, updated_at

batch_factory_v11_director_revisions
  id, run_id, revision, normalized_json, prompt_contract_json,
  catalog_versions_json, created_at

batch_factory_v11_compiler_snapshots
  id, owner_username, batch_id, book_id, video_id, director_revision_id,
  effective_snapshot_id, compiled_json, compiled_sha256, created_at
~~~

`AppendRevision` calculates the next revision while holding the run row lock. It rejects a different owner, an invalidated run, or a revision whose `settings_hash` no longer matches the current effective settings. It records only a SHA-256 and redacted failure code in logs; full prompt/result JSON remains in the database row and is returned only to the owner-authorized V11 route.

- [ ] **Step 3: Re-run the store and schema suite**

~~~bash
go -C backend test ./internal/batchfactoryv11 ./internal/storage -run 'Test(DirectorRun|DirectorRevision|V11DirectorSchema)' -count=1
~~~

Expected: PASS for memory and MySQL fixture implementations, with no update statement targeting an existing director revision.

- [ ] **Step 4: Commit immutable Director persistence**

~~~bash
git add backend/internal/batchfactoryv11 backend/internal/storage
git commit -m "feat(batch-v11): persist immutable Hook and Director revisions"
~~~

### Task 2: Build canonical Hook and Director contracts and normalize output

**Interfaces:**

- `SystemPresetCatalog.Resolve(id string, version int) (PresetVersion, error)` returns a published or explicitly pinned immutable version; it never accepts preset body from the browser.
- `BuildHookContract(ctx, owner, batchID, bookID) (PromptContract, error)` and `BuildDirectorContract(ctx, owner, batchID, bookID) (PromptContract, error)` derive all IDs, model limits, settings and catalog versions server-side.
- `NormalizeDirectorOutput(raw json.RawMessage, settings DirectorSettings) (DirectorResult, error)` validates and canonicalizes provider output before it can become a DirectorRevision.
- `DirectorExecutor.Execute(ctx context.Context, contract PromptContract) ([]byte, error)` is injected by Go application configuration. A nil executor does not issue an outbound request.

- [ ] **Step 1: Write failing contract and normalizer tests**

Create `backend/internal/batchfactoryv11/director_prompt_test.go` and `director_output_test.go` with these concrete cases:

~~~text
original mode uses the frozen original-director, script, and asset preset versions
viral mode rejects a Director run until a non-empty approved Hook revision exists
viral contract contains the phrase "短视频可感知强情绪" and examples of visible escalation
fixed single VIDEO allows exactly one storyboard whose duration equals the requested frozen `exactDuration`; `exactDuration` must be within the frozen model limit
multiple VIDEO output permits only integer durations from 1 through the frozen model maximum
shots start at 0, have no gaps or overlaps, and end exactly at the VIDEO duration
each character, scene, prop, and prefix key references an item declared in the same normalized result
fenced JSON is parsed; malformed JSON, unknown assets, an unknown prefix, and stale model duration are rejected
~~~

Run:

~~~bash
go -C backend test ./internal/batchfactoryv11 -run 'Test(BuildHookContract|BuildDirectorContract|NormalizeDirectorOutput)' -count=1
~~~

Expected: FAIL because V11 does not yet own the contract or normalizer.

- [ ] **Step 2: Implement server-derived contract construction**

Use the historical Go files only to preserve externally visible rules: original and viral director preset selection, frozen prompt version metadata, model-duration validation, fixed-single source coverage, and normalized result shape. Implement the new functions in `backend/internal/batchfactoryv11`; query the Phase 2 config version and catalog by owner and Batch ID, resolve user prompt overrides/drafts in Go, and serialize a `PromptContract` containing:

~~~text
systemPrompt, userPrompt, temperature, maxTokens,
promptVersions, normalizedSettings, sourceCoveragePolicy, settingsHash
~~~

For viral mode, the contract requires the approved Hook text and instructs visible, story-supported emotional escalation. It does not fabricate a numeric emotion score or replace the user's source text. For original mode, it uses source text directly. Store the resolved catalog version map and settings hash with the run.

- [ ] **Step 3: Add an executor gate without a Node fallback**

Add `QIANTIE_BATCH_FACTORY_V11_DIRECTOR_EXECUTION_ENABLED` to `backend/internal/config/config.go`. The value must parse as an explicit boolean; an absent value is `false`. `DirectorService.StartRun` does all local validation and creates a run only when the gate is true and a Go `DirectorExecutor` is configured. Otherwise it returns `ErrCapabilityUnavailable("director.run", reason)`, emits no network traffic, and leaves `director.run` unavailable.

The application must construct the executor exclusively from the existing Go model/credential configuration. If that configuration is not present in the chosen V78 baseline, leave the executor nil and keep the capability disabled; do not introduce a Node bridge or a second credential store.

- [ ] **Step 4: Verify domain behavior and commit**

~~~bash
go -C backend test ./internal/batchfactoryv11 -run 'Test(BuildHookContract|BuildDirectorContract|NormalizeDirectorOutput|DirectorExecutor)' -count=1
git add backend/internal/batchfactoryv11 backend/internal/app backend/internal/config
git commit -m "feat(batch-v11): own Director contracts and normalization in Go"
~~~

Expected: PASS. A candidate configuration with the execution gate off must report an unavailable capability rather than silently using an old Node path.

### Task 3: Resolve effective settings and preserve incompatible overrides

**Interfaces:**

- `ResolveEffectiveSettings(ctx, owner string, ref ScopeRef) (EffectiveSettings, error)` returns `Values`, `Origins`, `Compatibility`, `SnapshotID`, and `Hash`.
- `EffectiveSettings.Origins` maps each final key to exactly one of `system`, `batch`, `book`, or `video`.
- `ClassifySettingsChange(before, after EffectiveSettings) ChangeImpact` reports changed keys, affected Book/VIDEO counts, `InvalidatesDirector`, `PreservesOverrides`, and per-VIDEO compatibility notes.
- `InvalidateDirectorForChange` marks affected Director runs invalidated but leaves all patch JSON untouched.

- [ ] **Step 1: Write failing resolver tests**

Create `backend/internal/batchfactoryv11/effective_settings_test.go` with the following explicit sequence:

~~~text
system has aspectRatio 9:16 and injectScenePrompt true
batch overrides aspectRatio to 16:9
book overrides injectScenePrompt to false
video overrides exactDuration to 0 and negativePrompt to an empty string
the resolved VIDEO result contains all four explicit values and their four origins
restoring only book injectScenePrompt removes that Book key and exposes the batch/system value without copying it
changing mode, videoModelId, versionConfigId, aspectRatio, duration strategy, or fixedSingleVideo invalidates Director and preserves all child patch bytes
changing VIDEO identity labels the old patch orphaned or incompatible and rejects compilation for that VIDEO
~~~

Run:

~~~bash
go -C backend test ./internal/batchfactoryv11 -run 'Test(ResolveEffectiveSettings|RestoreOnlyNamedKey|SettingsChangeInvalidatesDirector|VideoIdentityChange)' -count=1
~~~

Expected: FAIL until the resolver, compatibility classifier, and invalidation persistence exist.

- [ ] **Step 2: Implement one resolver used by every consumer**

`ResolveEffectiveSettings` loads the immutable system config revision, then overlays only present keys from Batch, Book, and VIDEO patches. It canonicalizes video model/version/duration against Go catalog data before calculating the hash. It snapshots the full resolved JSON, source map, catalog revision map, and compatibility map in `batch_factory_v11_config_snapshots`; the snapshot ID is returned for Director and compiler use.

`SaveSettings` calls the same classifier before commit. When an invalidating key changes it appends invalidation metadata to affected Director runs, but it does not delete Book/VIDEO rows, patch values, user prompts, drafts, or earlier snapshots. A VIDEO identity change preserves the old patch JSON and sets its compatibility state to `orphaned` when the old VIDEO is absent or `incompatible` when it remains but violates the new catalog/configuration.

- [ ] **Step 3: Re-run settings regression tests and commit**

~~~bash
go -C backend test ./internal/batchfactoryv11 ./internal/storage -run 'Test(ResolveEffectiveSettings|RestoreOnlyNamedKey|SettingsChangeInvalidatesDirector|VideoIdentityChange|SparsePatch|ParentSave)' -count=1
git add backend/internal/batchfactoryv11 backend/internal/storage
git commit -m "feat(batch-v11): resolve effective settings and invalidate Director safely"
~~~

### Task 4: Compile one final VIDEO prompt from frozen Go data

**Interfaces:**

- `CompileFinalPrompt(ctx, owner, batchID, bookID, videoID string) (CompiledPrompt, error)` is the only compiler entry point.
- `CompiledPrompt{SnapshotID, DirectorRevisionID, Prompt, NegativePrompt, AssetRefs, Hash, CreatedAt}` contains no provider credential and is stored by hash in `batch_factory_v11_compiler_snapshots`.
- `CompilerInput` is constructed only from `ResolveEffectiveSettings`, the latest valid DirectorRevision, current VIDEO references, and Go-owned Prompt catalog records.

- [ ] **Step 1: Write failing compiler tests**

Create `backend/internal/batchfactoryv11/final_prompt_test.go` with an original-mode DirectorRevision that has two scenes, two characters, two props, and two VIDEO storyboard entries. Assert that compiling VIDEO one injects only that VIDEO's declared character, scene, and prop references; it includes enabled prefix/quality/restriction/negative/subtitle constraints; it omits a disabled constraint; and it preserves a deliberate empty-string override.

Add cases that fail closed when the selected VIDEO has no valid DirectorRevision, its Director run is invalidated, its compatibility state is not `active`, or a referenced catalog prompt version no longer resolves. Recompile the same immutable input twice and assert the returned `Hash` and `SnapshotID` are reused instead of producing divergent text.

Run:

~~~bash
go -C backend test ./internal/batchfactoryv11 -run 'Test(CompileFinalPrompt|CompilerRejects)' -count=1
~~~

Expected: FAIL because no V11 compiler exists.

- [ ] **Step 2: Implement deterministic compiler composition**

Build the prompt from the frozen `CompilerInput` in this order:

~~~text
director VIDEO description
current VIDEO asset references only
enabled character/scene/prop injection blocks
enabled prefix, quality, restriction, negative, and subtitle constraints
canonical model/aspect/duration settings
~~~

The compiler records exact source catalog/prompt versions and normalized settings in the compiled JSON. It has no HTTP client and does not invoke a model. Both the UI preview route and Phase 4 production submit must call `CompileFinalPrompt`; neither may concatenate prompt text independently.

- [ ] **Step 3: Verify deterministic output and commit**

~~~bash
go -C backend test ./internal/batchfactoryv11 -run 'Test(CompileFinalPrompt|CompilerRejects)' -count=1
git add backend/internal/batchfactoryv11 backend/internal/storage
git commit -m "feat(batch-v11): compile final VIDEO prompts in Go"
~~~

### Task 5: Expose owner-scoped V11 routes and capability state

**Files:** `backend/internal/httpapi/batch_factory_v11_director.go`, `batch_factory_v11_compiler.go`, `batch_factory_v11_director_test.go`, `batch_factory_v11_compiler_test.go`, `router.go`, and `batch_factory_v11_capabilities.go`.

- [ ] **Step 1: Write failing HTTP contract tests**

Use the real `BridgeAuth` test helper and a MemoryStore fixture. Add cases for unsigned `401`, another owner's batch `404`, a viral Director request without a Hook approval `409`, a stale settings revision `409`, an invalid normalized output `422`, and these endpoint contracts:

~~~text
GET  /api/batch-factory/v11/batches/{batchId}/books/{bookId}/hook-runs/latest
POST /api/batch-factory/v11/batches/{batchId}/books/{bookId}/hook-runs
PUT  /api/batch-factory/v11/batches/{batchId}/books/{bookId}/hook-runs/{runId}/approval
GET  /api/batch-factory/v11/batches/{batchId}/books/{bookId}/director-runs/latest
POST /api/batch-factory/v11/batches/{batchId}/books/{bookId}/director-runs
GET  /api/batch-factory/v11/batches/{batchId}/books/{bookId}/videos/{videoId}/effective-settings
POST /api/batch-factory/v11/batches/{batchId}/books/{bookId}/videos/{videoId}/final-prompt
~~~

The final-prompt response must contain `compiledPrompt`, `negativePrompt`, `snapshotId`, `directorRevisionId`, `assetRefs`, and `hash`. It must never contain a provider credential or raw bridge secret.

- [ ] **Step 2: Implement thin handlers and capabilities**

Handlers derive owner only from `BridgeIdentityFromContext`, enforce object ownership, decode bounded request bodies, call the new V11 services, and map `ErrNotFound` to `404`, `ErrConflict` to `409`, invalid client input to `400`, invalid provider/output structure to `422`, and disabled executor to `503` with an explicit capability reason.

`GET /api/batch-factory/v11/capabilities` adds `settings.resolve` and `prompt.compile`. `hook.review` is available only after the Hook persistence/approval endpoints pass. `director.run` is available only when the Go executor gate and executor are both present. All Production, Merge, 121, and Yadi capability values remain false in this phase.

- [ ] **Step 3: Run domain, HTTP, and Node transport regression suites**

~~~bash
go -C backend test ./internal/batchfactoryv11 ./internal/httpapi ./internal/storage -count=1
node --test test/batch-factory-v11-proxy.test.js test/batch-factory.test.js test/batch-factory-current-mainline-contract.test.js
~~~

Expected: PASS. The Node proxy forwards the new routes as opaque transport; it has no Director or compiler imports.

- [ ] **Step 4: Commit the Go endpoint slice**

~~~bash
git add backend/internal/httpapi backend/internal/batchfactoryv11 backend/internal/storage backend/internal/app backend/internal/config
git commit -m "feat(batch-v11): expose Director and final prompt APIs"
~~~

## Phase Gate

- [ ] Migration `1100005` passes the MySQL 8.4 matrix introduced in Phase 2 and `RunMigrations` rejects a changed checksum.
- [ ] Every Hook, Director, snapshot, effective-setting, and compiled-prompt read/write is owner scoped and proven by tests.
- [ ] The same `CompileFinalPrompt` function is called by the preview endpoint and exposed as the Phase 4 production submit dependency.
- [ ] Settings changes invalidate Director only; Book/VIDEO override bytes and prior snapshots remain retrievable.
- [ ] Candidate configuration has no Director executor and reports the feature as disabled without outbound traffic; a separately configured non-candidate executor is required before declaring live Director execution complete.
- [ ] No Node Batch Factory business module, historical Shuihuo module, 121/Yadi code, V78 `:3000`, formal MySQL, or formal volume changed.

Stop here for review before enabling Phase 4 Production/Status/Merge.
