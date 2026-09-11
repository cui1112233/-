# Task 3d report — configuration persistence hardening

## Delivered

- Custom models receive a stable `custom-*` catalog ID from the model ID/display name; the server assigns a numeric suffix on collision when it generates the ID.
- Enabled custom models are rejected unless Base URL, model ID, and API Key are all available. The form also exposes the missing-key validation before submission.
- The custom capability form now writes only the persisted capability object: `supportsReferenceImages`, `requiresImageInput`, and bounded `maxVideoDuration` (1–60). Existing values are loaded back into those controls.
- The Local Doubao preset obtains pairing state from the signed Go local-executor listing. Saving/enabling refreshes that state server-side; an unpaired executor cannot be enabled. The status endpoint persists a verified transition for an existing catalog record.

## Files

- `lib/model-catalog-runtime.js`
- `routes/config.js`
- `frontend/src/shared/api/config.js`
- `frontend/src/shared/api/modelCatalog.js`
- `frontend/src/user/pages/ApiConfigPage.jsx`
- `tests/model-catalog-routes.test.js`
- `tests/model-catalog-capabilities.test.js`
- `tests/model-catalog-api-config-ui.test.js`

## Verification

```text
node --test tests/model-catalog-routes.test.js tests/model-catalog-capabilities.test.js tests/model-catalog-api-config-ui.test.js
9 passed, 0 failed

node --test tests/model-catalog-routes.test.js tests/model-catalog-api-config-ui.test.js tests/model-catalog-capabilities.test.js tests/model-catalog.test.js tests/model-catalog-crud-access.test.js tests/model-catalog-member-visibility.test.js tests/model-catalog-app-route.test.js tests/model-catalog-reference-protection.test.js tests/typed-model-select.test.js
33 passed, 0 failed

npm --prefix frontend run build
passed (existing unresolved brand-logo runtime warnings only)
```

## Caveat

The pairing status is based on the Go service's persisted local executor list for the current account. A temporary Go-service outage does not fabricate a paired executor; enabling will be rejected until the server can confirm it.

## Final follow-up

- The client now allocates the next unused stable `custom-*` ID before submission; the server remains the collision authority for concurrent saves.
- Pairing status is fetched even before a Local Doubao catalog record exists, so an already paired executor can be enabled on its first model-directory save.
- Added `frontend/src/shared/modelCatalog/customModelId.test.js`; the focused model-catalog suite and production frontend build pass without staging generated `dist` output.
