# Batch Factory Go API Migration Design

**Date:** 2026-08-29

## Goal

Restore the project to the intended architecture without interrupting the working Batch Factory flow:

- API / service backend: **Golang**
- Admin UI: **React + Ant Design**
- User UI: **React + Ant Design**
- Node / Express is treated only as a temporary compatibility layer during migration and must not receive new Batch Factory business logic.

The migration is incremental. One functional slice moves to Go, is verified, then its Node implementation becomes a thin compatibility proxy or is removed. The application must remain usable after each slice.

## Current State

The user-facing Batch Factory is implemented in React (`BatchFactoryPageV10.jsx` and related components). Model catalog, task execution, provider configuration, credential references and Shuihuo production already exist in the Go service.

However, several Batch Factory business responsibilities currently live in Node / Express, including:

- batch settings persistence and validation
- config-version snapshot handling
- book / VIDEO inheritance overrides
- director and prompt orchestration
- final VIDEO prompt compilation
- batch production submission and bound-model checks

This creates a split backend authority. The migration removes that split gradually.

The new branch starts from `09-batch-factory-video-model-selector` so the already-added unified video-model selector is preserved while backend ownership is moved to Go.

## Target Architecture

```text
User React + Ant Design
        |
        | /api/...
        v
Golang API
  - Batch Factory batches/settings
  - config snapshots
  - book/video overrides
  - director orchestration
  - prompt compiler
  - production submission
  - model catalog + credentials
  - task/status/merge/publish
        |
        v
DB / storage / model providers

Temporary during migration only:
Node / Express
  - compatibility proxy for endpoints not yet migrated
  - no new Batch Factory business rules
```

Go becomes the only long-term authority for business validation and persistence. React never duplicates backend rules and never stores provider secrets. Node must not become a second source of truth.

## Migration Principles

1. **No big-bang rewrite.** Move one vertical slice at a time.
2. **Keep the existing UI stable.** React + Ant Design remains the user/admin presentation layer.
3. **Preserve endpoint behavior while migrating.** Response shapes should remain compatible where practical so React changes stay small.
4. **Go owns validation.** Model availability, duration limits, inheritance normalization, config revisions and production guards are validated server-side.
5. **No key duplication.** API keys / credentials remain managed by the existing Go model/credential system. Batch Factory stores model references, never secrets.
6. **One source of truth per migrated slice.** Once a slice moves to Go, Node may proxy but may not independently normalize or mutate that data.
7. **Test before cutover.** Every slice gets Go tests first, then React/API cutover, then regression verification.
8. **Rollback stays cheap.** Until a slice is verified, its previous Node endpoint remains available behind the compatibility path.

## Data Ownership

### Go-owned immediately or already

- model definitions and versions
- public model catalog
- credential references / provider configuration
- generation tasks and task status
- generated media / production project state

### Migrate to Go in stages

- Batch Factory batch records
- unified production settings
- frozen config version metadata
- book-level sparse overrides
- VIDEO-level sparse overrides
- director results and prompt version metadata
- final compiled VIDEO prompt payload
- Batch Factory production submission metadata
- publish settings

During a transition slice, existing file-backed Node data may be read by a one-time compatibility adapter or migrated to the Go persistence model. New writes for that slice must go to Go after cutover.

## Phase 1 — Settings + Video Model Selection

This is the first implementation slice.

Move these responsibilities to Go:

- read / save unified production settings
- validate selected video model against the Go public model catalog
- canonicalize and persist:
  - `videoModelId`
  - `videoModelVersionId`
  - `videoModelName`
  - `maxVideoDuration`
- persist:
  - aspect ratio
  - fixed single VIDEO
  - prefix settings
  - prompt preset IDs
  - character / scene / prop injection switches
  - quality / restriction / negative settings
  - subtitle policy
  - frozen config-version metadata
- book-level sparse overrides
- VIDEO-level sparse overrides
- restore-inheritance semantics by deleting override keys, not copying parent values

The React selector continues to list models from the existing Go model endpoint. Saving unified settings must call a Go-owned Batch Factory endpoint.

### Important model-switch behavior

Changing a video model updates the batch model snapshot and maximum duration from the server-side model definition. The browser cannot submit arbitrary version/name/duration values as authoritative data.

If director output already exists and the new model changes duration capability, the API must mark existing director output as needing regeneration before production rather than silently producing with mismatched assumptions.

## Phase 2 — Config Snapshots + Prompt Selection

Move to Go:

- list available Batch Factory config snapshots
- latest snapshot resolution
- historical frozen preset versions
- script prompt selection
- asset prompt selection
- prefix preset resolution

Existing batch snapshots must remain reproducible after newer admin prompt versions are published.

## Phase 3 — Director Orchestration

Move to Go:

- hook generation orchestration for viral mode
- director request construction
- director response parsing / normalization
- fixed-single-VIDEO rules
- model maximum-duration rules
- source coverage metadata
- prompt version tracking

The existing text-model configuration remains server-side. React only starts a director job and reads status/results.

## Phase 4 — Effective Settings + Prompt Compiler

