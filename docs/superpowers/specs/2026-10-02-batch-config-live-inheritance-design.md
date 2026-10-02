# Batch Factory model configuration: live inheritance

**Status:** approved design, awaiting implementation-plan review  
**Date:** 2026-10-02

## Goal

Make the backend model catalogue the single source of truth for model choices.
The model selected in a batch preset, the batch-wide configuration, and a book's
configuration must use the same catalogue, IDs, labels, and availability rules.

The user-facing behaviour is deliberately simple:

1. Selecting a preset and pressing **立即执行** writes that preset's model
   choices into the batch-wide configuration.
2. Each book initially follows the batch-wide configuration. Its dropdowns show
   the same selected model names and the same available options.
3. Changing a model for one book creates an override for that field only; other
   books and the batch-wide configuration are unchanged.
4. Changing the batch-wide configuration updates every book that has not
   overridden that field, including books that have not yet reached that stage.
5. Resetting a book field removes only that book's override, so it follows the
   batch-wide value again.

No UI provenance labels, frozen-run labels, or hidden alternative model lists
are introduced.

## Configuration ownership

### Backend model catalogue

The catalogue is the only authority for:

- selectable model IDs;
- display names;
- model kind (text, image, video, voice);
- enabled/disabled state.

Every model dropdown must consume this same response. UI code must not invent a
label from a stale ID or maintain a second list.

### Batch-wide patch

The batch patch stores the chosen defaults, including `textModelId`,
`imageModelId`, `videoModelId`, and other shared production settings. Applying
a preset replaces the relevant batch defaults atomically before automation is
started.

### Per-book patch

A book patch contains only fields explicitly changed for that book. It must not
be populated by automation, preset application, or task startup. For any absent
field, the effective value is read live from the batch patch.

## Runtime behaviour

At the start of each production stage, effective settings are resolved as:

```
validated backend model catalogue
        + batch-wide patch
        + explicit per-book fields only
```

There is no automation configuration snapshot participating in this resolution.
Consequently, a later batch-wide change affects books that still inherit the
changed field. A book with an explicit override remains unchanged.

Before a production request is made, the backend validates every selected model
ID against the current enabled catalogue and correct model kind. A missing or
disabled model produces a direct configuration error naming the affected field;
it must never proceed to a provider request that later returns generic
`invalid input`.

## UI behaviour

- Unified and book configuration dialogs obtain choices from the same model
  catalogue request and render the catalogue's display name.
- The single-book dropdown displays its own explicit value when present;
  otherwise it displays the effective batch-wide value.
- Saving a book model different from the batch-wide value saves that one field
  in its patch.
- Saving a book model equal to the batch-wide value removes that field from its
  patch instead of storing a duplicate.
- A per-field **恢复默认** action removes that field's override. It does not
  overwrite other single-book settings.

## Existing data repair

Older automation runs incorrectly copied full task snapshots into book patches.
Repair is conservative and field-level:

1. Identify books marked as having had an execution snapshot applied.
2. Compare each book field with the automation snapshot recorded for that same
   batch/job.
3. Remove only fields that exactly match the automatically copied snapshot.
4. Preserve fields that differ, because they may be a real user override.
5. Do not mutate a book when its historical automation snapshot is unavailable;
   the user can use **恢复默认** instead.

The repair is idempotent, auditable, and runs only through an explicit
maintenance endpoint/job; normal page loads never mutate configuration.

## Non-goals

- No mass replacement of model credentials or provider configuration.
- No retry or paid model call as part of migration.
- No alteration of completed-stage outputs.
- No automatic removal of ambiguous historical book settings.

## Acceptance checks

1. All three model dropdown contexts receive the same IDs and names from the
   backend catalogue.
2. A newly created batch with a selected preset shows exactly those selections
   in unified configuration and in every unmodified book configuration.
3. A single-book edit changes only that book and field.
4. A subsequent unified edit updates only books without that field override.
5. Resetting a book field restores its current unified value.
6. Automation never writes a full configuration snapshot into a book patch.
7. A stale, missing, disabled, or wrong-kind model ID is blocked before the
   external provider call with a readable error.
8. Existing automatically copied fields are removed only when exact snapshot
   comparison proves their origin; manual and ambiguous settings remain intact.

