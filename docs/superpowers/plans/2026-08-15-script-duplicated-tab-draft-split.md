# 剧本复制标签页草稿自动拆分 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 按任务逐项执行。步骤使用 checkbox（`- [ ]`）跟踪。

**Goal:** 在浏览器复制剧本标签页时自动分配新的草稿 ID，避免复制页面覆盖原页面草稿。

**Architecture:** 新建纯 JavaScript 协调器，封装 `BroadcastChannel` 占用探测、响应、超时清理和 tab ID 拆分判定。`ScriptPage` 在草稿读取与自动保存前等待协调器完成；若发现同 ID 的原页面，复制页更新自己的 `sessionStorage` ID 并只加载新草稿键。历史与生成链路保持原样。

**Tech Stack:** React、浏览器 `BroadcastChannel` / `sessionStorage`、Node 内置 `node:test`。

## Global Constraints

- 仅修改剧本标签页草稿协调、`ScriptPage` 生命周期和对应测试；不修改 AI、后端协议、`saveHistory`、历史数据结构或草稿键格式。
- 探测频道名必须为 `qiantie:script-draft-tabs`；消息只允许 `probe`、`occupied` 两种类型。
- 原标签页保持原 `tabId` 与草稿不变；被复制的页面必须拿到新 `tabId`，并仅更新自身 `sessionStorage`。
- 无占用响应时必须保留原 ID，保证普通刷新与普通导航返回仍恢复原草稿。
- 不支持或无法创建 `BroadcastChannel` 时不得抛出，维持现有 `sessionStorage` 行为。
- ID 探测完成前不得调用 `loadScriptDraft` 或启动草稿自动保存。
- 不新增草稿项目、草稿列表、跨标签同步、用户可见提示或第三方依赖。
- 不覆盖用户已有修改；不创建 Git 提交，除非用户明确要求。

---

## 文件结构

- 创建 `frontend/src/user/pages/scriptDraftTabCoordinator.js`：纯协调器，管理消息协议、占用响应、超时和清理。
- 修改 `frontend/src/user/pages/ScriptPage.jsx`：等待探测结果后初始化草稿恢复与自动保存。
- 创建 `tests/script-duplicated-tab-draft-split.test.js`：以伪 BroadcastChannel 验证复制页拆分、正常页保留、降级与清理。
- 修改 `tests/script-draft-persistence-contract.test.js`：验证页面将草稿初始化延后到探测完成后，且历史调用边界不变。

### Task 1: 创建可测试的复制标签页协调器

**Files:**
- Create: `frontend/src/user/pages/scriptDraftTabCoordinator.js`
- Create: `tests/script-duplicated-tab-draft-split.test.js`

**Interfaces:**
- Produces: `resolveScriptDraftTabId({ tabId, createTabId, setTabId, BroadcastChannelClass, timeoutMs })`，返回 `Promise<{ tabId: string, split: boolean }>`。
- Consumes: 当前页 tab ID、生成新 ID 函数、当前页 sessionStorage 写入函数、原生或伪造 `BroadcastChannel` 构造器。

- [ ] **Step 1: 写入“复制标签页自动拆分”失败测试**

在测试中实现 `FakeBroadcastChannel`：同频道实例收集到静态数组；`postMessage(message)` 向其它未关闭实例调用 `onmessage({ data: message })`；`close()` 标记关闭。创建原页协调器后不关闭，再启动复制页协调器：

```js
test('splits a duplicated script tab while preserving the original tab id', async () => {
  const original = resolveScriptDraftTabId({
    tabId: 'tab-original', createTabId: () => 'unused', setTabId: () => {},
    BroadcastChannelClass: FakeBroadcastChannel, timeoutMs: 0
  });
  const writes = [];
  const duplicate = await resolveScriptDraftTabId({
    tabId: 'tab-original', createTabId: () => 'tab-copy', setTabId: id => writes.push(id),
    BroadcastChannelClass: FakeBroadcastChannel, timeoutMs: 0
  });
  assert.deepEqual(duplicate, { tabId: 'tab-copy', split: true });
  assert.deepEqual(writes, ['tab-copy']);
  await original.cleanup();
});
```

