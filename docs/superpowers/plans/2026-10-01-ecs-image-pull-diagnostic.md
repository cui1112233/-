# ECS Image Pull Diagnostic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a read-only, manually triggered GitHub Actions diagnostic that identifies why the public ECS host times out while pulling immutable release images.

**Architecture:** Add a standalone `workflow_dispatch` workflow that reuses the existing protected ECS SSH secret but never logs into GHCR, pulls images, restarts services, changes files, or deletes Docker data. It reports only bounded operational facts: filesystem capacity, Docker storage, process state, resolver/connectivity probes, and whether the known immutable Go image is already locally present.

**Tech Stack:** GitHub Actions YAML, SSH, Docker CLI, Bash.

## Global Constraints

- Source of truth is Git branch `v88`; do not edit production directly.
- This workflow is diagnostic-only: no `docker pull`, `docker compose`, `docker system prune`, `rm`, or service restart.
- Do not print credentials, Docker config content, API keys, tokens, or arbitrary process command lines.
- Release is blocked until the diagnostic evidence identifies a concrete root cause.

---

### Task 1: Add a bounded, read-only ECS diagnostic workflow

**Files:**
- Create: `.github/workflows/v88-ecs-image-pull-diagnostic.yml`
- Test: GitHub Actions YAML parse via Ruby `YAML.safe_load_file` and static command safety assertions.

**Interfaces:**
- Consumes: repository secret `V88_ECS_SSH_PRIVATE_KEY` and public ECS host `115.190.156.223`.
- Produces: one private Actions log containing `ECS_PULL_DIAGNOSTIC_OK` plus non-sensitive host and Docker readiness fields.

- [x] **Step 1: Write the failing safety check**

Run:

```bash
ruby -e 'require "yaml"; p YAML.safe_load(File.read(".github/workflows/v88-ecs-image-pull-diagnostic.yml"), aliases: true)'
rg -n "docker (pull|compose|system prune)|rm -rf|docker login" .github/workflows/v88-ecs-image-pull-diagnostic.yml
```

Expected: the YAML file is missing before implementation; no mutating Docker commands may appear after implementation.

- [x] **Step 2: Create the workflow**

Use `workflow_dispatch` with a required `release_sha` input restricted to a lowercase 40-character Git SHA, `contents: read`, a five-minute job timeout, and the same temporary SSH-key/known-host handling as the existing API configuration diagnostic. Pass that value to the remote script only as a positional argument after validation. Its remote script must run only these checks:

```bash
df -h / /var/lib/docker
docker system df
ps -eo pid,stat,comm | grep "[d]ockerd\|[c]ontainerd"
getent hosts ghcr.io
curl -I --connect-timeout 10 --max-time 15 https://ghcr.io/v2/
docker image inspect ghcr.io/cui1112233/qiantie-go-api:<requested-sha>
```

The script must turn expected probe failures into explicit status fields rather than failing before the summary. It must not expose image configuration or credentials.

- [x] **Step 3: Verify static safety and syntax**

Run:

```bash
ruby -e 'require "yaml"; p YAML.safe_load(File.read(".github/workflows/v88-ecs-image-pull-diagnostic.yml"), aliases: true)'
! rg -n "docker (pull|compose|system prune)|rm -rf|docker login" .github/workflows/v88-ecs-image-pull-diagnostic.yml
git diff --check
```

Expected: YAML parses; the workflow contains no pull, deploy, deletion, or login commands; whitespace check passes.

- [ ] **Step 4: Commit the diagnostic-only source change**

```bash
git add .github/workflows/v88-ecs-image-pull-diagnostic.yml docs/superpowers/plans/2026-10-01-ecs-image-pull-diagnostic.md
git commit -m "ci: add ECS image pull diagnostic"
```

### Task 2: Run and interpret the diagnostic before changing the release path

**Files:**
- No source files changed unless Task 1's results identify a source-side defect.

**Interfaces:**
- Consumes: the manually dispatched Task 1 workflow run.
- Produces: a stated root cause and exactly one follow-up repair hypothesis.

- [ ] **Step 1: Dispatch the workflow from its committed V88 source**

Run:

```bash
gh workflow run v88-ecs-image-pull-diagnostic.yml --ref v88 -f release_sha=<failed-release-sha>
```

Expected: a diagnostic run begins without publishing images or touching production services.

- [ ] **Step 2: Read only the diagnostic summary and relevant failure lines**

Run:

```bash
gh run view <run-id> --log
```

Expected: evidence distinguishes storage exhaustion, stuck Docker daemon, DNS/connectivity failure, and image-layer extraction failure.

- [ ] **Step 3: Propose one evidence-backed repair**

Do not increase the 15-minute timeout merely to mask the issue. If storage is exhausted, prepare a recoverable cleanup proposal; if registry connectivity is unhealthy, repair the registry/network boundary; if Docker is wedged, diagnose the daemon before restart.
