# Team Video Generation Permission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a server-enforced `video` API scope so team managers can authorize individual members to generate videos.

**Architecture:** Extend the existing API-scope whitelist rather than adding a parallel permission field. The member/team forms use the same scope value, while `routes/script-video.js` checks the authenticated member’s effective team scope before contacting the video provider.

**Tech Stack:** Node.js, Express, React, Ant Design, existing member/team stores, Node test runner.

## Global Constraints

- Use the existing `apiScopes` mechanism and add only the `video` scope.
- Existing members retain their current scopes; invitation defaults remain text-only.
- Unauthorized video creation returns HTTP 403 before any upstream provider call or quota charge.
- Never expose API keys or full provider configuration to members.
- Do not modify or reset production data volumes during implementation.

---

### Task 1: Extend scope contracts and persistence paths

**Files:**
- Modify: `lib/team-collaboration-store.js`
- Modify: `routes/auth.js`
- Modify: `routes/member-center.js`
- Modify: `routes/team-admin.js`
- Test: `tests/team-video-permission-contract.test.js`

**Interfaces:**
- Existing scope arrays gain the literal value `video`.
- Existing invite and member-management endpoints accept and persist `video`.

- [ ] **Step 1: Add failing contract tests** for invite scope validation and member-management scope filtering with `video`.
- [ ] **Step 2: Run `node --test tests/team-video-permission-contract.test.js` and confirm the new assertions fail.**
- [ ] **Step 3: Add `video` to all server-side scope allowlists, preserving `*` behavior and existing defaults.**
- [ ] **Step 4: Run the focused test and confirm it passes.**
- [ ] **Step 5: Commit with `feat: add video team permission scope`.**

### Task 2: Enforce permission at video creation

**Files:**
- Modify: `routes/script-video.js`
- Modify: the route registration/dependency wiring file identified by the existing `script-video` router tests
- Test: `tests/team-video-permission-contract.test.js`

**Interfaces:**
- Video creation reads the authenticated account and effective member scope through existing app stores.
- Unauthorized MEMBER requests return `{ error: '暂无视频生成权限' }` with status 403.

- [ ] **Step 1: Add tests proving a MEMBER with `video` can create and a MEMBER without it receives 403.**
- [ ] **Step 2: Add a provider stub/call counter and assert the unauthorized branch makes zero provider calls.**
- [ ] **Step 3: Implement the smallest reusable scope check in the existing route wiring, allowing DEV/MANAGER and `video`/`*` members according to current team rules.**
- [ ] **Step 4: Run the focused video route tests and confirm they pass.**
- [ ] **Step 5: Commit with `feat: enforce video generation permission`.**

### Task 3: Add manager-facing controls and member status

**Files:**
- Modify: `frontend/src/user/pages/TeamPage.jsx`
- Modify: `frontend/src/user/pages/AdvancedTeamAdminPage.jsx`
- Modify: `frontend/src/user/pages/ApiConfigPage.jsx`
- Test: existing frontend/team contract tests or `tests/team-video-permission-contract.test.js`

**Interfaces:**
- Scope option value `video`, label `视频生成`.
- Existing save APIs submit the selected scope without changing their endpoint shape.

- [ ] **Step 1: Add contract assertions for the label/value and both management pages.**
- [ ] **Step 2: Add the option to create, invite, edit, and joint-governance forms and render it in scope summaries.**
- [ ] **Step 3: Add the team video-generation status row to personal center without displaying credentials.**
- [ ] **Step 4: Run frontend tests/build and confirm the controls compile.**
- [ ] **Step 5: Commit with `feat: add team video permission controls`.**

### Task 4: Gate the script UI and verify end to end

**Files:**
- Modify: the script page/component that renders the `生成视频` action
- Test: `tests/team-video-permission-contract.test.js`

- [ ] **Step 1: Add a UI contract test for disabled state and the explanatory message when `video` is absent.**
- [ ] **Step 2: Implement the UI gate while keeping the server check authoritative.**
- [ ] **Step 3: Run focused tests, the existing video/team test suites, and the frontend build.**
- [ ] **Step 4: Inspect the final diff and verify no API key/config values are logged or rendered.**
- [ ] **Step 5: Commit with `feat: gate script video generation by team permission`.**

