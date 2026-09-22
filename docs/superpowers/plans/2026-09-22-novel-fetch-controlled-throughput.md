# Novel Fetch Controlled Throughput Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Novel Fetch moving under normal batch load while preventing retries and concurrent accounts from exhausting the public Node CPU.

**Architecture:** Keep the existing persistent V2 queue, but route every original-fetch, AI-rewrite, and web-submit operation through one process-wide stage controller. The controller enforces fixed global limits, applies hysteresis-based load backpressure before starting new work, and reports capacity to the V2 queue status. Retry payloads carry a stable per-owner/per-book/per-stage/version key; the queue accepts it once while active and preserves normal bounded retry/backoff behavior.

**Tech Stack:** Node.js CommonJS, `node:test`, existing V2 Novel Fetch queue and static workbench JavaScript.

**Spec:** `docs/superpowers/specs/2026-09-22-novel-fetch-throughput-design.md`

## Global Constraints

- Work only on V88; never change `master`, V78 behavior, user task data, 121 credentials, or the Browser Worker security boundary.
- Global defaults are fetch `2`, rewrite `2`, submit `1`; the existing per-book AI-version order remains unchanged.
- Stop issuing new work when normalized one-minute load is at or above `0.75`; resume only once it is at or below `0.60`.
- A repeated retry is idempotent for `owner + book + stage + target versions` while queued, waiting, or running.
- Existing completed originals and AI versions remain reusable; retry only starts at the earliest failed stage.
- No production code before a focused failing test; do not run real AI or 121 actions during verification.

## Review Focus

- Two users submit a fetch batch at once: combined active fetch count never exceeds two. Covered in Task 2.
- Load is between 0.60 and 0.75 after a pause: no new work resumes until it reaches the lower threshold. Covered in Task 2.
- Double-clicking retry on an AI2 failure: one active queue item exists and AI1 remains untouched. Covered in Task 3.
- A queue item resumes after an interrupted process: a stale running lease is recoverable without duplicating active work. Covered in Task 3.
- Configuration or task polling fails/aborts: UI leaves loading state and only one runtime request/polling timer exists. Covered in Task 4.

---

### Task 1: Normalize safe throughput defaults and effective caps

**Files:**
- Modify: `lib/novel-fetch-workshop/config.js:10-42`
- Modify: `lib/novel-fetch-workshop/workflow-policy.js:1-83`
- Modify: `lib/novel-fetch-workshop/runner.js:1-20,185-190,289-294`
- Create: `lib/novel-fetch-workshop/workflow-policy.test.js`

**Interfaces:**
- Produces `effectiveFetchConcurrency(fetchConfig)` and `effectiveRewriteConcurrency(aiConfig)`.
- Both return integers in `[1, 2]`; `force_serial_batch` still returns `1`.

- [ ] **Step 1: Write failing policy tests**

```js
const { effectiveFetchConcurrency, effectiveRewriteConcurrency } = require('./workflow-policy');

test('effective pools cap legacy high concurrency at two', () => {
  assert.equal(effectiveFetchConcurrency({ concurrency: 6 }), 2);
  assert.equal(effectiveRewriteConcurrency({ max_concurrency: 6 }), 2);
});

test('serial rewrite remains one even when configured higher', () => {
  assert.equal(effectiveRewriteConcurrency({ max_concurrency: 6, force_serial_batch: true }), 1);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test lib/novel-fetch-workshop/workflow-policy.test.js`

Expected: FAIL because `effectiveFetchConcurrency` is not exported and rewrite still returns six.

- [ ] **Step 3: Implement the smallest safe normalization**

```js
const FETCH_CONCURRENCY_LIMIT = 2;
const REWRITE_CONCURRENCY_LIMIT = 2;

function effectiveFetchConcurrency(fetchConfig = {}) {
  return Math.min(FETCH_CONCURRENCY_LIMIT, Math.max(1, Math.floor(Number(fetchConfig.concurrency) || 1)));
}

function effectiveRewriteConcurrency(aiConfig = {}) {
  if (aiConfig.force_serial_batch === true) return 1;
  return Math.min(REWRITE_CONCURRENCY_LIMIT, Math.max(1, Math.floor(Number(aiConfig.max_concurrency) || 1)));
}
```

Set default `fetch.concurrency` and `ai.max_concurrency` to `2`, export the constants/helpers, and make the runner call `effectiveFetchConcurrency(config.fetch)` instead of reading raw fetch concurrency.

