# V78 Batch Factory Go-First Integration Design

## Status

Conversation-approved on 2026-08-31. This document records the approved
design for review before implementation. It replaces the old
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

This candidate rebuilds the following Batch Factory slices in this order:

1. Go Settings, Settings Store, model snapshot validation, sparse overrides,
   and Config Snapshot ownership.
2. Go Director contract and normalization, effective-settings resolution, and
   final VIDEO Prompt compiler.
3. Go production submission and status aggregation, with Node limited to
   compatibility forwarding where the V78 app still needs a same-origin API.
4. The V10 Batch Factory workbench, final production and publish Drawers, and
   inline constraint editing in the recovered V78 React shell.
5. Isolated Compose, a fresh temporary-volume drill, automated regression
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
  - director input contract and output normalization
  - effective settings and final prompt compilation
  - production submission, task/media status aggregation
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
model snapshot, selected configuration version, and invalidation state. A model
change that changes maximum duration or input capability invalidates
incompatible director results and VIDEO overrides rather than silently reusing
them.

The stored configuration snapshot freezes:

- model ID, version ID, display name, max duration, and required inputs;
- selected configuration revision and label;
- resolved system-preset version map;
- the settings values used for director and final prompt compilation.

Partial book and VIDEO overrides remain sparse. Restoring inheritance removes
only the requested override scope and does not alter sibling book or VIDEO
records. Disabled constraint switches retain their text but exclude it from the
Go compiler input.

### Director, Effective Settings, And Final Prompt

Director request construction, JSON parsing/normalization, fixed-single-VIDEO
enforcement, and final prompt compilation move to Go. A shared Go compiler must
be called for both view final prompt and actual production submission; two
separately maintained prompt paths are not permitted.

Fixed single VIDEO means exactly one VIDEO is retained, its duration never
exceeds the frozen model capability, and unrepresented source remains marked as
remaining rather than being silently turned into extra VIDEO records.

### Production And Status

The Go production layer validates the frozen model reference, submits a
per-VIDEO compiler result, persists the resulting task references, and
aggregates director, task, media, merge, and failure states. The UI obtains
those states through the Go-owned contract. Any residual Node route is an
adapter only and must not reinterpret the state.

Real external submission remains disabled in candidate Compose configuration
until the relevant provider capability has an explicit acceptance decision. The
no-outbound regression suite must exercise every disabled path. Single-book
and whole-batch acceptance flows use a deterministic candidate test adapter to
verify Go persistence, status aggregation, refresh recovery, and restart
recovery without claiming an external-provider result.

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

Production settings use a right-side wide Drawer, normally 720--860px on a
desktop viewport. It stays inside the workbench instead of navigating away.
Publish settings use a separate Drawer. Prefix, quality, restrictions, and
negative-prompt toggles expand their own fields immediately; switching a field
off preserves text and makes it inactive, without an additional edit button.
The historical Modal-only and disabled-single-book designs are not valid
sources for this UI.

121/Yadi controls have a disabled state such as "尚未启用 / 待后续发布" and an
explanation that no external action will be performed. They do not show fake
success, queued, or credential-ready states. Client interaction is disabled,
and any defensive server request returns an explicit feature-disabled error
before a transport can be invoked.

## Provenance Rules

Each imported file is recorded with source branch/ref, source commit, source
blob SHA, purpose, and changes required to fit the V78 shell. Likely source
lines are:

| Capability | Reference line | Use |
| --- | --- | --- |
| Go settings/config/director contracts | origin/10-batch-factory-go-api-migration | selective Go source and tests |
| Final Drawer/inline constraints/workspace layout | origin/10-batch-factory-inline-constraints-version-config | selective React interaction source |
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

The existing fresh-MySQL rehearsal failure is a hard prerequisite:

~~~text
MySQL 8.4 migration 27:
BLOB, TEXT, GEOMETRY or JSON column admin_note can't have a default value
~~~

The migration must be made MySQL-8.4 compatible and tested on a fresh candidate
database before any candidate is connected to a copied volume. It must not be
bypassed by connecting to the production backend or a previously migrated test
volume.

Only after clean synthetic-volume tests pass may a brand-new, read-only copy of
the production volume be created for compatibility rehearsal. The source volume
is hashed before and after copying, never mounted by the candidate, and never
reused from an old migration drill. The copy is scrubbed of credentials, tokens,
API keys, personal data, and external identifiers before mounting. Batch and
preset migrations must be atomic, backed up, audited, idempotent, and
quarantine invalid records without blocking valid records.

## Verification And Release Gates

Every task uses test-first implementation and ends in a focused commit. The
candidate cannot progress past a failing Go boundary, migration, or no-outbound
check.

Required final evidence includes:

- clean npm ci, npm --prefix frontend ci, and frontend production build;
- relevant Go unit, HTTP-boundary, store, migration, director, compiler,
  production, and status tests;
- Node compatibility tests that prove forwarding only, not duplicated rules;
- V78 non-Batch bundle-parity check with an explicit Batch Factory allowlist;
- fresh MySQL/Redis/volume Compose startup and migration audit with zero
  unexpected preset quarantine;
- isolated candidate health checks and immutable image tag/digest;
- no-outbound tests for disabled provider, 121, and Yadi entry points;
- manual acceptance of login, novel-fetch intake, V10 workbench, both Drawers,
  config version synchronization, all inheritance scopes, inline constraints,
  system/my prompt/draft selection, original and Hook workflows, director,
  fixed single VIDEO, final prompt, single/batch production, refresh recovery,
  and restart recovery.

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
