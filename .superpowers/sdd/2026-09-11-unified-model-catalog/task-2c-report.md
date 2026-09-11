# Task 2c Review Fix Report

## Scope

Addressed only the three review findings after `b16fce76`:

1. Model catalog CRUD now requires an active `dev` or `manager` record from `memberStore`.
2. Model deletion now fails closed when a required persistent reference source is missing or unreadable.
3. `GET /api/models?kind=...` now rejects unsupported kinds with HTTP 400.

No UI, frontend distribution files, business execution routes, deployment files, or credentials were changed.

## RED

Before the production changes, targeted tests reproduced the three defects:

- An authenticated username absent from `memberStore` received `201` from `POST /api/config/models`; expected `403`.
- A model without a config reference received `204` when the batch persistent source was absent; expected `409`.
- `GET /api/models?kind=audio` received `403` through the member-scope branch; expected `400` for an invalid model kind.

## GREEN

- `routes/config.js`: `apiManagementState` permits CRUD only for active `dev` or `manager` members. The default resolver wiring now accepts explicit account and batch-store dependencies.
- `lib/model-reference-resolver.js`: missing `batchFactoryStoreFactory` is treated as referenced, preserving deletion safety.
- `app.js`: validates `kind` against text, image, and video before member-scope checks.
- Added focused coverage for orphan authenticated CRUD denial, invalid root model kind, unavailable persistent source, and an explicitly complete unreferenced source set.

## Verification

```text
node --test tests/model-catalog-crud-access.test.js tests/model-catalog-routes.test.js tests/model-catalog-reference-protection.test.js tests/model-catalog-app-route.test.js tests/model-catalog-member-visibility.test.js tests/model-catalog-legacy-migration.test.js tests/model-catalog.test.js
25 passed, 0 failed
```

`git diff --check` passed for all Task 2c files.

## Commit Scope

The commit contains only Task 2c server logic, focused node:test coverage, and this report. Existing unrelated working-tree changes, including frontend distribution artifacts and prior unstaged test edits, are not included.
