# Model Center Compatibility Design

**Date:** 2026-08-18

## Goal

Add a configuration-driven Model Center to the existing Shuihuo Go backend without breaking deployed Shuihuo text, image, video, or audio workflows. The Model Center will make a stable `modelId` the business routing key, provide an administrator catalog and editor, safely resolve platform credentials on the server, validate user parameters from `uiSchema`, and support both synchronous and polling-based providers.

This is a compatibility upgrade, not a rewrite. Existing model definitions, versions, adapters, persisted numeric references, and enabled production paths remain readable until each model has been migrated and verified.

## Confirmed Decisions

1. The first catalog supports all four kinds: `text`, `image`, `video`, and `audio`.
2. Platform credentials are server-owned. Administrators select an already registered credential reference; neither browser nor database stores or returns an API key.
3. The existing Go model catalog is the single configuration and execution authority. React and Express consume its public contract only.
4. Migration uses a compatibility layer with dual reads. New requests resolve by `modelId`; un-migrated legacy references retain the existing adapter path.
5. `modelId` is globally unique and immutable after creation. An administrator may change display name, parameters, ordering, visibility, and provider configuration without invalidating historical task references.
6. The administrator catalog follows the supplied high-density dark-table reference: type tabs, state filters, search by name or `modelId`, bulk export/import, and row actions. Long IDs remain readable and copyable rather than being squeezed into one-character lines.

## Current Boundary

The current backend has `model_definitions`, versioned `model_versions`, four model kinds, and the `text_completion`, `jimeng_image`, `vidu_image_to_video`, and `generic_http` adapter concepts. It lacks a public stable `modelId`, hidden/sort behavior, a complete dynamic schema contract, a generic template/polling contract, and a working admin catalog read path.

The current Node/Express application remains the multi-page entry point and gateway. It must not become a second model catalog, template renderer, credential resolver, or task executor.

## Architecture

```text
Administrator React UI
  -> Go admin Model Center API
     -> model_definitions + immutable model_versions
     -> credential reference registry (environment backed)

User React workflow
  -> public Go model list (enabled and not hidden)
  -> business generation endpoint with explicit modelId + inputs
     -> Go validation and execution gateway
        -> configuration version + credential resolver + template engine
        -> synchronous provider response or asynchronous task poller
```

Every business request supplies a `modelId`. The Go gateway resolves the current enabled definition and version, checks role access, normalizes only declared inputs, renders a provider request, and records the model definition and version used by the task. React never chooses a fallback model on behalf of the user.

For a hidden but enabled model, the public list omits the row and direct browser submission by `modelId` is rejected. Only an existing persisted project configuration resolved server-side may continue to use it. A disabled model rejects all new submissions. This lets an administrator remove a model from the selector without allowing users to guess and invoke it.

## Data Contract And Migration

### Definitions

`model_definitions` remains the stable logical model record and gains:

| Field | Rule |
| --- | --- |
| `model_key` | Unique immutable `modelId`, for example `shot-video-v1`. |
| `hidden` | Default `false`; hides the row from the public selector while allowing existing references. |
| `sort_order` | Integer used for explicit front-end and admin display order. |
| `admin_note` | Administrator-only operational note. |
| `parameter_schema_json` | The `uiSchema` source of truth. |

The existing numeric primary key remains unchanged for foreign keys and legacy selections. A migration assigns every existing definition a deterministic unique `model_key` derived from its kind and numeric ID, for example `legacy-image-12`. New definitions require an administrator-supplied, validated lowercase kebab-case `modelId`. The field cannot be edited after creation.

### Versions

`model_versions` remains immutable configuration history and gains:

| Field | Rule |
| --- | --- |
| `base_domain` | HTTPS scheme and authority only. |
| `base_path` | Provider path combined with `base_domain` by the executor. |
| `credential_ref` | Registered reference ID, not an API key or browser-provided environment variable name. |
| `request_template` | JSON template for request method, headers, and body. |
| `response_mapping` | Declarative result extraction mapping. |
| `polling_template` | Null for synchronous providers; declarative polling contract for asynchronous providers. |
| `image_input_format` | `url`, `base64`, or `multipart`, when the kind consumes images. |
| `image_request_mode` | `json` or `multipart`, when the kind consumes images. |
| `runtime_policy_json` | Bounded concurrency, retry, interval, and timeout configuration. |

