# CM 宠物交互修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 CM 能稳定拖动、可靠对话、分析当前 qiantie 页面，并在完整 Agent 工作区继续同一聊天。

**Architecture:** 从 `StackyPet` 提取纯浮层几何与账号级 CM 任务引用；共享布局发布基础页面上下文，各页面发布受限业务摘要。宠物和 `/agent?task=<id>` 使用后端同一任务。

**Tech Stack:** React 18, Vite, Ant Design, lucide-react, CustomEvent, localStorage, Express, Node test runner。

---

## File Structure

- Create: `frontend/src/shared/pet/overlayGeometry.js` and `overlayGeometry.test.js` for drag and position pure functions.
- Modify: `frontend/src/shared/pet/stacky.js`, `StackyPet.jsx`, `frontend/src/shared/styles/global.css` for context, task reference, and overlay UI.
- Modify: `frontend/src/shared/layouts/UserLayout.jsx`, `frontend/src/user/pages/AgentPage.jsx` for account task handoff.
- Modify: `frontend/src/user/pages/{ScriptPage,TtsPage,ShuihuoProductionPage,NovelPanelPage}.jsx` for bounded context.
- Modify: `routes/agent.js`, `tests/agent-routes.test.js`, `tests/cm-agent-ui-contract.test.js`, `frontend/src/shared/pet/stacky.test.js` for contracts.

### Task 1: Add Tested Overlay and Context Contracts

**Files:**
- Create: `frontend/src/shared/pet/overlayGeometry.js`
- Create: `frontend/src/shared/pet/overlayGeometry.test.js`
- Modify: `frontend/src/shared/pet/stacky.js`
- Modify: `frontend/src/shared/pet/stacky.test.js`

- [ ] **Step 1: Write failing pure-function tests**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { didDrag, getOverlayLayout } from './overlayGeometry.js';

test('requires eight pixels before a drag', () => {
  assert.equal(didDrag({ x: 0, y: 0 }, { x: 7, y: 0 }), false);
  assert.equal(didDrag({ x: 0, y: 0 }, { x: 8, y: 0 }), true);
});

test('keeps panel inside all desktop corners', () => {
  for (const pet of [{ left: 0, top: 56 }, { left: 1320, top: 56 }, { left: 0, top: 770 }, { left: 1320, top: 770 }]) {
    const panel = getOverlayLayout({ viewport: { width: 1440, height: 900, topInset: 56 }, pet }).panel;
    assert.ok(panel.left >= 8 && panel.top >= 64);
    assert.ok(panel.left + panel.width <= 1432 && panel.top + panel.height <= 892);
  }
});
```

- [ ] **Step 2: Confirm test failure**

Run: `node --test frontend/src/shared/pet/overlayGeometry.test.js`

Expected: FAIL because `overlayGeometry.js` is absent.

- [ ] **Step 3: Implement geometry helpers**

```js
export const PET_SIZE = { width: 120, height: 130 };
export const OVERLAY_PADDING = 8;
export const DRAG_THRESHOLD = 8;
export const didDrag = (start, point) => Math.hypot(point.x - start.x, point.y - start.y) >= DRAG_THRESHOLD;