Move to Go:

- effective settings resolution:
  `system < batch < book < video`
- preservation of explicit `false` and empty-string overrides
- final VIDEO prompt compilation
- character / scene / prop prompt injection
- prefix / quality / restriction / negative / subtitle constraints
- duration and aspect-ratio markers

The “查看最终上传 Prompt” endpoint and the actual production submission must use the same Go compiler function so preview and execution cannot diverge.

`visualPrompt` / `video_desc` remains story/visual content only. Constraints are compiled dynamically and are not baked into the director description.

## Phase 5 — Production Submission

Move to Go:

- generate one book
- generate whole batch in deterministic book order
- bound-model validation
- per-VIDEO duration/aspect settings
- production submission result persistence
- submission errors

The model executor and credentials already live in Go, so this phase removes the Node bridge between Batch Factory and Shuihuo production.

## Phase 6 — Status, Merge and Publish

Move remaining Batch Factory orchestration to Go:

- production status aggregation
- merge capability
- VIDEO merge submission
- publish settings
- final publishing integration when the real publishing endpoint is available

After this phase, React should have no Batch Factory dependency on Node business routes.

## Node Compatibility Layer

While migration is incomplete:

- old Node routes may remain for unmigrated slices
- a migrated Node route may temporarily proxy to Go when old clients still call it
- proxy routes must not re-normalize or persist business data
- no new feature may be implemented only in Node

After all consumers use the Go route and regression tests are green, delete the corresponding Node implementation.

## API Shape

Prefer a Go namespace such as:

```text
GET    /api/batch-factory/batches
POST   /api/batch-factory/batches
GET    /api/batch-factory/batches/{batchId}
PUT    /api/batch-factory/batches/{batchId}/settings
PUT    /api/batch-factory/batches/{batchId}/publish-settings
PUT    /api/batch-factory/batches/{batchId}/items/{itemId}/overrides
PUT    /api/batch-factory/batches/{batchId}/items/{itemId}/videos/{videoId}/overrides
GET    /api/batch-factory/config-versions
POST   /api/batch-factory/batches/{batchId}/director
POST   /api/batch-factory/batches/{batchId}/items/{itemId}/director
GET    /api/batch-factory/batches/{batchId}/items/{itemId}/videos/{videoId}/compiled-prompt
POST   /api/batch-factory/batches/{batchId}/generate
POST   /api/batch-factory/batches/{batchId}/items/{itemId}/generate
```

Exact naming may follow existing Go router conventions, but the ownership boundary must remain the same.

## Authentication and Authorization

Batch Factory Go endpoints use the same authenticated user identity and role model as existing Shuihuo Go endpoints.

The API must enforce:

- user ownership / tenant isolation for batch records
- model role restrictions
- hidden / disabled model rules
- owner-only admin configuration where applicable

React-provided role or owner flags are never authoritative.

## Error Handling

Use consistent HTTP behavior:

- `400` invalid user input
- `403` role/permission restriction
- `404` batch/item/VIDEO not found
- `409` state conflict, unavailable model, stale director result, or regeneration required
- `422` invalid server-side prompt/config definition when appropriate
- `502/503/504` upstream/provider/service availability failures

Errors shown in React should preserve the distinction between invalid settings, state conflicts and provider outages.

## Verification Strategy

Each migration phase must include:

1. Go unit tests for normalization and inheritance rules.
2. Go HTTP handler tests for authentication, validation and response shape.
3. Regression tests proving explicit `false` / empty override behavior.
4. Model-switch tests proving the server canonicalizes model version/name/max duration.
5. Tests proving model changes invalidate incompatible director output.
6. Prompt compiler parity tests before Node compiler removal.
7. React production build.
8. Existing Batch Factory regression suite until the equivalent coverage is moved to Go.
9. A compare/diff review confirming only the intended slice changed.

No paid provider call or real API key is required for automated verification.

## Rollout and Rollback

For each phase:

1. Add Go implementation and tests while Node path remains active.
2. Cut React or compatibility proxy to the Go endpoint.
3. Verify tests/build and normal Batch Factory behavior.
4. Keep the old implementation for one migration checkpoint if rollback is useful.
5. Delete obsolete Node business logic only after the Go path is proven.

A failed phase is rolled back by restoring the previous endpoint routing; already-stable earlier Go phases stay in place.

## Non-Goals

- Do not rewrite React pages into Vue or another frontend framework.
- Do not move credentials into React, Node, browser storage or Batch Factory records.
- Do not rewrite unrelated Node features as part of this migration.
- Do not redesign the Batch Factory UI unless a migration requires a small compatibility change.
- Do not delete all Node code at once.

## Completion Criteria

The migration is complete when:

- Batch Factory user/admin UIs are React + Ant Design.
- All Batch Factory business APIs and persistence are owned by Go.
- Model/credential/task execution remains Go-owned.
- React calls Go APIs directly or through infrastructure-only routing.
- `routes/batch-factory*.js` no longer contains Batch Factory business logic and can be deleted or reduced to non-business compatibility routing.
- automated tests and frontend build are green after the final cutover.
