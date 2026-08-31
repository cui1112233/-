# Batch Factory V11 Legacy Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and rehearse a one-time Go-owned import of legacy Node Batch Factory data into the complete V11 MySQL model with preserved IDs, audit, quarantine, idempotency, reconciliation, and no dual-write.

**Architecture:** The importer reads a read-only RAW clone of legacy data, calculates a manifest, validates the full Batch aggregate, and writes a dry-run report before any target mutation. Apply runs only against a fresh writable migration clone and records each preserved source identity. Node legacy writers are paused before a separately approved cutover; V11 becomes the sole writer.

**Tech Stack:** Go 1.23, MySQL 8.4, read-only filesystem import adapter, JSON fixtures, Docker volume clone scripts.

## Global Constraints

- This plan begins only after all V11 aggregate fields exist and Slice 6 evidence is accepted.
- Data chain: `production :ro -> RAW immutable clone -> writable migration clone` and separately `RAW immutable clone -> sanitized acceptance clone`.
- RAW clone is never scrubbed, migrated, mounted writable, or used as a V11 target.
- Preserve legacy Batch, Book, VIDEO, Director, production/task/media, and merge public IDs exactly; do not renumber or lossy-map.
- No dual-write: legacy Node mutations/workers are paused before final import; Go/MySQL is the only writer after cutover.
- An import discrepancy, changed source digest, unknown parent, duplicate identity, or dangling reference is a stop condition, not an automatic repair.

---

## File Structure

- Create: `backend/internal/batchfactoryv11/legacyimport/reader.go`, `manifest.go`, `validate.go`, `dryrun.go`, `apply.go`, `audit.go`, `reconcile.go`.
- Create: corresponding `*_test.go` files and JSON fixtures in `backend/internal/batchfactoryv11/legacyimport/testdata/`.
- Create: `backend/cmd/batch-factory-v11-import/main.go` - explicit `dry-run` and `apply` CLI.
- Modify: `backend/internal/storage/batch_factory_v11_schema.go` - import run/record/quarantine tables if Foundation did not already create the final fields.
- Create: `scripts/batch-factory-v11-clone-legacy-volume.sh`, `scripts/batch-factory-v11-import-rehearsal.sh`, `test/batch-factory-v11-import-scripts.test.js`.
- Create: `docs/batch-factory/legacy-import-runbook.md`, `docs/batch-factory/legacy-import-reconciliation.schema.json`.

### Task 1: Define legacy aggregate inventory, manifest, and validation fixtures

**Files:**
- Create: `backend/internal/batchfactoryv11/legacyimport/reader.go`, `manifest.go`, `validate.go`
- Create: `backend/internal/batchfactoryv11/legacyimport/reader_test.go`, `validate_test.go`, `testdata/valid.json`, `testdata/dangling-video.json`, `testdata/duplicate-id.json`

**Interfaces:**
- `ReadLegacyAggregate(root string) ([]LegacyBatch, Manifest, error)` reads only from a supplied read-only root.
- `Manifest` records RAW clone ID, file path digest, entity counts, and aggregate/source digests.
- `Validate(LegacyBatch) []QuarantineReason` reports exact record/parent reason codes.

- [ ] **Step 1: Write failing fixture tests**

```go
func TestManifestCountsEveryLegacyEntity(t *testing.T) {
    _, manifest, err := ReadLegacyAggregate("testdata/valid")
    require.NoError(t, err)
    assert.Equal(t, 1, manifest.Counts["batch"])
    assert.Equal(t, 2, manifest.Counts["video"])
}

func TestDanglingVideoIsQuarantinedWithSourceID(t *testing.T) {
    reasons := Validate(loadFixture(t, "dangling-video.json"))
    assert.Equal(t, "missing_book_parent", reasons[0].Code)
    assert.Equal(t, "legacy-video-3", reasons[0].SourceID)
}
```

- [ ] **Step 2: Run tests and confirm the importer package is absent**

Run: `cd backend && go test ./internal/batchfactoryv11/legacyimport -run 'TestManifestCountsEveryLegacyEntity|TestDanglingVideoIsQuarantinedWithSourceID' -count=1`

Expected: FAIL with missing package/fixtures.

- [ ] **Step 3: Implement read-only inventory and validation**

Open only explicit files underneath the supplied root, reject symlink escape,
calculate SHA-256 per source and aggregate, validate IDs/references before any
database operation, and emit bounded reason codes. Do not copy credentials or
large unredacted content into reports.

- [ ] **Step 4: Run importer validation suite**

Run: `cd backend && go test ./internal/batchfactoryv11/legacyimport -run 'Test.*Manifest|Test.*Quarantine|Test.*Duplicate' -count=1`

Expected: PASS; fixtures produce exact count and quarantine evidence.

- [ ] **Step 5: Commit importer inventory**

```bash
git add backend/internal/batchfactoryv11/legacyimport
git commit -m "feat(batch-v11): inventory legacy batch data safely"
```

### Task 2: Implement dry-run/apply audit, idempotency, and reconciliation

**Files:**
- Create: `backend/internal/batchfactoryv11/legacyimport/dryrun.go`, `apply.go`, `audit.go`, `reconcile.go`
- Modify: `backend/internal/storage/batch_factory_v11_schema.go`
- Test: `backend/internal/batchfactoryv11/legacyimport/dryrun_test.go`, `apply_test.go`, `reconcile_test.go`

