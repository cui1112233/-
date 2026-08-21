# Qiantie Local Docker Test Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the complete Qiantie platform locally through Docker Compose, with the Node platform on port 3000 and the Go Shuihuo backend, MySQL, and Redis isolated in containers.

**Architecture:** The Node platform proxies Shuihuo requests to `backend:4000` through the existing signed bridge. The Go backend owns the MySQL schema and Redis task queue; the Compose environment uses named volumes so it cannot alter the host MySQL, Redis, or project data. The Go binary and frontend bundle are created on the host to avoid requiring a Go build image during Docker build.

**Tech Stack:** Docker Compose, Node.js 24 runtime image, Go static Linux binary, MySQL 8.4, Redis 7.4.

---

### Task 1: Create isolated runtime images

**Files:**
- Create: `deploy/Dockerfile.platform`
- Create: `deploy/Dockerfile.backend`
- Create: `.dockerignore`

- [ ] Copy the platform runtime files and preinstalled production Node dependencies into a configurable Node base image.
- [ ] Copy the host-built static Go binary and CA certificates into a scratch backend image.
- [ ] Exclude host state, credentials, dependency caches, source-only frontend files, and local logs from Docker build context.

### Task 2: Define Compose test environment

**Files:**
- Create: `deploy/docker-compose.test.yml`
- Create: `deploy/.env.test.example`

- [ ] Create `platform`, `backend`, `mysql`, and `redis` services with private Compose networking.
- [ ] Persist only test MySQL, Redis, and object storage through named Docker volumes.
- [ ] Expose platform on `3000` and backend media URLs on `14000`; keep MySQL and Redis unexposed.
- [ ] Pass bridge and backend configuration only through the ignored local environment file.

### Task 3: Create build and deployment entrypoints

**Files:**
- Create: `scripts/build-test-docker-artifacts.sh`
- Create: `scripts/deploy-test-docker.sh`

- [ ] Build the Vite bundle and cross-compile a static Linux binary for the local Docker architecture; allow `QIANTIE_RUN_TESTS=1` to enforce the Go test suite when the current worktree is green.
- [ ] Generate unique test secrets in `deploy/.env.test-docker` with restrictive permissions.
- [ ] Refuse to take occupied ports, then build, start, and health-check the Compose stack.
- [ ] Provide `down`, `clean`, `ps`, `logs`, and `health` operations.