调整协调器接口以便第一个调用能先保持频道监听：返回 promise 对象或拆分为 `startScriptDraftTabCoordination()`，但最终 API 必须允许测试在原页面持续监听、复制页完成探测、再明确清理原页面。

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/script-duplicated-tab-draft-split.test.js`

Expected: FAIL，协调器模块不存在。

- [ ] **Step 3: 实现协调器协议**

实现更适合 React 与测试的 API：

```js
export function startScriptDraftTabCoordination({ tabId, createTabId, setTabId, BroadcastChannelClass = globalThis.BroadcastChannel, timeoutMs = 80 }) {
  return { ready: Promise<{ tabId, split }>, cleanup: () => void };
}
```

规则：

1. 没有 `tabId` 或 `BroadcastChannelClass` 不是函数时，`ready` 立即 resolve `{ tabId, split: false }`，`cleanup` 空操作；
2. 建立频道 `new BroadcastChannelClass('qiantie:script-draft-tabs')`；构造抛错时同样安全降级；
3. 接收到 `{ type: 'probe', tabId: sameId, instanceId: otherId }` 且 `otherId !== instanceId` 时回复 `{ type: 'occupied', tabId: sameId, instanceId: otherId }`；
4. 启动后发送自身 probe；在 `timeoutMs` 后结算：收到对应 `occupied` 则调用 `createTabId()`、`setTabId(nextId)`，resolve `{ tabId: nextId, split: true }`；否则 resolve `{ tabId, split: false }`；
5. 结算后保留频道监听，直到 `cleanup()`，使原页面能响应后续复制页的 probe；
6. `cleanup()` 必须清除 timer、设置 `onmessage = null` 并调用 `channel.close()`，重复调用安全；
7. 忽略非对象、未知 type、tabId 不同或 instanceId 不匹配的消息。

每个页面生成 `instanceId`：优先 `crypto.randomUUID()`，异常时使用 `instance-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`。

- [ ] **Step 4: 添加正常页与降级测试并运行通过**

```js
test('keeps the tab id when no existing page reports it occupied', async () => {
  const result = await startScriptDraftTabCoordination({ tabId: 'tab-a', createTabId: () => 'tab-b', setTabId: () => assert.fail(), BroadcastChannelClass: FakeBroadcastChannel, timeoutMs: 0 }).ready;
  assert.deepEqual(result, { tabId: 'tab-a', split: false });
});

