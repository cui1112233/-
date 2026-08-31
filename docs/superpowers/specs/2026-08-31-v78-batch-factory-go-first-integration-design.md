# V78 Batch Factory Go-First Integration Design

## Status

Review pending / changes requested on 2026-08-31. The earlier conversation
approval of the Go-first direction is conditional on the contracts added in
this revision. No Go, Node, React, Compose, migration, or production work is
authorized until this revised document receives a further review approval.

This document replaces the old
release/production-v78.3.0.3-batch-factory-full implementation direction;
that branch is retained only as historical evidence and is not a release base.

## Goal

Deliver the complete approved Batch Factory workflow on top of the reconstructed
V78.3.0.3 source baseline, prove it in an isolated candidate environment, and
report the result for a separate production-release decision. The candidate must
not change master, port 3000, the production image, production containers,
production volumes, or production data.

## Baseline And Branch

The only source baseline is:

~~~text
recovery/production-v78.3.0.3-source @ 483faed8d654e452f6079fc1ef40b74db3a13d1c
~~~

The implementation branch is:

~~~text
release/production-v78.3.0.3-batch-factory-go-first
~~~

The branch is in its own worktree at:

~~~text
/Users/ming/Downloads/qiantie/.worktrees/release-production-v78.3.0.3-batch-factory-go-first
~~~

483faed is a reconstructed reproducible source baseline, not a claim that the
recovered sources are the original historical sources. Its clean build has
already reproduced the V78 static distribution byte-for-byte, but it does not
prove dynamic Go/MySQL Batch Factory parity.

The old base is explicitly excluded:

~~~text
release/production-v78.3.0.3-preset-migration-drawer @ 72327e9
~~~

It is neither the source baseline nor a branch to merge. The 08, 09, and 10
Batch Factory history branches remain file-level behavioral references only;
they must never be merged wholesale.

## Scope

This candidate will be planned as independently testable slices in this order:

1. Go/MySQL migration foundations: checksum-protected schema migration,
   one-time legacy data-migration contract, and synthetic rehearsal only.
2. Go Settings, Settings Store, model snapshot validation, sparse overrides,
   prompt authority, and Config Snapshot ownership.
3. Go Director contract and normalization, effective-settings resolution, and
   final VIDEO Prompt compiler.
4. Go production submission, status aggregation, and Merge capability,
   request, status, and persistence, with Node limited to compatibility
   forwarding where the V78 app still needs a same-origin API.
5. The V10 Batch Factory workbench, final production and publish Drawers, and
   inline constraint editing in the recovered V78 React shell.
6. Isolated Compose, a fresh temporary-volume drill, automated regression
   checks, manual acceptance, immutable image build, and an acceptance report.

121 and Yadi are not active integrations in this candidate. Their entries may
be visible only as clearly disabled, non-misleading controls. They must state
that the capability is not enabled for this release and must not call legacy
Node adapters, persist credentials, emit network traffic, or imply a completed
submission.

Pixiu, account center, novel-fetch redesigns, screenplay features, and other
app-shell changes are outside this Batch Factory candidate. Existing V78
behaviour remains untouched unless a narrowly scoped Go compatibility change is
required by the Batch Factory contract.

## Ownership Architecture

The implementation follows this ownership boundary:

~~~text
Recovered V78 React UI
        |
        | same-origin Batch Factory API
        v
V78 Node compatibility boundary
        |
        | session-derived trusted identity/internal transport only; no business normalization
        v
Go Batch Factory API
  - settings and version snapshots
  - model capability validation and frozen model snapshots
  - batch/book/VIDEO sparse override storage
  - system presets, personal prompts, and scoped drafts
  - director input contract and output normalization
  - effective settings and final prompt compilation
  - production submission, task/media/merge status aggregation
  - merge capability, request validation, execution state, and media persistence
        |
        v
Candidate MySQL / candidate services / provider adapters
~~~

New or rebuilt Batch Factory rules belong in Go. Node may retain existing V78
legacy read/migration code and may forward an authenticated request to Go, but
it must not add independent validation, inheritance resolution, model-duration
logic, prompt compilation, status derivation, production orchestration, or
credential handling. If a required feature cannot be implemented through Go,
implementation stops for an architecture decision rather than filling the gap
with new Node rules.

