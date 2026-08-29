# Preset Store Backward Compatibility Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make historical Docker `presets.json` / `preset-audit.json` data safely upgradeable to the current preset-store schema without deleting user prompts or crashing the platform.

**Architecture:** Extract the current strict schema/validators into a shared module, then run an idempotent migration under the existing preset-store lock before normal store reads. Migration creates original-byte backups, normalizes recognizable legacy records, quarantines unrecognizable single records, validates with the exact runtime validators, and atomically writes canonical state plus marker/audit/quarantine. A Docker drill script validates an isolated copy of the production volume before any live update.

**Tech Stack:** Node.js 20, CommonJS, `node:test`, existing `lib/system-store.js` JSON lock/transaction primitives, Docker CLI, Bash.

**Spec:** `docs/superpowers/specs/2026-08-30-preset-store-backward-compat-migration-design.md`

## Global Constraints

- Never delete, clear, or replace user preset bodies with repository defaults.
- Whole-file invalid JSON is a hard safe failure; do not treat it as an empty store.
- Runtime validation remains strict; compatibility belongs in migration.
- Preserve safe Unicode preset IDs; module IDs remain ASCII.
- Backups are byte-for-byte copies created before migration writes.
- Quarantined records remain inspectable and are never silently dropped.
- Migration must be idempotent.
- Docker verification must copy the source volume and must not write to the production volume.
- Work only on `10-batch-factory-go-api-migration`; do not merge or deploy.

---

### Task 1: Shared strict preset schema

**Files:**
- Create: `lib/preset-store-schema.js`
- Modify: `lib/preset-store.js`
- Test: `test/preset-store-schema.test.js`

**Interfaces:**
- Produces `isPresetIdentifier(value)`, `isModuleIdentifier(value)`, `validatePreset(preset)`, `validatePresets(presets)`, `validateAudit(audit)`, `publicPreset(preset)`, and `auditSummary(preset)`.
- `preset-store.js` consumes these exports instead of maintaining duplicate schema logic.

- [ ] **Step 1: Write failing schema tests**

Create tests that assert:

```js
assert.equal(isPresetIdentifier('批量工厂-导演.v1'), true);
assert.equal(isPresetIdentifier('../escape'), false);
assert.equal(isModuleIdentifier('batch-factory'), true);
assert.equal(isModuleIdentifier('批量工厂'), false);
```

Also construct a fully valid canonical preset using a Unicode ID and verify `validatePresets([preset])` does not throw.

- [ ] **Step 2: Verify RED**

Run:

```bash
node --test test/preset-store-schema.test.js
```

Expected: FAIL because `lib/preset-store-schema.js` does not exist.

- [ ] **Step 3: Implement shared schema**

Move the current validator constants/helpers from `preset-store.js` into `preset-store-schema.js`. Use:

```js
const PRESET_ID_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}._-]{0,63}$/u;
const MODULE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
```

`validatePreset` uses `isPresetIdentifier` for `id` and compatible base IDs and `isModuleIdentifier` for `module`. Keep all other current validation rules unchanged.

- [ ] **Step 4: Rewire runtime store**

Import schema exports in `preset-store.js`. `createDraft`, `publish`, `rollback`, `getVersion`, `listCatalog`, `listAll`, `getPublished`, and `resolveSelection` use the separated preset/module identifier functions. Do not add catch-and-ignore validation behavior.

- [ ] **Step 5: Verify GREEN**

Run:

```bash
node --test test/preset-store-schema.test.js
```

and the existing preset-store tests discovered in `test/`.

- [ ] **Step 6: Commit**

```bash
git add lib/preset-store-schema.js lib/preset-store.js test/preset-store-schema.test.js
git commit -m "refactor: share strict preset store schema"
```

---

### Task 2: Idempotent migration, backups, quarantine and marker

**Files:**
- Create: `lib/preset-store-migration.js`
- Create: `test/preset-store-migration.test.js`

**Interfaces:**
- Produces `migratePresetStore({ systemDir, now }) -> { migrated, marker, quarantine }`.
- Uses validators from `preset-store-schema.js`.
- Uses `readJsonOrMissing`, `writeJsonAtomic`, `withJsonLock`, `writeJsonTransaction`, and `recoverJsonTransaction` from `system-store.js`.

- [ ] **Step 1: Write the four required RED compatibility tests**

