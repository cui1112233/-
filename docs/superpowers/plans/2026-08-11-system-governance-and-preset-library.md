# System Governance and Preset Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persistent accounts, account applications, scoped administration, auditable system preset versions, and safe preset selection APIs to qiantie.

**Architecture:** Keep Express as the only HTTP entry point. Replace the hard-coded account lookup with a JSON-backed account store under `data/system/`, seed the six existing users once, and attach an effective permission set to every authenticated request. Store protected preset bodies only on the server; ordinary clients receive catalog metadata and submit selected IDs, while scoped managers use admin-only endpoints.

**Tech Stack:** Node.js 18+, Express 5, Node built-in `node:test`, React 18, Ant Design, JSON file storage.

---

## File Structure

- Create `app.js`: exports `createApp()` so route integration tests can start a disposable HTTP server.
- Create `lib/account-store.js`: persistent accounts, applications, grants, password hashes, and audit records.
- Create `lib/preset-store.js`: server-only preset catalog, immutable versions, compatibility checks, and selection resolver.
- Create `lib/system-store.js`: JSON read/write helpers rooted at a supplied directory for production and tests.
- Create `routes/applications.js`: public account-application endpoint and applicant status endpoint.
- Create `routes/admin.js`: authenticated account, grant, audit, and preset administration endpoints.
- Create `routes/presets.js`: authenticated metadata catalog and validated selection endpoints for production tools.
- Create `frontend/src/shared/api/admin.js`: client wrappers for administrator operations.
- Create `frontend/src/shared/api/presets.js`: metadata-only preset APIs for user workbenches.
- Create `frontend/src/admin/pages/AccountsPage.jsx`, `PresetLibraryPage.jsx`, and `AuditPage.jsx`.
- Create `frontend/src/shared/components/AccountApplicationModal.jsx`: login-overlay account application flow.
- Modify `server.js`, `lib/shared.js`, `routes/auth.js`, `middleware/auth.js`, `routes/pages.js`, `frontend/src/admin/App.jsx`, `frontend/src/shared/layouts/AdminLayout.jsx`, `frontend/src/shared/layouts/UserLayout.jsx`, `frontend/src/shared/api/auth.js`, and `frontend/src/shared/styles/global.css`.
- Create `tests/account-store.test.js`, `tests/preset-store.test.js`, and `tests/governance-routes.test.js`.

## Task 1: Extract an Express app factory

**Files:**
- Create: `app.js`
- Modify: `server.js`
- Test: `tests/governance-routes.test.js`

- [ ] **Step 1: Write the failing app-factory test**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../app');

test('createApp returns an Express request handler without listening', () => {
  const app = createApp();
  assert.equal(typeof app, 'function');
  assert.equal(app.listening, undefined);
});
```

- [ ] **Step 2: Run the test to verify the missing module failure**

Run: `node --test tests/governance-routes.test.js`

Expected: FAIL with `Cannot find module '../app'`.

- [ ] **Step 3: Move the existing middleware and route mounting into `createApp()`**

```js
// app.js
const express = require('express');
const pagesRouter = require('./routes/pages');
const authRouter = require('./routes/auth');

function createApp() {
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  app.use('/', pagesRouter);
  app.use('/api/login', authRouter);
  app.use((req, res) => res.status(404).json({ error: 'Not found' }));
  return app;
}