Editing creates a newer version rather than mutating a version used by a historical task. A task stores definition ID, version ID, immutable `modelId`, minimal normalized inputs, and a short user note. It does not persist a second rendered payload or a raw upstream response body.

### Credential Registry

The backend loads a startup configuration mapping reference IDs to environment variable names. Example: `openai-platform` maps to `OPENAI_API_KEY`. The admin API returns only `{ id, label, configured }`; `configured` says whether the resolved environment value is present and nonempty. The editor uses this list as a select control and rejects unknown IDs.

The executor may substitute a short-lived `credential` token into an in-memory request header or body only when the provider template declares it. It redacts the value from errors, logs, task metadata, imports, exports, and HTTP responses. No API key is stored in MySQL.

### Compatibility Reads

1. New model-center clients use `modelId`.
2. Existing Shuihuo selections that store numeric model IDs continue to resolve through the existing definition ID and its latest enabled version.
3. The resolver maps a migrated numeric definition to the same record's `modelId`; it does not duplicate provider configuration.
4. Un-migrated legacy adapter calls remain available behind the compatibility branch until the administrator replaces them with a configured Model Center row.
5. A model with historical task or snapshot references cannot be hard-deleted. The catalog action archives it by setting `enabled=false` and `hidden=true`; hard deletion is available only for never-referenced drafts.

## APIs

### Administrator APIs

Owner-only endpoints provide complete catalog management:

- `GET /api/shuihuo-production/admin/models`: filter by kind, enabled state, hidden state, search, and pagination; returns administrator fields but never credential values.
- `POST /api/shuihuo-production/admin/models`: creates a definition and version after schema/template validation.
- `GET /api/shuihuo-production/admin/models/{modelId}` and `PUT /api/shuihuo-production/admin/models/{modelId}`: load and create a revised version without changing `modelId`.
- `POST /api/shuihuo-production/admin/models/{modelId}/duplicate`: copies configuration into a required new `modelId` with `enabled=false`.
- `POST /api/shuihuo-production/admin/models/import` and `GET /api/shuihuo-production/admin/models/export`: use a versioned, credential-free JSON format. Import validates every row transactionally before creating any row.
- `GET /api/shuihuo-production/admin/model-credential-refs`: returns the selectable environment-backed reference metadata.

### Public And Business APIs

- `GET /api/shuihuo-production/models`: returns only models that are enabled, not hidden, and allowed for the authenticated role. It includes `modelId`, name, kind, display order, and public `uiSchema`; it removes admin notes, endpoints, templates, response mappings, polling configuration, and credential references.
- Existing business generation endpoints accept an explicit enabled, non-hidden `modelId` and typed inputs. During the compatibility period they also resolve an existing persisted numeric or hidden model selection internally, but never accept an arbitrary client-supplied provider endpoint or template.

## Administrator UI

The catalog is a dense desktop table modeled on the accepted reference. It has type tabs for all four kinds, enabled/disabled filters, search by name or `modelId`, clearly contrasted enabled and hidden states, explicit sort order, selection checkboxes, copy, archive/delete, import, export, and create actions. It uses responsive horizontal scrolling on narrow viewports instead of compressing identifiers into unreadable columns.

The create/edit drawer is divided into four sections:

1. Identity and visibility: name, type, immutable `modelId`, sort order, enabled, hidden, allowed roles, and admin note.
2. Provider connection: registered credential reference, adapter, base domain/path, and image protocol settings.
3. Request protocol: request template, result mapping, optional polling template, plus an administrator-only configuration validation action.
4. Runtime policy: bounded concurrency, timeout, retry count, retry interval, and polling interval.

The drawer also renders a read-only preview of the public dynamic form generated from `uiSchema`. It makes clear which parameters users can actually submit.

## uiSchema And Template Engine

`uiSchema` has three identical consumers:

1. React renders dynamic controls from labels, types, options, ranges, and defaults.
2. Go fills defaults and normalizes values to the declared type.
3. Go rejects undeclared user fields before any upstream request.

The implementation supports explicit string, number, boolean, enum, and bounded list fields. Business-required fields such as `prompt` and `image` are registered per model kind and remain visible in the same whitelist. Empty request templates (`{}`) send the normalized inputs as the JSON body.

