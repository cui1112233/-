# Batch Factory V11 Phase 1 Data Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. This phase defines and tests the importer first; the real import is gated until final candidate acceptance.

**Goal:** 定义并验证 V78 Node Batch/Book/VIDEO/Director/Production 数据到 Go/MySQL 的一次性导入合同，保证 ID、override、审计、回滚和数量对账可证明，且切换后没有 dual-write。

**Architecture:** 导入器读取冻结的 Node JSON/SQL 快照，先写 RAW immutable evidence，再把解析结果写入独立 writable migration clone。每条记录使用 source system、owner、entity type、source ID 和 source hash 组成幂等键；合法记录进入 V11 表，非法或冲突记录进入 quarantine，原始证据永不被覆盖。

**Tech Stack:** Go 1.23、MySQL 8.4、JSON/SQL snapshot reader、Node 现有 lib/batch-factory/store.js 和 lib/batch-factory/mysql-store.js 作为读取格式参考、shell clone script。

## Global Constraints

- 导入执行顺序固定为 production :ro -> RAW immutable clone -> writable migration clone -> sanitized acceptance clone。
- 导入审计使用唯一的 Migration `1100007`；即使本阶段代码先实现，`1100007` 也只能在 Phase 2 的 `1100004`、Phase 3 的 `1100005` 和 Phase 4 的 `1100006` 之后注册，不能抢占或复用其他版本。
- 导入器从冻结副本读取，不修改 Node 源数据；切换前旧写路径由 cutover gate 拒绝。
- ID 原样保留。Batch id、Book 内部 id 与公开 bookId、VIDEO id 分别保存；同一 ID 在不同类型或 owner 冲突时 quarantine，不自动加前缀。
- Director、Production、Merge 的未知 JSON 字段原样保存到版本化 payload；已知字段按 V11 contract 校验，不能因为一条记录失败丢弃整批。
- 模式、模型或配置改变只记录 Director invalidation；不得删除 Book/VIDEO patch。VIDEO identity 不同则保留 patch 并写入 orphaned 或 incompatible。
- Audit、quarantine 和报告不得包含 token、API key、cookie、用户凭据或未经脱敏的浏览器数据。
- 本阶段不执行真实导入、不接外部 provider、不触碰正式 MySQL、正式 volume 或 :3000。

## File Structure

- Create: docs/batch-factory/v11-import-contract.md - 字段映射、状态机、切换和回滚合同。
- Create: backend/internal/batchfactoryv11/import_contract.go - 版本化输入、结果、幂等键和对账类型。
- Create: backend/internal/batchfactoryv11/import_contract_test.go - ID/override/orphan/quarantine/dry-run tests。
- Create: backend/internal/batchfactoryv11/import_runner.go - source reader、事务批处理、audit 和 quarantine writer。
- Create: backend/internal/batchfactoryv11/import_runner_test.go - fixture 导入、重复执行和失败恢复 tests。
- Create: backend/internal/storage/batch_factory_v11_import_audit.go - audit、quarantine、source checksum 的 additive migration。
- Create: scripts/batch-factory-v11-import.sh - clone、backup、dry-run、对账和 cutover gate。
- Create: test/batch-factory-v11-import-script.test.js - 参数拒绝、正式卷路径拒绝和 no-dual-write guard。
- Modify: docs/batch-factory/v11-source-provenance.tsv - 记录导入器和 fixture 来源。

### Task 1: Freeze the source and define the mapping contract

**Interfaces:**

- SourceRecord{Owner, EntityType, SourceID, Payload, SourceHash} is the only input to the domain importer.
- ImportPlan{RunID, SourceSnapshotSHA256, DryRun, CutoverMode} is immutable for one run.
- ImportResult{Imported, Quarantined, SkippedIdempotent, Counts, AuditID} is the only summary consumed by release tooling.

- [ ] **Step 1: Write the failing contract test**

Create a fixture containing two owners, one batch with two books, one VIDEO override containing false, empty string, and zero, one Director payload, one Production payload, a duplicate source row, and one malformed VIDEO identity. Assert:

~~~text
source batch/book/video IDs == destination IDs
destination patch bytes == source patch bytes
duplicate source hash -> skippedIdempotent = 1
malformed identity -> quarantine = 1 and raw payload hash retained
counts.imported + counts.quarantined + counts.skipped == counts.seen
~~~

Run:

~~~bash
go -C backend test ./internal/batchfactoryv11 -run TestImportContractPreservesIdsAndSparseValues -count=1
~~~

Expected: FAIL because the V11 import contract types do not exist.

- [ ] **Step 2: Record the actual Node source formats before implementation**

Run:

~~~bash
rg -n 'batch-factory\.json|batch_factory|directorResult|productionResults|settingOverrides|promptVersions' lib/batch-factory routes data 2>/dev/null
~~~

Record whether the selected snapshot is file JSON, SQL rows, or both in docs/batch-factory/v11-import-contract.md. Do not infer a database table from a branch name; the snapshot and its SHA-256 are the evidence.

- [ ] **Step 3: Implement the versioned contract and mapping table**

Define the three types above and reject an empty run ID, a non-hex snapshot hash, an unknown cutover mode, and a source record without owner or entity type. The mapping table names the V11 destination table, preserved source ID, parser version, and audit fields for each entity.

- [ ] **Step 4: Run the contract test and commit**

