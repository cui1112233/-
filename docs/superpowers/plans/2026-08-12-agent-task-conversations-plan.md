# CM Agent Task Conversations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace CM Agent's single account history with independently persisted, account-scoped task conversations.

**Architecture:** `lib/agent-store.js` will become a versioned per-account task store with one-time migration from `agent-history.json`. `routes/agent.js` will expose task CRUD and require a task ID for chat, using only that task's messages as model context. `AgentPage.jsx` will render a task sidebar and a selected conversation while keeping skills, mode, expert, and attachment controls in the composer.

**Tech Stack:** Node.js CommonJS, Express, Node test runner, React, Ant Design, CSS, local JSON persistence.

---

## File Structure

- Modify: `lib/agent-store.js` - versioned per-account task persistence, migration, ownership-scoped task operations, and message validation.
- Modify: `routes/agent.js` - task CRUD endpoints and task-aware chat orchestration.
- Modify: `frontend/src/shared/api/agent.js` - frontend task API wrappers and task ID in chat payloads.
- Modify: `frontend/src/user/pages/AgentPage.jsx` - task state, task operations, selected task loading, and skill access from the composer.
- Modify: `frontend/src/shared/styles/global.css` - responsive task sidebar, task rows, active state, and compact skill picker styling.
- Modify: `tests/agent-store.test.js` - migration, task isolation, title, capacity, and message persistence coverage.
- Modify: `tests/agent-routes.test.js` - authenticated task API, cross-account rejection, current-task clear/delete, and context-window coverage.
- Modify: `tests/agent-skill-routes.test.js` - task ID adoption for existing chat security tests.
- Modify: `tests/cm-agent-ui-contract.test.js` - static contract checks for task UI and retained composer skill controls.

## Task 1: Replace the flat store with a versioned task store

**Files:**
- Modify: `tests/agent-store.test.js`
- Modify: `lib/agent-store.js`

- [ ] **Step 1: Write failing store tests for migration, automatic titles, and independent tasks**

Replace the flat-message tests with the following task-facing cases. Use a deterministic `id` callback so assertions do not depend on random UUID values.

