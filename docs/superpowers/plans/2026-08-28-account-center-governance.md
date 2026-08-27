# Account Center Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a DEV-only account-and-role workspace, make team membership transfers safe and explicit, and reduce `/team` to current-team API and quota management.

**Architecture:** Keep `member-store` as the source of truth for role and `boundTo`, while adding a dedicated account-admin router that exposes DEV-only account lifecycle operations. A team transfer is a single server-side operation: validate target owner, update `boundTo`, remove every team API grant, write an audit event, and notify affected accounts. The React account page consumes this API; `/team` remains responsible only for the selected team’s invitations, API scopes, and quotas.

**Tech Stack:** Node.js, Express 5, JSON-backed member/team stores, React, Ant Design, Lucide, Node built-in test runner, Vite.

## Global Constraints

- Do not migrate, rewrite, or delete existing team/member data.
- `managerUsername` remains a compatibility field whose meaning is team-owner username.
- A MEMBER `boundTo` must reference one active DEV or MANAGER.
- Transferring a MEMBER clears every `api:use` scope; the destination team must grant scopes again.
- DEV retains global account control and an independent personal team; MANAGER remains limited to its own team.
- API Key values must never appear in account lists, transfer previews, notifications, or MEMBER views.
- Management-backend access remains a separate explicit grant.
- Preserve account-center deep/light theme tokens and do not modify batch-factory or novel-fetch layouts.

---

## File Structure

- Create `routes/account-admin.js`: DEV-only account directory, transfer preview, transfer commit, role changes and lifecycle wrappers.
- Modify `server.js`: mount `/api/account-admin` with existing stores and auth runtime.
- Modify `lib/member-store.js`: expose one atomic `transferManagedMember()` operation instead of allowing UI callers to assemble transfer side effects.
- Modify `routes/member-center.js`: make `/team` resolve only the requested/current team and remove global-account concerns.
- Create `frontend/src/shared/api/accountAdmin.js`: typed request helpers for the new account-admin endpoints.
- Create `frontend/src/user/pages/AccountRolePage.jsx`: DEV account-and-role workspace with filters and right-side management drawer.
- Modify `frontend/src/user/App.jsx` and `frontend/src/shared/layouts/UserLayout.jsx`: add DEV-only `/accounts` route and personal-center entry.
- Modify `frontend/src/user/pages/TeamPage.jsx`: remove global account table and role-authorization controls; retain selected-team operations.
- Modify `frontend/src/user/pages/MemberCenterPage.jsx`, `ProfilePage.jsx`, `ApiConfigPage.jsx`, and their shared load helpers: present one current-team vocabulary and recoverable error states.
- Modify `frontend/src/shared/styles/account-center-visual-rebuild.css`: add account directory and narrow-screen styles without changing the existing visual system.
- Create/modify `tests/account-admin.test.js`, `tests/member-center.test.js`, `tests/account-center-visual-contract.test.js`, and `tests/account-center-route-contract.test.js`: cover server authorization, transfer invariants, route visibility, and visual contract markers.

## Task 1: Atomic Member Transfer Domain Operation

**Files:**
- Modify: `lib/member-store.js: createMemberStore return API and member mutation helpers`
- Modify: `tests/member-center.test.js`

**Interfaces:**
- Consumes: `transferManagedMember(actorUsername, targetUsername, { boundTo, resetMonthlyTokenLimit })` from this task.
- Produces: `{ member, before, clearedScopes }`, where `clearedScopes` is an array of removed `'*' | 'text' | 'image' | 'tts'` scopes.

- [ ] **Step 1: Write failing transfer-invariant tests**

```js
test('DEV transfers a MEMBER to another active team owner and clears API scopes', t => {
  const { memberStore } = fixture(t);
  const manager = memberStore.createManagedMember('choushiyiguai', {
    username: 'manager-transfer', password: 'password01', role: 'manager'
  });
  const member = memberStore.createManagedMember('choushiyiguai', {
    username: 'member-transfer', password: 'password01', boundTo: 'choushiyiguai', apiEnabled: true
  });

  const result = memberStore.transferManagedMember('choushiyiguai', member.username, { boundTo: manager.username });

  assert.equal(result.member.boundTo, manager.username);
  assert.deepEqual(result.member.apiScopes, []);
  assert.deepEqual(result.clearedScopes, ['*']);
});

test('MANAGER cannot transfer a MEMBER and a disabled owner is rejected', t => {
  // Assert FORBIDDEN for a MANAGER actor and INVALID/NOT_FOUND for an inactive boundTo owner.
});
```

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `node --test tests/member-center.test.js`