~~~bash
go -C backend test ./internal/batchfactoryv11 -run TestImportContract -count=1
git add docs/batch-factory/v11-import-contract.md backend/internal/batchfactoryv11/import_contract.go backend/internal/batchfactoryv11/import_contract_test.go
git commit -m "feat(batch-v11): define one-time import contract"
~~~

Expected: PASS on fixture data; no production path or real volume is accessed.

### Task 2: Implement dry-run, backup, audit, quarantine and idempotency

**Interfaces:**

- RunImport(ctx context.Context, db *sql.DB, plan ImportPlan, records []SourceRecord) (ImportResult, error).
- BuildIdempotencyKey(record SourceRecord) string returns source-system, owner, entity-type, source-id and source-hash joined in a canonical form.
- ReconcileImport(sourceCounts, resultCounts map[string]int) error fails unless every entity count balances.

- [ ] **Step 1: Write the failing runner tests**

Cover a dry-run that writes audit rows but zero destination rows, a writable-clone run that preserves IDs and bytes, a second identical run that only increments SkippedIdempotent, and a run with one malformed record that commits valid rows while quarantining the malformed payload hash and reason.

Run:

~~~bash
go -C backend test ./internal/batchfactoryv11 -run 'TestRunImportDryRun|TestRunImportIsIdempotent|TestRunImportQuarantinesOneRecord|TestReconcileImport' -count=1
~~~

Expected: FAIL because the runner and audit repository do not exist.

- [ ] **Step 2: Add additive audit/quarantine schema**

Add Migration `1100007` after the Phase 2-4 schema migrations. Create immutable run_id, source_snapshot_sha256, entity_type, source_id, owner, source_hash, outcome, reason, destination_id, created_at, and a unique idempotency key. Never alter the SQL/checksum of `1100001`-`1100006`.

- [ ] **Step 3: Implement transactional import behavior**

For DryRun=true, validate and reconcile every record, write only audit/quarantine rows, and return without inserting Batch/Book/VIDEO rows. For a migration clone, insert valid records in dependency order, preserve original IDs, retain sparse JSON bytes, and use duplicate-key handling only when the stored source hash is identical. A different hash for the same source ID quarantines as source_changed; it never overwrites silently.

When a model/mode/config identity differs from stored source identity, call the Settings compatibility classifier and persist director_invalidated=true plus old override bytes. For a VIDEO identity mismatch, persist compatibility_state as orphaned or incompatible and retain the old patch.

- [ ] **Step 4: Run runner tests and commit**

~~~bash
go -C backend test ./internal/batchfactoryv11 ./internal/storage -count=1
git add backend/internal/batchfactoryv11 backend/internal/storage/batch_factory_v11_import_audit.go
git commit -m "feat(batch-v11): add auditable idempotent import runner"
~~~

Expected: PASS on memory fixtures; no formal volume is mounted.

### Task 3: Add clone tooling and the no-dual-write cutover gate

**Files:** scripts/batch-factory-v11-import.sh, test/batch-factory-v11-import-script.test.js, docs/batch-factory/v11-import-contract.md.

- [ ] **Step 1: Write failing shell contract tests**

Reject a source path that resolves to a known formal volume, reject a writable source mount, reject --cutover without a prior successful dry-run and count report, and require distinct paths for RAW, migration, and sanitized clones.

Run:

~~~bash
node --test test/batch-factory-v11-import-script.test.js
~~~

Expected: FAIL because the script is not present.

- [ ] **Step 2: Implement the explicit clone pipeline**

The script performs, in order:

~~~text
production :ro
  -> RAW immutable clone (source bytes + SHA-256 manifest)
  -> writable migration clone (Go importer target)
  -> sanitized acceptance clone (browser/API test data)
~~~

It emits a redacted JSON report with source/destination paths, source hash, counts, audit ID, quarantine count, and rollback target. It never deletes or scrubs the RAW clone.

- [ ] **Step 3: Enforce no dual-write**

Persist a cutover state with the import audit. Before cutover-ready, V11 writes are rejected with a clear state error. After cutover, old Node write routes reject imported V11 IDs and no V11 handler calls lib/batch-factory/store.js. A source read may remain available for comparison, but no request may write both stores.

- [ ] **Step 4: Run script tests and commit**

~~~bash
node --test test/batch-factory-v11-import-script.test.js
git add scripts/batch-factory-v11-import.sh test/batch-factory-v11-import-script.test.js docs/batch-factory/v11-import-contract.md
git commit -m "chore(batch-v11): add immutable clone and cutover gates"
~~~

### Task 4: Final import gate (deferred until candidate acceptance)

- [ ] **Step 1: Re-run the full source-to-clone matrix**

Use a newly named RAW, migration, and sanitized clone for every rehearsal. Run the dry-run twice, compare source SHA-256 manifests byte-for-byte, and reconcile counts per owner and entity type.

- [ ] **Step 2: Require all upstream phases to be green**

Do not run --cutover until Phase 2 Go Settings/Snapshot, Phase 3 Director/Compiler, Phase 4 Production/Status/Merge, Phase 5 UI, and Phase 6 candidate browser/API acceptance each supply a full commit SHA and passing report.

- [ ] **Step 3: Commit only the evidence**

Add docs/batch-factory/alpha-releases/data-import-run.md with the actual run ID, source hash, counts, quarantine list, audit ID, clone paths and rollback command. The release evidence must not contain credentials or raw user content.