The template evaluator supports typed whole-value placeholders, nested object paths, array indexes, `$map`, `$concat`, and `$if`. It refuses unknown variables, dangerous path traversal, non-JSON output, or templates that expose credentials in persisted diagnostics. URL construction validates HTTPS `baseDomain` and normalizes `basePath`; arbitrary browser URLs are never allowed.

## Execution And Recovery

Before the executor calls an upstream provider, it atomically records an upstream-attempt marker. If that write fails, it does not make the HTTP request. This gives restart recovery a trustworthy answer to whether the provider may already have been called.

Synchronous calls map the provider response to artifacts and finalize the task in one compare-and-set transition. For asynchronous calls, `pollingTemplate` extracts a provider task ID, marks the task `processing`, and a worker polls under a lease. A poll network error or temporary provider unavailability retains `processing` and retries with bounded backoff. Only an explicit provider terminal failure, a validated terminal error response, or an exhausted deadline produces a failed task.

Artifacts are copied to application-owned object storage or media storage; raw upstream bodies, especially inline base64, are not stored in task rows. A periodic recovery worker finds stale processing tasks, acquires a lease with compare-and-set, reconstructs execution from model definition, version, and minimal inputs, then resumes polling or safely finalizes. It never reconstructs a request from a separately persisted rendered payload.

## Error Contract

| Situation | Result |
| --- | --- |
| Missing, malformed, disabled, or unauthorized model | `409` with a model availability error. |
| Input violates `uiSchema` or a request template is invalid | `400` for user input; `422` for administrator configuration validation. |
| Provider result violates its declared response mapping | `422` and no partial artifact write. |
| Provider authentication, network, or remote 5xx failure | `502` with a redacted user-safe summary. |
| Provider timeout | `504`; task retry policy decides whether it can retry. |
| Duplicate worker finalization or busy lease | no duplicate side effect; loser observes the persisted task state. |

The frontend preserves the distinction between invalid model output/configuration and transient upstream failures. It must not present a `502` or `504` as a user parameter error.

## Delivery Phases

1. Add the compatibility schema, deterministic legacy `modelId` migration, credential-reference registry, public/admin catalog reads, and all four kind tabs/forms. Do not call real providers in automated verification.
2. Add `uiSchema` normalization and the generic template validator/executor for one synchronous configured model, then use the same contract for text, image, and audio rows.
3. Add image material conversion and the polling executor for video or any row with a polling template.
4. Add durable upstream-attempt markers, leases, stale-task recovery, import/export, and explicit archive semantics.
5. Migrate existing Shuihuo model selections one row at a time. Remove a legacy branch only after the matching Model Center row is configured, enabled, and verified with a controlled provider smoke test.

All four model kinds appear in the first-phase catalog and use the same validation contract. Provider-specific invocation is enabled only after its individual configuration and test coverage are complete.

## Verification

1. Go migration tests prove idempotent upgrades, unique immutable legacy/new `modelId` values, hidden/sort defaults, and preservation of numeric foreign keys.
2. Catalog/store tests cover role filtering, public redaction, archive behavior, version creation, credential-reference allowlist validation, import all-or-nothing behavior, and duplicate behavior.
3. Template and schema tests cover typed replacement, nested paths, arrays, `$map`, `$concat`, `$if`, empty templates, defaults, reject-unknown input, credential redaction, and malformed values.
4. Fake HTTP provider tests cover sync success, provider errors, response-mapping violations, async task extraction, polling success/failure, transient poll errors, timeout, lease contention, and stale task recovery.
5. React tests cover all four tabs, filters, search, long-ID display/copy, bulk actions, the credential select, immutable `modelId`, visibility controls, and dynamic form preview.
6. Run targeted Go tests, relevant Node contracts, the React build, `git diff --check`, admin/public HTTP contract checks, and a browser check of both themes. Do not use a real API key or call a paid provider as part of automated tests.

## Non-Goals

- This design does not move API keys into MySQL, browser storage, request logs, imports, or exports.
- This design does not replace Express multi-page routing or introduce a single-page frontend architecture.
- This design does not automatically choose models for users or silently reroute a request to a different provider.
- This design does not claim semantic verification of a real model response without a separately authorized, credentialed smoke test.
