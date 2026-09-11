# Task 2b: model deletion reference protection

## Scope completed

- Model deletion now awaits a real reference resolver instead of assuming no references.
- The resolver scans the manager's persisted API configuration for `modelId`, `textModelId`, `imageModelId`, and `videoModelId`, including nested defaults and ScriptPage/Shuihuo-owned configuration bindings.
- In the application, it also queries the manager's Batch Factory task store and scans persisted batches and task payloads for the same bindings.
- If the Batch Factory store, account lookup, or any configured source cannot be queried, the resolver returns referenced and deletion is rejected with HTTP 409.
- Direct callers that omit a resolver also fail closed.

## Verification

RED: `node --test tests/model-catalog-reference-protection.test.js` failed because a persisted `defaults.textModelId` binding incorrectly returned HTTP 204.

GREEN: `node --test tests/model-catalog-reference-protection.test.js tests/model-catalog-routes.test.js` passed 5 tests. The direct coverage verifies a persisted configured reference returns 409 and a truly unreferenced model returns 204.

`git diff --check` passed.

## Deliberate scope boundaries

- No UI, model execution routes, frontend build output, credentials, data, or deployment were changed.
- The Node Shuihuo gateway does not currently persist catalog model IDs outside manager configuration; its manager configuration bindings are covered by the persisted-config scan. Go-owned data is not treated as a Node store.