export function getOverlayLayout({ viewport, pet }) {
  const width = Math.min(360, viewport.width - OVERLAY_PADDING * 2);
  const height = Math.min(420, viewport.height - viewport.topInset - OVERLAY_PADDING * 2);
  const right = pet.left + PET_SIZE.width + 12 + width <= viewport.width - OVERLAY_PADDING;
  const left = pet.left - 12 - width >= OVERLAY_PADDING;
  const placement = right ? 'right' : left ? 'left' : 'above';
  const idealLeft = placement === 'right' ? pet.left + PET_SIZE.width + 12 : placement === 'left' ? pet.left - width - 12 : pet.left + (PET_SIZE.width - width) / 2;
  const idealTop = placement === 'above' ? pet.top - height - 12 : pet.top;
  return { panel: { placement, width, height, left: Math.max(OVERLAY_PADDING, Math.min(viewport.width - width - OVERLAY_PADDING, idealLeft)), top: Math.max(viewport.topInset + OVERLAY_PADDING, Math.min(viewport.height - height - OVERLAY_PADDING, idealTop)) } };
}
```

- [ ] **Step 4: Add CM task and context helpers**

Add to `stacky.js`:

```js
const PET_TASK_KEY_PREFIX = 'qiantie-cm-task:';
export const cmTaskStorageKey = username => username ? `${PET_TASK_KEY_PREFIX}${username}` : '';
export function readCmTaskId(username) { const key = cmTaskStorageKey(username); return key ? localStorage.getItem(key) || '' : ''; }
export function writeCmTaskId(username, taskId) { const key = cmTaskStorageKey(username); if (!key) return; if (taskId) localStorage.setItem(key, taskId); else localStorage.removeItem(key); }
export function normalizePetContext(context = {}) {
  const text = value => String(value || '').trim().slice(0, 1600);
  return { page: text(context.page), pagePath: text(context.pagePath), summary: text(context.summary), entities: context.entities && typeof context.entities === 'object' ? context.entities : {}, actions: Array.isArray(context.actions) ? context.actions.map(text).filter(Boolean).slice(0, 6) : [] };
}
```

- [ ] **Step 5: Add and run state tests**

```js
test('normalizes context and scopes task key by account', () => {
  assert.equal(cmTaskStorageKey('writer'), 'qiantie-cm-task:writer');
  assert.deepEqual(normalizePetContext({ page: '配音', actions: ['生成语音', '', '下载'] }), { page: '配音', pagePath: '', summary: '', entities: {}, actions: ['生成语音', '下载'] });
});
```

Run: `node --test frontend/src/shared/pet/overlayGeometry.test.js frontend/src/shared/pet/stacky.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/shared/pet/overlayGeometry.js frontend/src/shared/pet/overlayGeometry.test.js frontend/src/shared/pet/stacky.js frontend/src/shared/pet/stacky.test.js
git commit -m "test: define CM overlay and context contracts"
```

### Task 2: Separate Drag, Open, and Analysis Actions

**Files:**
- Modify: `frontend/src/shared/pet/StackyPet.jsx`
- Modify: `frontend/src/shared/styles/global.css`
- Modify: `tests/cm-agent-ui-contract.test.js`

- [ ] **Step 1: Make the UI contract fail first**

```js
assert.match(pet, /className="stacky-pet-drag-handle"/);
assert.match(pet, /title="分析当前页面"/);
assert.match(pet, /onClick=\{analyzeCurrentPage\}/);
assert.doesNotMatch(pet, /onDoubleClick=\{handlePetDoubleClick\}/);
assert.doesNotMatch(pet, /messages\.slice\(-4\)/);
```

Run: `node --test tests/cm-agent-ui-contract.test.js`

Expected: FAIL against the current combined drag/double-click implementation.

- [ ] **Step 2: Move pointer capture to an explicit drag handle**

Use `didDrag()` from Task 1 only from this handle; remove sprite pointer and double-click handlers:

```jsx
<button className="stacky-pet-drag-handle" type="button" title="拖动移动 CM" aria-label="移动 CM" onPointerDown={handleDragStart} onPointerMove={handleDragMove} onPointerUp={handleDragEnd}>
  <GripVertical size={14} aria-hidden="true" />
