# Preset Store Backward Compatibility Migration Design

## Context

Qiantie persists system prompt presets in the Docker volume under `data/system/presets.json` and audit history in `data/system/preset-audit.json`. The current `lib/preset-store.js` validates the complete store before `seedSystemPresets()` can run. Historical volumes can contain records produced by older schemas (missing fields, legacy field names, Unicode preset IDs, legacy audit records, non-contiguous versions, or older status metadata). A single incompatible record currently causes `Invalid preset store`, which aborts `createApp()` and puts the web container into a restart loop.

The compatibility fix must preserve user data and must not weaken the current store into accepting arbitrary malformed records.

## Goals

1. Upgrade historical preset stores before strict runtime validation.
2. Preserve prompt `body`, version history semantics, and published/draft/archived state whenever they can be determined safely.
3. Support historical preset IDs, including safe Unicode IDs, without forcing destructive renames.
4. Back up original `presets.json` and `preset-audit.json` bytes before any migration write.
5. Isolate an unrecognizable single record instead of crashing the whole platform.
6. Keep the migration idempotent and transactionally write the migrated state, quarantine, migration audit, and schema marker.
7. Make Docker upgrades testable against an isolated copy of the production volume before touching the live volume.

## Non-goals

- Do not delete or reset the prompt library.
- Do not silently replace user prompt bodies with repository defaults.
- Do not treat a completely unreadable JSON file as an empty store. Whole-file JSON corruption remains a hard failure because safe per-record recovery is impossible without guessing.
- Do not merge this work into `master` or deploy it as part of implementation.

## Schema boundary

Create `lib/preset-store-schema.js` as the single definition of the current preset and preset-audit schema. Both the runtime store and the migration code use the same validators.

Preset IDs and module IDs are intentionally separate concepts:

- module IDs remain strict ASCII identifiers (`[A-Za-z0-9._-]`) because they are routing/category keys controlled by the application;
- preset IDs accept safe Unicode letters and numbers plus `.`, `_`, and `-`, with the first character required to be a Unicode letter or number. This preserves legacy Chinese preset IDs while still rejecting whitespace, path separators, control characters, and traversal-like values.

No extra compatibility-only properties are added to a preset record; compatibility metadata belongs in the migration audit.

## Migration files

For a system directory such as `data/system`, migration uses:

- `presets.json` — canonical migrated presets.
- `preset-audit.json` — canonical runtime audit records.
- `preset-store-schema.json` — schema marker.
- `preset-store-quarantine.json` — isolated records that could not be safely normalized.
- `preset-store-migration-audit.json` — append-only migration decisions and summaries.
- `preset-store-backups/` — byte-for-byte source backups.
- `preset-store-migration-transaction.json` — transaction journal used by `writeJsonTransaction`.
- existing `preset-store.lock` — serializes migration and runtime preset mutations.

### Schema marker

Current marker version is `2`:

```json
{
  "schemaVersion": 2,
  "migratedAt": "2026-08-30T00:00:00.000Z",
  "sourceDigest": "sha256:...",
  "presetsDigest": "sha256:...",
  "auditDigest": "sha256:...",
  "backup": {
    "presets": "preset-store-backups/...-presets.json",
    "audit": "preset-store-backups/...-preset-audit.json"
  },
  "quarantinedRecords": 0
}
```

If the marker already has `schemaVersion: 2` and the current canonical preset/audit digests match the marker, migration is a no-op. This gives deterministic repeated startup behavior.

## Original-byte backup

Before the first migration write for a given source state:

1. read original file bytes without parsing/reformatting;
2. calculate SHA-256 digests;
3. create `preset-store-backups/` with private permissions;
4. write copies whose filenames contain an ISO-safe timestamp and the first 12 digest characters;
5. use exclusive creation so an existing backup is never overwritten;
6. fsync the backup file before continuing.

Missing source files are represented as `null` backup paths; they are not invented.

## Preset normalization

Migration processes each source array element independently and never mutates its `body` value.

Recognized canonical fields are copied directly. Conservative legacy aliases are supported where the mapping is unambiguous:

- `presetId` or `key` -> `id`
- `moduleId` -> `module`
- `title` -> `name`
- `type` -> `kind`
- `content` or `prompt` -> `body`
- `compatibleBases` -> `compatibleBaseIds`
- `revision` -> `version`
- `state` -> `status`
- `created_at` / `created_by` -> `createdAt` / `createdBy`
- `published_at` / `published_by` -> `publishedAt` / `publishedBy`

Missing compatible fields receive deterministic defaults:

- `kind`: `base`
- `description`: empty string
- `compatibleBaseIds`: empty array
- `protocolLock`: `null`
- `createdAt`: existing valid creation/publish time, otherwise the migration timestamp
- `createdBy`: existing valid actor, otherwise `legacy_migration`

Status handling:

- valid `draft`, `published`, `archived` values are preserved;
- legacy boolean `enabled: true` maps to `published` and `enabled: false` maps to `archived` only when no canonical status exists;
- draft records always have `publishedAt/publishedBy = null`;
- published/archived records receive deterministic publish metadata if old data omitted it.

Version handling occurs per preset ID after record-level normalization:

- a valid already-contiguous `1..N` history is preserved exactly;
- duplicate, missing, or gapped versions are sorted by valid legacy version first and source order second, then renumbered to `1..N`;
- at most one record per ID remains `published`; if multiple historical records claim published state, the highest resulting version stays published and older ones become archived;
- each structural change is recorded in migration audit.

A preset record is quarantined if required identity/content cannot be recovered safely, including invalid/missing preset ID, invalid module, missing body, invalid JSON value body, or unrecoverable kind/status semantics.

## Runtime preset audit normalization

Existing `preset-audit.json` records that already pass the current validator are retained byte-equivalently at the data level. Recognized legacy audit records may be normalized when their action and target are unambiguous. An invalid single audit record is quarantined rather than aborting the whole preset store.

The canonical runtime audit action set remains unchanged. Migration-specific information is never inserted into `preset-audit.json`; it goes to `preset-store-migration-audit.json`.

## Quarantine format

```json
{
  "schemaVersion": 1,
  "records": [
    {
      "at": "2026-08-30T00:00:00.000Z",
      "source": "presets",
      "index": 7,
      "reason": "missing or invalid preset id",
      "record": {"original": "value"}
    }
  ]
}
```

Quarantine records preserve the original JSON value. Migration never drops them silently.

## Migration audit format

```json
{
  "schemaVersion": 1,
  "entries": [
    {
      "id": "uuid",
      "at": "2026-08-30T00:00:00.000Z",
      "action": "preset.normalized",
      "source": "presets",
      "index": 2,
      "target": "旧预设ID",
      "changes": ["added kind=base", "renumbered version 4 -> 2"]
    }
  ]
}
```

Allowed migration actions are `migration.started`, `preset.normalized`, `preset.quarantined`, `audit.normalized`, `audit.quarantined`, and `migration.completed`.

## Atomic write and recovery

Migration runs under the existing `preset-store.lock`. After backups exist, it validates the fully normalized preset and audit arrays with the same current validators used at runtime. Only then it calls `writeJsonTransaction` to atomically publish:

- `presets.json`
- `preset-audit.json`
- `preset-store-quarantine.json`
- `preset-store-migration-audit.json`
- `preset-store-schema.json`

The migration transaction has its own journal path so it cannot be confused with normal preset mutations. On startup, pending migration journals are recovered before deciding whether a migration is required.

If final validation fails, canonical files are not replaced. If transaction recovery cannot prove a consistent write, startup fails with an explicit migration error rather than presenting an empty prompt library.

## Startup integration

`createPresetStore({ systemDir })` invokes the migration before exposing store operations. Therefore all callers, including `seedSystemPresets()` and `seedBatchFactoryPromptPresets()`, see a canonical store.

The runtime validation stays strict. The migration is the compatibility boundary; runtime operations do not gain a catch-and-ignore fallback for arbitrary malformed data.

## Test requirements

At minimum, add independent migration tests covering:

1. legacy `presets.json` starts successfully and preserves body/status/content after normalization;
2. mixed current and legacy records start successfully without rewriting already-valid records unnecessarily;
3. one invalid preset or audit record is quarantined and all valid records remain available;
4. running migration twice yields the same canonical preset/audit/quarantine data and no second backup set.

Also test:

- byte-for-byte backups exist before canonical replacement;
- Unicode preset IDs are accepted while unsafe path-like IDs are quarantined;
- non-contiguous versions are normalized deterministically;
- the schema marker matches the canonical digests;
- `createApp()` can seed system presets after migrating a legacy store.

## Docker upgrade drill

Add `scripts/verify-preset-volume-upgrade.sh`. It must never mutate the source production volume. The script:

1. requires an explicit source Docker volume name and candidate web image;
2. creates a uniquely named temporary Docker volume;
3. copies the entire source volume into the temporary volume using a short-lived helper container;
4. runs the candidate web image with the temporary volume mounted at `/app/data` and a migration-only command that loads `createPresetStore` and exits after validation;
5. verifies backup, marker, quarantine, and migration-audit files in the temporary volume;
6. prints commands for optionally starting the candidate stack against the copied volume for manual endpoint checks;
7. deletes the temporary volume only when the operator explicitly passes `--cleanup`.

The script refuses source and destination names that are equal and never runs a write command with the original volume mounted read-write.

## Release gate

Before updating the production `app_data` volume:

1. run Node migration tests;
2. run existing Node regression tests;
3. build the React frontend;
4. perform the Docker temporary-volume drill with the exact candidate image;
5. verify settings, prompt library, novel acquisition, Batch Factory, and login in the isolated copy;
6. only then schedule the real image switch.
