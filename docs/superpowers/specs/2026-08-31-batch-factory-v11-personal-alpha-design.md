# Batch Factory V11 Personal Alpha Design

## Status

Approved for implementation planning on 2026-08-31. This is a design and
planning authorization only. No application, image, database, Compose, or
`:3000` change has been made by this document.

This document supersedes the delivery model in
`2026-08-31-v78-batch-factory-go-first-integration-design.md`. The former
document remains historical evidence of the Go-first contracts and is not an
implementation instruction.

## Decision

`http://10.0.101.122:3000/batch-factory` becomes the personal Alpha delivery
surface for a new Batch Factory V11. It is not a switch that makes every
historical button work. The full V11 interface may be visible from the first
Alpha release, but every action is enabled only when its corresponding Go V11
API, durable storage, automated tests, and release checks exist.

The current V78 static preview is not a V11 data source and is never treated
as a completed workflow. It remains recoverable through the prior immutable
image and may remain available at `/batch-factory-preview` as a read-only
visual fallback while V11 is introduced.

## Baseline And Branch

The sole source baseline remains:

```text
recovery/production-v78.3.0.3-source @ 483faed8d654e452f6079fc1ef40b74db3a13d1c
```

The implementation branch remains:

```text
release/production-v78.3.0.3-batch-factory-go-first
```

The recovered baseline is a `reconstructed reproducible source baseline`.
Its V78 frontend distribution was reproduced byte-for-byte, but it does not
prove historical Go/MySQL Batch Factory behavior. V11 starts as a new business
domain on that release baseline; it does not claim to recover the original
Batch Factory source.

The following history is reference-only and must never be wholesale merged:

```text
08-batch-factory-independent-pipeline
09-batch-factory-independent-pipeline
10-batch-factory-go-api-migration
10-batch-factory-inline-constraints-version-config
```

## Ownership Boundary

```text
React V11 workbench
  -> same-origin /api/batch-factory/v11/*
V78 Node session/auth proxy
  -> signed internal request only
Go V11 Batch Factory API
  -> MySQL V11 tables, model catalog, prompt store, jobs, media, audits
```

Node may authenticate the existing V78 session, derive the trusted account
identity, sign the internal request, and proxy the response. It must not parse
or normalize V11 settings, resolve inheritance, validate a model or duration,
compile a prompt, derive workflow state, submit a provider task, store V11
records, or handle V11 credentials. A missing Go capability stops the slice;
it must not be filled with new Node business logic.

React is a request client and rendering layer. It renders server-returned
state and capability flags. It does not calculate an authoritative effective
setting, construct a provider payload, infer status, or enable an action from
locally guessed conditions.

## V11 API And Capability Contract

All browser requests use `/api/batch-factory/v11/*`. The Node proxy preserves
method, body, response status, and correlation ID while adding only signed
session-derived identity headers. Go exposes the same route family on the
internal service and rejects unsigned, expired, or malformed bridge requests.

The first endpoint is always:

```text
GET /api/batch-factory/v11/capabilities
```

It returns a server-owned capability map. Every UI action renders from that
map, for example:

```json
{
  "batch.read": { "available": true },
  "settings.edit": { "available": true },
  "director.run": { "available": false, "reason": "Director slice not released" },
  "production.submit": { "available": false, "reason": "Production slice not released" },
  "merge.run": { "available": false, "reason": "Merge slice not released" },
  "publish.121": { "available": false, "reason": "121 is not enabled" },
  "publish.yadi": { "available": false, "reason": "Yadi is not enabled" }
}
```

The visible UI may include all areas, but unavailable actions are non-mutating
and explain their real release state. No hard-coded demo counts, fake task
states, fake success notifications, or local-only settings are permitted.

The V11 route family is:

