# 剧本用户约束提示词 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 提供后端账号级、跨设备、严格隔离且按实际使用置顶的剧本个人约束提示词库。

**Architecture:** 新增独立 JSON 事务存储和认证路由，所有记录使用 `req.username` 做服务端所有权边界。剧本草稿只保存所选来源、系统 ID 或个人 ID 与当前编辑正文；生成路由对个人记录重新从后端读取并只在成功接受时更新最近使用时间。

**Tech Stack:** Node.js、Express、node:test、React 18、Ant Design、既有 JSON 事务锁与认证中间件。

## Global Constraints

- 仅适用于 `prefix`、`quality`、`restriction`、`negative` 四类约束；`shortdrama` 不注入约束。
- 移除“台词添加词”及任何两段内容拼接；每个分类只使用一个完整正文。
- 个人提示词必须持久化在服务端 `data/system`，不可用 localStorage 作为个人库。
- 每条记录的用户名由 `req.username` 推导，前端不得传 username；跨账号记录操作统一返回不存在。
- 命名个人提示词名称为 1–80 字，正文 1–12000 字；每账号每分类最多 100 条命名记录，且至多一条未命名副本。
- 仅成功接收剧本生成请求会更新 `lastUsedAt`；查询、编辑、保存不得改变排序。
- 列表排序固定为 `lastUsedAt DESC NULLS LAST, updatedAt DESC, createdAt DESC`。
- 系统预设继续由管理员维护；用户修改与保存绝不写回系统预设或暴露管理后台协议锁。

---

## 文件结构

- Create: `lib/script-constraint-prompt-store.js` — 个人提示词的 JSON 数据校验、事务 CRUD、所有权查询、使用时间与排序。
- Create: `routes/script-constraint-prompts.js` — 所有个人提示词 REST API，使用 `apiAuth`。
- Modify: `server.js` — 注册个人提示词路由。
- Modify: `routes/chat.js` — 个人提示词的服务端解析与成功生成后的使用时间更新。
- Modify: `frontend/src/shared/api/generation.js` — 个人提示词库 API 客户端。
- Modify: `frontend/src/user/pages/scriptConstraints.js` — 分类状态迁移为 source/personalPromptId/body，移除 customText 语义。
- Modify: `frontend/src/user/pages/ScriptPage.jsx` — 系统/个人来源、完整可编辑正文、保存未命名副本、命名保存、删除与使用选择。
- Create: `tests/script-constraint-prompt-store.test.js` — 存储、隔离、配额和 LRU 测试。
- Create: `tests/script-constraint-prompts-routes.test.js` — API 认证、跨账号保护、验证与排序测试。
- Modify: `tests/script-chat.test.js` — 个人提示词服务端解析及 `shortdrama` 回归测试。
- Modify: `tests/script-constraints.test.js` — 旧草稿迁移与新状态归一化测试。

### Task 1: 个人提示词服务端存储

**Files:**
- Create: `lib/script-constraint-prompt-store.js`
- Create: `tests/script-constraint-prompt-store.test.js`

**Interfaces:**
- Produces `createScriptConstraintPromptStore({ systemDir, lockTimeoutMs, lockRetryMs })`.
- Store methods: `list(username, category)`, `createOrSaveDraft(username, input)`, `update(username, id, patch)`, `remove(username, id)`, `getOwned(username, id)`, `markUsed(username, ids)`.
- Personal record shape: `{ id, username, category, name, body, createdAt, updatedAt, lastUsedAt }`.

- [ ] **Step 1: 写失败的隔离与最近使用排序测试**

在 `tests/script-constraint-prompt-store.test.js` 创建临时 systemDir，添加：

```js
test('keeps personal prompts private and moves actual usage to the top', async t => {
  const store = createStore(t);
  const first = store.createOrSaveDraft('alice', { category: 'prefix', name: '暖色 2D', body: '二维动画暖色' });
  const second = store.createOrSaveDraft('alice', { category: 'prefix', name: '电影光影', body: '电影级光影' });
  assert.equal(store.getOwned('bob', first.id), null);
  store.markUsed('alice', [first.id]);
  assert.deepEqual(store.list('alice', 'prefix').map(item => item.id), [first.id, second.id]);
  store.markUsed('alice', [second.id]);
  assert.deepEqual(store.list('alice', 'prefix').map(item => item.id), [second.id, first.id]);
});
```

