# V88 Consolidation and Production Runtime A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `v88` the only maintained source line, prevent multiple GPT sessions from overwriting each other, and migrate the public web entry from Docker-coupled routing to Host Nginx + Host Node with traceable Git SHA and rollback.

**Architecture:** Git `v88` remains the single source of truth. Development work happens on short-lived branches and merges into `v88`; only the release coordinator deploys. Production web entry becomes Host Nginx -> Host Node, while Browser Worker and other isolation-heavy services may remain Dockerized. Every deployment records current and previous stable SHA and verifies public health before promotion.

**Tech Stack:** GitHub, GitHub Actions, Node.js 24.19.0, React + Ant Design, Go, systemd, Nginx, Docker only for isolated infrastructure/Worker, MySQL, Redis, Goose.

**Spec:** `docs/superpowers/specs/2026-09-07-v88-consolidation-production-runtime-design.md`

## Global Constraints

- `v88` is the canonical maintained source and future total branch.
- Do not delete or force-overwrite `master` before auditing its unique commit `96908c32456cb7572b8e621221e7cbeff75976db`.
- Do not mass-merge old `fix/*`, `feat/*`, `integrate/*`, `diag/*`, `design/*` branches into `v88`.
- Public main site must no longer depend on Docker Node or Docker Nginx after Runtime A cutover.
- Browser Worker may remain Dockerized; Worker failure must not make the main site unreachable.
- Every public release must expose the exact Git SHA, previous stable SHA, deploy mode, and health state.
- Ordinary GPT development sessions must not deploy production or directly overwrite `v88`; only the release coordinator performs merge and deploy.
- No production architecture cutover occurs until the parallel Host path is healthy and rollback is verified.

---