</button>
<div className="stacky-pet" role="button" tabIndex={0} aria-label="打开 CM 对话" onClick={openChat} onKeyDown={handlePetKeyDown}>
```

- [ ] **Step 3: Add explicit commands and retry state**

```jsx
<Button type="text" icon={<ScanSearch size={16} />} title="分析当前页面" aria-label="分析当前页面" onClick={analyzeCurrentPage} loading={asking} />
<Button type="text" icon={<ExternalLink size={16} />} title="在 Agent 工作区继续" aria-label="在 Agent 工作区继续" onClick={openInAgentWorkspace} disabled={!petTaskIdRef.current} />
{failedRequest ? <Button size="small" onClick={() => sendQuestion(failedRequest.prompt)}>重新发送</Button> : null}
```

`analyzeCurrentPage()` calls `sendQuestion('请分析当前页面的内容，指出下一步最值得处理的事项。')`. A failed send stores `{ prompt, error }`, preserves the draft, and never claims success. Render all messages with `messages.map` in scrollable history.

- [ ] **Step 4: Use one geometry source for panel placement**

Replace `getChatPanelLayout()` with `getOverlayLayout()`. Recalculate from pet rect after drag end and resize. Apply fixed `left`, `top`, `width`, and `height`; delete old panel `bottom` variables.

- [ ] **Step 5: Replace conflicting CSS**

```css
.stacky-pet-shell { position: fixed; z-index: 900; pointer-events: none; }
.stacky-pet { position: relative; width: 120px; height: 130px; pointer-events: auto; cursor: pointer; }
.stacky-pet-drag-handle { position: absolute; z-index: 2; top: 6px; left: 6px; display: grid; width: 24px; height: 24px; place-items: center; border: 1px solid var(--legacy-border-strong); border-radius: 5px; background: var(--legacy-card); color: var(--legacy-muted); cursor: grab; pointer-events: auto; }
.stacky-pet-drag-handle:active { cursor: grabbing; }
.stacky-agent-panel { position: fixed; display: flex; flex-direction: column; overflow: hidden; pointer-events: auto; }
.stacky-agent-history { flex: 1; max-height: none; overflow-y: auto; }
```

Keep light-theme overrides and make header and composer visible within the panel.

- [ ] **Step 6: Verify and commit**

Run: `node --test tests/cm-agent-ui-contract.test.js && npm --prefix frontend run build && git diff --check`

Expected: PASS and Vite exit `0`.

```bash
git add frontend/src/shared/pet/StackyPet.jsx frontend/src/shared/styles/global.css tests/cm-agent-ui-contract.test.js
git commit -m "fix: separate CM drag and conversation controls"
```

### Task 3: Persist CM Task and Deep-Link Agent Workspace

**Files:**
- Modify: `frontend/src/shared/layouts/UserLayout.jsx`
- Modify: `frontend/src/shared/pet/StackyPet.jsx`
- Modify: `frontend/src/user/pages/AgentPage.jsx`
- Modify: `tests/cm-agent-ui-contract.test.js`

- [ ] **Step 1: Add failing task-continuity contracts**

```js
assert.match(pet, /readCmTaskId\(username\)/);
assert.match(pet, /writeCmTaskId\(username, taskId\)/);
assert.match(pet, /\/agent\?task=\$\{encodeURIComponent\(taskId\)\}/);
assert.match(page, /new URLSearchParams\(window\.location\.search\)\.get\('task'\)/);
assert.match(page, /selectTask\(requestedTaskId\)/);
```

- [ ] **Step 2: Pass account identity and restore saved task reference**

Change mount to `<StackyPet username={username} accountSessionKey={accountSessionKey} />`. On account key change reset messages/request state and load `readCmTaskId(username)` into `petTaskIdRef`, without fetching until panel open.

- [ ] **Step 3: Persist task ID and clear stale IDs**

Call `writeCmTaskId(username, taskId)` after create and successful chat. On task `404`, clear local task ID/ref/messages and show `当前对话已失效，已为你准备新对话。`; create only on next send.

- [ ] **Step 4: Select query task in Agent page**

After task list load, read `new URLSearchParams(window.location.search).get('task')`; if it exists in the list, call `selectTask(requestedTaskId)` once. Synchronize selection through `window.history.replaceState({}, '', `/agent?task=${encodeURIComponent(taskId)}`)` and clear it when no task remains. Keep ownership validation server-side.

- [ ] **Step 5: Verify and commit**

Run: `node --test tests/cm-agent-ui-contract.test.js tests/agent-routes.test.js`

Expected: PASS, including current task isolation and serial request tests.

```bash
git add frontend/src/shared/layouts/UserLayout.jsx frontend/src/shared/pet/StackyPet.jsx frontend/src/user/pages/AgentPage.jsx tests/cm-agent-ui-contract.test.js
git commit -m "feat: continue CM conversations in Agent workspace"
```

### Task 4: Supply Bounded Page-Specific Context

**Files:**
- Modify: `frontend/src/shared/layouts/UserLayout.jsx`
- Modify: `frontend/src/user/pages/ScriptPage.jsx`
- Modify: `frontend/src/user/pages/TtsPage.jsx`
- Modify: `frontend/src/user/pages/ShuihuoProductionPage.jsx`
- Modify: `frontend/src/user/pages/NovelPanelPage.jsx`
- Modify: `routes/agent.js`
- Modify: `tests/agent-routes.test.js`

- [ ] **Step 1: Write a failing route test**

```js
test('Agent chat sends structured context transiently', async t => {
  const seen = [];
  const app = makeApp({ respond: async ({ messages }) => { seen.push(messages); return '已收到页面摘要'; } });
  const { token } = await login(app, 'cm-context-user');
  const task = (await request(app, { method: 'POST', requestPath: '/api/agent/tasks', token })).body.task;
  const result = await request(app, { method: 'POST', requestPath: '/api/agent/chat', token, body: { taskId: task.id, prompt: '下一步', context: { page: '水货生产', summary: '当前项目：雨夜车站；已确认 6 个分段。', entities: { projectId: 'p-1' }, actions: ['检查分段'] } } });
  assert.equal(result.status, 200);
  assert.match(seen[0].at(-1).content, /当前页面摘要：当前项目：雨夜车站；已确认 6 个分段。/);
  assert.equal(result.body.task.messages.some(message => message.content.includes('当前项目：雨夜车站')), false);
});
```

- [ ] **Step 2: Implement bounded backend serialization**

In `routes/agent.js` append non-empty values to `buildPageContext()`:

```js
const summary = cleanText(context?.summary, 1600);
const entities = context?.entities && typeof context.entities === 'object' ? JSON.stringify(context.entities).slice(0, 1600) : '';
const actions = Array.isArray(context?.actions) ? context.actions.map(action => cleanText(action, 120)).filter(Boolean).slice(0, 6).join('、') : '';
```

Render them as `当前页面摘要`, `当前实体`, `可执行操作`; leave `agentStore.append()` unchanged.

- [ ] **Step 3: Replace stale route context**

Layout dispatches `{ page, pagePath, summary: \`当前位于${pageTitle(pathname)}。\`, entities: {}, actions: [] }`. The pet replaces current context with `normalizePetContext(event.detail)` instead of merge-spreading old business fields.

- [ ] **Step 4: Publish work-page summaries**

`ScriptPage`: character/scene counts, output state, first 12 entities, actions `提取人物与场景` / `生成剧本`.

`TtsPage`: card count, default voice label, generated audio count, actions `检查配音参数` / `生成语音`.

`ShuihuoProductionPage`: project name, segment/asset counts, current view and project ID, actions `检查分段` / `检查资产` / `检查任务状态`; without a project only `创建作品`.

`NovelPanelPage`: only current project/document title and visible stage; do not scrape iframe DOM or raw source text.

- [ ] **Step 5: Verify and commit**

Run: `node --test tests/agent-routes.test.js && npm --prefix frontend run build && git diff --check`

Expected: PASS and Vite exit `0`.

```bash
git add frontend/src/shared/layouts/UserLayout.jsx frontend/src/user/pages/ScriptPage.jsx frontend/src/user/pages/TtsPage.jsx frontend/src/user/pages/ShuihuoProductionPage.jsx frontend/src/user/pages/NovelPanelPage.jsx routes/agent.js tests/agent-routes.test.js
git commit -m "feat: give CM bounded page-specific context"
```

### Task 5: Browser Acceptance Checks

**Files:**
- Modify: `tests/cm-agent-ui-contract.test.js`
- Modify: `frontend/src/shared/pet/overlayGeometry.test.js`

- [ ] **Step 1: Add final coverage**

Assert source contains `title="拖动移动 CM"`, `title="分析当前页面"`, `title="在 Agent 工作区继续"`, `failedRequest`, `重新发送`, plus `水货生产` and `配音` context dispatches.

- [ ] **Step 2: Run complete automated suite**

Run: `node --test frontend/src/shared/pet/overlayGeometry.test.js frontend/src/shared/pet/stacky.test.js tests/cm-agent-ui-contract.test.js tests/agent-routes.test.js`

Expected: all tests PASS.

- [ ] **Step 3: Build and verify service**

Run: `npm --prefix frontend run build && /usr/bin/curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/agent`

Expected: build exit `0`; endpoint prints `200`.

- [ ] **Step 4: Execute authenticated browser verification**

At desktop and narrow mobile sizes: drag CM by its handle to four corners; click sprite opens panel without request; panel never clips; analysis requests from `/script`, `/tts`, `/shuihuo-production`, `/novel-panel` contain matching summaries; `在 Agent 工作区继续` opens same task and history.

- [ ] **Step 5: Report verification boundaries and commit**

Report static tests, browser interactions, and upstream-model limits separately. Do not claim model reply quality if only request payloads were verified.

```bash
git add frontend/src/shared/pet/overlayGeometry.test.js tests/cm-agent-ui-contract.test.js
git commit -m "test: cover CM overlay interaction workflow"
```

## Plan Self-Review

- Tasks 1-2 cover drag separation, placement, history, explicit analysis, retry, and responsive layout.
- Task 3 covers account-scoped task continuity and deep links without weakening backend ownership checks.
- Task 4 covers bounded page context and transient backend formatting without persisting snapshots.
- Task 5 requires both automated and real browser validation. No placeholders or inconsistent API names remain.