**Interfaces:**
- `DryRun(ctx, Manifest, []LegacyBatch) (ImportReport, error)` writes audit/quarantine only, never V11 aggregate rows.
- `Apply(ctx, Manifest, []LegacyBatch) (ImportReport, error)` writes V11 aggregates atomically per Batch.
- Idempotency key: `(raw_manifest_hash, importer_version, entity_type, legacy_source_id, source_digest)`.
- Reconciliation: `source_total = migrated + already_idempotent + quarantined` for every entity and Batch.

- [ ] **Step 1: Write failing dry-run/idempotency/reconciliation tests**

```go
func TestDryRunDoesNotWriteV11BatchRows(t *testing.T) {
    report := dryRunFixture(t, "valid.json")
    assert.Equal(t, 0, countV11Batches(t))
    assert.Equal(t, 1, report.Counts["would_migrate_batch"])
}

func TestSameManifestApplyIsVerifiedNoOp(t *testing.T) {
    first := applyFixture(t, "valid.json")
    second := applyFixture(t, "valid.json")
    assert.Equal(t, 0, second.Counts["new_batch"])
    assert.Equal(t, first.ManifestHash, second.ManifestHash)
}
```

- [ ] **Step 2: Run tests and confirm no import service exists**

Run: `cd backend && go test ./internal/batchfactoryv11/legacyimport -run 'TestDryRunDoesNotWriteV11BatchRows|TestSameManifestApplyIsVerifiedNoOp' -count=1`

Expected: FAIL with missing dry-run/apply behavior.

- [ ] **Step 3: Implement audit-first importer**

Create import-run, per-record, and quarantine rows before aggregate writes.
Apply each valid Batch in a transaction; preserve public legacy ID in a unique
field and enforce parent/child references. A changed digest for a previously
imported source ID fails hard. Do not use upsert semantics that overwrite a
completed legacy import.

- [ ] **Step 4: Run importer package suite**

Run: `cd backend && go test ./internal/batchfactoryv11/legacyimport -count=1`

Expected: PASS; dry run produces no V11 aggregate rows, apply preserves IDs,
repeat is auditable no-op, and every count reconciles.

- [ ] **Step 5: Commit importer core**

```bash
git add backend/internal/batchfactoryv11/legacyimport backend/internal/storage/batch_factory_v11_schema.go
git commit -m "feat(batch-v11): add audited legacy import"
```

### Task 3: Build clone/rehearsal CLI and cutover runbook

**Files:**
- Create: `backend/cmd/batch-factory-v11-import/main.go`
- Create: `scripts/batch-factory-v11-clone-legacy-volume.sh`, `scripts/batch-factory-v11-import-rehearsal.sh`
- Create: `docs/batch-factory/legacy-import-runbook.md`, `docs/batch-factory/legacy-import-reconciliation.schema.json`
- Test: `test/batch-factory-v11-import-scripts.test.js`

**Interfaces:**
- CLI: `batch-factory-v11-import dry-run --raw-root <read-only-root> --manifest <path>` and `apply --raw-root <read-only-root> --target-dsn <dsn> --manifest <path>`.
- Clone script emits a clone ID and manifest; it refuses a writable production mount.
- Rehearsal script creates distinct RAW, writable migration, and sanitized acceptance derivatives.

- [ ] **Step 1: Write failing script safety tests**

```js
test('clone script refuses a writable production source', () => {
  assert.match(run('scripts/batch-factory-v11-clone-legacy-volume.sh --source /prod --mode rw'), /read-only/);
});

test('rehearsal creates distinct raw and sanitized identifiers', () => {
  const result = parse(run('scripts/batch-factory-v11-import-rehearsal.sh --dry-run'));
  assert.notEqual(result.rawCloneId, result.sanitizedCloneId);
});
```

- [ ] **Step 2: Run script tests and confirm scripts are missing**

Run: `node --test test/batch-factory-v11-import-scripts.test.js`

Expected: FAIL with missing script.

- [ ] **Step 3: Implement CLI, scripts, and no-dual-write runbook**

The runbook names the exact pause point: disable legacy Node Batch Factory
mutation routes/workers for the target dataset, verify no mutation attempts,
run accepted dry-run, apply to a fresh writable clone, reconcile all counts,
then point `/batch-factory` only at V11. It must not delete legacy source data.

- [ ] **Step 4: Rehearse against synthetic and cloned non-production data**

Run:

```bash
cd backend && go test ./internal/batchfactoryv11/legacyimport -count=1
node --test test/batch-factory-v11-import-scripts.test.js
scripts/batch-factory-v11-import-rehearsal.sh --dry-run
```

Expected: PASS; no production source is modified and reports have zero
unexplained count differences.

- [ ] **Step 5: Commit import runbook and stop for explicit cutover approval**

```bash
git add backend/cmd scripts test docs/batch-factory
git commit -m "docs(batch-v11): add legacy import rehearsal runbook"
```

Do not execute a production clone, apply, or cutover merely because this plan
is complete. Report the rehearsal evidence and request an explicit import
approval.