module.exports = { createApp };
```

```js
// server.js
const { createApp } = require('./app');
createApp().listen(PORT, HOST, () => {
  console.log(`Server running at http://127.0.0.1:${PORT}`);
});
```

Retain every current static-file and API mount from `server.js` inside `createApp()` before its 404 handler.

- [ ] **Step 4: Run the focused and existing architecture checks**

Run: `node --test tests/governance-routes.test.js && node scripts/validate-multipage-architecture.js && node scripts/validate-react-frontend-architecture.js`

Expected: all commands exit `0` and both validation scripts print `passed.`

- [ ] **Step 5: Commit the isolated factory change**

```bash
git add app.js server.js tests/governance-routes.test.js
git commit -m "refactor: export Express app factory"
```

## Task 2: Add persistent accounts and audit storage

**Files:**
- Create: `lib/system-store.js`
- Create: `lib/account-store.js`
- Modify: `lib/shared.js`
- Test: `tests/account-store.test.js`

- [ ] **Step 1: Write account-store tests with an isolated data directory**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createAccountStore } = require('../lib/account-store');

function tempStore() {
  return createAccountStore({ systemDir: fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-accounts-')) });
}

test('seeds the owner once and never grants owner to another account', () => {
  const store = tempStore();
  store.ensureSeedAccounts({ choushiyiguai: '123456', choushiyiguai1: '123456' });
  assert.equal(store.getAccount('choushiyiguai').isOwner, true);
  assert.throws(() => store.setOwner('choushiyiguai1'), /owner is immutable/);
});

test('writes an audit record for a grant', () => {
  const store = tempStore();
  store.ensureSeedAccounts({ choushiyiguai: '123456', choushiyiguai1: '123456' });
  store.grant('choushiyiguai', 'choushiyiguai1', { capability: 'preset:draft', scope: 'novel-panel' });
  assert.equal(store.listAudit().at(-1).action, 'grant.created');
});
```

- [ ] **Step 2: Run tests to verify the missing store failure**

Run: `node --test tests/account-store.test.js`

Expected: FAIL with `Cannot find module '../lib/account-store'`.

- [ ] **Step 3: Implement atomic JSON state helpers**

```js
// lib/system-store.js
function readJson(filePath, fallback) {
  try {
    return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : fallback;
  } catch {
    return fallback;
  }
}
function writeJsonAtomic(filePath, value) {
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tempPath, filePath);
}
module.exports = { readJson, writeJsonAtomic };
```

Use `data/system/accounts.json`, `applications.json`, `grants.json`, and `audit.json` in production. Validate account names with `/^[a-zA-Z0-9_-]{3,32}$/`; do not use the old `USERS` object as an authorization check after seeding.

- [ ] **Step 4: Implement account records and append-only audit records**

```js
const CAPABILITIES = new Set(['account:review', 'preset:draft', 'preset:publish']);

function effectivePermissions(account, grants) {
  if (account.isOwner) return [{ capability: '*', scope: '*' }];
  return grants.filter(grant => grant.subject === account.username);
}

function appendAudit(actor, action, target, before, after) {
  // append { id, at, actor, action, target, before, after } without exposing hashes
}
```

Hash passwords with `crypto.scryptSync` and verify with `crypto.timingSafeEqual`. `ensureSeedAccounts()` imports the current six hard-coded accounts only when `accounts.json` does not yet exist; it creates `choushiyiguai` with `isOwner: true` and all other seeds with `isOwner: false`.

- [ ] **Step 5: Make user data paths accept active persisted accounts**

Replace `safeUserName()` in `lib/shared.js` with format validation only. Calls that access a user directory remain behind `apiAuth`, which now confirms the account is active through `account-store`.

- [ ] **Step 6: Run unit tests and syntax checks**

Run: `node --test tests/account-store.test.js && node --check lib/system-store.js && node --check lib/account-store.js && node --check lib/shared.js`

Expected: all pass.

- [ ] **Step 7: Commit persistent account storage**

```bash
git add lib/system-store.js lib/account-store.js lib/shared.js tests/account-store.test.js
git commit -m "feat: add persistent account and audit store"
```

## Task 3: Enforce authenticated capability checks

**Files:**
- Modify: `routes/auth.js`
- Modify: `middleware/auth.js`
- Modify: `lib/shared.js`
- Test: `tests/governance-routes.test.js`

- [ ] **Step 1: Add failing authorization cases**

```js
test('ordinary users receive 403 from an account administration route', async () => {
  const response = await request(app).get('/api/admin/accounts').set(auth('choushiyiguai1'));
  assert.equal(response.status, 403);
});

test('a disabled account token no longer authenticates', async () => {
  await disableAccountAsOwner('choushiyiguai1');
  const response = await request(app).get('/api/config').set(auth('saved-token'));
  assert.equal(response.status, 401);
});
```

Use a small local `request(app)` helper built on `node:http`; do not add a test framework dependency solely for HTTP requests.