Expected: FAIL because `transferManagedMember` is not exported by `member-store`.

- [ ] **Step 3: Implement the smallest atomic store operation**

```js
function transferManagedMember(actorUsername, targetUsername, { boundTo, resetMonthlyTokenLimit = false } = {}) {
  return withLock(() => {
    const state = readStateUnsafe();
    const actor = ensureDev(state, actorUsername);
    const target = ensureActiveMember(state, targetUsername);
    if (target.role !== 'member') throw memberError('仅 MEMBER 可以转移团队');
    const owner = validateTeamOwnerBinding(state, boundTo, target.username);
    if (target.boundTo === owner.username) throw memberError('成员已属于该团队', 'CONFLICT');
    const before = clone(target);
    const clearedScopes = state.grants
      .filter(grant => grant.subject === target.username && grant.capability === API_CAPABILITY)
      .map(grant => grant.scope);
    state.grants = state.grants.filter(grant => !(grant.subject === target.username && grant.capability === API_CAPABILITY));
    upsertProfile(state, target.username, {
      boundTo: owner.username,
      monthlyTokenLimit: resetMonthlyTokenLimit ? null : target.monthlyTokenLimit
    });
    const member = getMemberUnsafe(state, target.username);
    appendAudit(state, actor.username, 'member.transferred', target.username, before, {
      boundTo: member.boundTo,
      clearedScopes,
      monthlyTokenLimit: member.monthlyTokenLimit
    });
    writeStateUnsafe(state);
    return { member, before, clearedScopes };
  });
}
```

- [ ] **Step 4: Run focused tests and existing member authorization regression tests**

Run: `node --test tests/member-center.test.js tests/dev-permissions.test.js`

Expected: PASS. Confirm a transferred member resolves no API scopes until the destination owner re-grants one.

- [ ] **Step 5: Commit the domain change**

```bash
git add lib/member-store.js tests/member-center.test.js
git commit -m "feat: add atomic member team transfers"
```

## Task 2: DEV Account-Admin API and Transfer Preview

**Files:**
- Create: `routes/account-admin.js`
- Modify: `server.js: account-admin router registration`
- Modify: `tests/account-admin.test.js`

**Interfaces:**
- Consumes: `memberStore.transferManagedMember()` from Task 1, `usageStore`, `createTeamCollaborationStore`, and `authRuntime.tokenMap`.
- Produces:
  - `GET /api/account-admin/accounts?role=&active=&online=&owner=&query=`
  - `POST /api/account-admin/accounts`
  - `GET /api/account-admin/accounts/:username/transfer-preview?boundTo=`
  - `POST /api/account-admin/accounts/:username/transfer`
  - `PATCH /api/account-admin/accounts/:username`

- [ ] **Step 1: Write failing HTTP contract tests**

```js
test('DEV account directory includes ownership, online state, API host, and monthly usage', async t => {
  const fx = await fixture(t);
  const login = await loginAsDev(fx.app);
  const response = await request(fx.app, { requestPath: '/api/account-admin/accounts', token: login.token });
  assert.equal(response.status, 200);
  assert.ok(response.body.accounts.every(account => 'teamOwner' in account && 'presence' in account));
  assert.equal('apiKey' in response.body.accounts[0], false);
});

test('transfer preview and commit clear old scopes and notify both team owners', async t => {
  // Create a DEV-owned member and a MANAGER owner, grant text scope, request preview, then commit.
  // Assert API scopes are empty, boundTo changes, and notifications include old/new owner usernames.
});

test('MANAGER and MEMBER cannot access account-admin routes', async t => {
  // Assert HTTP 403 for both roles.
});
```

- [ ] **Step 2: Run API tests and verify failure**

Run: `node --test tests/account-admin.test.js`

Expected: FAIL because `/api/account-admin` is not mounted.

- [ ] **Step 3: Implement dedicated router with explicit response shapes**