Go owns the candidate Batch, book, VIDEO, setting, snapshot, job, and status
records. The existing Node file store is a legacy migration/read source only;
it is not the write authority for any newly rebuilt Batch Factory path.

The Node boundary derives the account identity from the authenticated V78
session and transmits it only through the candidate's internal authenticated
bridge. Go never accepts a browser-supplied username, owner flag, model
capability, or other authority field as a trusted value.

React is a presentation and request client. It cannot treat a submitted model
name, model version, maximum duration, or inherited setting as authoritative;
it renders the Go response and submits only user choices.

## Go Contracts

### Settings And Config Snapshots

Go owns a canonical settings record with these layers:

~~~text
system -> batch -> book -> VIDEO
~~~

Every create/update response returns the effective settings, field ownership,
model snapshot, selected configuration version, invalidation state, and a
server-calculated change-impact summary. Model, production-mode, and
configuration-version changes may invalidate the Director result only. They
must never silently delete Book or VIDEO overrides, regenerate a Director
result, resubmit production, or copy a setting into a different scope.

Existing Book and VIDEO sparse patches remain stored verbatim. If a changed
model capability or configuration makes a patch non-effective, Go returns a
per-field compatibility result while preserving the patch for inspection and
explicit user action. The prior Director result is retained as an auditable
revision but marked `invalidated`; it is not silently reused for production.

A VIDEO identity is an immutable persisted Go VIDEO ID associated with the
Director revision that created it, never an array index or a description hash.
When a re-Director operation changes that identity, its prior VIDEO override is
kept under its original identity and marked `orphaned` or `incompatible`. It is
not applied to a newly created VIDEO. The API and UI must expose that retained
patch and require an explicit audited user choice to reapply, edit, restore, or
discard it.

The stored configuration snapshot freezes:

- model ID, version ID, display name, max duration, and required inputs;
- selected configuration revision and label;
- resolved system-preset version map;
- the settings values used for director and final prompt compilation.

Partial book and VIDEO overrides remain sparse. Restoring inheritance removes
only the requested override scope and does not alter sibling book or VIDEO
records. Disabled constraint switches retain their text but exclude it from the
Go compiler input.

### Prompt Authority: System Presets, My Prompts, And Drafts

Go/MySQL is the only authoritative Batch Factory prompt store. The final
contract uses Go's versioned prompt catalog (`prompt_definitions` and
`prompt_versions`) for both global system presets and owner-scoped personal
prompts: global definitions are system-owned, personal definitions are scoped
by authenticated owner, and every selected body resolves to an immutable
version. The required schema evolution must make ownership and uniqueness
explicit without weakening existing system-preset integrity.

Current drafts are a separate Go/MySQL owner-and-scope store, keyed by the
Batch Factory scope (batch, Book, VIDEO, and constraint field). A draft is not
a shared preset and does not become a personal prompt until the user explicitly
saves it as one. Deleting a personal prompt that is currently selected must
leave the current scoped draft/body recoverable rather than dropping it.

The legacy Node system-preset catalog and any Node file-backed personal/draft
records are migration input or compatibility-read sources only. React uses Go
APIs to list, select, save, and resolve them; it does not assemble prompt
rules. This UI migration must not introduce any new Node Batch Factory prompt
validation, inheritance, selection, or compilation rule.

### Director, Effective Settings, And Final Prompt

Director request construction, JSON parsing/normalization, fixed-single-VIDEO
enforcement, and final prompt compilation move to Go. A shared Go compiler must
be called for both view final prompt and actual production submission; two
separately maintained prompt paths are not permitted.

Viral/Hook mode is an explicit Go Director and compiler contract, not a React
label or a Node string append. Its frozen, versioned instruction requires
short-video-readable emotional amplification where the source material and
safety boundaries permit it: visible conflict or behavior escalation rather
than merely adding an adjective such as "very angry". The selected mode and
the instruction/preset version are recorded in the configuration snapshot and
used by the same compiler for inspection and production.

Fixed single VIDEO means exactly one VIDEO is retained, its duration never
exceeds the frozen model capability, and unrepresented source remains marked as
remaining rather than being silently turned into extra VIDEO records.

### Production And Status

The Go production layer validates the frozen model reference, submits a
per-VIDEO compiler result, persists the resulting task references, and
aggregates director, task, media, merge, and failure states. Go also owns the
complete Merge contract:

- capability: a read-only report of required local execution dependencies,
  including FFmpeg and object storage, with no provider call;