- [ ] **Step 2: Run the authorization cases**

Run: `node --test tests/governance-routes.test.js`

Expected: FAIL because administration routes and effective permission checks do not exist.

- [ ] **Step 3: Replace token values with session metadata and expose narrow middleware**

```js
function issueSession(username) {
  const token = crypto.randomBytes(32).toString('hex');
  tokenMap.set(token, { username, issuedAt: Date.now() });
  return token;
}

function requireCapability(capability, getScope = () => '*') {
  return (req, res, next) => {
    if (!accountStore.can(req.auth, capability, getScope(req))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}
```

`apiAuth` must set `req.username` and `req.auth`, reject missing, unknown, disabled, or pending accounts, and never trust a role supplied by the client. Login must use `accountStore.verifyPassword()` and return only `token`, `username`, and metadata safe for the current user.

- [ ] **Step 4: Run route tests and existing smoke checks**

Run: `node --test tests/governance-routes.test.js && node --check routes/auth.js && node --check middleware/auth.js && node scripts/validate-multipage-architecture.js`

Expected: all pass.

- [ ] **Step 5: Commit authorization enforcement**

```bash
git add routes/auth.js middleware/auth.js lib/shared.js tests/governance-routes.test.js
git commit -m "feat: enforce account roles and capabilities"
```

## Task 4: Implement account applications and account administration APIs

**Files:**
- Create: `routes/applications.js`
- Create: `routes/admin.js`
- Modify: `app.js`
- Test: `tests/governance-routes.test.js`

- [ ] **Step 1: Add failing application lifecycle tests**

```js
test('an applicant cannot log in before approval', async () => {
  await request(app).post('/api/applications').send({ username: 'writer_01', password: 'secret-123', reason: '小说创作' }).expect(201);
  await request(app).post('/api/login').send({ username: 'writer_01', password: 'secret-123' }).expect(401);
});

test('an account reviewer can approve but cannot grant presets', async () => {
  await grantAsOwner('reviewer', { capability: 'account:review', scope: '*' });
  await request(app).post('/api/admin/applications/writer_01/approve').set(auth('reviewer')).expect(200);
  await request(app).post('/api/admin/grants').set(auth('reviewer')).send({ subject: 'writer_01', capability: 'preset:draft', scope: 'novel-panel' }).expect(403);
});
```

- [ ] **Step 2: Run the lifecycle tests**

Run: `node --test tests/governance-routes.test.js`

Expected: FAIL with missing application and administration routes.

- [ ] **Step 3: Implement public application submission**

```js
router.post('/', (req, res) => {
  const application = accountStore.submitApplication({
    username: req.body?.username,
    password: req.body?.password,
    reason: req.body?.reason
  });
  res.status(201).json({ id: application.id, status: application.status });
});
```

Reject duplicate active usernames, duplicate pending usernames, malformed names, passwords shorter than 8 characters, and blank reasons. Store only a password hash in the application record.

- [ ] **Step 4: Implement protected administrator routes**

```js
router.get('/accounts', requireCapability('account:review'), listSafeAccounts);
router.post('/applications/:id/approve', requireCapability('account:review'), approveApplication);
router.post('/applications/:id/reject', requireCapability('account:review'), rejectApplication);
router.post('/accounts/:username/status', requireCapability('account:review'), setAccountStatus);
router.post('/accounts/:username/reset-password', requireCapability('account:review'), resetPassword);
router.post('/grants', requireOwner, createGrant);
router.delete('/grants/:id', requireOwner, revokeGrant);
router.get('/audit', requireOwner, listAudit);
```

Only `requireOwner` may issue or revoke grants. All mutation handlers call `appendAudit()` with safe before/after summaries.

- [ ] **Step 5: Mount and verify the routes**

Run: `node --test tests/governance-routes.test.js && node --check routes/applications.js && node --check routes/admin.js && node --check app.js`

Expected: all pass.

- [ ] **Step 6: Commit account application APIs**

```bash
git add app.js routes/applications.js routes/admin.js tests/governance-routes.test.js
git commit -m "feat: add account application and administration APIs"
```