```js
function accountRow(member) {
  const owner = member.boundTo ? memberStore.getMember(member.boundTo) : null;
  const month = usageStore.summaryForUser(member.username, 'month');
  return {
    username: member.username,
    displayName: member.displayName,
    role: member.role,
    active: member.active,
    boundTo: member.boundTo,
    teamOwner: owner ? { username: owner.username, displayName: owner.displayName, role: owner.role } : null,
    apiScopes: member.apiScopes,
    monthlyTokenLimit: member.monthlyTokenLimit,
    presence: { online: isRuntimeOnline(authRuntime, member.username) },
    usage: { month }
  };
}

router.post('/accounts/:username/transfer', (req, res) => {
  requireDev(req, res);
  const preview = buildTransferPreview(req.params.username, req.body?.boundTo);
  const result = memberStore.transferManagedMember(req.username, req.params.username, {
    boundTo: preview.to.owner.username,
    resetMonthlyTokenLimit: req.body?.resetMonthlyTokenLimit === true
  });
  notifyTransfer(preview, result);
  res.json({ preview, ...result });
});
```

`buildTransferPreview()` must return only owner names, team names, old/new team monthly limits, old scopes, preserved/reset personal limit, and `requiresReauthorization: true`; it must never return config objects or keys.

- [ ] **Step 4: Mount the router and run all account/team API tests**

Run: `node --test tests/account-admin.test.js tests/member-center.test.js tests/account-recovery-advanced-auth.test.js`

Expected: PASS. Verify no existing manager co-manager or invitation contract changes.

- [ ] **Step 5: Commit the API layer**

```bash
git add routes/account-admin.js server.js tests/account-admin.test.js
git commit -m "feat: add developer account administration API"
```

## Task 3: Account-and-Role Workspace and DEV Navigation

**Files:**
- Create: `frontend/src/shared/api/accountAdmin.js`
- Create: `frontend/src/user/pages/AccountRolePage.jsx`
- Modify: `frontend/src/user/App.jsx`
- Modify: `frontend/src/shared/layouts/UserLayout.jsx`
- Modify: `frontend/src/shared/styles/account-center-visual-rebuild.css`
- Modify: `tests/account-center-route-contract.test.js`

**Interfaces:**
- Consumes: Task 2 endpoints using `apiRequest()` and `getMemberCenter()`.
- Produces: DEV-only `/accounts` route and a drawer whose transfer commit uses `transferAccountMember(username, { boundTo, resetMonthlyTokenLimit })`.

- [ ] **Step 1: Write failing route and visual contracts**

```js
test('account and role management is a DEV-only personal-center destination', () => {
  assert.match(app, /'\/accounts': AccountRolePage/);
  assert.match(layout, /account\?\.role === 'dev'.*账号与角色/s);
  assert.match(accountPage, /当前团队|API 托管负责人|转移团队|待重新授权/);
});

test('team page no longer renders the global developer account table', () => {
  assert.doesNotMatch(teamPage, /开发者账号管理/);
  assert.doesNotMatch(teamPage, /授权管理者/);
});
```

- [ ] **Step 2: Run contract tests and verify failure**

Run: `node --test tests/account-center-route-contract.test.js tests/account-center-visual-contract.test.js`

Expected: FAIL because the route, navigation label, and account page do not exist.

- [ ] **Step 3: Implement API helpers and the page interaction model**

```js
export function getAccountDirectory(filters = {}) {
  const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== undefined && value !== ''));
  return apiRequest(`/api/account-admin/accounts?${query}`);
}
export function getAccountTransferPreview(username, boundTo) {
  return apiRequest(`/api/account-admin/accounts/${encodeURIComponent(username)}/transfer-preview?boundTo=${encodeURIComponent(boundTo)}`);
}
export function transferAccountMember(username, payload) {
  return apiRequest(`/api/account-admin/accounts/${encodeURIComponent(username)}/transfer`, { method: 'POST', body: JSON.stringify(payload) });
}
```

`AccountRolePage` must:

- Redirect to an in-page 403 state for a non-DEV response; do not render an empty table.
- Show the four filter groups and a single “创建账号” command.
- Put all row commands behind one `MoreHorizontal` button that opens a Drawer.
- Provide transfer in two steps inside the Drawer: select owner, then load preview; enable final transfer only when `preview.requiresReauthorization === true` and the owner differs from current `boundTo`.
- Show “待重新授权” after a successful transfer and refresh the directory.
- Keep role upgrade/downgrade and account lifecycle operations in the same drawer, using the existing member APIs until dedicated lifecycle endpoints are available.

- [ ] **Step 4: Add styles that retain account-center geometry**

```css
.account-role-filters { display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:10px; }
.account-role-table-head,.account-role-table-row { display:grid; grid-template-columns:minmax(190px,1.3fr) 92px minmax(150px,.9fr) minmax(150px,.9fr) 86px 86px 110px 52px; }
@container (max-width: 900px) { .account-role-filters { grid-template-columns:repeat(2,minmax(0,1fr)); } .account-role-table { overflow:auto; } }
@container (max-width: 620px) { .account-role-filters { grid-template-columns:1fr; } }
```

