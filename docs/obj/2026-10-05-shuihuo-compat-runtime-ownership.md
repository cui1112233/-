# Shuihuo compatibility runtime ownership

Date: 2026-10-06. Classification: `required`. This is an ownership decision, not approval to migrate or retire the service.

## Evidence and limits

The coordinating task supplied read-only ECS evidence: public Nginx proxies application requests only to `v88-node:3000`; Node runtime declares `QIANTIE_SHUIHUO_COMPAT_BASE_URL`; the retained compatibility container exposes internal ports 4000 and 4100. Exposed ports do not establish active listeners. This task did not connect to ECS or change traffic.

Tracked `deploy/v88-public/nginx.conf` agrees with the Node ingress boundary. Tracked Compose binds the compatibility target to `http://shuihuo-compat:4100`, exposes 4100 without host publication, and retains an isolated compatibility database and object volume. Manifest `publicExposure` records source Compose; `observedRuntimeExposure` records the supplied runtime port evidence separately.

No accessible Nginx access log was found in the supplied inspection. **No 24-hour observation occurred.** Route counts and window duration are unknown, not zero. Public traffic frequency, internal-call frequency and legacy image build provenance remain unverified.

## Contract ownership

| Public contract | Owner chain | Replacement / rollback requirement |
| --- | --- | --- |
| Remaining methods under `/api/shuihuo-production/*` | Nginx → Node authentication/preset transforms → signed compatibility API | Replace every forwarded method/path, maintain account isolation, presets, persisted state and object readback; restore prior exact Node SHA plus compatibility image/database/objects and recheck signed forwarding and authenticated writes/readback. |
| `GET /api/platform-projects`, Shuihuo entries | Nginx → Node aggregate → signed `GET /api/shuihuo-production/projects` | Preserve account-scoped project records, IDs, timestamps/navigation and unavailable-source semantics; rollback rechecks both aggregate and authenticated existing-project listing. |

`routes/shuihuo-production.js` forwards remaining requests after Node's `/models` and `/preset-slots` handlers. `app.js` mounts local-executor-artifacts and giant-material executor bridges before that router. Those earlier handlers are not evidence of compatibility ownership. The catch-all means this document cannot claim a complete list of live legacy endpoints; route-by-route enumeration is a mandatory replacement gate.

For applicable AI calls, Node also signs `PUT /api/shuihuo-production/account-ai-config` before forwarding the request. This internal dependency must be replaced and observed; Nginx ingress counts alone cannot establish its absence. `routes/platform-projects.js` shares the compatibility URL resolver, so replacing the workbench bridge alone leaves a caller.

## Retirement gate

Keep `required` until a V88 source-owned implementation proves equivalent Node behavior for each method/path, including AI config sync, persisted database state, account isolation, presets and object readback. Enumerate forwarded paths and compare successful, unauthorized, missing-project and upstream-failure behavior. Preserve database/object backups, retained image identity and previous stable exact Node SHA; rehearse rollback with authenticated existing-project read/write and media readback.

Then collect a complete **24-hour sanitized traffic observation**, recording UTC start/end, normalized method/route, upstream owner and counts. Include internal Node compatibility calls; exclude IPs, authorization headers, cookies, query text and bodies. Record nonzero routes explicitly. A complete window with no remaining route **and** no internal dependency is required before `retire`; missing logs cannot satisfy the gate. `replace-with-node` requires a concrete replacement implementation and contract proof before cutover.

## Local verification

`tests/v88-shuihuo-compat-boundary.test.js` first failed because classification was absent. It validates explicit ownership, nonempty gates and truthful missing-observation metadata, then executes real Node forwarding and aggregation against a loopback HTTP fixture that rejects incorrect signed bridge requests. This proves the local request boundary only; the fixture does not prove compatibility database persistence, public authentication, provider execution, object readback, 24-hour traffic or live rollback. Those remain gates above.

Run with repository dependencies available: `node --test tests/v88-shuihuo-compat-boundary.test.js`. In the isolated checkout dependencies were supplied through `NODE_PATH` from the primary checkout; no dependency files or production code changed.