```js
test('migrates valid legacy history once into an account-local history task', t => {
  const usersDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-agent-store-'));
  t.after(() => fs.rmSync(usersDir, { recursive: true, force: true }));
  const legacyDir = path.join(usersDir, 'writer_a');
  fs.mkdirSync(legacyDir, { recursive: true });
  fs.writeFileSync(path.join(legacyDir, 'agent-history.json'), JSON.stringify([
    { role: 'user', content: '帮我检查第一集冲突', createdAt: '2026-08-12T00:00:00.000Z' },
    { role: 'assistant', content: '先让矛盾提前出现。', createdAt: '2026-08-12T00:01:00.000Z' }
  ]));
  const store = createAgentStore({ usersDir, id: () => 'legacy-task' });

  assert.deepEqual(store.listTasks('writer_a'), [{
    id: 'legacy-task', title: '历史聊天', createdAt: '2026-08-12T00:00:00.000Z',
    updatedAt: '2026-08-12T00:01:00.000Z', messageCount: 2, preview: '先让矛盾提前出现。'
  }]);
  assert.equal(store.getTask('writer_a', 'legacy-task').messages.length, 2);
  assert.equal(fs.existsSync(path.join(legacyDir, 'agent-history.json')), true);
  assert.equal(store.listTasks('writer_a').length, 1);
});

test('keeps tasks and messages isolated by account and titles a new task from its first user message', () => {
  const usersDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-agent-store-'));
  try {
    let sequence = 0;
    const store = createAgentStore({ usersDir, id: () => `task-${++sequence}`, now: () => '2026-08-12T00:00:00.000Z' });
    const task = store.createTask('writer_a');
    store.append('writer_a', task.id, { role: 'user', content: '这是一个超过二十个字的任务标题测试内容' });
    store.append('writer_a', task.id, { role: 'assistant', content: '答复内容' });
    const other = store.createTask('writer_b');

    assert.equal(store.getTask('writer_a', task.id).title, '这是一个超过二十个字的任务标题测试内容，');
    assert.equal(store.getTask('writer_b', task.id), null);
    assert.equal(store.getTask('writer_b', other.id).messages.length, 0);
  } finally { fs.rmSync(usersDir, { recursive: true, force: true }); }
});

test('renames, clears, deletes only the requested task and rejects invalid content', () => {
  const usersDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-agent-store-'));
  try {
    let sequence = 0;
    const store = createAgentStore({ usersDir, id: () => `task-${++sequence}`, maxTasks: 2, maxEntries: 2 });
    const first = store.createTask('writer_a');
    const second = store.createTask('writer_a');
    assert.throws(() => store.createTask('writer_a'), /任务数量已达上限/);
    assert.throws(() => store.append('writer_a', first.id, { role: 'system', content: 'hidden' }), /Invalid agent message/);
    assert.throws(() => store.renameTask('writer_a', first.id, ' '), /任务标题不合法/);
    store.append('writer_a', first.id, { role: 'user', content: 'a' });
    store.append('writer_a', first.id, { role: 'assistant', content: 'b' });
    store.clearTaskMessages('writer_a', first.id);
    assert.equal(store.getTask('writer_a', first.id).messages.length, 0);
    assert.equal(store.getTask('writer_a', second.id).id, second.id);
    assert.equal(store.deleteTask('writer_a', second.id), true);
    assert.equal(store.getTask('writer_a', second.id), null);
  } finally { fs.rmSync(usersDir, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run the store tests to verify they fail**

Run: `node --test tests/agent-store.test.js`

Expected: FAIL because `listTasks`, `getTask`, `createTask`, `renameTask`, `clearTaskMessages`, and task-aware `append` do not exist.

- [ ] **Step 3: Implement the task document reader and atomic writer**

Replace `lib/agent-store.js` with a focused store. Preserve `MAX_MESSAGE_LENGTH = 12000`; add `MAX_TASK_TITLE_LENGTH = 80`, `TASK_DOCUMENT_VERSION = 1`, and `crypto.randomUUID` as the default ID factory. The store constructor accepts `{ usersDir, maxTasks = 100, maxEntries = 100, now, id }`.

Implement the following public interface:

```js
function createAgentStore({ usersDir, maxTasks = 100, maxEntries = 100, now = () => new Date().toISOString(), id = () => crypto.randomUUID() } = {}) {
  function listTasks(username) { /* returns task summaries sorted newest first */ }
  function getTask(username, taskId) { /* returns a cloned task with messages or null */ }
  function createTask(username) { /* returns a cloned empty task */ }
  function renameTask(username, taskId, title) { /* returns a cloned task or null */ }
  function append(username, taskId, message) { /* returns appended message or null when task is absent */ }
  function clearTaskMessages(username, taskId) { /* returns cloned task or null */ }
  function deleteTask(username, taskId) { /* returns true when removed */ }
  return { listTasks, getTask, createTask, renameTask, append, clearTaskMessages, deleteTask };
}
```

Use `safeUserName(username)` before deriving `users/<username>/agent-tasks.json`. `readDocument` must accept only `{ version: 1, tasks: [] }` with valid task objects and valid user/assistant message objects. If the target file is absent, migrate valid entries from `agent-history.json` into exactly one `历史聊天` task, otherwise initialize `{ version: 1, tasks: [] }`.

Write with `fs.writeFileSync(tempPath, JSON.stringify(document, null, 2), { encoding: 'utf8', mode: 0o600 })`, then `fs.renameSync(tempPath, taskPath)`. Build temp paths in the same user directory using an ID-derived suffix so rename remains atomic. Never write page context or arbitrary message properties: append only `{ role, content, createdAt }`.

When the first valid user message is appended to a task whose `titleMode` is `automatic` and title is `新聊天`, set `title` to `Array.from(content).slice(0, 20).join('')`. A rename validates a trimmed title between 1 and 80 Unicode characters and sets `titleMode: 'manual'`. Update `updatedAt` for create, append, rename, and clear.

- [ ] **Step 4: Run the store tests to verify they pass**

Run: `node --test tests/agent-store.test.js`

Expected: PASS with all migration, per-account, automatic-title, capacity, clear, delete, and validation tests green.

- [ ] **Step 5: Commit the store change**

```bash
git add lib/agent-store.js tests/agent-store.test.js
git commit -m "feat: persist agent task conversations"
```

## Task 2: Add authenticated task APIs and task-aware chat

**Files:**
- Modify: `tests/agent-routes.test.js`
- Modify: `tests/agent-skill-routes.test.js`
- Modify: `routes/agent.js`

- [ ] **Step 1: Write failing route tests for task CRUD, isolation, and scoped model history**

In `tests/agent-routes.test.js`, replace the legacy `/history` assertion with a test that creates two accounts, creates one task for the first account, posts chat with that task ID, and asserts the persisted JSON omits `novelText` and `scriptOutput`.

Add this ownership and lifecycle test:

```js
test('Agent task endpoints scope reads and mutations to the authenticated account', async t => {
  const systemDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-agent-route-'));
  t.after(() => fs.rmSync(systemDir, { recursive: true, force: true }));
  let sequence = 0;
  const app = createApp({
    accountStore: createAccountStore({ systemDir }), tokenMap: new Map(), sessionsPath: path.join(systemDir, 'sessions.json'),
    agentStore: createAgentStore({ usersDir: path.join(systemDir, 'users'), id: () => `task-${++sequence}` }),
    agentResponder: async () => '候选答复'
  });
  const owner = await request(app, { method: 'POST', requestPath: '/api/login', body: { username: 'writer_a', password: '123456' } });
  const other = await request(app, { method: 'POST', requestPath: '/api/login', body: { username: 'writer_b', password: '123456' } });
  const created = await request(app, { method: 'POST', requestPath: '/api/agent/tasks', token: owner.body.token });
  const taskId = created.body.task.id;

  assert.equal(created.status, 201);
  assert.equal((await request(app, { requestPath: '/api/agent/tasks', token: owner.body.token })).body.tasks.length, 1);
  for (const requestPath of [`/api/agent/tasks/${taskId}`, `/api/agent/tasks/${taskId}/messages`]) {
    const result = await request(app, { method: requestPath.endsWith('/messages') ? 'DELETE' : 'GET', requestPath, token: other.body.token });
    assert.equal(result.status, 404);
  }
  assert.equal((await request(app, { method: 'PATCH', requestPath: `/api/agent/tasks/${taskId}`, token: other.body.token, body: { title: '越权' } })).status, 404);
  assert.equal((await request(app, { method: 'DELETE', requestPath: `/api/agent/tasks/${taskId}`, token: other.body.token })).status, 404);
  assert.equal((await request(app, { method: 'POST', requestPath: '/api/agent/chat', token: other.body.token, body: { taskId, prompt: '越权写入' } })).status, 404);
});
```

Add a responder-capture test that sends messages in two tasks, then verifies the final responder `messages` contains the first task's context but no content from the second task.

In `tests/agent-skill-routes.test.js`, add a helper that creates `/api/agent/tasks` for each logged-in user and include `taskId` in each existing `/api/agent/chat` body. This preserves the security tests while adopting the required chat contract.

- [ ] **Step 2: Run the route tests to verify they fail**

Run: `node --test tests/agent-routes.test.js tests/agent-skill-routes.test.js`

Expected: FAIL because `/api/agent/tasks` does not exist and `/api/agent/chat` does not require a task ID.

- [ ] **Step 3: Implement task routes and require a task ID for chat**

In `routes/agent.js`, remove `GET /history` and `DELETE /history`. Add a small `sendTaskNotFound(res)` helper that sends `404` with `{ error: 'Not found' }`.

Implement these handlers before `/chat`:

```js
router.get('/tasks', (req, res) => res.json({ tasks: agentStore.listTasks(req.username) }));

