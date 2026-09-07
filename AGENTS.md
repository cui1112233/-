# V88 Agent Execution Rules

All agents, chats, Codex sessions, and automation working on this repository must follow these rules before changing or deploying V88.

## 1. Canonical source

1. **Git branch `v88` is the canonical maintained source and future total branch.** Do not treat production/ECS files, old V78 branches, historical releases, hotfix bundles, or `master` as the source of truth for new work.
2. **Every feature and bug fix must be written into Git first.** Normal flow: fresh feature/fix branch from current `v88` -> tests -> review/merge into `v88` -> record commit SHA -> deploy/sync production.
3. **Production/ECS is a runtime copy, not a development source.** Do not complete a task by editing only the running server/container. Emergency production edits must be ported back to `v88` immediately; otherwise the task is incomplete.
4. **Before modifying or deploying, verify the current `v88` HEAD.** Never overwrite current V88 with an older `app.js`, old hotfix bundle, old image, historical branch snapshot, or stale chat-local copy.

## 2. Agent/chat roles

Every session must operate in exactly one role.

### Development worker

- Start from the latest `v88` HEAD on a fresh short-lived branch such as `fix/...` or `feat/...`.
- Modify only the assigned feature/fix scope.
- Run focused tests and the required regression/build checks.
- Commit changes and report the branch name + commit SHA to the release coordinator.
- **Must not deploy production.**
- **Must not force-update, reset, or directly overwrite `v88`.**
- **Must not merge unrelated old branches into the work branch.**

### Release coordinator

- Re-read `docs/V88_CURRENT_STATE.md` and verify the latest `v88` HEAD before integration.
- Review the worker branch/commit, tests, and overlap with other in-flight work.
- Merge only verified changes into `v88`.
- Perform the approved deployment path, verify public health, and update the recorded production SHA/rollback SHA.
- This is the only normal role allowed to publish V88 to production.

### Emergency recovery

- May restart/recover the last verified production release to restore service availability.
- Must prefer the last known-good Git SHA over uncommitted server edits.
- Emergency recovery is not a feature release and must not silently introduce new product changes.
- Any emergency server-side change that alters code/config must be written back to Git and reviewed before the incident is considered closed.

## 3. Deployment policy

5. **Daily small changes should prefer Git -> ECS incremental direct deployment, not full Docker rebuilds.** Frontend-only changes rebuild only frontend; Node-only changes restart Node; Go changes rebuild/restart Go; migrations run Goose only when required; Worker changes update/restart Worker only when required.
6. **Do not interpret “no Docker for daily releases” as “delete all existing Docker infrastructure.”** Existing MySQL/Redis/Worker/containerized infrastructure may remain until intentionally migrated. Docker is not the default release mechanism for small application changes.
7. **Target Runtime A:** public main-site availability must converge on Host Nginx -> Host Node / Host Go. Docker is reserved for isolation-heavy components such as the 121 Browser Worker and migration-period infrastructure. A Worker/Docker failure must not make the main website unreachable.
8. **Every production release must be traceable to a Git SHA** and have a known previous stable SHA/rollback point.
9. **Do not use retired Docker/GHCR Node release workflows as the normal release path.** Historical emergency/diagnostic workflows are not authoritative just because they still exist in the repository.

## 4. Product invariants

10. **User-visible `121` naming must be `视频管理系统`.** Internal compatibility names may retain `121`.
11. **Novel Fetch confirmed semantics must not regress:** preserve full `originalRaw`; process only up to `maxTxt`; display processed/raw counts such as `4000/27831`; `input_ready` displays `分类信息已就绪`; `running/processing` displays `正在执行中…`; date filters must use real task dates and must not be bypassed with fake dates such as `2099-12-31`.

## 5. Default interpretation of user commands

12. If the user says only **“执行”** or **“发布”**:
   - Development worker: implement/test/commit on its work branch and hand off; do not deploy.
   - Release coordinator: use the latest Git `v88`, ensure the change is committed/reviewed first, then use the currently approved deployment path.
   - Never silently choose direct production edits or a full Docker rebuild.

## 6. Required state references

Before work, read these in order:

1. `docs/V88_CURRENT_STATE.md` — current live branch/runtime/deployment state.
2. `docs/V88_PROJECT_EXECUTION_MEMORY.md` — stable project conventions and rationale.
3. `obj` — historical log only; historical entries do not override the two current rule files above.
