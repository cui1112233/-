# V88 Functional Consolidation Plan

**Goal:** Close all core Qiantie functionality into `v88` without wholesale merging divergent legacy branches, while preserving the exact master-base website and keeping production unchanged.

**Canonical branch:** `v88`. Re-resolve its current HEAD immediately before every write; never promote from a stale integration base.

## Rules
- Work module-by-module on short-lived `integrate/v88-*` branches.
- Never whole-merge divergent V78 feature/integration/ops/design/plan branches.
- Prefer already verified V88 milestones over reimplementation.
- Preserve unrelated master-base website files.
- Promote each module into `v88` only after structural/test evidence is recorded.
- Do not change GitHub default branch or deploy production.

## Authoritative source lines

### Batch Factory V11 dual video provider
- Source branch: `feat/bf11-dual-video-provider-integration-20260902`
- Source tip: `d9c3a164053473c55704fa0ba904041366564b61`
- Integration rule: semantic/content parity audit only; never whole-merge this divergent branch into `v88`.
- Verified already present in `v88`: personal `yd_video` / `yd2.0-mini` provider, Doubao local executor provider, provider/model compatibility checks, local executor public/signed artifact media path, provider-aware production state, main Batch Factory V11 settings/workbench UI, asset-prompt clearing semantics, and completed-media publish authority safeguards.
- Any future delta from this source line must be migrated file-by-file or commit-by-commit only when missing from the latest `v88`.

## Order
1. Novel Fetch local-first body lifecycle + local body store.
2. Novel Fetch sparse AI / explicit version configuration.
3. Novel Fetch late V2 / 121 deltas and browser worker contract.
4. Unified Settings / Version Config authoritative implementation.
5. Doubao local executor desktop/runtime completion.
6. Batch Factory cross-module handoff verification, including parity against `d9c3a164053473c55704fa0ba904041366564b61`.
7. Full frontend/Node/Go/MySQL regression gate.
8. Final branch cleanup classification and default-branch promotion decision.
