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
- [x] Add gzip directives and an asset-specific buffered proxy location.
- [x] Run the contract test and Nginx syntax check.

### Task 2: Validate and package the patch

**Files:**
- Modify: `deploy/v78-public/nginx.conf`

- [x] Run `git diff --check`.
- [x] Commit the isolated performance patch.
- [x] Record the exact commit and config checksum for deployment.

### Task 3: Deploy only the Nginx change when host access is available

**Files:**
- Remote: `deploy/v78-public/nginx.conf`

- [x] Back up the remote config with a timestamp.
- [x] Replace the config and recreate only the Nginx service.
- [x] Verify `Content-Encoding: gzip`, `/api/build-info`, and public response timing.

## Deployment Evidence

- V88 commit: `55eb9a8f` (`perf: harden public asset delivery`).
- Remote backup: `/opt/qiantie/v78/deploy/v78-public/nginx.conf.bak.20260903133131`.
- Remote config SHA: `ad2ed61ec1e87618299e60d641257d74f869d85747db305044181835ca8626cf`.
- Remote `nginx -t`: passed; only `v78-public-nginx-1` was recreated.
- Public `/api/build-info`: unchanged at `v78.3.0.3-remote-workbench-20260819-r1`.
- Public shared JS transfer: approximately 180 KB compressed, 1.4-2.6 seconds in repeated checks.
