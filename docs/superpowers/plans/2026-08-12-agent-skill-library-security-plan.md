# CM Agent Skill Library And Security Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add server-resolved CM skills and enforce an internal-information disclosure boundary.

**Architecture:** Store system skills separately from per-account private skills. The API returns metadata only unless the authenticated owner edits a private skill; chat resolves selected bodies on the server and does not persist them.

**Tech Stack:** Express, Node built-in test runner, React, Ant Design.

---

### Task 1: Skill Store And Seed

**Files:**
- Create: `lib/agent-skill-store.js`
- Create: `lib/agent-skill-catalog.js`
- Test: `tests/agent-skill-store.test.js`

- [ ] Write failing tests for public metadata projection, account isolation, and the published pre-roll built-in.
- [ ] Implement the minimal filesystem store and catalog seed.
- [ ] Run `node --test tests/agent-skill-store.test.js`.

### Task 2: Secure Chat And Skill Routes

**Files:**
- Create: `routes/agent-skills.js`
- Modify: `routes/agent.js`
- Modify: `routes/admin.js`
- Modify: `app.js`
- Test: `tests/agent-skill-routes.test.js`
- Test: `tests/agent-routes.test.js`

- [ ] Write failing route tests for authorized selection and blocked disclosure requests.
- [ ] Implement selection resolution, protected-request refusal, and admin-only system skill management.
- [ ] Run `node --test tests/agent-skill-routes.test.js tests/agent-routes.test.js`.

### Task 3: User And Admin UI

**Files:**
- Modify: `frontend/src/shared/api/agent.js`
- Modify: `frontend/src/shared/api/admin.js`
- Modify: `frontend/src/user/pages/AgentPage.jsx`
- Modify: `frontend/src/shared/pet/StackyPet.jsx`
- Modify: `frontend/src/shared/pet/stacky.js`
- Create: `frontend/src/admin/pages/AgentSkillLibraryPage.jsx`
- Modify: `frontend/src/admin/App.jsx`
- Modify: `frontend/src/shared/layouts/AdminLayout.jsx`
- Modify: `frontend/src/admin/pages/DashboardPage.jsx`
- Modify: `frontend/src/shared/styles/global.css`
- Test: `tests/agent-skill-ui-contract.test.js`

- [ ] Write a failing UI contract test for metadata-only skill selection and the admin route.
- [ ] Implement the skill picker, private-skill editor, selected-skill request payload, and admin management surface.
- [ ] Run the focused UI test plus `npm run frontend:build`.

### Task 4: Integration Verification

**Files:**
- Test: `tests/agent-skill-store.test.js`
- Test: `tests/agent-skill-routes.test.js`
- Test: `tests/agent-routes.test.js`
- Test: `tests/agent-skill-ui-contract.test.js`

- [ ] Run all focused tests and the React architecture validator.
- [ ] Restart the canonical `com.ming.qiantie` service and make authenticated browser/API smoke checks without calling a real model.