test('degrades without BroadcastChannel support', async () => {
  const coordinator = startScriptDraftTabCoordination({ tabId: 'tab-a', createTabId: () => 'tab-b', setTabId: () => assert.fail(), BroadcastChannelClass: undefined });
  assert.deepEqual(await coordinator.ready, { tabId: 'tab-a', split: false });
  coordinator.cleanup();
});
```

Run: `node --test tests/script-duplicated-tab-draft-split.test.js`

Expected: PASS。

### Task 2: 在 ScriptPage 延迟草稿初始化至探测完成

**Files:**
- Modify: `frontend/src/user/pages/ScriptPage.jsx`
- Modify: `tests/script-draft-persistence-contract.test.js`

**Interfaces:**
- Consumes: `startScriptDraftTabCoordination()`，`getScriptDraftTabId()`，现有 `loadScriptDraft()`、`saveScriptDraft()`。
- Produces: 仅在当前 tab ID 协调完成后执行的草稿恢复、草稿 ready 状态和页面卸载清理。

- [ ] **Step 1: 写入页面生命周期合约失败测试**

增加断言：

```js
assert.match(page, /startScriptDraftTabCoordination/);
assert.match(page, /draftTabReady/);
assert.match(page, /coordinator\.ready\.then/);
assert.match(page, /coordinator\.cleanup\(\)/);
assert.match(page, /if \(!draftTabReady\) return;/);
```

保留对 `getScriptDraftTabId`、三参数读写调用和 `saveHistory` 不包含 tab ID 的断言。

- [ ] **Step 2: 运行合约测试确认失败**

Run: `node --test tests/script-draft-persistence-contract.test.js`

Expected: FAIL，页面未使用协调器和 ready 状态。

- [ ] **Step 3: 接入协调器与延迟恢复**

在 ScriptPage：

1. 导入 `startScriptDraftTabCoordination`；
2. 新增 `const [draftTabReady, setDraftTabReady] = useState(false)`；
3. 将当前“加载草稿、启动 readyTimer、设置 draftReadyRef”的 `useEffect` 改为先创建协调器：

```js
const coordinator = startScriptDraftTabCoordination({
  tabId: draftTabIdRef.current,
  createTabId: () => getScriptDraftTabId({ getItem: () => null, setItem: (_, id) => window.sessionStorage.setItem('qiantie:script-draft-tab-id', id) }),
  setTabId: id => { draftTabIdRef.current = id; }
});
coordinator.ready.then(() => {
  if (!active) return;
  setDraftTabReady(true);
  // 在这里执行原有 loadScriptDraft、状态恢复、readyTimer 与首次 persistDraft。
});
return () => { active = false; coordinator.cleanup(); /* 原有 readyTimer 清理 */ };
```

为避免把 sessionStorage 键常量暴露在 ScriptPage，Task 1 应同时从 `scriptDraftStorage.js` 导出 `replaceScriptDraftTabId(sessionStorageLike, nextId)`，该函数只写 `tabStorageKey` 并返回 `nextId`；`createScriptDraftTabId()` 从 Task 1 协调器内部生成，或由 `scriptDraftStorage.js` 导出。最终 ScriptPage 调用必须不重复键字符串。

4. `persistDraft()` 开头改为：

```js
if (!draftReadyRef.current || !draftTabReady) return;
```

5. 原有与草稿状态相关的自动保存 effect 依赖数组包含 `draftTabReady`；页面卸载仍调用 `persistDraft()`，协调器清理在同一 effect cleanup 中完成；
6. 未收到占用响应时，保持已有 ID；收到占用响应后，任何 `loadScriptDraft`、首次 persist、后续保存均使用替换后的 `draftTabIdRef.current`；
7. 不修改 history 调用或任何生成请求。

- [ ] **Step 4: 运行页面与协调器测试**

Run:

```powershell
node --test tests/script-duplicated-tab-draft-split.test.js tests/script-tab-isolated-drafts.test.js tests/script-draft-persistence-contract.test.js
```

Expected: PASS。

### Task 3: 回归、构建与手工复现验证

**Files:**
- Test: `tests/script-duplicated-tab-draft-split.test.js`
- Test: `tests/script-tab-isolated-drafts.test.js`
- Test: `tests/script-draft-persistence-contract.test.js`
- Test: `tests/script-entity-management.test.js`
- Test: `tests/script-entity-ui-contract.test.js`
- Test: `tests/script-entity-enrichment.test.js`
- Test: `tests/script-protagonist-generation-contract.test.js`

**Interfaces:**
- Consumes: 标签协调器与接入后的 ScriptPage。
- Produces: 通过验证的复制标签页自动草稿拆分功能。

- [ ] **Step 1: 运行完整剧本相关测试**

Run:

```powershell
node --test tests/script-duplicated-tab-draft-split.test.js tests/script-tab-isolated-drafts.test.js tests/script-draft-persistence-contract.test.js tests/script-entity-management.test.js tests/script-entity-ui-contract.test.js tests/script-entity-enrichment.test.js tests/script-protagonist-generation-contract.test.js
```

Expected: PASS。

- [ ] **Step 2: 运行前端生产构建**

Run: `npm run build`

Working directory: `frontend`

Expected: Vite build 成功；仅记录既有 bundle 体积警告。

- [ ] **Step 3: 手工验证复制标签页**

1. 在剧本标签 A 输入“小说 A”，等待自动保存；
2. 使用浏览器“复制标签页”创建 B；
3. 等待 B 加载完成，在 B 填写“小说 B”；
4. 在 A 刷新，确认仍是“小说 A”；在 B 刷新，确认仍是“小说 B”；
5. 在 A 通过导航离开再返回 `/script`，确认仍是“小说 A”；
6. 分别生成一次，确认历史存在两条记录，且 `saveHistory` 无标签页字段；
7. 在不支持 BroadcastChannel 的模拟环境中，确认页面不崩溃且仍采用 sessionStorage 行为。

- [ ] **Step 4: 检查变更范围**

Run:

```powershell
git diff --check
git status --short
git diff --stat
```

Expected: `git diff --check` 无输出；修改只涉及协调器、ScriptPage、对应测试及该设计/计划文档。不得创建提交，除非用户明确要求。
