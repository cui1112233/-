# Preset Store Docker Volume Upgrade

This procedure validates a candidate Qiantie web image against a copy of the existing Docker `app_data` volume. Do not point a new image at the production volume before this drill succeeds.

## Why this exists

Historical deployments may contain `data/system/presets.json` and `data/system/preset-audit.json` written by older preset schemas. The current platform performs strict validation before seeding system presets. The backward-compatibility migration upgrades recognizable legacy records, preserves prompt bodies and history, quarantines unrecognizable individual records, and records a schema marker before the normal preset store opens.

## Safety rule

The source production volume is never mounted read-write by the drill. The script mounts it at `/from:ro`, copies it into a generated temporary volume, and gives the candidate image write access only to the temporary copy.

## 1. Identify the production volume and exact candidate image

List volumes:

```bash
docker volume ls
```

For the default Compose project the volume is commonly similar to `qiantie_app_data`, but use the actual value returned by Docker.

Use the exact candidate web image digest or tag that will be deployed, for example:

```bash
CANDIDATE_IMAGE=ghcr.io/cui1112233/qiantie-web:v8-latest
SOURCE_VOLUME=qiantie_app_data
```

## 2. Run the isolated migration drill

```bash
bash scripts/verify-preset-volume-upgrade.sh \
  --source-volume "$SOURCE_VOLUME" \
  --image "$CANDIDATE_IMAGE"
```

Do not pass `--cleanup` on the first run. The temporary migrated volume should remain available for Codex/operator inspection.

The script prints the generated temporary volume name, for example:

```text
qiantie-preset-upgrade-20260830T010203Z-12345
```

## 3. Inspect migration evidence

Inspect the temporary volume only:

```bash
docker run --rm \
  -v qiantie-preset-upgrade-20260830T010203Z-12345:/data:ro \
  alpine:3.20 \
  sh -c 'ls -la /data/system && cat /data/system/preset-store-schema.json'
```

Required files:

```text
data/system/preset-store-schema.json
data/system/preset-store-quarantine.json
data/system/preset-store-migration-audit.json
data/system/preset-store-backups/
```

The backups under `preset-store-backups/` are byte-for-byte copies of the source `presets.json` and `preset-audit.json` as they existed before migration.

Review quarantine carefully. A quarantined record is preserved there with its source, original index, reason, and complete original JSON value. Quarantine means the platform can continue using other valid presets; it does not mean the quarantined item may be discarded.

## 4. Start an isolated candidate stack

Create a temporary Compose override or separate project that maps the web/backend legacy data mount to the generated temporary volume. Do not reuse the production Compose project name and do not map the production `app_data` volume into the candidate web container.

At minimum verify:

1. login;
2. Settings / system prompt library;
3. existing historical presets and their bodies;
4. novel acquisition / novel panel;
5. Batch Factory list and settings;
6. Batch Factory prompt catalog and director entry;
7. no container restart loop and no `Invalid preset store` startup error.

If quarantine is non-empty, review each record before production cutover and decide whether an additional explicit mapping is needed.

## 5. Production cutover gate

Only update the production image after all of the following are true:

- preset migration Node tests pass;
- existing Node/Batch Factory regressions pass;
- React frontend build passes;
- isolated-volume migration succeeds using the exact candidate image;
- migration audit and quarantine have been reviewed;
- isolated application smoke checks pass.

Then schedule the real image update. The production startup will run the same idempotent migration once and write `schemaVersion: 2` to `preset-store-schema.json` after a successful validated transaction.

## 6. Cleanup after review

When the temporary volume is no longer needed:

```bash
docker volume rm qiantie-preset-upgrade-20260830T010203Z-12345
```

Or rerun the drill with `--cleanup` only when you intentionally do not need to inspect the resulting copy:

```bash
bash scripts/verify-preset-volume-upgrade.sh \
  --source-volume "$SOURCE_VOLUME" \
  --image "$CANDIDATE_IMAGE" \
  --cleanup
```

Never use the cleanup command against the source production volume.