- request: ownership, ordered input-media, duplicate, speed, and batch/Book
  validation before accepting a merge job;
- status: durable queued/running/succeeded/failed/cancelled state and event
  history exposed through the common status API; and
- persistence: immutable merge-input snapshot, output media linkage, error
  details, and retry/audit data associated with the owning Book.

The UI obtains all of those states through the Go-owned contract. Any residual
Node route is an adapter only and must not reinterpret status, run merge logic,
or persist Batch Factory media state.

Real external submission remains disabled in the candidate until the relevant
provider capability has an explicit acceptance decision. This requires all
three controls at once: a Go backend feature gate checked before credential or
transport resolution, no production credentials in candidate configuration or
mounts, and candidate-container network egress blocking except for explicitly
required internal services. A disabled request returns a clear feature-disabled
error before transport invocation. The no-outbound regression suite must prove
each layer, including 121 and Yadi paths. Single-book, whole-batch, and Merge
acceptance flows use a deterministic candidate test adapter to verify Go
persistence, status aggregation, refresh recovery, and restart recovery
without claiming an external-provider result.

## Frontend Design

/batch-factory becomes the V10 workbench in the recovered V78 app shell.
/batch-factory-preview remains available as the V78 fallback during acceptance.

The workbench contains a batch header, book list, current-book workspace,
VIDEO/result area, and batch actions. It exposes:

- novel-fetch intake without automatic director execution;
- original and viral/Hook workflows;
- model and configuration snapshot summaries;
- production and publish settings entry points;
- per-batch, per-book, and per-VIDEO inheritance indicators and restore
  controls;
- editable asset/storyboard and regeneration flows backed by Go contracts;
- current-book and whole-batch production controls;
- final prompt inspection from the same compiler used by production;
- durable task status, refresh recovery, and restart recovery.

The production-settings Drawer has a fixed top-to-bottom order: (1)
configuration version, (2) basic production settings, then (3) the separate
constraint-settings section. Configuration version is never hidden in an
advanced subsection. It shows the selected frozen revision/label/preset
versions, historical selection, and a separately confirmed "sync latest"
action; a newly published backend version never changes a batch automatically.
Syncing a batch version must not clear Book or VIDEO overrides.

Production settings use a right-side wide Drawer, normally 720--860px on a
desktop viewport. It stays inside the workbench instead of navigating away.
Publish settings use a separate Drawer. Prefix, quality, restrictions, and
negative-prompt toggles expand their own fields immediately; switching a field
off preserves text and makes it inactive, without an additional edit button.
The historical Modal-only and disabled-single-book designs are not valid
sources for this UI.

Each Book has a compact settings/constraint card rather than a second full
settings page. It shows its override badge and field count, lets the user
choose "follow batch configuration version" or an explicit Book version
override, exposes the same constraint editor as the batch scope, and provides
an explicit restore-inheritance action. Its saved patch remains sparse; a
batch save does not erase it by default.

Before committing a model, production-mode, or configuration-version change,
the UI requests Go's change-impact result and displays dynamic affected counts
(for example, existing Director results and incompatible preserved overrides).
When existing Director output would be invalidated, saving requires explicit
confirmation, never automatically re-Directs or regenerates Books. Counts are
calculated from current data, not hard-coded.

121/Yadi controls have a disabled state such as "尚未启用 / 待后续发布" and an
explanation that no external action will be performed. They do not show fake
success, queued, or credential-ready states. Client interaction is disabled,
and any defensive server request returns an explicit feature-disabled error
before a transport can be invoked. They remain separate from Go Production,
Status, and Merge and cannot become implicitly enabled because another Batch
Factory control is available.

## Provenance Rules

Each imported file is recorded with source branch/ref, source commit, source
blob SHA, purpose, and changes required to fit the V78 shell. Likely source
lines are:

| Capability | Reference line | Use |
| --- | --- | --- |
| Go settings/config/director contracts | origin/10-batch-factory-go-api-migration | selective Go source and tests |
| Go Merge capability/request/status/persistence | origin/10-batch-factory-go-api-migration `backend/internal/httpapi/shuihuo_batch_factory_merge_handlers.go` | behavior and validation reference; rebuilt under the Go-owned status contract |
| Final Drawer/inline constraints/workspace layout | origin/10-batch-factory-inline-constraints-version-config | selective React interaction source |
| Final product/UI contracts, including Viral emotion and Drawer order | origin/docs/batch-factory-complete-spec-20260830 | product-definition reference, not a merge base |
| Existing V78 page/API assets | recovery/production-v78.3.0.3-source@483faed | release baseline |
| Batch production frame/state evidence | feature/batch-factory-functional and feature/batch-factory-frame-closure-20260827 | behavioral reference only |

