# Batch Automation Direct Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make scheduled giant-material batches use the existing book-store source retrieval before OCR, then run the existing full-submit and 121-confirmation chain without a local executor.

**Architecture:** Move V12's safe direct-source cleanup and refill into a shared server module. Add it to the V11 automation adapter, and invoke it before OCR reconciliation in both preflight and individual book advancement.

**Tech Stack:** Node.js CommonJS, Express, Go-backed V11 API bridge, Node test runner.

## Global Constraints

- Do not overwrite a saved source; retain the expected-revision fill-only source API.
- Preserve `full_submit`: only a confirmed 121 receipt produces `uploaded`.
- Direct source fetching cannot require a browser or a local OCR executor.
- A failed book frees only its own slot; do not alter other books or work data.
- Do not commit generated `frontend/dist` artifacts.

---

### Task 1: Extract the shared direct-source refill primitive

**Files:**
- Create: `lib/batch-factory-v11/source-refill.js`
- Modify: `routes/batch-factory-v12.js:10-261`
- Test: `routes/batch-factory-v12.test.js:260-325`

**Interfaces:**
- Consumes: `book`, `platforms`, `fetchDirectOriginal({ bookId, platformId, maxTxt })`, and `captureSource(payload)`.
- Produces: `refillMissingBatchFactoryBookSource(input) -> Promise<{ fetched: { length, attempts, bookinfo } }>`.

- [ ] **Step 1: Write the failing shared-module test**

```js
const { refillMissingBatchFactoryBookSource } = require('../lib/batch-factory-v11/source-refill');

const writes = [];
const result = await refillMissingBatchFactoryBookSource({
  book: { id: 'book-1', bookId: '101', platform: '七猫', sourceText: '', revision: 4, sourceMetadata: { sourceMode: 'giant_material', contentPending: true } },
  platforms: [{ id: '3', name: '七猫' }],
  fetchDirectOriginal: async () => ({ text: '修改中\\n书城正文', attempts: 2 }),
  captureSource: async payload => { writes.push(payload); return { ok: true }; }
});
assert.equal(result.fetched.length, 4);
assert.equal(writes[0].sourceMetadata.originalReadVia, 'bookstore');
assert.equal(writes[0].sourceMetadata.contentPending, false);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test routes/batch-factory-v12.test.js`

Expected: FAIL because `source-refill.js` is absent.

- [ ] **Step 3: Implement the shared module**

```js
// lib/batch-factory-v11/source-refill.js
function cleanBatchFactorySourceText(value) { /* move current state-line and punctuation filtering unchanged */ }
function resolveWorkshopPlatformId(raw, platforms = []) { /* move current numeric, exact-name, and unique-prefix mapping unchanged */ }
async function refillMissingBatchFactoryBookSource(input) { /* move current V12 fill-only retrieval and expectedRevision write unchanged */ }
module.exports = { cleanBatchFactorySourceText, resolveWorkshopPlatformId, refillMissingBatchFactoryBookSource };
```

Import these helpers from V12 and re-export them from `routes/batch-factory-v12.js` so the public route API does not change.

- [ ] **Step 4: Run the V12 tests to verify they pass**

Run: `node --test routes/batch-factory-v12.test.js`

Expected: PASS; platform mapping, cleanup, and atomic source fills remain unchanged.

- [ ] **Step 5: Commit the primitive**

```bash
git add lib/batch-factory-v11/source-refill.js routes/batch-factory-v12.js routes/batch-factory-v12.test.js
git commit -m "refactor(batch-factory): share direct source refill"
```

### Task 2: Expose direct source retrieval to the automation adapter

**Files:**
- Modify: `routes/batch-factory-v11.js:1-30,1960-2060`
- Test: `routes/batch-factory-v11.test.js`

**Interfaces:**
- Consumes: Task 1's `refillMissingBatchFactoryBookSource`, `createMySQLWorkshopStore`, and `v11JSONRequest`.
- Produces: `adapter.fetchDirectSource({ owner, isOwner, batch, book }) -> Promise<{ state: 'succeeded', characters: number } | { state: 'failed', error: string }>`.

- [ ] **Step 1: Write the failing adapter test**

```js
const direct = await routerAutomationAdapter.fetchDirectSource({
  owner: 'user', isOwner: false, batch: { id: 'batch-1' },
  book: { id: 'book-1', bookId: '101', platform: '3', sourceText: '', revision: 1, sourceMetadata: { sourceMode: 'giant_material' } }
});
assert.deepEqual(direct, { state: 'succeeded', characters: 4 });
assert.equal(sourceWrite.pathname, '/api/batch-factory/v11/batches/batch-1/books/book-1/source');
```

- [ ] **Step 2: Run the adapter test to verify it fails**

Run: `node --test routes/batch-factory-v11.test.js`

Expected: FAIL because `fetchDirectSource` is not present.

- [ ] **Step 3: Implement the adapter**

```js
fetchDirectSource: async ({ owner: username, isOwner, batch, book }) => {
  try {
    const account = { username, isOwner };
    const store = createMySQLWorkshopStore({ targetBaseUrl: options.targetBaseUrl, bridgeSecret: upstreamOptions.bridgeSecret, account });
    const result = await refillMissingBatchFactoryBookSource({
      book,
      platforms: store.getPlatforms?.() || [],
      fetchDirectOriginal: input => store.fetchDirectOriginal(input),
      captureSource: payload => v11JSONRequest({ username, isOwner, method: 'PUT', pathname: `/api/batch-factory/v11/batches/${encodeURIComponent(batch.id)}/books/${encodeURIComponent(book.id)}/source`, payload, ...upstreamOptions })
    });
    return { state: 'succeeded', characters: Number(result?.fetched?.length || 0) };
  } catch (error) {
    return { state: 'failed', error: String(error?.message || '书城正文直取失败') };
  }
}
```

