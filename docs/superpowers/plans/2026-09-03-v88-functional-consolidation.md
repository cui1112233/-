# V88 Functional Consolidation Plan

**Goal:** Close all core Qiantie functionality into `v88` without wholesale merging divergent legacy branches, while preserving the exact master-base website and keeping production unchanged.

**Current base:** `v88@6371f0d5e8a46f68c5ed025538c11ab1cf5f6947`

## Rules
- Work module-by-module on short-lived `integrate/v88-*` branches.
- Never whole-merge divergent V78 feature/integration/ops/design/plan branches.
- Prefer already verified V88 milestones over reimplementation.
- Preserve unrelated master-base website files.
- Promote each module into `v88` only after structural/test evidence is recorded.
- Do not change GitHub default branch or deploy production.

## Order
1. Novel Fetch local-first body lifecycle + local body store.
2. Novel Fetch sparse AI / explicit version configuration.
3. Novel Fetch late V2 / 121 deltas and browser worker contract.
4. Unified Settings / Version Config authoritative implementation.
5. Doubao local executor desktop/runtime completion.
6. Batch Factory cross-module handoff verification.
7. Full frontend/Node/Go/MySQL regression gate.
8. Final branch cleanup classification and default-branch promotion decision.