另写：未命名记录重复保存只更新同一条、101 条命名记录被拒绝、无效分类/空正文/81 字名称被拒绝。

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/script-constraint-prompt-store.test.js`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现严格校验和事务存储**

使用 `system-store.js` 的 `readJsonOrMissing`、`withJsonLock`、`writeJsonTransaction` 与 `recoverJsonTransaction`，在 `data/system/script-constraint-prompts.json` 保存：

```js
{ version: 1, prompts: [] }
```

分类仅接受：

```js
const CATEGORIES = new Set(['prefix', 'quality', 'restriction', 'negative']);
```

`createOrSaveDraft` 在 `name === null` 时寻找同用户名、同分类、`name === null` 的记录并更新正文，否则生成 `crypto.randomUUID()`。`list` 仅过滤传入用户名和分类，按 `lastUsedAt` 空值最后、再 `updatedAt`/`createdAt` 倒序排列。`getOwned` 查不到或用户名不符时返回 `null`；`markUsed` 忽略不属于用户名的 ID，单次写入相同 ISO 时间。

- [ ] **Step 4: 运行存储测试确认通过**

Run: `node --test tests/script-constraint-prompt-store.test.js`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add lib/script-constraint-prompt-store.js tests/script-constraint-prompt-store.test.js
git commit -m "feat: add private script constraint prompt store"
```

### Task 2: 认证 API 与跨账号保护

**Files:**
- Create: `routes/script-constraint-prompts.js`
- Modify: `server.js`
- Create: `tests/script-constraint-prompts-routes.test.js`

**Interfaces:**
- `createScriptConstraintPromptsRouter({ promptStore })` returns Express router protected by `apiAuth`.
- `GET /api/script-constraint-prompts?category=prefix` returns `{ prompts }` for current account.
- `POST /api/script-constraint-prompts` creates named record or upserts unnamed draft.
- `PUT /api/script-constraint-prompts/:id`, `DELETE /api/script-constraint-prompts/:id` require ownership and return 404 for another user.
- `POST /api/script-constraint-prompts/usage` accepts `{ ids: string[] }` and only marks owned records.

- [ ] **Step 1: 写失败的路由隔离测试**

在 `tests/script-constraint-prompts-routes.test.js` 创建应用、登录 alice 与 bob，添加：

```js
test('personal prompt routes isolate accounts and order used prompts', async t => {
  const { app, login } = await createPromptApp(t);
  const alice = await login(app, 'alice');
  const bob = await login(app, 'bob');
  const created = await request(app, { method: 'POST', requestPath: '/api/script-constraint-prompts', token: alice.token, body: { category: 'prefix', name: 'Alice 2D', body: 'Alice prompt' } });
  assert.equal(created.status, 201);
  const forbidden = await request(app, { method: 'DELETE', requestPath: `/api/script-constraint-prompts/${created.body.prompt.id}`, token: bob.token });
  assert.equal(forbidden.status, 404);
  const used = await request(app, { method: 'POST', requestPath: '/api/script-constraint-prompts/usage', token: alice.token, body: { ids: [created.body.prompt.id] } });
  assert.equal(used.status, 200);
});
```

增加无令牌 401、错误 category 400、空 body 400、带 `username` 字段不改变归属、未命名 POST 重复返回同 ID 的断言。

- [ ] **Step 2: 运行路由测试确认失败**

Run: `node --test tests/script-constraint-prompts-routes.test.js`

Expected: FAIL，路由未注册。

- [ ] **Step 3: 实现 API 与服务器依赖注入**

路由中 `router.use(apiAuth)`，每个存储调用传 `req.username`。POST 从请求体取 `category`、`name`、`body`，不读取 username；PUT 仅接受 `name`、`body`。不存在/不归属记录统一：

```js
return res.status(404).json({ error: '提示词不存在' });
```

在 `server.js` 建立 store 并挂载 `/api/script-constraint-prompts`，测试应用构建注入临时 systemDir 的 store。

- [ ] **Step 4: 运行路由测试确认通过**