Use existing `--ac-*` variables and explicit `[data-theme='dark']` contrast rules for status tags and Drawer descriptions.

- [ ] **Step 5: Run frontend build and contracts**

Run: `node --test tests/account-center-route-contract.test.js tests/account-center-visual-contract.test.js && npm run frontend:build`

Expected: PASS. The build must not introduce route-loading errors.

- [ ] **Step 6: Commit the account workspace**

```bash
git add frontend/src/shared/api/accountAdmin.js frontend/src/user/pages/AccountRolePage.jsx frontend/src/user/App.jsx frontend/src/shared/layouts/UserLayout.jsx frontend/src/shared/styles/account-center-visual-rebuild.css tests/account-center-route-contract.test.js tests/account-center-visual-contract.test.js
git commit -m "feat: add developer account and role workspace"
```

## Task 4: Reduce Team and Governance Pages to Their Intended Scope

**Files:**
- Modify: `routes/member-center.js`
- Modify: `frontend/src/user/pages/TeamPage.jsx`
- Modify: `frontend/src/user/pages/AdvancedTeamAdminPage.jsx`
- Modify: `frontend/src/user/pages/MemberCenterPage.jsx`
- Modify: `tests/member-center.test.js`
- Modify: `tests/account-center-visual-contract.test.js`

**Interfaces:**
- Consumes: selected `teamOwner` username from `/team/meta`, Task 2 transfer clearing semantics.
- Produces: selected-team-only members/usage payloads and no role management control in `/team`.

- [ ] **Step 1: Write failing selected-team tests and page contracts**

```js
test('DEV team endpoint returns members only for the requested team owner', async t => {
  // Create a DEV member and a MANAGER member. Request /api/member/team?owner=manager.
  // Assert the manager and only the manager-bound member are returned.
});

test('team page keeps current-team API controls but excludes account lifecycle controls', () => {
  assert.match(teamPage, /成员列表/);
  assert.match(teamPage, /AI 能力权限/);
  assert.doesNotMatch(teamPage, /开发者账号管理/);
  assert.doesNotMatch(teamPage, /授权管理者/);
});
```

- [ ] **Step 2: Run focused tests and verify failure**

Run: `node --test tests/member-center.test.js tests/account-center-visual-contract.test.js`

Expected: FAIL because DEV `/team` still returns `visibleTeam()` globally and `TeamPage` renders the global table.

- [ ] **Step 3: Make `/team` selected-team aware**

```js
const ownerUsername = self.role === 'dev' ? String(req.query.owner || self.username) : self.username;
const owner = memberStore.getMember(ownerUsername);
if (!owner || !['dev', 'manager'].includes(owner.role)) return res.status(400).json({ error: '团队负责人不可用' });
const members = memberStore.listMembers().filter(item => item.username === owner.username || (item.role === 'member' && item.boundTo === owner.username));
const month = usageStore.summariesForUsers(members.map(item => item.username), 'month', { teamOwner: owner.username });
```

Reject a DEV request for unknown owners; a MANAGER must ignore `owner` query values and always use itself.

- [ ] **Step 4: Simplify `TeamPage` and align `AdvancedTeamAdminPage`**

- Fetch `/team?owner=${activeOwner}` whenever DEV changes the selector.
- Remove the DEV global account-management panel and `managerGrantOpen` modal from `TeamPage`.
- Keep create-member, invitation, API-scope, personal quota, team quota, rename, archive, and password controls scoped to `activeOwner`.
- Replace “主管理 / 主 MANAGER” copy in advanced governance with “团队负责人” when the owner is DEV; retain “联合管理员” only for MANAGER co-managers.
- In `MemberCenterPage`, use `center.team.name` for DEV “我的团队” everywhere instead of fallback “qiantie 核心”.

- [ ] **Step 5: Run backend, visual, and frontend build verification**

Run: `node --test tests/member-center.test.js tests/account-recovery-advanced-auth.test.js tests/account-center-visual-contract.test.js && npm run frontend:build`

Expected: PASS. DEV sees selected team only; MANAGER sees only own team; the team page has no global account controls.

- [ ] **Step 6: Commit the scope cleanup**

```bash
git add routes/member-center.js frontend/src/user/pages/TeamPage.jsx frontend/src/user/pages/AdvancedTeamAdminPage.jsx frontend/src/user/pages/MemberCenterPage.jsx tests/member-center.test.js tests/account-center-visual-contract.test.js
git commit -m "refactor: scope team management to selected team"
```

