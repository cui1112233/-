# 巨量素材单次导入队列去重 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent one Giant Material import-modal submission from reading or registering the same resolved platform book more than once.

**Architecture:** Retain existing input-ID normalization. Add a pure, per-run platform-book claim helper in the queue module. The modal creates one claim set for each `executeQueue` call, claims the selected resolved book before executor/OCR or intake, and marks later matches skipped. No persistent data is consulted, so history remains allowed.

**Tech Stack:** React, ES modules, Node built-in test runner, V12 Batch Factory bridge.

## Global Constraints

- Canonical source is Git `v88`; implement only in the isolated `codex/giant-material-id-dedup` worktree.
- A duplicate is the same normalized `platformBookId` within one `executeQueue` call, never a matching title or historical record.
- A duplicate must be skipped before OCR, intake creation, and production automation.
- Do not alter MySQL schema, existing historical books, OCR executor contracts, or `allowDuplicate` semantics.
- Release only changed Node/frontend runtime through the approved incremental path after Git merge and exact-SHA verification.

---

### Task 1: Add a pure per-submission platform-book claim contract

**Files:**
- Modify: `frontend/src/user/pages/shuihuo/batchFactoryGiantMaterialQueue.js`
- Test: `frontend/src/user/pages/shuihuo/batchFactoryGiantMaterialQueue.test.js`

**Interfaces:**
- Produces: `createGiantMaterialPlatformBookClaims()` with `claim(book)` returning `{ accepted, platformBookId, duplicateOfMaterialId }`.
- Consumes: `platformBookId` or legacy `bookId`, plus the source `giantMaterialId` only for user feedback.

- [ ] **Step 1: Write the failing test**

```js
test('claims a resolved platform book only once per submission regardless of title', () => {
  const claims = createGiantMaterialPlatformBookClaims();
  assert.deepEqual(claims.claim({ platformBookId: '748725', title: '旧标题', giantMaterialId: '7689285397448523826' }), {
    accepted: true, platformBookId: '748725', duplicateOfMaterialId: ''
  });
  assert.deepEqual(claims.claim({ bookId: '748725', title: '新标题', giantMaterialId: '7613606077155459091' }), {
    accepted: false, platformBookId: '748725', duplicateOfMaterialId: '7689285397448523826'
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test frontend/src/user/pages/shuihuo/batchFactoryGiantMaterialQueue.test.js`

Expected: FAIL because `createGiantMaterialPlatformBookClaims` is not exported.

- [ ] **Step 3: Write the minimal implementation**

```js
export function createGiantMaterialPlatformBookClaims() {
  const ownerByBookID = new Map();
  return { claim(book = {}) {
    const platformBookId = text(book.platformBookId || book.bookId);
    const giantMaterialId = text(book.giantMaterialId);
    const duplicateOfMaterialId = ownerByBookID.get(platformBookId) || '';
    if (platformBookId && !duplicateOfMaterialId) ownerByBookID.set(platformBookId, giantMaterialId);
    return { accepted: Boolean(platformBookId) && !duplicateOfMaterialId, platformBookId, duplicateOfMaterialId };
  } };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test frontend/src/user/pages/shuihuo/batchFactoryGiantMaterialQueue.test.js`

Expected: PASS with all queue tests green.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/user/pages/shuihuo/batchFactoryGiantMaterialQueue.js frontend/src/user/pages/shuihuo/batchFactoryGiantMaterialQueue.test.js
git commit -m "feat(giant): claim resolved book IDs per import queue"
```

### Task 2: Skip duplicate resolved books before OCR and show the reason

**Files:**
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryGiantMaterialImportModal.jsx`
- Modify: `frontend/src/user/pages/shuihuo/BatchFactoryGiantMaterialImportModal.source.test.js`
- Test: `frontend/src/user/pages/shuihuo/batchFactoryGiantMaterialQueue.test.js`

**Interfaces:**
- Consumes: `createGiantMaterialPlatformBookClaims()` from Task 1.
- Produces: skipped result `{ status: 'skipped', duplicateReason: 'same_submission_platform_book', duplicateOfMaterialId }` before executor creation.

- [ ] **Step 1: Write the failing source-contract test**

```js
test('giant import claims a resolved book before it dispatches OCR', () => {
  assert.match(source, /createGiantMaterialPlatformBookClaims/);
  assert.match(source, /duplicateReason:\s*'same_submission_platform_book'/);
  assert.match(source, /claims\.claim\(/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test frontend/src/user/pages/shuihuo/BatchFactoryGiantMaterialImportModal.source.test.js`

Expected: FAIL because the modal does not import or use the claim helper.

- [ ] **Step 3: Write the minimal modal integration**

Create claims once per `executeQueue` call and pass it to `processItem`. After `selectGiantMaterialBook` returns a chosen book, before checking executor availability or creating a placeholder, call the helper with the selected book and `item.id`. If it returns false, return the skipped result above. In `queueDetail`, distinguish this outcome from the existing current-batch same-material-ID message by saying the material resolved to a book already selected in this submission.

- [ ] **Step 4: Run focused verification**

Run: `node --test frontend/src/user/pages/shuihuo/batchFactoryGiantMaterialQueue.test.js frontend/src/user/pages/shuihuo/BatchFactoryGiantMaterialImportModal.source.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/user/pages/shuihuo/BatchFactoryGiantMaterialImportModal.jsx frontend/src/user/pages/shuihuo/BatchFactoryGiantMaterialImportModal.source.test.js
git commit -m "fix(giant): skip duplicate resolved books in one submission"
```

### Task 3: Build, merge, and release exact source SHA

**Files:**
- No new source files expected.

- [ ] **Step 1: Run full affected checks**

Run: `node --test frontend/src/user/pages/shuihuo/batchFactoryGiantMaterialQueue.test.js frontend/src/user/pages/shuihuo/BatchFactoryGiantMaterialImportModal.source.test.js frontend/src/user/pages/shuihuo/batchFactoryGiantMaterialImport.test.js && npm run build --prefix frontend`

Expected: all tests pass and frontend build exits 0.

- [ ] **Step 2: Merge exact branch head to `v88` and push**

```bash
git fetch origin v88
git rebase origin/v88
git checkout v88
git merge --ff-only codex/giant-material-id-dedup
git push origin v88
```

- [ ] **Step 3: Incrementally release only updated Node/frontend runtime**

Use the approved direct release path for the exact pushed SHA. Preserve MySQL, Redis, Go API, Browser Worker, Docker networks, volumes, and existing batch data. Record the prior SHA and verify rollback guard before cutover.

- [ ] **Step 4: Verify the runtime boundary**

Verify production build-info exact SHA and the authenticated import UI. Submit a safe pair resolving to one `platformBookId`; prove one item is skipped before OCR-job creation and no second book record is created. If no safe fixture exists, do not create paid jobs; report targeted unit/build/runtime identity evidence and leave provider-bound proof pending.