router.post('/tasks', (req, res) => {
  try { return res.status(201).json({ task: agentStore.createTask(req.username) }); }
  catch (error) { return res.status(400).json({ error: error.message || '无法创建任务' }); }
});

router.get('/tasks/:taskId', (req, res) => {
  const task = agentStore.getTask(req.username, req.params.taskId);
  return task ? res.json({ task }) : sendTaskNotFound(res);
});

router.patch('/tasks/:taskId', (req, res) => {
  try {
    const task = agentStore.renameTask(req.username, req.params.taskId, req.body?.title);
    return task ? res.json({ task }) : sendTaskNotFound(res);
  } catch (error) { return res.status(400).json({ error: error.message || '任务标题不合法' }); }
});

router.delete('/tasks/:taskId/messages', (req, res) => {
  const task = agentStore.clearTaskMessages(req.username, req.params.taskId);
  return task ? res.status(204).end() : sendTaskNotFound(res);
});

router.delete('/tasks/:taskId', (req, res) => (
  agentStore.deleteTask(req.username, req.params.taskId) ? res.status(204).end() : sendTaskNotFound(res)
));
```

At the start of `/chat`, validate `taskId` is a non-empty string and fetch `agentStore.getTask(req.username, taskId)`. Return `400` for missing task ID, `404` for unknown or foreign tasks. Append user and assistant messages with `agentStore.append(req.username, taskId, ...)`; if either append returns `null`, return `404` and do not recreate the task.

Build history with `task.messages.slice(-HISTORY_WINDOW)` before appending the current user message. Pass `{ history, prompt, context, skills }` to `buildAgentMessages` as before, and return `{ task: agentStore.getTask(req.username, taskId), user, assistant }` after the assistant is persisted. Preserve rate limits, refusal behavior, selected-skill resolution, and upstream error behavior.

- [ ] **Step 4: Run route tests to verify they pass**

Run: `node --test tests/agent-routes.test.js tests/agent-skill-routes.test.js`

Expected: PASS. Cross-account task IDs receive `404`; only active task messages reach the responder; skills remain resolved without exposing their bodies.

- [ ] **Step 5: Commit the route change**

```bash
git add routes/agent.js tests/agent-routes.test.js tests/agent-skill-routes.test.js
git commit -m "feat: add account scoped agent task APIs"
```

## Task 3: Replace legacy frontend calls with task API wrappers

**Files:**
- Modify: `frontend/src/shared/api/agent.js`
- Modify: `tests/cm-agent-ui-contract.test.js`

- [ ] **Step 1: Write a failing static contract for the task API surface**

Add this test to `tests/cm-agent-ui-contract.test.js`:

```js
test('CM Agent frontend uses task-scoped APIs and keeps skills available from the composer', () => {
  const api = read('frontend/src/shared/api/agent.js');
  const page = read('frontend/src/user/pages/AgentPage.jsx');

  assert.match(api, /export function listAgentTasks\(\)/);
  assert.match(api, /export function createAgentTask\(\)/);
  assert.match(api, /export function getAgentTask\(id\)/);
  assert.match(api, /export function renameAgentTask\(id, title\)/);
  assert.match(api, /export function clearAgentTask\(id\)/);
  assert.match(api, /export function deleteAgentTask\(id\)/);
  assert.match(api, /taskId/);
  assert.match(page, /listAgentTasks/);
  assert.match(page, /createAgentTask/);
  assert.match(page, /activeTaskId/);
  assert.match(page, /agent-task-sidebar/);
  assert.match(page, /openComposerTool\('skill'\)/);
});
```

- [ ] **Step 2: Run the UI contract test to verify it fails**

Run: `node --test tests/cm-agent-ui-contract.test.js`

Expected: FAIL because the API exports and task sidebar identifiers do not exist.

- [ ] **Step 3: Implement the task API wrappers**

In `frontend/src/shared/api/agent.js`, remove `getAgentHistory` and `clearAgentHistory`. Add these wrappers:

```js
export function listAgentTasks() { return apiRequest('/api/agent/tasks'); }
export function createAgentTask() { return apiRequest('/api/agent/tasks', { method: 'POST' }); }
export function getAgentTask(id) { return apiRequest(`/api/agent/tasks/${encodeURIComponent(id)}`); }
export function renameAgentTask(id, title) {
  return apiRequest(`/api/agent/tasks/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ title }) });
}
export function clearAgentTask(id) { return apiRequest(`/api/agent/tasks/${encodeURIComponent(id)}/messages`, { method: 'DELETE' }); }
export function deleteAgentTask(id) { return apiRequest(`/api/agent/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
```

Change `askAgent` to accept `{ taskId, prompt, context, skillIds = [] }` and serialize all four fields. Keep skill CRUD exports unchanged.

- [ ] **Step 4: Run the UI contract test to verify the API portion now passes**

Run: `node --test tests/cm-agent-ui-contract.test.js`

Expected: FAIL only on `AgentPage.jsx` task sidebar assertions, confirming the API wrapper portion is present.

- [ ] **Step 5: Commit the frontend API change**

```bash
git add frontend/src/shared/api/agent.js tests/cm-agent-ui-contract.test.js
git commit -m "feat: add agent task frontend API"
```

## Task 4: Implement the CM task sidebar and task lifecycle UI

**Files:**
- Modify: `frontend/src/user/pages/AgentPage.jsx`
- Modify: `frontend/src/shared/styles/global.css`
- Modify: `tests/cm-agent-ui-contract.test.js`

- [ ] **Step 1: Extend the failing UI contract for task operations and skill-library removal**

Add assertions that the page uses `Modal` for renaming, calls `clearAgentTask` and `deleteAgentTask`, contains `新建聊天`, and no longer renders `agent-skill-library` as a top-level aside.

```js
assert.match(page, /title="新建聊天"|>新建聊天</);
assert.match(page, /renameAgentTask/);
assert.match(page, /clearAgentTask/);
assert.match(page, /deleteAgentTask/);
assert.match(page, /<Modal title="重命名任务"/);
assert.doesNotMatch(page, /<aside className="agent-skill-library/);
assert.match(css, /\.agent-task-sidebar/);
assert.match(css, /\.agent-task-row\.active/);
```

- [ ] **Step 2: Run the UI contract test to verify it fails**

Run: `node --test tests/cm-agent-ui-contract.test.js`

Expected: FAIL because the current page still renders a large skills aside and has a global history clear action.

- [ ] **Step 3: Refactor `AgentPage.jsx` around selected task state**

Update imports to include `Tooltip` and the task API wrappers. Replace `messages` with:

```js
const [tasks, setTasks] = useState([]);
const [activeTaskId, setActiveTaskId] = useState(null);
const [activeTask, setActiveTask] = useState(null);
const [loadingTask, setLoadingTask] = useState(false);
const [renameOpen, setRenameOpen] = useState(false);
const [renameTitle, setRenameTitle] = useState('');
```

Add these helpers:

```js
async function refreshTasks({ selectId } = {}) {
  const result = await listAgentTasks();
  const next = Array.isArray(result.tasks) ? result.tasks : [];
  setTasks(next);
  const nextId = selectId || activeTaskId;
  if (nextId && next.some(task => task.id === nextId)) return loadTask(nextId);
  if (next[0]) return loadTask(next[0].id);
  setActiveTaskId(null); setActiveTask(null);
}

async function loadTask(id) {
  setLoadingTask(true);
  try {
    const result = await getAgentTask(id);
    setActiveTaskId(result.task.id);
    setActiveTask(result.task);
  } finally { setLoadingTask(false); }
}
```

On mount, call `Promise.all([refreshTasks(), loadSkills()])`; retain pet context dispatch. Scroll the history from `activeTask?.messages` instead of a global message list.

Add `createTask`, `saveRename`, `clearCurrentTask`, and `removeCurrentTask` functions. Each catches API errors with the existing `message.error` style. Create selects the returned task. After clear, reload that task and task list. After delete, refresh and select the first remaining task. The popconfirm copy must explicitly say it affects only the current task.

In `sendQuestion`, if no active task exists, await `createAgentTask()` and retain its returned ID. Send `askAgent({ taskId, prompt, context, skillIds: selectedSkillIds })`. On success set `activeTask` from `result.task`, refresh task summaries without changing selection, then retain the existing CM pet state behavior. Do not persist attachments or selection state.

Replace the current outer skills `<aside>` with this task sidebar before the workbench:

```jsx
<aside className="agent-task-sidebar cm-conversation-frame" aria-label="CM 任务列表">
  <header>
    <Typography.Title level={4}>任务</Typography.Title>
    <Button type="primary" size="small" onClick={createTask}>新建聊天</Button>
  </header>
  <div className="agent-task-list">
    {tasks.map(task => <button type="button" key={task.id}
      className={`agent-task-row${task.id === activeTaskId ? ' active' : ''}`}
      onClick={() => loadTask(task.id)}>
      <strong>{task.title}</strong><span>{task.preview || '还没有消息'}</span><time>{formatTaskTime(task.updatedAt)}</time>
    </button>)}
    {!loading && tasks.length === 0 ? <div className="agent-task-empty">新建一段 CM 对话。</div> : null}
  </div>
</aside>
```

Use a local `formatTaskTime(value)` function that displays `今天 HH:mm` for same-day messages and `MM-DD HH:mm` otherwise. It must return `--` for invalid timestamps.

Make the workbench header show `activeTask?.title || 'CM Agent'`. Replace the global clear control with compact Ant Design `Button` controls labeled `重命名`, `清空`, and `删除`, each inside a `Tooltip` that explains its current-task scope. The frontend currently has no icon package installed, so this change must not add one solely for three task actions.

Keep the skills editor modal and move its discoverability to the `composerPanel === 'skill'` section. Prepend a `新建我的技能` button and render `visibleSkills` as compact selectable cards with template, edit, and delete actions. Preserve the maximum-three selected skills rule and all current skill CRUD behavior.

Add the rename modal after the skill modal:

```jsx
<Modal title="重命名任务" open={renameOpen} onCancel={() => setRenameOpen(false)}
  onOk={saveRename} okButtonProps={{ disabled: !renameTitle.trim() }}>
  <Input value={renameTitle} maxLength={80} autoFocus onChange={event => setRenameTitle(event.target.value)} />
</Modal>
```

- [ ] **Step 4: Add scoped, responsive task sidebar styles**

Replace the old `.agent-page--skills-collapsed`, `.agent-skill-library`, `.agent-skill-list`, and `.agent-skill-card` layout styles with task-specific CSS. Preserve the existing CM frame and composer colors so the theme remains readable.

```css
.agent-page { display: grid; grid-template-columns: minmax(248px, 316px) minmax(0, 1fr); gap: 16px; height: 100%; padding: 24px; }
.agent-task-sidebar { display: flex; min-height: 520px; flex-direction: column; gap: 14px; padding: 16px; overflow: hidden; }
.agent-task-sidebar > header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.agent-task-sidebar .ant-typography { margin: 0; color: var(--legacy-text); }
.agent-task-list { display: flex; min-height: 0; flex: 1; flex-direction: column; gap: 6px; overflow-y: auto; }
.agent-task-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 8px; width: 100%; border: 1px solid transparent; border-radius: 7px; padding: 11px; background: transparent; color: var(--legacy-text); cursor: pointer; font: inherit; text-align: left; }
.agent-task-row:hover, .agent-task-row:focus-visible { border-color: var(--legacy-border-strong); background: var(--legacy-input); outline: none; }
.agent-task-row.active { border-color: var(--legacy-accent); background: var(--legacy-accent-dim); box-shadow: inset 3px 0 0 var(--legacy-accent); }
.agent-task-row strong, .agent-task-row span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.agent-task-row span, .agent-task-row time { color: var(--legacy-muted); font-size: 12px; }
.agent-task-row time { grid-column: 2; grid-row: 1; white-space: nowrap; }
.agent-task-empty { padding: 18px 8px; color: var(--legacy-muted); font-size: 13px; text-align: center; }
```

Keep `.agent-workbench` at full available width by changing `width: min(900px, 100%)` to `width: 100%`. Add a responsive rule at `max-width: 860px` that creates a vertical layout, gives the task list `max-height: 190px`, and prevents task row text from expanding the page width.

- [ ] **Step 5: Run UI contract and frontend build checks**

Run: `node --test tests/cm-agent-ui-contract.test.js && npm --prefix frontend run build`

Expected: PASS. The React build completes with no unresolved imports and the static contract confirms task operations plus composer skill access.

- [ ] **Step 6: Commit the task UI**

```bash
git add frontend/src/user/pages/AgentPage.jsx frontend/src/shared/styles/global.css tests/cm-agent-ui-contract.test.js
git commit -m "feat: add CM task conversation workspace"
```

## Task 5: Run complete regression checks and verify in a real browser

**Files:**
- Verify only; no code changes expected.

- [ ] **Step 1: Run all focused Agent tests**

Run:

```bash
node --test tests/agent-store.test.js tests/agent-routes.test.js tests/agent-skill-routes.test.js tests/cm-agent-ui-contract.test.js
```

Expected: PASS with no skipped or failing tests.

- [ ] **Step 2: Run frontend and architecture validation**

Run:

```bash
npm --prefix frontend run build
node scripts/validate-react-frontend-architecture.js
```

Expected: both commands exit `0`.

- [ ] **Step 3: Restart the local service and verify its health**

Run:

```bash
launchctl kickstart -k gui/$(id -u)/com.ming.qiantie
sleep 2
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/agent
```

Expected: the final line is `200`.

- [ ] **Step 4: Perform an authenticated browser acceptance pass at `http://127.0.0.1:3000/agent`**

Use the existing signed-in account to:

1. Create two chats and confirm both rows show in the task list.
2. Send a short message to each chat and switch back and forth; confirm messages do not mix.
3. Rename the first task; reload the page and confirm the name and messages persist.
4. Clear the first task; confirm the second task retains its messages.
5. Delete the first task; confirm the second task stays selected or becomes selected.
6. Open the composer `技能` panel and confirm skills can still be selected, edited, and created.
7. Inspect browser console for errors and verify task rows, header actions, and text contrast in the active theme.

Expected: no console errors, no overlap or clipping, and all actions affect only the active account/task.

- [ ] **Step 5: Commit only verification-related test corrections if any were required**

```bash
git status --short
git add tests/agent-store.test.js tests/agent-routes.test.js tests/agent-skill-routes.test.js tests/cm-agent-ui-contract.test.js
git commit -m "test: verify agent task conversations"
```

Do not commit unrelated files shown by `git status --short`. If no test correction was required, do not create an empty commit.

## Plan Self-Review

- Spec coverage: Task 1 covers versioned persistence, atomic writes, 100-task/message limits, title rules, and legacy migration. Task 2 covers every task route, account ownership, `404` behavior, task-only model context, and retained safeguards. Tasks 3 and 4 cover the frontend API, task sidebar, task actions, retained composer functionality, and responsive styling. Task 5 covers focused tests, build, architecture check, restart, and authenticated browser evidence.
- Completeness scan: all implementation and test steps contain concrete paths, code, commands, and expected outcomes.
- Type consistency: task operations consistently use `taskId`; store methods use `(username, taskId, ...)`; API response property is `task`; task summaries use `preview`; chat responses include `{ task, user, assistant }`.