- [ ] **Step 4: Run router tests to verify they pass**

Run: `node --test routes/batch-factory-v11.test.js routes/batch-factory-v12.test.js`

Expected: PASS; the owner-scoped Go source write retains its expected revision.

- [ ] **Step 5: Commit the adapter**

```bash
git add routes/batch-factory-v11.js routes/batch-factory-v11.test.js
git commit -m "feat(batch-factory): let automation refill source directly"
```

### Task 3: Resolve direct source before OCR and release failed books

**Files:**
- Modify: `lib/batch-factory-v11/automation-orchestrator.js:600-760,970-1005`
- Modify: `test/batch-factory-automation.test.js:510-620`

**Interfaces:**
- Consumes: `adapter.fetchDirectSource` and existing `adapter.reconcileGiantMaterialSource`.
- Produces: `resolveDirectSource(job, batch, book) -> Promise<boolean>`; `true` means the book was persisted as pending or failed and must not continue in the current tick.

- [ ] **Step 1: Extend the existing failing orchestrator test**

```js
adapter.fetchDirectSource = async ({ book }) => {
  directFetches += 1;
  book.sourceText = '从书城直接获取的完整正文';
  return { state: 'succeeded', characters: book.sourceText.length };
};
await controller.start({ owner: 'user', batchId: batch.id, concurrency: 1, runMode: 'full_submit' });
for (let i = 0; i < 10; i += 1) { await controller.tick(); await wait(); }
assert.equal(directFetches, 1);
assert.equal(status.books[0].stage, 'uploaded');
```

Add a companion case whose direct fetch returns `{ state: 'failed', error: '书城无正文' }`; assert it is `failed/source`, the next valid book is `uploaded`, and no unclaimed OCR task can block the queue.

- [ ] **Step 2: Run the orchestration test to verify it fails**

Run: `node --test test/batch-factory-automation.test.js`

Expected: FAIL because preflight currently fails the giant placeholder before a direct-source call.

- [ ] **Step 3: Implement direct-first resolution**

```js
async function resolveDirectSource(job, batch, book) {
  if (typeof adapter.fetchDirectSource !== 'function') return false;
  const result = object(await adapter.fetchDirectSource({ owner: job.owner, isOwner: job.isOwner, batch, book, job }));
  if (text(result.state).toLowerCase() === 'succeeded') {
    setBook(job, book, { status: 'pending', stage: 'source', message: `正文已从书城获取${Number(result.characters) ? `（${Number(result.characters)} 字）` : ''}，正在进入自动生产`, error: '', retryRequested: false, retryAt: '' });
    await persist();
    return true;
  }
  return false;
}
```

Call it before OCR reconciliation in `advanceBook` and the all-books giant preflight. If direct retrieval failed and there is no active OCR job, save `failed/source` with the direct-read error and continue other books. Retain reconciliation only for a verified live OCR job after direct retrieval has failed.

- [ ] **Step 4: Run automation tests to verify they pass**

Run: `node --test test/batch-factory-automation.test.js`

Expected: PASS; direct-source books bypass OCR, source failures free slots, and confirmed `full_submit` uploads remain `uploaded`.

- [ ] **Step 5: Commit the orchestration change**

```bash
git add lib/batch-factory-v11/automation-orchestrator.js test/batch-factory-automation.test.js
git commit -m "fix(batch-factory): run direct source before OCR"
```

### Task 4: Verify and deploy safely

**Files:**
- Verify: `test/batch-factory-automation.test.js`, `routes/batch-factory-v11.test.js`, `routes/batch-factory-v12.test.js`
- Deploy: existing direct release archive and activation script.

**Interfaces:**
- Consumes: committed source and the existing direct-release process.
- Produces: a public build SHA matching source and a runtime that does not wait for offline OCR before trying direct source.

- [ ] **Step 1: Run targeted tests and build**

Run: `node --test test/batch-factory-automation.test.js routes/batch-factory-v11.test.js routes/batch-factory-v12.test.js && npm run frontend:build`

Expected: PASS; generated frontend assets remain uncommitted.

- [ ] **Step 2: Verify clean source scope before packaging**

Run: `git status --short && git log -4 --oneline`

Expected: only generated frontend artifacts are dirty; no data migration is included.

- [ ] **Step 3: Deploy and check runtime identity**

Use the existing direct deployment with fresh user SSH authorization. Verify build info, Go health, Node running state, and one authenticated runtime-summary request. Do not start/retry books or mutate production data during deploy.

- [ ] **Step 4: Inspect the 38-book batch after its next tick**

Record `uploaded`, `failed/source`, and active counts. A card, HTTP success, or queued upload does not count as upload success; only a confirmed 121 receipt does.

## Plan Self-Review

- Spec coverage: Tasks 1-3 implement direct source, executor independence, per-book failure release, and preserved `full_submit`; Task 4 verifies production behavior and receipts.
- Placeholder scan: no incomplete implementation markers or undefined interfaces remain.
- Type consistency: `fetchDirectSource` uses `state`, `characters`, and `error` consistently between adapter and orchestrator.