## Task 5: Add server-only preset versioning and selection resolution

**Files:**
- Create: `lib/preset-store.js`
- Create: `routes/presets.js`
- Modify: `routes/admin.js`
- Modify: `app.js`
- Test: `tests/preset-store.test.js`

- [ ] **Step 1: Write failing preset behavior tests**

```js
test('catalog metadata never includes the protected body', () => {
  const store = createPresetStore({ systemDir: tempSystemDir() });
  store.createDraft(owner, { module: 'novel-panel', name: '现实情感', kind: 'base', body: 'server-only rules' });
  assert.deepEqual(store.listCatalog('novel-panel')[0], {
    id: 'preset_1', module: 'novel-panel', name: '现实情感', kind: 'base', description: '', version: 1, status: 'draft'
  });
});

test('resolver rejects two base presets and incompatible add-ons', () => {
  assert.throws(() => store.resolveSelection({ baseId: 'base_a', addonIds: ['base_b'] }), /base preset/);
  assert.throws(() => store.resolveSelection({ baseId: 'base_a', addonIds: ['addon_x'] }), /incompatible/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/preset-store.test.js`

Expected: FAIL with `Cannot find module '../lib/preset-store'`.

- [ ] **Step 3: Implement immutable versions and metadata projection**

```js
function createDraft(actor, input) {
  const state = readState();
  const record = { id: nextId(state), version: nextVersion(state, input.id), status: 'draft', ...input, updatedBy: actor, updatedAt: new Date().toISOString() };
  state.presets.push(record);
  writeState(state);
  appendAudit(actor, 'preset.draft_created', record.id, null, publicMetadata(record));
  return record;
}
function publish(actor, presetId, version) {
  const state = readState();
  const record = findVersion(state, presetId, version);
  record.status = 'published';
  record.updatedBy = actor;
  record.updatedAt = new Date().toISOString();
  writeState(state);
  appendAudit(actor, 'preset.published', presetId, null, { version });
  return record;
}
function rollback(actor, presetId, version) {
  return publish(actor, presetId, version);
}
function publicMetadata(record) {
  const { body, protocolLock, ...metadata } = record;
  return metadata;
}
```

Require `kind` to be `base` or `addon`. A base preset is selected by `baseId`; add-ons are selected by `addonIds`. Persist declared `compatibleBaseIds` on each add-on and enforce it server-side.

- [ ] **Step 4: Implement catalog and administration routes**

```js
router.get('/', apiAuth, (req, res) => res.json(presetStore.listCatalog(req.query.module)));
router.post('/resolve', apiAuth, (req, res) => res.json(presetStore.resolveSelection(req.body)));

adminRouter.post('/presets', requireCapability('preset:draft', body => body.module), createDraft);
adminRouter.post('/presets/:id/publish', requireCapability('preset:publish', body => body.module), publishPreset);
adminRouter.post('/presets/:id/rollback', requireCapability('preset:publish', body => body.module), rollbackPreset);
```

The server returns resolved internal prompt content only to the server-side generation service, never to an HTTP client response.

- [ ] **Step 5: Run store and route tests**

Run: `node --test tests/preset-store.test.js tests/governance-routes.test.js`

Expected: all pass, including a 403 when a `novel-panel` draft manager attempts a different module.

- [ ] **Step 6: Commit preset library support**

```bash
git add lib/preset-store.js routes/presets.js routes/admin.js app.js tests/preset-store.test.js tests/governance-routes.test.js
git commit -m "feat: add scoped system preset library"
```

## Task 6: Build account and preset management surfaces

**Files:**
- Create: `frontend/src/shared/api/admin.js`
- Create: `frontend/src/shared/api/presets.js`
- Create: `frontend/src/shared/components/AccountApplicationModal.jsx`
- Create: `frontend/src/admin/pages/AccountsPage.jsx`
- Create: `frontend/src/admin/pages/PresetLibraryPage.jsx`
- Create: `frontend/src/admin/pages/AuditPage.jsx`
- Modify: `frontend/src/admin/App.jsx`
- Modify: `frontend/src/shared/layouts/AdminLayout.jsx`
- Modify: `frontend/src/shared/layouts/UserLayout.jsx`
- Modify: `frontend/src/shared/api/auth.js`
- Modify: `frontend/src/shared/styles/global.css`
- Test: `scripts/validate-react-frontend-architecture.js`