- [ ] **Step 4: Verify GREEN**

Run: `node --test lib/novel-fetch-workshop/workflow-policy.test.js test/novel-fetch-progressive-queue.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/novel-fetch-workshop/config.js lib/novel-fetch-workshop/workflow-policy.js lib/novel-fetch-workshop/runner.js lib/novel-fetch-workshop/workflow-policy.test.js
git commit -m "feat(novel-fetch): cap local stage concurrency"
```

### Task 2: Add the shared global stage controller and CPU backpressure

**Files:**
- Create: `lib/novel-fetch-workshop/throughput-controller.js`
- Create: `lib/novel-fetch-workshop/throughput-controller.test.js`
- Modify: `lib/novel-fetch-workshop/runner.js:81-414`
- Modify: `lib/novel-fetch-workshop/v2-batch-executor.js:151-214`
- Modify: `lib/novel-fetch-workshop/v2-runtime.js`
- Modify: `lib/novel-fetch-workshop/v2-api-contract.js:185-280`

**Interfaces:**
- `createNovelFetchThroughputController({ limits, readLoad, sleep })` returns `{ run(stage, work, options), snapshot() }`.
- `run` accepts only `fetch`, `rewrite`, or `submit`, waits for both capacity and a safe load sample, and invokes `work` exactly once.
- `snapshot()` returns `{ limits, active, waiting, paused, load, pauseAt: 0.75, resumeAt: 0.60 }`.
- `runNovelFetchBatch({... throughput })` wraps `tasks.fetchOriginal`, each per-book `generateAiVersions`, and each `submit` group through `throughput.run`.

- [ ] **Step 1: Write failing controller tests**

```js
test('shares a fetch cap across concurrent callers', async () => {
  let active = 0; let peak = 0; let release;
  const gate = new Promise(resolve => { release = resolve; });
  const controller = createNovelFetchThroughputController({ limits: { fetch: 2 }, readLoad: () => 0 });
  const jobs = [1, 2, 3].map(() => controller.run('fetch', async () => {
    peak = Math.max(peak, ++active); await gate; active -= 1;
  }));
  await waitUntil(() => controller.snapshot().active.fetch === 2);
  assert.equal(peak, 2); assert.equal(controller.snapshot().waiting.fetch, 1);
  release(); await Promise.all(jobs);
});

test('keeps acquisition paused until load falls below the resume threshold', async () => {
  let load = 0.8;
  const controller = createNovelFetchThroughputController({ readLoad: () => load, sleep: async () => {} });
  const pending = controller.run('rewrite', async () => 'ran');
  assert.equal(controller.snapshot().paused, true);
  load = 0.7; await Promise.resolve(); assert.equal(controller.snapshot().paused, true);
  load = 0.6; assert.equal(await pending, 'ran');
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test lib/novel-fetch-workshop/throughput-controller.test.js`

Expected: FAIL because the controller module does not exist.

- [ ] **Step 3: Implement controller and runner integration**

Use FIFO waiter queues per stage. `readLoad` returns a normalized ratio; production default calculates `os.loadavg()[0] / Math.max(1, os.availableParallelism())`, while tests inject deterministic values. Once any sample reaches `0.75`, set `paused`; only clear it after a later sample is `<= 0.60`. Check `options.shouldStop()` before allocating a slot and reject with a non-retryable `STOP_REQUESTED` error if true.

In `v2-runtime.js`, construct one module-level controller so all owners share it. Pass it through the batch executor to the runner. Include `throughput: controller.snapshot()` in `/process/queue/status` and `/tasks/batch-retry` responses without changing existing queue fields.

- [ ] **Step 4: Add runner integration RED tests, then GREEN implementation**

```js
test('runner uses the supplied global controller for fetch, rewrite and submit', async () => {
  const stages = [];
  const throughput = { run: async (stage, work) => { stages.push(stage); return work(); } };
  await runNovelFetchBatch({ /* one task, auto fetch/rewrite/confirmed submit */, throughput });
  assert.deepEqual(stages, ['fetch', 'rewrite', 'submit']);
});
```

Run: `node --test test/novel-fetch-progressive-queue.test.js lib/novel-fetch-workshop/throughput-controller.test.js`

