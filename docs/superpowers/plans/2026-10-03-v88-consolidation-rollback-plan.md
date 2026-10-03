# V88 Consolidation and Rollback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Make `v88` the single production source of truth, record reproducible rollback releases in Git, and safely reduce ECS/container/branch sprawl without deleting business data.

**Architecture:** Git stores release manifests, the current release pointer, and rollback procedures; GHCR stores immutable images by full SHA. ECS cleanup is evidence-driven and separated from repository consolidation so a failed cleanup can be reversed without changing application data.

**Tech Stack:** Git/GitHub Actions, Docker Compose, GHCR immutable image tags, PowerShell/SSH verification, Node test scripts.

**Spec:** `docs/superpowers/specs/2026-10-03-v88-consolidation-rollback-design.md`

## Global Constraints

- Do not modify `master`.
- Do not commit secrets, cookies, database data, task state, video artifacts, or user content.
- Rollback uses a full Git SHA and matching immutable GHCR image tags.
- Delete only objects proven to have no container, route, or business-data dependency.
- Preserve current production services and business volumes by default.

## Review Focus

- A release manifest could point Node and Go at different SHAs — test exact SHA equality before deployment.
- A rollback could reference an unverified image — reject manifests without both image references and verification metadata.
- The legacy compat container could still receive traffic — capture route/DNS/dependency evidence before removal.
- An apparently unused volume could contain business data — require zero container links and an explicit data-size report.
- A branch could contain an unmerged active feature — classify and review before remote deletion.

### Task 1: Add release and rollback contracts

**Files:**
- Create: `deploy/v88-public/CURRENT_RELEASE`
- Create: `deploy/v88-public/releases/<verified-sha>.manifest.json`
- Create: `deploy/v88-public/releases/<verified-sha>.env.example`
- Create: `deploy/v88-public/ROLLBACK.md`
- Modify: `.github/workflows/v88-unified-public-image-release.yml`
- Test: existing release contract tests plus a new manifest contract test

**Interfaces:**
- Produces one release manifest containing `release_sha`, `node_image`, `go_image`, `branch`, `verified_at`, and `verification` fields.
- `CURRENT_RELEASE` contains exactly one full 40-character SHA.

- [ ] **Step 1: Write failing contract tests** for SHA format, Node/Go image SHA equality, required verification fields, and rejection of mismatched manifests.
- [ ] **Step 2: Run the focused contract tests** and confirm they fail because the new files/contracts do not exist.
- [ ] **Step 3: Add the current verified release manifest and rollback instructions** without credentials; document Node→Go health, build-info, and page checks.
- [ ] **Step 4: Update the workflow contract** so release publication and deployment consume the same expected SHA and reject a stale `CURRENT_RELEASE`.
- [ ] **Step 5: Run focused release tests and `git diff --check`; commit the contract changes.**

### Task 2: Produce an evidence-based ECS cleanup report

**Files:**
- Create: `deploy/v88-public/cleanup/2026-10-03-ecs-inventory.md`
- Create: `deploy/v88-public/cleanup/2026-10-03-branch-inventory.md`

**Interfaces:**
- Produces explicit keep/remove/defer classifications for every container, image, volume, temporary directory, and remote branch candidate.

- [ ] **Step 1: Capture read-only ECS evidence** for containers, image references, volume links/sizes, routes, DNS aliases, disk, and memory.
- [ ] **Step 2: Capture read-only Git evidence** for remote branches, merge ancestry, worktrees, release tags, and `v88`/`master` relationship.
- [ ] **Step 3: Write the two inventories** with commands, timestamps, evidence, and a reversible action order.
- [ ] **Step 4: Review the inventories for missing data/route dependencies; commit the reports.**

### Task 3: Remove only confirmed ECS orphans

**Files:**
- Modify: `deploy/v88-public/cleanup/2026-10-03-ecs-inventory.md` with post-cleanup evidence
- Test: deployment smoke checks and Docker link/volume checks

**Interfaces:**
- No application code changes; cleanup must leave all eight required services and business volumes intact.

- [ ] **Step 1: Verify the legacy compat container has no active route or required Compose dependency; stop only if evidence is conclusive.**
- [ ] **Step 2: Remove only the zero-link anonymous volume and the zero-link `v78-public_mysql_data` volume after recording sizes and IDs.**
- [ ] **Step 3: Clean only confirmed release temp directories, unreferenced images, and bounded old logs.**
- [ ] **Step 4: Verify all required containers, Node→Go health, public page, build-info SHA, and business-volume sizes; record results.**
- [ ] **Step 5: Commit the post-cleanup evidence and report any deferred item.**

### Task 4: Consolidate remote branch references

**Files:**
- Create: `deploy/v88-public/cleanup/2026-10-03-branch-deletion-manifest.md`
- Modify: `deploy/v88-public/ROLLBACK.md` with tag retention policy

**Interfaces:**
- Produces an allowlist of retained branches/tags and an explicit deletion list; active unmerged branches are excluded from automatic deletion.

- [ ] **Step 1: Classify remote branches as retained, archived, merged-safe, or active-unmerged.**
- [ ] **Step 2: Retain `v88`, `master`, and the latest 2–3 verified release tags; record all retained SHAs.**
- [ ] **Step 3: Delete only the reviewed merged-safe/archive branch references; do not touch active-unmerged branches.**
- [ ] **Step 4: Verify `v88` remains unchanged, tags resolve, and the deployment workflow still points only to `v88`; commit the manifest.**

### Task 5: Final release verification

**Files:**
- Modify: cleanup inventories with final status

- [ ] **Step 1: Run repository contract tests and frontend build.**
- [ ] **Step 2: Verify `CURRENT_RELEASE`, both immutable images, running containers, public build-info, Node→Go health, and production page.**
- [ ] **Step 3: Confirm no secrets or business data entered Git and the worktree is clean.**
- [ ] **Step 4: Commit final evidence and publish the exact retained/deleted/deferred lists.**