No file is copied solely because its name matches. Its dependencies, route
ownership, source blob, and behaviour must be reviewed before import. The
implementation manifest and the total Batch Factory map are updated after each
completed slice.

## Data And Migration Safety

Candidate services use a unique Compose project, fresh named volumes, a new
candidate-only environment file, and port 3100 or another reported free port.
They do not mount production data paths, production environment files, or
production credential files.

### Candidate No-Outbound Contract

Candidate no-outbound safety is a three-layer requirement, not a UI convention:

1. The Go backend feature gate is false and is checked before a provider,
   credential reference, DNS lookup, or transport can be resolved.
2. Candidate secrets/mounts contain no production provider, 121, or Yadi
   credentials; Node and Go cannot fall back to a production environment file.
3. Candidate application containers have network egress blocked, with only
   explicitly required candidate-internal services allowed.

All three controls must be verified independently. A missing gate, credential,
or egress policy fails the candidate rather than becoming an informal warning.
Disabled requests return a deterministic feature-disabled response and leave no
provider, 121, or Yadi network trace.

### Production Evidence And Clone Chain

Every compatibility rehearsal follows this immutable fan-out, using a newly
created source each time:

~~~text
production :ro -> RAW immutable clone -> writable migration clone
                                      -> sanitized acceptance clone
~~~

The production source is read only. The RAW clone is the sole, immutable,
credential-bearing evidence copy: it receives a recorded manifest/hash and is
never scrubbed, migrated, mounted by candidate services, or modified. The
writable migration clone is derived from it for dry-run/apply exercises. The
sanitized acceptance clone is a separate derivative used only after the RAW
clone remains preserved; sanitizing it must never alter or replace the RAW
evidence copy. The RAW clone and its manifest are the mandatory source backup;
before each apply, the candidate target also receives a recorded rollback
backup/snapshot. No old migration drill volume can be reused.

### One-Time Node To Go/MySQL Batch Migration Contract

The migration is a one-time, Go-owned import from the legacy Node Batch Factory
store to Go/MySQL. Its scope includes the complete Batch aggregate: Batch,
Book, VIDEO, Director output/revisions, sparse settings/config snapshots,
production jobs/tasks/status events, media, and Merge state/output references.
It may not silently omit a child record or manufacture a missing parent.

ID preservation is mandatory. Each target record exposes the exact immutable
legacy Batch, Book, VIDEO, Director, production, and media identity as its
canonical public identity, and every parent/child reference is preserved
against that identity. An internal surrogate is permissible only when the
immutable legacy ID has a unique constraint and remains the API identity;
renumbering, generated replacement IDs, and lossy many-to-one mapping are not
allowed. A schema that cannot meet this condition blocks migration rather than
relaxing the contract.

For every run, Go creates an audit run record containing the RAW-clone ID and
manifest hash, migration/tool revision, target schema/checksum manifest,
start/end time, operator-independent outcome, and counts. Per-record audit
entries record entity type, preserved source ID, target ID where applicable,
owner/aggregate reference, source-content digest, outcome, and a bounded
reason code. Audit data contains identifiers and hashes rather than copied
secrets or unredacted credential material.

The required sequence is:

1. Inventory the RAW clone and write source counts and hashes per entity type,
   owner, and Batch aggregate.
2. Run a read-only dry-run against a writable derivative. It parses, validates
   identities and references, resolves the intended Go mappings, and produces
   the full audit/quarantine/reconciliation report without writing active Go
   Batch Factory data or changing the RAW clone.
3. After the dry-run report is accepted, apply to a fresh writable migration
   clone. Each aggregate writes atomically where its references permit it;
   an invalid record is quarantined with source pointer, digest, and reason
   instead of being dropped or blocking unrelated valid aggregates.
4. Reconcile every entity type and each Batch: source total equals newly
   migrated plus already-confirmed idempotent records plus quarantined records;
   active Go counts and parent/child references must match the non-quarantined
   source set exactly. Any unexplained difference, duplicate, or dangling
   reference stops acceptance.