- [ ] **Step 1: Add failing static architecture assertions**

```js
exists('frontend/src/admin/pages/AccountsPage.jsx');
exists('frontend/src/admin/pages/PresetLibraryPage.jsx');
exists('frontend/src/admin/pages/AuditPage.jsx');
assert(read('frontend/src/admin/App.jsx').includes("'/admin/accounts'"));
assert(read('frontend/src/admin/App.jsx').includes("'/admin/presets'"));
assert(read('frontend/src/shared/api/presets.js').includes("'/api/presets'"));
assert(!read('frontend/src/shared/api/presets.js').includes('body:'));
```

- [ ] **Step 2: Run the static check**

Run: `node scripts/validate-react-frontend-architecture.js`

Expected: FAIL because the listed modules and routes are missing.

- [ ] **Step 3: Implement metadata-only user and administrator API clients**

```js
// frontend/src/shared/api/presets.js
export function listPresetCatalog(module) {
  return apiRequest(`/api/presets?module=${encodeURIComponent(module)}`);
}
export function resolvePresetSelection(selection) {
  return apiRequest('/api/presets/resolve', { method: 'POST', body: JSON.stringify(selection) });
}
```

`admin.js` must call only `/api/admin/*`; it never relies on hidden menu state as authorization.

- [ ] **Step 4: Implement the three admin pages and application modal**

Use Ant Design `Table`, `Form`, `Modal`, `Tabs`, `Tag`, `Switch`, and `Popconfirm`. Accounts page displays status, grants, applications, approval/rejection, and reset actions. Preset page displays module, name, kind, compatibility, version, and status, with draft/publish/rollback actions conditional on server-provided capabilities. Audit page displays read-only audit rows. The login overlay adds a text action that opens `AccountApplicationModal`.

- [ ] **Step 5: Add routes and enforce responsive layout**

```jsx
if (pathname === '/admin/accounts') return <AccountsPage />;
if (pathname === '/admin/presets') return <PresetLibraryPage />;
if (pathname === '/admin/audit') return <AuditPage />;
```

Keep the admin menu compact and operational. Do not render a protected page merely because a link exists; API 403 responses must produce a clear `Alert` state.

- [ ] **Step 6: Build and run architecture checks**

Run: `npm --prefix frontend run build && node scripts/validate-react-frontend-architecture.js && node scripts/validate-multipage-architecture.js`

Expected: frontend build succeeds and both validators print `passed.`

- [ ] **Step 7: Commit governance UI**

```bash
git add frontend/src scripts/validate-react-frontend-architecture.js
git commit -m "feat: add account and preset governance UI"
```

## Task 7: Run the governance regression suite

**Files:**
- Modify: `README.md`
- Test: `tests/account-store.test.js`
- Test: `tests/preset-store.test.js`
- Test: `tests/governance-routes.test.js`

- [ ] **Step 1: Document the new protected data locations and bootstrap owner**

Add `data/system/` to `.gitignore` and document that `choushiyiguai` is the seeded owner, while credentials, grants, audit records, and preset bodies must not be committed.

- [ ] **Step 2: Run all deterministic checks**

Run: `node --test tests/account-store.test.js tests/preset-store.test.js tests/governance-routes.test.js && node --check app.js && node --check server.js && node --check routes/admin.js && npm --prefix frontend run build && node scripts/validate-multipage-architecture.js && node scripts/validate-react-frontend-architecture.js`

Expected: every command exits `0`.

- [ ] **Step 3: Perform a manual authorization smoke test**

Sign in as `choushiyiguai`, create a `novel-panel` draft grant for a second account, verify that account can create only a draft in that module, then verify it receives 403 from account approval and another module's preset route.

- [ ] **Step 4: Commit documentation and regression coverage**

```bash
git add README.md .gitignore tests
git commit -m "test: cover governance permissions and preset safety"
```
