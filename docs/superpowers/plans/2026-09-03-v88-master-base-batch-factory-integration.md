# V88 Master-Base Batch Factory Integration Plan

> **For agentic workers:** execute this plan without wholesale branch merges. Re-read V88 HEAD before each write.

**Goal:** Build V88 from the exact master baseline while integrating the current Batch Factory comprehensive candidate without losing unrelated website functionality or changing production.

**Base:** `master@fc1f5a96364518f0f14073fd5195363ef0e15a77`

**Batch Factory candidate:** `d9c3a164053473c55704fa0ba904041366564b61`

## Integration rules

- Do not merge the candidate's 265 divergent commits wholesale.
- Preserve all unrelated master-base files exactly.
- Overlay only Batch Factory V11 code and required runtime wiring.
- Keep `/batch-factory-preview` and all unrelated routes untouched.
- Do not deploy, retag production, or change the GitHub default branch.
- Keep the pre-reset V88 state archived.

## Atomic integration set

1. Add candidate `backend/` subtree for Batch Factory V11 Go/MySQL/runtime support.
2. Replace root `app.js` with the candidate version only because the comparison shows additive V11 runtime wiring and no deletions relative to the selected base.
3. Replace root `Dockerfile` with the candidate integrated-runtime build definition on V88 only; do not deploy it.
4. Add candidate BF11 verification workflows without replacing the existing master workflow directory.
5. Replace only `frontend/src/user/pages/BatchFactoryPage.jsx` so `/batch-factory` mounts V11.
6. Add `BatchFactoryPageV11.jsx` and the complete `frontend/src/user/pages/batch-factory-v11/` subtree.
7. Add only `frontend/src/shared/api/batchFactoryV11.js` and its test; preserve all other shared APIs and all other pages from master.
8. Add `CURRENT_VERSION.md` recording provenance and non-production status.

## Verification gates

- Compare V88 against the exact base and confirm unrelated site source is not modified.
- Confirm the V88 tree contains the BF11 backend, frontend workbench and API client.
- Confirm `master` remains the repository default branch and production is untouched.
- Check available CI/status evidence; do not claim tests pass without fresh test evidence.