Expected RED: the runner does not call the controller. Then implement the three wraps and rerun until PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/novel-fetch-workshop/throughput-controller.js lib/novel-fetch-workshop/throughput-controller.test.js lib/novel-fetch-workshop/runner.js lib/novel-fetch-workshop/v2-batch-executor.js lib/novel-fetch-workshop/v2-runtime.js lib/novel-fetch-workshop/v2-api-contract.js test/novel-fetch-progressive-queue.test.js
git commit -m "feat(novel-fetch): add global throughput backpressure"
```

### Task 3: Make retries idempotent and recover stale active work

**Files:**
- Modify: `lib/novel-fetch-workshop/task-ops.js:320-372`
- Modify: `lib/novel-fetch-workshop/queue.js:1-183`
- Modify: `lib/novel-fetch-workshop/queue-store.js:1-160`
- Modify: `lib/novel-fetch-workshop/v2-api-contract.js:219-238`
- Create: `lib/novel-fetch-workshop/queue.test.js`
- Modify: `test/novel-fetch-retry-stage.test.js`

**Interfaces:**
- `retryIdempotencyKey(owner, meta, stage, versions)` returns a stable non-secret string.
- `queue.start(owner, payloads)` returns normal queue status plus `accepted` and `deduplicated` counts.
- Running items persist `leaseExpiresAt`; queue-store converts only expired running leases to queued during `load(owner)`.

- [ ] **Step 1: Write failing retry/lease tests**

```js
test('same retry key is accepted once while the first item is active', async () => {
  const queue = createNovelFetchQueue({ store, execute: async () => gate });
  const first = queue.start('alice', [{ retry_idempotency_key: 'alice:1002:rewrite:ai2' }]);
  const second = queue.start('alice', [{ retry_idempotency_key: 'alice:1002:rewrite:ai2' }]);
  assert.equal(first.accepted, 1);
  assert.equal(second.deduplicated, 1);
  assert.equal(queue.status('alice').items.length, 1);
});

