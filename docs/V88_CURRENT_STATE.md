# V88 Current State

> This is the live coordination document. Read it before changing or deploying V88. Update it only when Git/deployment state materially changes.

## Canonical Git state

- Repository: `cui1112233/-`
- Canonical maintained branch: `v88`
- GitHub default branch at last check: `master` **(pending switch to `v88`)**
- `v88` HEAD at the start of this consolidation implementation: `2c26c27ffc1a3d6b2fd25bc49e302e0f98b4c9bd`
- Current consolidation work branch: `ops/v88-consolidation-runtime-a-20260907`
- `master` last known SHA: `96908c32456cb7572b8e621221e7cbeff75976db`
- `master` must not be deleted or force-moved until the master-only audit is complete.

## Public runtime state

Last externally verified recovery evidence (2026-09-07 18:37 +08:00 / 10:37 UTC):

- Public endpoint: `http://115.190.156.223:3000`
- Public runtime Git SHA: `a35265f3bb8f738d33c7bfd9f9dcf2007d5597b4`
- Runtime deploy mode reported by `/api/build-info`: `git-direct-stage`
- Host Node health: `127.0.0.1:18081` verified healthy at that time.
- Public `:3000` health: externally verified healthy at that time.
- Public runtime is **behind current `v88` HEAD** because emergency recovery intentionally restored the last verified Host release first.
- Previous stable SHA: **not yet normalized into a single authoritative state file by the legacy deployment path**. Runtime A cutover must establish this before traffic promotion; do not invent a rollback SHA.

## Current production architecture (migration state)

The current environment is still mixed and is **not** the final Runtime A architecture:

`Internet -> Docker Nginx (:3000) -> Docker bridge gateway -> Host Node (:18081)`

Host Node staging currently still depends on Docker network/container discovery for old Node, Go API, Worker, and Nginx. Therefore Docker/Nginx/bridge startup can still affect main-site availability.

## Approved target architecture A

`Internet -> Host Nginx -> Host Node / Host Go`

Isolation-heavy services such as the 121 Browser Worker may remain Dockerized. MySQL/Redis may remain containerized during migration if stable. Docker Worker/data-service failures must not make the main website unreachable.

## Approved normal workflow

`latest v88 -> short-lived worker branch -> tests -> release coordinator review -> merge v88 -> exact-SHA incremental ECS deploy -> public health check -> record current/previous stable SHA`

Development workers do **not** deploy production. Only the release coordinator normally merges and publishes.

## Retired / non-authoritative release paths

Do not use these merely because the files still exist:

- Automatic Docker/GHCR V88 public Node release (`V88 Linux AMD64 Public Image Release`) — retired.
- Old Docker Node emergency redeploy — emergency/history only, not the normal release path.
- `*-once.yml`, diagnostic and registry transfer workflows — incident tooling/history unless explicitly re-authorized by the coordinator.
- Historical feature/fix/integrate/diag/design branches — reference only; never mass-merge into `v88`.

## Active consolidation work

Design:

`docs/superpowers/specs/2026-09-07-v88-consolidation-production-runtime-design.md`

Implementation plan:

`docs/superpowers/plans/2026-09-07-v88-consolidation-production-runtime.md`

Current sequence:

1. Enforce Git/GPT coordination rules.
2. Audit the one master-only commit.
3. Switch GitHub default branch to `v88` while preserving master/archive.
4. Add RED deployment contracts for Runtime A.
5. Build Host Nginx + Host Node in parallel without public cutover.
6. Cut public `:3000` only after exact-SHA health and rollback proof.
7. Retire conflicting temporary workflows only after stable observation.