The test file creates temporary system directories and covers:

1. legacy preset aliases/missing fields normalize and preserve the exact `body` and enabled/published semantics;
2. mixed current + legacy records normalize while current records retain their canonical data;
3. an invalid single record is written to quarantine while valid records remain in `presets.json`;
4. a second migration produces identical canonical `presets.json`, `preset-audit.json`, and quarantine data and does not create a second backup set.

Fixtures must include a Unicode preset ID and a path-like invalid ID.

- [ ] **Step 2: Add RED assertions for backup and marker**

Before migration read the original source bytes. After migration assert the backup file bytes are exactly equal to the originals. Assert marker `schemaVersion === 2` and its canonical digests match the files.

- [ ] **Step 3: Verify RED**

Run:

```bash
node --test test/preset-store-migration.test.js
```

Expected: FAIL because migration module does not exist.

- [ ] **Step 4: Implement migration file layout and digests**

Use paths:

```js
presets.json
preset-audit.json
preset-store-schema.json
preset-store-quarantine.json
preset-store-migration-audit.json
preset-store-migration-transaction.json
preset-store-backups/
preset-store.lock
```

Implement SHA-256 helper over raw bytes and deterministic JSON digest over canonical data.

- [ ] **Step 5: Implement byte-for-byte backup**

For each existing source file, create one exclusive `0o600` backup under `preset-store-backups/` using a timestamp-safe filename and digest suffix. fsync the descriptor before close. Never overwrite an existing backup.

- [ ] **Step 6: Implement record normalization**

For each preset, map only the aliases defined in the spec. Preserve canonical fields first. Defaults use one migration timestamp and actor `legacy_migration`. Never transform `body` content.

Quarantine records that cannot produce a valid preset identity/module/body/kind/status. Store the original record and reason.

- [ ] **Step 7: Implement group version/status normalization**

Group by preset ID. Preserve already-contiguous unique versions. Otherwise deterministically renumber to `1..N`, recording each version change. If more than one record is published, keep the highest resulting version published and archive the rest.

- [ ] **Step 8: Implement runtime audit normalization**

Retain records that already validate. For recognizable legacy records, fill only unambiguous missing values. Quarantine other single audit records into the same quarantine file with `source: "preset-audit"`.

- [ ] **Step 9: Validate then transactionally publish**

Call shared `validatePresets()` and `validateAudit()` on the final arrays before writes. Under the existing preset lock, write canonical preset/audit, quarantine, migration audit, and schema marker in one `writeJsonTransaction` using the migration journal path.

Recover an existing migration journal before checking the marker.

- [ ] **Step 10: Implement idempotent marker check**

If schema marker version is `2` and canonical preset/audit digests match marker values, return `migrated:false` without backup or writes.

- [ ] **Step 11: Verify GREEN**

Run:

```bash
node --test test/preset-store-migration.test.js
```

Expected: all required migration tests pass.

- [ ] **Step 12: Commit**

```bash
git add lib/preset-store-migration.js test/preset-store-migration.test.js
git commit -m "feat: migrate legacy preset stores safely"
```

---

### Task 3: Startup integration and application regression

**Files:**
- Modify: `lib/preset-store.js`
- Create: `test/preset-store-startup-migration.test.js`
- Modify: `.github/workflows/batch-factory-verify.yml`

**Interfaces:**
- `createPresetStore({ systemDir })` invokes `migratePresetStore({ systemDir })` once before normal operations.
- Startup test exercises the real `createPresetStore` / `seedSystemPresets` path, not only the migration helper.

- [ ] **Step 1: Write startup RED test**

Create a temporary legacy `presets.json` that would fail the current strict validator. Instantiate the real preset store and call `seedSystemPresets(store, 'choushiyiguai')`. Assert no throw, legacy body remains retrievable, and missing current system presets are seeded after migration.

- [ ] **Step 2: Verify RED**

Run:

```bash
node --test test/preset-store-startup-migration.test.js
```

Expected: FAIL with `Invalid preset store` until startup invokes migration.

- [ ] **Step 3: Integrate migration**

At `createPresetStore` construction, run migration before building normal file operations. Keep migration and runtime operations on the same lock path; migration itself owns the lock during its transaction.

- [ ] **Step 4: Add CI step**

Add a focused step before Batch Factory-specific Node tests:

```yaml
- name: Test preset store backward compatibility migration
  run: node --test test/preset-store-schema.test.js test/preset-store-migration.test.js test/preset-store-startup-migration.test.js
```

- [ ] **Step 5: Verify focused and regression tests**

Run:

```bash
node --test test/preset-store-schema.test.js test/preset-store-migration.test.js test/preset-store-startup-migration.test.js
node --test test/batch-factory.test.js
```

Then run the frontend build:

```bash
npm --prefix frontend ci
npm --prefix frontend run build
```

- [ ] **Step 6: Commit**

```bash
git add lib/preset-store.js test/preset-store-startup-migration.test.js .github/workflows/batch-factory-verify.yml
git commit -m "fix: migrate preset data before platform startup"
```

---

### Task 4: Docker isolated-volume upgrade drill

**Files:**
- Create: `scripts/verify-preset-volume-upgrade.sh`
- Create: `test/preset-volume-upgrade-script.test.js`
- Create: `docs/deployment/preset-store-volume-upgrade.md`

**Interfaces:**
- Script usage:

```bash
scripts/verify-preset-volume-upgrade.sh --source-volume <volume> --image <candidate-web-image> [--cleanup]
```

- Script creates a temporary destination volume itself and never accepts a caller-provided destination equal to source.

- [ ] **Step 1: Write script contract RED test**

Read the shell source and assert it contains safeguards for required source/image args, a generated temporary volume name, read-only source mount during copying, candidate mount at `/app/data`, migration validation command, and cleanup only behind `--cleanup`.

- [ ] **Step 2: Verify RED**

Run:

```bash
node --test test/preset-volume-upgrade-script.test.js
```

Expected: FAIL because script does not exist.

- [ ] **Step 3: Implement Docker drill script**

The script must:

```text
validate docker is available
validate source volume exists
create qiantie-preset-upgrade-<timestamp>-<pid>
copy /from/. -> /to/. using alpine with source mounted :ro
run candidate image with temporary volume mounted /app/data
execute node -e "require('./lib/preset-store').createPresetStore({systemDir:'/app/data/system'}).listAll('script')"
verify marker/backups/migration-audit paths inside temp volume
print temp volume name and manual compose verification guidance
remove temp volume only when --cleanup is set
```

Use a trap only for command errors, never an unconditional cleanup trap that would destroy evidence.

- [ ] **Step 4: Document operator flow**

Document the exact safe upgrade order: production volume remains untouched, run drill against exact candidate image, inspect quarantine and migration audit, optionally start an isolated stack, verify login/settings/prompt library/novel acquisition/Batch Factory, then schedule the real image update.

- [ ] **Step 5: Verify script contract**

Run:

```bash
node --test test/preset-volume-upgrade-script.test.js
bash -n scripts/verify-preset-volume-upgrade.sh
```

- [ ] **Step 6: Commit**

```bash
git add scripts/verify-preset-volume-upgrade.sh test/preset-volume-upgrade-script.test.js docs/deployment/preset-store-volume-upgrade.md
git commit -m "ops: add isolated preset volume upgrade drill"
```

---

### Task 5: Final verification and diff review

**Files:** No new production files.

- [ ] **Step 1: Run all migration-focused Node tests**

```bash
node --test test/preset-store-schema.test.js test/preset-store-migration.test.js test/preset-store-startup-migration.test.js test/preset-volume-upgrade-script.test.js
```

- [ ] **Step 2: Run repository Node regression and frontend build**

```bash
node --test test/batch-factory.test.js
npm --prefix frontend ci
npm --prefix frontend run build
```

- [ ] **Step 3: Review branch diff**

Compare the pre-feature commit to HEAD and verify only schema/migration/startup/CI/Docker-drill/docs/tests changed. No user preset contents, secrets, deployment state, or master ref are modified.

- [ ] **Step 4: Verify GitHub Actions**

Inspect the workflow run for the final commit. If GitHub still reports the existing zero-step runner startup failure, report that as infrastructure-blocked and do not claim CI green. If steps execute, require migration tests, existing Batch Factory regression, and frontend build to pass.

- [ ] **Step 5: Report handoff**

Provide branch `10-batch-factory-go-api-migration`, final commit SHA, migration file paths, quarantine/audit/marker formats, and the exact isolated Docker drill command for Codex to run against a copied production volume.
