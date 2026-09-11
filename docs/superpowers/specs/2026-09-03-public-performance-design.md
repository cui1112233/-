# Public Performance Hardening Design

**Goal:** Reduce first-load and route-switch latency for the existing public V78 stack without changing application behavior or switching production to V88.

**Scope:** Nginx response compression and asset proxy behavior only. Node, Go, MySQL, persistent volumes, routes, and application data remain unchanged.

**Design:** Enable gzip for browser text assets, add a dedicated `/assets/` proxy location with response buffering and normal keep-alive semantics, and remove the global WebSocket upgrade headers. The general proxy keeps the existing long read timeout and upload size so long-running API and upload behavior is preserved.

**Verification:** A Node contract test checks the Nginx directives; a local Nginx config test checks syntax when the Nginx binary is available; after deployment, public headers must include `Content-Encoding: gzip` for JavaScript and the public build-info endpoint must remain unchanged.

**Rollout boundary:** The production host must be backed up before replacing its Nginx config. Only the Nginx container is recreated/reloaded; application containers and data volumes are not changed.