test('expired running lease is requeued but a live lease stays running', () => {
  const state = store.load('alice');
  assert.equal(state.items.find(item => item.id === 'stale').state, 'queued');
  assert.equal(state.items.find(item => item.id === 'live').state, 'running');
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test lib/novel-fetch-workshop/queue.test.js test/novel-fetch-retry-stage.test.js`

Expected: FAIL because active duplicate keys are both appended and no lease is stored.

- [ ] **Step 3: Implement stable retry identity and leases**

Generate retry keys only from owner, book id, retry stage, and sorted target/retry-submit versions; never include input text, credentials, or timestamps. Before append, compare the key to queued, waiting-retry, and running items; return duplicate metadata rather than appending. On `running`, set a lease expiry; refresh it when `control.report` runs; queue-store requeues only an expired lease on load. Keep existing retry count and exponential delay unchanged.

Return `{ retried: accepted, deduplicated, retry_stage_counts, tasks }` from the V2 retry route. Do not silently reset completed stages.

- [ ] **Step 4: Verify GREEN**

Run: `node --test lib/novel-fetch-workshop/queue.test.js test/novel-fetch-retry-stage.test.js test/novel-fetch-progressive-queue.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/novel-fetch-workshop/task-ops.js lib/novel-fetch-workshop/queue.js lib/novel-fetch-workshop/queue-store.js lib/novel-fetch-workshop/v2-api-contract.js lib/novel-fetch-workshop/queue.test.js test/novel-fetch-retry-stage.test.js
git commit -m "feat(novel-fetch): deduplicate retries with queue leases"
```

### Task 4: Finish UI cancellation, capacity visibility, and script uniqueness

**Files:**
- Modify: `public/batch-rewrite/v78-novel-fetch-v2-runtime.js:1-128`
- Modify: `frontend/public/batch-rewrite/app.js:80-170,2840-2900`
- Modify: `public/batch-rewrite/v78-novel-fetch-v2.js:1-260`
- Modify: `lib/novel-fetch-workshop/v2-page.js:1-92`
- Modify: `test/novel-fetch-performance.test.js`
- Modify: `test/novel-fetch-retry-ui-progress.test.js`

**Interfaces:**
- Runtime `request(path, options)` creates a request controller only for a new in-flight request and exposes `cancel(key)`.
- Retry response renders `retried`, `deduplicated`, per-stage totals, and server `throughput` capacity.
- `injectNovelFetchV2Script(html)` emits each managed script `id` at most once.

- [ ] **Step 1: Write failing static and behavior tests**

```js
test('runtime can abort one outstanding config request and clears its in-flight key', async () => {
  const request = runtime.request('/config');
  runtime.cancel(runtime.requestKey('/config'));
  await assert.rejects(request, /取消|Abort/);
  assert.equal(runtime.inFlight.has(runtime.requestKey('/config')), false);
});

test('V2 injection contains each managed script id exactly once', () => {
  const html = injectNovelFetchV2Script(sourceWithDuplicateTags);
  assert.equal((html.match(/qiantie-novel-fetch-runtime/g) || []).length, 1);
  assert.equal((html.match(/qiantie-novel-fetch-task-visibility/g) || []).length, 1);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test test/novel-fetch-performance.test.js test/novel-fetch-retry-ui-progress.test.js`

Expected: FAIL because runtime has no cancellation registry, duplicate existing managed tags are not normalized, and retry output lacks capacity/deduplication text.

- [ ] **Step 3: Implement only the required UI behavior**

Store `AbortController` by request key in the runtime and clear it in `finally`; preserve the existing single-flight promise behavior. Cancel previous config loading only when a newer config load replaces it, show a stable `请求已取消` or timeout state, and never leave the loading label unchanged. Normalize existing managed script tags by `id` before appending tags. In the retry message, show `已加入`, `已在队列`, stage counts, and active/limit values from the response; retain the existing five-second polling and stop it when no task remains active.

- [ ] **Step 4: Verify GREEN**

Run: `node --test test/novel-fetch-performance.test.js test/novel-fetch-retry-ui-progress.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add public/batch-rewrite/v78-novel-fetch-v2-runtime.js public/batch-rewrite/v78-novel-fetch-v2.js frontend/public/batch-rewrite/app.js lib/novel-fetch-workshop/v2-page.js test/novel-fetch-performance.test.js test/novel-fetch-retry-ui-progress.test.js
git commit -m "feat(novel-fetch): expose controlled retry capacity"
```

### Task 5: Build, regression-test, and prepare the V88-only release

**Files:**
- Modify only generated equivalents required by this repository’s Node static serving: `frontend/dist/batch-rewrite/app.js`, `frontend/dist/batch-rewrite/index.html`, and any changed V2 helper under `frontend/dist/batch-rewrite/`.
- Modify: `docs/superpowers/plans/2026-09-22-novel-fetch-controlled-throughput.md` to mark completed checkboxes.

- [ ] **Step 1: Run the complete Novel Fetch regression group**

Run: `node --test test/novel-fetch-*.test.js tests/novel-fetch-*.test.js lib/novel-fetch-workshop/*.test.js`

Expected: PASS; separately record any unrelated baseline failures rather than masking them.

- [ ] **Step 2: Build the frontend and synchronize only changed batch-rewrite assets**

Run: `npm --prefix frontend run build`

Expected: exit code 0. Inspect `git diff -- frontend/dist/batch-rewrite` and retain only assets corresponding to Task 4; do not include unrelated generated assets.

- [ ] **Step 3: Verify public-release package invariants locally**

Run: `git diff --check && node --check lib/novel-fetch-workshop/throughput-controller.js && node --check lib/novel-fetch-workshop/queue.js`

Expected: all commands exit 0.

- [ ] **Step 4: Commit implementation and tests**

```bash
git add docs/superpowers/plans/2026-09-22-novel-fetch-controlled-throughput.md frontend/dist/batch-rewrite lib/novel-fetch-workshop public/batch-rewrite frontend/public/batch-rewrite test tests
git commit -m "feat(novel-fetch): control batch throughput and retries"
```

- [ ] **Step 5: Request release authorization separately**

Report the exact commit and local evidence. Do not deploy, start real AI work, or submit to 121 until the user explicitly authorizes the V88 Node-only public release.

## Self-review

- Spec coverage: Tasks 1–2 cover bounded fetch/rewrite/submit capacity and CPU hysteresis; Task 3 covers retry identity, stage preservation, and recovery; Task 4 covers request cancellation, visible queue state, polling, and one-time scripts; Task 5 covers generated assets and release boundaries.
- Placeholder scan: no TBD/TODO items; every task names exact files, tests, commands, and interfaces.
- Type consistency: all production callers use `throughput.run(stage, work, options)` and retry records use `retry_idempotency_key`.
- Review Focus coverage: each listed risk has a named test in its owning task.