### Task 1: Canonical Git and GPT coordination rules

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/V88_PROJECT_EXECUTION_MEMORY.md`
- Create: `docs/V88_CURRENT_STATE.md`

**Interfaces:**
- Consumes: current `v88` HEAD and repository default-branch metadata.
- Produces: one short current-state document that all GPT sessions can read before touching V88.

- [ ] **Step 1:** Update `AGENTS.md` to explicitly distinguish three roles: development worker, release coordinator, emergency recovery.
- [ ] **Step 2:** Add hard rules: development workers use a fresh branch from current `v88`, cannot deploy, cannot force-update `v88`, and must report commit SHA to the coordinator.
- [ ] **Step 3:** Create `docs/V88_CURRENT_STATE.md` with canonical branch, current `v88` HEAD, public runtime SHA, approved deployment mode, previous stable SHA, and a short “do not use” list for retired Docker release paths.
- [ ] **Step 4:** Update `docs/V88_PROJECT_EXECUTION_MEMORY.md` to reference `docs/V88_CURRENT_STATE.md` as the live state and `obj` as historical log only.
- [ ] **Step 5:** Verify the three documents do not contradict each other.
- [ ] **Step 6:** Commit the governance changes on the isolated implementation branch.

### Task 2: Audit the one master-only commit

**Files:**
- Create: `docs/audits/2026-09-07-master-to-v88-audit.md`
- Potentially modify only the exact V88 files proven to be missing equivalent behavior.
- Add/modify focused regression tests only if behavior is actually missing.

**Interfaces:**
- Consumes: `master` unique commit `96908c32456cb7572b8e621221e7cbeff75976db` and current `v88`.
- Produces: per-file classification `already-covered`, `migrate-minimal`, or `obsolete`.

- [ ] **Step 1:** Fetch the unique commit diff and list every changed file.
- [ ] **Step 2:** Compare each changed file/behavior against current `v88` implementation.
- [ ] **Step 3:** Record evidence and classification in the audit document.
- [ ] **Step 4:** If anything is `migrate-minimal`, use TDD: write a failing regression test, verify RED, implement the smallest current-architecture fix, verify GREEN.
- [ ] **Step 5:** Do not cherry-pick the whole old commit unless every changed file is proven current and required.
- [ ] **Step 6:** Commit the audit and any minimal migration.

### Task 3: Switch GitHub default branch to v88 and preserve master

**Files:**
- No source file is required for the repository setting itself.
- Create archive branch only after Task 2 confirms master-only behavior is accounted for.

**Interfaces:**
- Consumes: completed Task 2 audit.
- Produces: repository default branch = `v88`; historical `master` retained; archive pointer preserved.

- [ ] **Step 1:** Verify repository default branch is still `master` immediately before the change.
- [ ] **Step 2:** Change GitHub repository default branch to `v88` using an authorized repository-settings path. If the current connector cannot mutate this setting, stop at this single UI action and ask the user to perform only `Settings -> Branches -> Default branch -> v88`, then re-read repository metadata before proceeding.
- [ ] **Step 3:** Verify repository metadata reports `default_branch: v88`.
- [ ] **Step 4:** Create `archive/master-before-v88-canonical-20260907` at the audited master SHA.
- [ ] **Step 5:** Keep `master` itself intact; do not delete or force-move it in this phase.

### Task 4: Define tests for Host Nginx + Host Node independence

**Files:**
- Create/modify focused tests under `tests/` for Runtime A deployment contracts.
- Inspect: `deploy/v88-direct/stage-node-host.sh`
- Inspect: `deploy/v88-direct/cutover-node-host.sh`
- Inspect current Nginx and service deployment files.

**Interfaces:**
- Consumes: current mixed Host/Docker deployment scripts.
- Produces: RED tests proving that public Node/Nginx must no longer require Docker Node or Docker Nginx.

- [ ] **Step 1:** Invoke `superpowers:test-driven-development`.
- [ ] **Step 2:** Add a regression test that fails while Host stage requires `v88-public-v88-node` or `v88-public-nginx`.
- [ ] **Step 3:** Add a regression test requiring a Host Nginx config/systemd service path and `127.0.0.1:18081` upstream.
- [ ] **Step 4:** Add a regression test requiring runtime state files for `current_sha` and `previous_stable_sha`.
- [ ] **Step 5:** Run focused tests and verify RED for the intended missing Runtime A contracts only.

### Task 5: Implement parallel Runtime A without cutting public traffic

**Files:**
- Modify: `deploy/v88-direct/stage-node-host.sh`
- Create: `deploy/v88-direct/install-host-nginx.sh`
- Create: `deploy/v88-direct/promote-host-node.sh`
- Create/modify systemd/Nginx templates under `deploy/v88-direct/`
- Modify GitHub Actions stage workflow as required.

**Interfaces:**
- Produces Host Node `127.0.0.1:18081`, Host Nginx test listener/alternate port, runtime SHA state, and rollback commands.

- [ ] **Step 1:** Remove dependency on Docker Node and Docker Nginx from the Host Node stage path; environment must come from an explicit host env file, not `docker inspect` of old Node.
- [ ] **Step 2:** Keep Worker connectivity explicit and isolated; Docker Worker may be addressed through a stable host-published port or an intentional bridge endpoint, but main Node startup must not require Docker Nginx/Node.
- [ ] **Step 3:** Install Host Nginx configuration in parallel without taking port 3000 yet.
- [ ] **Step 4:** Start/restart Host Node through systemd and verify `/api/build-info` reports the exact staged SHA.
- [ ] **Step 5:** Verify Host Nginx can proxy to Host Node on the parallel test port.
- [ ] **Step 6:** Run Runtime A contract tests and existing focused deployment regressions; verify GREEN.
- [ ] **Step 7:** Commit the parallel Runtime A implementation.

### Task 6: Safe public cutover and rollback proof

**Files:**
- Modify/create only the production cutover workflow/scripts required by Task 5.

**Interfaces:**
- Consumes: verified Host Node + Host Nginx parallel path.
- Produces: public `:3000` owned by Host Nginx, exact SHA verification, previous stable rollback point.

- [ ] **Step 1:** Record current public SHA as `previous_stable_sha` before changing traffic.
- [ ] **Step 2:** Stop only the Docker Nginx binding that conflicts with public port 3000; do not remove Docker Worker or data services.
- [ ] **Step 3:** Bind Host Nginx to public port 3000 and reload after `nginx -t` succeeds.
- [ ] **Step 4:** Verify from the ECS host and an external GitHub runner: `/`, `/api/build-info`, `/script`, and the Novel Fetch static entry.
- [ ] **Step 5:** Verify exact `git_sha`, `deploy_mode=git-direct`, and runtime state files.
- [ ] **Step 6:** Perform a rollback rehearsal to the previous stable Host release or documented emergency route, then restore the new release and re-verify.
- [ ] **Step 7:** Commit any final cutover adjustments and record the production SHA.

### Task 7: Retire conflicting release paths only after stable observation

**Files:**
- Review and remove/archive obsolete one-shot diagnostic/emergency workflows only after Runtime A has been stable.
- Update: `docs/V88_CURRENT_STATE.md`
- Update: `AGENTS.md`

**Interfaces:**
- Produces one normal V88 deploy path and one documented emergency recovery path.

- [ ] **Step 1:** Inventory `once`, `diagnostic`, legacy GHCR/Docker Node, old stage/cutover workflows.
- [ ] **Step 2:** Keep only workflows still required for active Runtime A or emergency recovery.
- [ ] **Step 3:** Remove obsolete temporary workflows/scripts from `v88` after checking they contain no unique production logic.
- [ ] **Step 4:** Update current-state docs with the final normal and emergency commands.
- [ ] **Step 5:** Run full relevant CI and public health verification.
- [ ] **Step 6:** Use `superpowers:verification-before-completion` before declaring consolidation complete.
