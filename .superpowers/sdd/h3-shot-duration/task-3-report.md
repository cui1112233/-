# Task 3: ScriptPage and H3 Shot-Duration Wiring

## Scope and baseline

- Fixed checkout: `C:/Users/Administrator/Documents/Codex/2026-09-04/new-chat-2/qiantie-v88`
- Branch: `feat/v88-h3-unified-video-20260909`
- Starting HEAD: `df4e0faa33451b2848dbb566ff64e0c3291a9cc1`
- Scoped changes only: `frontend/src/user/pages/ScriptPage.jsx`, `tests/h3-shot-duration-frontend-contract.test.js`, and `tests/h3-script-video-route.test.js`.
- Pre-existing unrelated dirty files and credentials were not edited, staged, cleaned, or inspected.

## TDD evidence

### RED

Command:

```text
node --test tests/h3-shot-duration-frontend-contract.test.js tests/h3-script-video-route.test.js
```

Result: 6 tests total, 5 passed, 1 failed.

- `tests/h3-shot-duration-frontend-contract.test.js` failed as expected because `ScriptPage.jsx` did not import `resolveShotVideoDuration` before the production wiring was added.
- The five route tests were already GREEN, including the newly added 15-second acceptance and 16-second rejection boundaries. This confirms the existing route already enforced the 1–15 integer contract and did not require route production changes.

### GREEN

Minimal `ScriptPage` wiring:

- Imports `resolveShotVideoDuration`.
- Computes the existing 10/15 second selector value as `fallbackDuration`.
- For `minimax-h3-video`, resolves the current card's `总时长：Ns` before generating state or request submission.
- Displays the returned resolver error and exits before submission when invalid.
- Supplies `resolvedDuration.duration` to `buildScriptVideoPayload`.
- Keeps non-H3 payload behavior and H3 reference-image/task polling flow unchanged.

Command:

```text
node --test tests/h3-shot-duration-frontend-contract.test.js tests/h3-script-video-route.test.js
```

Result: 6 tests total, 6 passed, 0 failed.

## Added contract coverage

- Frontend source contract verifies the H3 resolver import/call, invalid-result guard before generating state, and resolved payload duration.
- Route contract verifies `duration: 15` reaches the captured H3 workflow payload and returns the existing `202` task response.
- Route contract verifies `duration: 16` returns HTTP 400 with the 1–15 error and never invokes `h3Submit`.

## Boundaries

- This is local source-contract and route-contract evidence only; no deployment, ECS, public verification, or actual H3 provider submission was performed.