Idempotency is enforced by a unique RAW-source-manifest lineage/migration-
version/entity-type/source-ID key together with the source-content digest. All
derivatives retain that RAW lineage, so repeating the same input is a verified
no-op with audit evidence instead of a second import. A changed digest for an
already migrated source ID is a hard failure requiring review, never an
implicit upsert. Quarantine is queryable and recoverable only through an
explicit, audited repair path; it is not a successful migration result.

There is no dual-write period. Before the final import/cutover rehearsal, Node
Batch Factory mutation endpoints and workers are made read-only/paused for the
candidate dataset. During and after the import Go/MySQL is the sole Batch
Factory writer; Node may only read the legacy source or forward to Go. A
candidate cannot pass while Node and Go can both mutate the same Batch
aggregate. The legacy source is retained as evidence and is never deleted by
the migration.

### Schema Migration Integrity And MySQL 8.4 Gate

The existing fresh-MySQL rehearsal failure is a hard prerequisite:

~~~text
MySQL 8.4 migration 27:
BLOB, TEXT, GEOMETRY or JSON column admin_note can't have a default value
~~~

Before repairing migration 27, the migration-ledger checksum policy must be
defined and tested. The current historical ledger records only version and
applied time, so it cannot prove that a recorded migration's content matches the
reviewed definition. The revised ledger must record an immutable expected
checksum for every migration; static SQL uses canonical SQL content, and a Go
callback migration has an explicit reviewed checksum/version input. Startup
compares the expected and recorded checksum before applying later migrations
and fails closed on a mismatch. A pre-checksum historical row can only receive
a one-time, audited verified backfill; the system must never silently overwrite
an existing checksum.

Only after that policy is in place may migration 27 be repaired for MySQL 8.4.
The repair must be validated against real MySQL 8.4 in all of these cases:

- an empty database to latest;
- a schema-1 ledger/database to latest;
- a schema-26 fixture to latest; and
- repeated startup after each successful path.

Each case verifies schema objects, recorded checksums, no duplicate migration
application, and the correct failure behavior for a checksum mismatch. It may
not be bypassed by connecting to the production backend or a previously
migrated test volume. Only after clean synthetic tests pass may the clone chain
above be used for the one-time Batch migration rehearsal.

## Verification And Release Gates

Every task uses test-first implementation and ends in a focused commit. The
candidate cannot progress past a failing Go boundary, migration, or no-outbound
check.

Required final evidence includes:

- clean npm ci, npm --prefix frontend ci, and frontend production build;
- relevant Go unit, HTTP-boundary, store, migration, director, compiler,
  production, status, and Merge tests;
- Node compatibility tests that prove forwarding only, not duplicated rules;
- V78 non-Batch bundle-parity check with an explicit Batch Factory allowlist;
- fresh MySQL 8.4 migration checks from empty, schema 1, and schema 26 to
  latest, followed by repeat-start and checksum-mismatch checks;
- synthetic and cloned-volume one-time-migration dry-runs with immutable RAW
  evidence manifests, backup/audit records, ID/reference preservation, and
  count reconciliation with zero unexplained difference;
- fresh MySQL/Redis/volume Compose startup and migration audit with zero
  unexpected preset quarantine;
- isolated candidate health checks and immutable image tag/digest;
- no-outbound tests proving backend gate, absent credentials, and blocked
  egress for disabled provider, 121, and Yadi entry points;
- manual acceptance of login, novel-fetch intake, V10 workbench, both Drawers,
  approved configuration-version Drawer order, Book version override and
  constraint card, dynamic mode/model change warning, all inheritance scopes,
  inline constraints, system/my prompt/draft selection, original and
  strong-emotion Viral/Hook workflows, director, fixed single VIDEO, final
  prompt, single/batch production, Merge capability/request/status, refresh
  recovery, and restart recovery.

After acceptance, the result report records the branch, final SHA, imported
file provenance, test output, clean-build result, candidate URL, image tag and
digest, fresh temporary-volume hashes/audits, remaining Node-owned code, known
limitations, and a production rollback command. The current implementation
stops there. Replacing port 3000 needs a new, explicit user approval after
reviewing that evidence.

## Explicit Non-Release Rule

No command in this design changes the current production deployment. A
successful candidate, Docker build, or isolated acceptance run is not
authorization to update http://10.0.101.122:3000/.
