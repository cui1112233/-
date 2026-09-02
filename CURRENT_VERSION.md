# CURRENT VERSION

## Status

- Current consolidation branch: `v88`
- Status: **integration candidate — not yet production/default**
- V88 baseline source: `fix/v78-full-regression-20260902`
- Baseline SHA: `b52e8285f869d192ba24b0fa895a7c138d84bcd5`
- Current repository default branch: `master`
- Rule: do not treat `master` as the authoritative latest product source during V88 consolidation.

## Promotion Rule

`v88` may become the GitHub default branch only after Novel Fetch, Batch Factory V11, unified settings/version configuration, Doubao local executor, 121/Browser Worker, Go backend, and required production behavior are consolidated and pass their regression gates.

## Canonical Development Rule

Until promotion is complete:

1. New consolidation work targets `v88` or a short-lived branch created from `v88`.
2. Do not start new product work from legacy V78 feature/integration/ops/plan/design branches.
3. Do not blindly merge a whole legacy branch because its name contains `final`, `release`, or `production`.
4. Compare implementations first; integrate only the authoritative validated code.
5. A feature is not considered part of V88 until it exists and is tested on the V88 tree.

## Core Subsystems Under Consolidation

| Subsystem | Status | Canonical source/entry |
|---|---|---|
| Batch Factory V11 | baseline partially present | audit in progress |
| Novel Fetch | pending selective integration | audit in progress |
| Unified Settings / Version Config | pending | audit in progress |
| Doubao Local Executor | pending | audit in progress |
| 121 / Browser Worker | pending validation/integration | audit in progress |
| Go backend / MySQL | baseline partially present | audit in progress |
| Production deployment mapping | pending | must resolve to one Git SHA |

## Required Governance Files

- `docs/superpowers/plans/2026-09-03-v88-consolidation-plan.md`
- `QIATIE_REPOSITORY_MEMORY.md` (must be present before V88 promotion)

## Default Branch Change

**Do not switch the default branch to `v88` yet.**

Switch only after the full V88 regression gate passes and this file is updated with:

- final V88 HEAD SHA
- production/deployment SHA
- canonical source entry points for every core subsystem
- verification results
