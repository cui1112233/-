# CURRENT VERSION

## Status

- Current consolidation branch: `v88`
- Status: **core consolidation in progress — not yet production/default**
- V88 initial integrated baseline source: `feat/v78-go-integrated-novel-fetch-doubao`
- V88 initial integrated baseline SHA: `167891fcb64331ea1f812d86ba201e751c4612d2`
- Previous V88 baseline preserved at: `archive/v88-pre-consolidation-20260903`
- Current repository default branch: `master`
- Rule: do not treat `master` as the authoritative latest product source during V88 consolidation.

> `v88` HEAD will continue to move as core modules are integrated. Always read the live branch HEAD before modifying code.

## Promotion Rule

`v88` may become the GitHub default branch only after Novel Fetch, Batch Factory V11, unified settings/version configuration, Doubao local executor, 121/Browser Worker, Go backend, and required production behavior are consolidated and pass their regression gates.

## Canonical Development Rule

Until promotion is complete:

1. New consolidation work targets `v88` or a short-lived branch created from `v88`.
2. Do not start new product work from legacy V78 feature/integration/ops/plan/design branches.
3. Do not blindly merge a whole legacy branch because its name contains `final`, `release`, or `production`.
4. Compare implementations first; integrate only the authoritative validated code.
5. A feature is not considered part of V88 until it exists and is tested on the V88 tree.
6. Do not delete historical V78 branches until V88 is fully validated.
7. Do not use `frontend/dist`, worktree copies, or production snapshots as the primary implementation source.

## Core Source Map

| Subsystem | V88 status | Primary source / action |
|---|---|---|
| Integrated Go + Doubao executor foundation | baseline present | `feat/v78-go-integrated-novel-fetch-doubao` |
| Batch Factory V11 Go/MySQL backend fixes | pending selective integration | `release/production-v78.3.0.3-batch-factory-go-first` |
| Batch Factory V11 frontend/workbench/settings | pending integration | `feat/batch-factory-v11-layout-showcase` |
| Novel Fetch V2 late fixes / 121 | pending selective integration | `release/production-v78.3.0.3-batch-factory-go-first` + check `integration/v78-novel-fetch-v2-final-20260902` |
| Novel Fetch local-first Go storage/lifecycle | pending integration | `feat/v78-novel-fetch-local-first-s2-go` |
| Local executor novel body store | pending selective extraction | `feat/v78-novel-fetch-local-first-s2-executor` |
| Unified Settings / Version Config | pending final source audit | must land on V88, not old page |
| Production deployment mapping | pending | final deployment must resolve to one V88 Git SHA |

## Branches Already Superseded For Consolidation

These branches must **not** be merged independently into V88:

- `fix/v78-full-regression-20260902` — already contained by later release work.
- `feat/v78-doubao-local-executor-s5-artifact-return` — fully contained by the integrated baseline and superseded by later commits.
- `feat/v78-novel-fetch-local-first-s1-go` — fully contained by `feat/v78-novel-fetch-local-first-s2-go`.

## High-Risk Sources

Do not whole-merge these categories into V88:

- `ops/*`
- `plan/*`
- `design/*`
- production snapshot branches
- old branches dominated by generated `frontend/dist/*` churn

Extract only verified source changes when needed.

## Required Governance Files

- `docs/superpowers/plans/2026-09-03-v88-consolidation-plan.md`
- `QIATIE_REPOSITORY_MEMORY.md`

## V88 Completion Gate

**Do not switch the default branch to `v88` yet.**

Switch only after all of the following are true:

1. Novel Fetch V2 + local-first behavior is consolidated.
2. Batch Factory V11 frontend and Go backend are consolidated.
3. Unified Settings / Version Config points to the current V88 implementation.
4. Doubao local executor regression tests pass.
5. 121 / Browser Worker tests and contracts pass.
6. Go tests pass.
7. Frontend build passes.
8. Node core regression results are recorded and blockers resolved.
9. Final V88 HEAD SHA is written here.
10. Production/deployment SHA maps to that V88 lineage.
