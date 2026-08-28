# Account Center Team Transfer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make account governance visible in the personal center and let DEV move existing MEMBER accounts between teams with explicit confirmation.

**Architecture:** Keep the existing team/member APIs and stores as the source of truth. Add the missing user-facing route/menu entry for the existing governance page, then add a DEV-only transfer workflow to the team page using the existing member update endpoint so API scopes are revoked by the current server rules.

**Tech Stack:** React, Ant Design, Express, Node test runner, Docker production publish script.

## Global Constraints

- DEV can manage all teams and transfer MEMBER accounts; MANAGER remains limited to its own team.
- Transfer confirmation must show the current and target teams.
- Transfer must not expose API keys.
- Existing batch-factory and novel-fetch layouts remain unchanged.
- Existing production data volumes must be preserved.

### Task 1: Expose Account Governance In The Personal Center

**Files:**
- Modify: `frontend/src/shared/layouts/UserLayout.jsx`
- Modify: `frontend/src/user/App.jsx`
- Modify: `frontend/src/admin/App.jsx`
- Test: `tests/account-center-governance-contract.test.js`

- [ ] Add a DEV-only “账号与角色” link under the personal-center developer tools section, pointing to `/accounts`.
- [ ] Route `/accounts` through the existing `AccountGovernancePage` while preserving the current admin layout and authorization guard.
- [ ] Keep `/admin/accounts` as a compatibility redirect to `/accounts`.
- [ ] Update the contract test to assert the visible route and redirect behavior.
- [ ] Run the focused contract test and commit.

### Task 2: Add DEV Existing-Member Team Transfer

**Files:**
- Modify: `frontend/src/user/pages/TeamPage.jsx`
- Modify: `frontend/src/shared/api/member.js`
- Test: `tests/member-center.test.js`

- [ ] Add a DEV-only “调整已有账号” action next to the team selector.
- [ ] Load all active MEMBER accounts and available teams from existing DEV-visible endpoints without returning credentials.
- [ ] Present target team/manager selection and a confirmation dialog showing `原团队 -> 新团队`.
- [ ] Call `updateTeamMember(username, { boundTo: targetManagerUsername })` only after confirmation.
- [ ] Refresh team data and show that the member now requires new-team API authorization.
- [ ] Add a focused server/client contract assertion for DEV transfer authorization and scope revocation.
- [ ] Run focused tests and commit.

### Task 3: Verification And Production Publish

**Files:**
- No source changes unless verification finds a defect.

- [ ] Run governance, member-center, and frontend contract tests.
- [ ] Build the frontend and verify `/accounts`, `/team`, and `/admin/accounts` route behavior.
- [ ] Publish with `scripts/deploy-production.sh publish` from a clean checked-out release state.
- [ ] Verify production health and preserve all four production data volumes.
- [ ] Record the published commit and endpoint.