```text
GET    /capabilities
POST   /intakes/novel-fetch
GET    /intakes/{intakeId}
POST   /intakes/{intakeId}/batches
GET    /batches
POST   /batches
GET    /batches/{batchId}
PUT    /batches/{batchId}/settings
PUT    /batches/{batchId}/books/{bookId}/override
PUT    /batches/{batchId}/books/{bookId}/videos/{videoId}/override
POST   /batches/{batchId}/change-impact
GET    /config-versions
POST   /batches/{batchId}/director
POST   /batches/{batchId}/books/{bookId}/director
GET    /batches/{batchId}/books/{bookId}/videos/{videoId}/effective-settings
GET    /batches/{batchId}/books/{bookId}/videos/{videoId}/final-prompt
POST   /batches/{batchId}/books/{bookId}/production
POST   /batches/{batchId}/production
GET    /batches/{batchId}/status
POST   /batches/{batchId}/books/{bookId}/merge
GET    /batches/{batchId}/books/{bookId}/merge
POST   /batches/{batchId}/books/{bookId}/publish/121
POST   /batches/{batchId}/books/{bookId}/publish/yadi
```

Each released endpoint validates ownership in Go. The client never submits an
owner ID, model authority, model duration limit, stored capability, task state,
or credential reference as a trusted value.

## Data Model And Compatibility Rules

V11 owns new MySQL tables with a `batch_factory_v11_` prefix. At minimum the
domain consists of:

```text
batches
intakes
books
videos
settings_patches
config_snapshots
prompt_definitions / prompt_versions / drafts
director_revisions
production_jobs / production_tasks / status_events / media_links
merge_jobs / merge_inputs
external_submission_credentials / external_submission_audits
legacy_import_runs / legacy_import_records / legacy_import_quarantine
```

New V11 aggregate IDs are immutable string IDs. The later legacy import stores
each legacy ID unchanged in a unique public identity field and preserves every
parent/child reference. An import cannot renumber a legacy Batch, Book, VIDEO,
Director revision, task, media record, or merge record.

The settings model is sparse and layered:

```text
system -> batch -> book -> VIDEO
```

Explicit `false`, empty string, and zero-like values remain stored values, not
absence. Restoring inheritance removes only requested keys from the current
scope. Batch settings changes cannot erase Book or VIDEO patches.

Changing a model, production mode, or configuration version can invalidate a
Director revision. It must never silently delete a Book or VIDEO patch, create
a new Director result, submit production, or apply an old VIDEO patch to a new
VIDEO. A changed VIDEO identity retains the old patch with an
`orphaned` or `incompatible` state until an explicit audited user decision.

## Prompt And Snapshot Authority

Go/MySQL owns Batch Factory system presets, personal prompts, and scoped
drafts. A selected prompt resolves to an immutable prompt-version ID. A draft
is separate from a personal prompt and becomes one only after an explicit save.
The Node preset store and historical Node Batch prompt files are migration
input/read evidence only; they are never a V11 write authority.

Every director or production action freezes a Config Snapshot containing the
selected model/version/capabilities, production mode, prompt-version map, and
resolved settings. A newly published configuration never changes a Batch
automatically. "Sync latest" is explicit and returns a Go-calculated impact
report before confirmation.

## V11 User Experience

`/batch-factory` renders the V11 four-region workbench in the existing V78 app
shell: Batch header, searchable Book list, Current Book workspace, VIDEO and
status area. Empty state is truthful and offers a real batch creation/intake
path only after its capability is released; it never falls back to the old
hard-coded seven- or one-hundred-book examples.

The production-settings Drawer is a right-side wide Drawer, normally
720--860px, in this fixed order:

1. Configuration version and explicit sync/latest impact;
2. Basic production settings, including original/viral mode, model, aspect
   ratio, script/asset choices, fixed single VIDEO, prefix mode, and subtitle
   policy;
3. Inline constraints, where a switch immediately exposes its editable field.

Book settings use a compact card with sparse override count, configuration
version choice, constraints, compatibility warnings, and explicit restore
inheritance. VIDEO settings follow the same principle and expose only the
selected immutable VIDEO identity. The UI does not use the old Modal-only or
separate-pencil constraint interaction as a source of truth.

The full UI can be released before every action. It must obtain all action
availability from `capabilities`; unavailable actions show their actual status
instead of simulating a result.

## Release Slices On :3000

Every slice is developed in the isolated branch/worktree, tested against a
fresh local test stack, committed, built with immutable tags, backed up, then
released to the same personal Alpha endpoint. No slice waits for all V11 work.