Run: `node --test tests/script-constraint-prompts-routes.test.js`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add routes/script-constraint-prompts.js server.js tests/script-constraint-prompts-routes.test.js
git commit -m "feat: expose private script constraint prompt APIs"
```

### Task 3: 草稿迁移与生成时可信个人正文

**Files:**
- Modify: `frontend/src/user/pages/scriptConstraints.js`
- Modify: `routes/chat.js`
- Modify: `tests/script-constraints.test.js`
- Modify: `tests/script-chat.test.js`

**Interfaces:**
- Normalized layer: `{ enabled, source: 'system'|'personal'|'draft', presetId, personalPromptId, body }`.
- `constraintsForFormat` preserves new layer fields for allowed formats and disables all constraints for `shortdrama`.
- `buildScriptMessages(input, presetStore, personalPromptStore, username)` resolves personal records through `personalPromptStore.getOwned(username, id)`.

- [ ] **Step 1: 写失败的迁移和服务端可信正文测试**

在 `tests/script-constraints.test.js` 增加：

```js
test('migrates legacy custom text into editable draft body', async () => {
  const { normalizeScriptConstraints } = await constraintsModule();
  const result = normalizeScriptConstraints({ enabled: true, prefix: { presetId: '', customText: '旧个人正文' } });
  assert.equal(result.prefix.source, 'draft');
  assert.equal(result.prefix.body, '旧个人正文');
  assert.equal(result.prefix.personalPromptId, '');
});
```

在 `tests/script-chat.test.js` 添加 personal store stub，断言 `source: 'personal'` 时即使浏览器传 `body: '伪造正文'`，系统提示词只含后端记录正文；另一用户 ID 不注入；`shortdrama` 不含任何约束标题。

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/script-constraints.test.js tests/script-chat.test.js`

Expected: FAIL，因为当前状态仍使用 `customText` 且 chat 不接收 personal store。

- [ ] **Step 3: 实现草稿归一化和后端解析**

归一化规则：旧 `presetId` 映射 `source: 'system'`；旧 `customText` 映射 `body`。若没有 presetId 且 body 非空，`source: 'draft'`；新 personal 状态保存 `personalPromptId`。

在 chat 约束解析中：

```js
if (value.source === 'personal') {
  const prompt = personalPromptStore.getOwned(username, value.personalPromptId);
  return prompt?.category === category ? prompt.body : '';
}
if (value.source === 'draft') return String(value.body || '').trim();
```

系统来源仍验证已发布 `constraint` addon，且只用服务端系统正文。删除旧的预设+customText 拼接逻辑。

- [ ] **Step 4: 运行迁移与生成测试确认通过**

Run: `node --test tests/script-constraints.test.js tests/script-chat.test.js`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/user/pages/scriptConstraints.js routes/chat.js tests/script-constraints.test.js tests/script-chat.test.js
git commit -m "feat: resolve trusted personal script constraints"
```

### Task 4: 个人提示词库界面与实际使用置顶

**Files:**
- Modify: `frontend/src/shared/api/generation.js`
- Modify: `frontend/src/user/pages/ScriptPage.jsx`
- Modify: `routes/chat.js`
- Modify: `tests/script-ui-contract.test.js` or existing script UI test file
- Modify: `tests/script-chat.test.js`

**Interfaces:**
- Client API functions: `listScriptConstraintPrompts(category)`, `saveScriptConstraintPrompt(payload)`, `updateScriptConstraintPrompt(id, payload)`, `deleteScriptConstraintPrompt(id)`, `markScriptConstraintPromptsUsed(ids)`.
- UI saves current editable body using POST; named save opens a name input modal and sends `{ category, name, body }`; unnamed save sends `{ category, name: null, body }`.
- Generate request includes `personalPromptId` for selected personal layers; server marks only selected owned IDs after successful request acceptance.

- [ ] **Step 1: 写 UI 与成功生成置顶失败测试**

在已有 UI 契约测试添加：

```js
test('constraint modal supports personal prompt source and saving complete editable text', () => {
  const page = read('frontend/src/user/pages/ScriptPage.jsx');
  assert.match(page, /系统预设/);
  assert.match(page, /我的提示词/);
  assert.match(page, /保存当前草稿/);
  assert.match(page, /保存为我的提示词/);
  assert.match(page, /提示词内容/);
});
```

在 chat 测试为真实成功的生成路由路径添加 personal store spy，断言成功请求调用：

```js
personalPromptStore.markUsed(username, [personalPromptId]);
```

并新增上游失败断言：上游请求失败时不调用 `markUsed`。

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/script-chat.test.js tests/script-ui-contract.test.js`

