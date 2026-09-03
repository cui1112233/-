# Public Performance Hardening Implementation Plan

> **For agentic workers:** Execute this plan task-by-task with verification after each task.

**Goal:** Improve public page and route-switch latency by compressing and buffering static browser assets at the existing Nginx entrypoint.

**Architecture:** Keep the V78 application stack and data untouched. Nginx will gzip proxied browser text responses, buffer `/assets/` responses, and use ordinary keep-alive headers for non-WebSocket traffic.

**Tech Stack:** Nginx 1.27, Docker Compose, Node test runner, curl.

## Global Constraints

- Do not deploy or switch the public application to V88.
- Do not restart or replace Node, Go, MySQL, Redis, worker, or persistent volumes.
- Preserve the existing 2 GB upload limit and 900 second API read timeout.
- Back up the live Nginx configuration before replacement.

### Task 1: Add the Nginx performance contract

**Files:**
- Create: `deploy/v78-public/nginx.conf`
- Test: `tests/v78-public-nginx-performance.test.js`

- [x] Write the failing contract test.
- [ ] Add gzip directives and an asset-specific buffered proxy location.
- [ ] Run the contract test and Nginx syntax check.

### Task 2: Validate and package the patch

**Files:**
- Modify: `deploy/v78-public/nginx.conf`

- [ ] Run `git diff --check`.
- [ ] Commit the isolated performance patch.
- [ ] Record the exact commit and config checksum for deployment.

### Task 3: Deploy only the Nginx change when host access is available

**Files:**
- Remote: `deploy/v78-public/nginx.conf`

- [ ] Back up the remote config with a timestamp.
- [ ] Replace the config and recreate only the Nginx service.
- [ ] Verify `Content-Encoding: gzip`, `/api/build-info`, and public response timing.