## Task 5: Personal-Center Loading, Error Recovery, and End-to-End Verification

**Files:**
- Create: `frontend/src/user/pages/accountCenterLoad.js`
- Modify: `frontend/src/user/pages/ProfilePage.jsx`
- Modify: `frontend/src/user/pages/ApiConfigPage.jsx`
- Modify: `frontend/src/user/pages/AdvancedTeamAdminPage.jsx`
- Modify: `frontend/src/user/pages/MemberCenterPage.jsx`
- Modify: `frontend/src/user/pages/UsageStatsPage.jsx`
- Modify: `tests/account-center-route-contract.test.js`
- Modify: `tests/account-center-visual-contract.test.js`

**Interfaces:**
- Produces `createAccountCenterLoader(load, fallbackMessage)` returning `{ loading, error, retry, data }` or equivalent shared hook semantics.
- Each account-center page must render `<AccountCenterError onRetry={retry} />` on failed initial data loading.

- [ ] **Step 1: Write failing empty-page prevention contracts**

```js
test('all personal-center pages contain an explicit failed-load retry state', () => {
  for (const page of ['ProfilePage.jsx', 'ApiConfigPage.jsx', 'AdvancedTeamAdminPage.jsx', 'MemberCenterPage.jsx', 'UsageStatsPage.jsx']) {
    const source = readPage(page);
    assert.match(source, /AccountCenterError|加载失败/);
    assert.match(source, /retry|load/);
  }
});

test('personal-center navigation exposes accounts only to DEV', () => {
  assert.match(layout, /account\?\.role === 'dev'.*账号与角色/s);
  assert.doesNotMatch(layout, /\['dev', 'manager'\]\.includes\(account\?\.role\).*账号与角色/s);
});
```

- [ ] **Step 2: Run contracts and verify failure**

Run: `node --test tests/account-center-route-contract.test.js`

Expected: FAIL because pages use only toast errors and can finish with an empty `center` state.

- [ ] **Step 3: Implement shared recoverable loading states**

```jsx
export function AccountCenterError({ message, onRetry }) {
  return <div className="account-center-page"><div className="ac-empty ac-load-error"><strong>{message}</strong><Button onClick={onRetry}>重试</Button></div></div>;
}

export function useAccountCenterLoad(load, fallbackMessage) {
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const retry = useCallback(async () => {
    setState(current => ({ ...current, loading: true, error: null }));
    try { setState({ loading: false, error: null, data: await load() }); }
    catch (error) { setState({ loading: false, error: error.message || fallbackMessage, data: null }); }
  }, [load, fallbackMessage]);
  return { ...state, retry };
}
```

Refactor each page to call its page-specific fetch function through the hook, display `Skeleton` only while loading, and display `AccountCenterError` before attempting any `center.member` rendering.

- [ ] **Step 4: Run complete regression suite and visual build**

Run: `node --test && npm run frontend:build`

Expected: PASS. Inspect `/profile`, `/member`, `/api-config`, `/usage`, `/team`, `/advanced-team-admin`, and `/accounts` as DEV; inspect allowed routes as MANAGER and MEMBER. Confirm dark/light text, tables, drawers, filters, and empty/error states are readable at desktop and narrow widths.

- [ ] **Step 5: Commit final reliability and verification changes**

```bash
git add frontend/src/user/pages/accountCenterLoad.js frontend/src/user/pages/ProfilePage.jsx frontend/src/user/pages/ApiConfigPage.jsx frontend/src/user/pages/AdvancedTeamAdminPage.jsx frontend/src/user/pages/MemberCenterPage.jsx frontend/src/user/pages/UsageStatsPage.jsx tests/account-center-route-contract.test.js tests/account-center-visual-contract.test.js
git commit -m "fix: add recoverable account center loading states"
```

## Final Acceptance Checks

- [ ] `git diff --check` reports no whitespace errors.
- [ ] `node --test` passes from the repository root.
- [ ] `npm run frontend:build` passes.
- [ ] DEV can transfer an existing MEMBER and the destination team must explicitly reauthorize API scopes before model calls succeed.
- [ ] MANAGER cannot access `/accounts`, cannot change role, and cannot transfer members.
- [ ] MEMBER cannot access team management, joint governance, account directory, or API configuration fields owned by a team owner.
- [ ] Existing manager teams, invitations, governance rows, account data, and batch-factory changes remain untouched.