| Slice | Alpha unlock | Required Go ownership | Not yet enabled after release |
| --- | --- | --- | --- |
| 0 | foundation only | Go runtime, signed proxy, migration checksum gate, V11 schema, capability API, backup/rollback tooling | all user actions |
| 1 | Batch/Book/VIDEO and settings | Batch aggregate, settings/snapshot/override/prompt persistence | Director, compiler, production, merge, 121, Yadi |
| 2 | Director/Hook/fixed single VIDEO | Director request, normalization, revision persistence | final prompt, production, merge, 121, Yadi |
| 3 | effective settings and final prompt | shared resolver and compiler | production, merge, 121, Yadi |
| 4 | single/batch production, status, refresh/restart recovery | job/task/media state and server orchestration | merge, 121, Yadi |
| 5 | Merge | capability/request/status/persistence and media output | 121, Yadi |
| 6 | 121 and Yadi | encrypted credentials, confirmations, audit, provider gates | none within V11 scope |

The one-time legacy Node import is not an Alpha unlock. Its framework is
prepared in Slice 0 and its dry-run begins only after V11 can represent the
entire aggregate. Its apply/cutover requires a separate explicit acceptance;
there is no dual-write window.

## Alpha Release And Rollback Contract

Before each deployment to `:3000`:

1. Run focused Go, Node proxy, frontend build, and slice acceptance tests in a
   fresh non-production test stack.
2. Record `git rev-parse HEAD`, the previous web and Go image tags/digests,
   current Compose service image IDs, and the capability map to a release
   manifest.
3. Create a timestamped, access-restricted MySQL backup of the V11 schema and
   any affected shared schema migration ledger before applying migrations.
4. Build immutable web and Go image tags containing the commit SHA. Never use
   `latest` or `v8-latest` for an Alpha release.
5. Apply only additive/reversible migration steps validated by the migration
   checksum gate, deploy, then run login, API, and UI smoke checks.

Rollback restores the recorded preceding web and Go image pair. For a
schema-affecting failed slice, it also restores the corresponding database
backup according to the generated release manifest. A release is not reported
as complete without its rollback command, image digests, backup identifier,
and smoke-test result.

The production data source is still never used as a writable test fixture.
For eventual legacy import rehearsal the required chain remains:

```text
production :ro -> RAW immutable clone -> writable migration clone
                                      -> sanitized acceptance clone
```

The RAW clone is never scrubbed, mounted for app writes, or reused as a target.

## Migration Integrity Gate

Before V11 data migrations run, Go migration tracking must record an immutable
checksum per migration and fail closed on mismatch. The historic migration 27
MySQL 8.4 incompatibility (`MEDIUMTEXT ... DEFAULT ''`) must be repaired only
after that ledger is implemented and tested.

The required verification matrix is: empty database to latest, schema-1 to
latest, schema-26 to latest, repeated startup, and deliberate checksum
mismatch. All run on fresh MySQL 8.4 volumes. Connecting a test container to
the production backend or reusing a migrated volume does not satisfy this
gate.

## External Submission Rules

121 and Yadi remain distinct from production and merge. Even in the personal
Alpha they require all of the following before the capability becomes true:

- a Go feature gate checked before credential lookup, DNS resolution, or
  transport creation;
- explicit per-submission confirmation identifying the destination and
  payload scope;
- encrypted, owner-scoped credentials stored only when a configured server
  encryption key is present; no plaintext fallback;
- a durable redacted audit record for credential changes, submission requests,
  provider references, and outcomes; and
- tests proving disabled routes return before transport and enabled routes
  cannot submit across owner boundaries.

## Provenance

Every selectively reused file must be recorded in
`docs/batch-factory/v11-provenance.tsv` with reference branch, source commit,
source blob SHA, destination, purpose, and changes. References include the
historical Go platform skeleton, model catalog, task/media facilities, V10
Drawer interaction, and product spec. A matching filename is never sufficient
evidence to copy a file.

## Non-Goals

- No wholesale merge of 08/09/10 history.
- No new Node Batch Factory business rule.
- No dual-write between legacy Node data and V11 MySQL.
- No fake sample Batch, Book, VIDEO, task, status, or external-submit success.
- No automatic `:3000` release before the slice-specific tests, backup, image
  digest, and rollback manifest exist.