Expected: FAIL，因为无个人库 UI 与生成后使用记录。

- [ ] **Step 3: 实现客户端与 UI**

在 generation API 加入 REST 请求函数。`ScriptPage` 在打开某分类、切换“我的提示词”来源时加载该类别列表。个人列表直接使用服务端顺序；显示无名称项为“未命名个人副本”。

系统预设选择后将正文载入 `body`，设置 `source: 'system'`；用户编辑正文后设置 `source: 'draft'` 并保留原始 ID 仅供保存操作。选择个人记录时设置 `source: 'personal'`、`personalPromptId` 与显示正文。

添加“保存当前草稿”：调用 POST `{ category, name: null, body }`，返回后将当前层设置为 `source: 'personal'` 和返回 ID。添加“保存为我的提示词”：在名称 Modal 获取名称后调用 POST，成功后选择新记录。提供仅对个人条目可见的编辑/删除操作，删除后清空当前个人选择，保留其正文为 `source: 'draft'`。

- [ ] **Step 4: 实现成功生成后的使用记录**

在 chat 成功发送上游请求并确认已接受后，收集启用分类中 `source === 'personal'` 的个人 ID，调用注入 store 的 `markUsed(req.username, ids)`。使用记录失败不得让已经成功的生成请求失败；记录失败写结构化错误日志但不返回个人正文。

- [ ] **Step 5: 运行 UI 和生成回归测试**

Run: `node --test tests/script-chat.test.js tests/script-ui-contract.test.js`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add frontend/src/shared/api/generation.js frontend/src/user/pages/ScriptPage.jsx routes/chat.js tests/script-chat.test.js tests/script-ui-contract.test.js
git commit -m "feat: manage reusable personal script constraints"
```

### Task 5: 全链路验证

**Files:**
- Test: `tests/script-constraint-prompt-store.test.js`
- Test: `tests/script-constraint-prompts-routes.test.js`
- Test: `tests/script-constraints.test.js`
- Test: `tests/script-chat.test.js`
- Test: existing script UI contract file

- [ ] **Step 1: 运行专属自动化测试**

Run: `node --test tests/script-constraint-prompt-store.test.js tests/script-constraint-prompts-routes.test.js tests/script-constraints.test.js tests/script-chat.test.js tests/script-ui-contract.test.js`

Expected: PASS。

- [ ] **Step 2: 运行安全治理回归与前端构建**

Run: `node --test tests/governance-routes.test.js`

Expected: PASS，公开目录不返回 `body` 或 `protocolLock`。

Run: `npm run frontend:build`

Expected: PASS；允许既有 bundle 大小告警，不允许构建失败。

- [ ] **Step 3: 手动验收**

使用账号 A 打开剧本约束设置，选择系统“2D 动漫”，改写正文并保存为“账号 A 2D”；刷新或使用另一浏览器登录账号 A，确认其可见。使用账号 B 登录，确认无法看到账号 A 内容。账号 A 先生成使用“账号 A 2D”，再生成使用另一条个人提示词，确认第二条排第一、第一条排第二。保存未命名副本但不生成，确认其排序不变。切换剧本模式，确认约束仍不注入。

- [ ] **Step 4: 提交**

```bash
git add lib routes frontend/src tests
git commit -m "test: verify private reusable script constraints"
```

## 计划自检

- Task 1 实现后端跨设备持久化、配额、未命名副本和 LRU 排序。
- Task 2 实现认证 API、账号隔离和跨账号不可枚举。
- Task 3 实现旧草稿兼容及个人正文的服务端可信解析。
- Task 4 实现完整编辑界面、命名/未命名保存以及仅实际生成置顶。
- Task 5 覆盖安全、功能、构建和浏览器验收。
- 全部任务不修改系统预设正文，也不让前端把 personal body 当作已保存记录的可信来源。