# 剧本生成标签页独立草稿 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 按任务逐项执行。步骤使用 checkbox（`- [ ]`）跟踪。

**Goal:** 让同一账号在多个浏览器标签页中编辑剧本时草稿相互隔离，同时让成功生成的结果仍进入同一时间排序的历史记录。

**Architecture:** 在 `sessionStorage` 中创建当前剧本标签页的稳定 ID，并把 `localStorage` 草稿键从账号级扩展为账号与标签页 ID 的组合。`ScriptPage` 在当前标签页 ID 上下文中读写草稿；旧账号级键仅在新标签页没有草稿时迁移一次。历史保存仍沿用既有 `saveHistory()` 调用，不接收标签页 ID。

**Tech Stack:** React、浏览器 `localStorage` / `sessionStorage`、Node 内置 `node:test`。

## Global Constraints

- 仅修改剧本页草稿存储与对应测试；不修改小说面板、后端剧本生成协议、人物/场景智能补全协议和历史数据模型。
- 草稿键必须使用 `qiantie:script-draft:{username}:{tabId}`；`username` 必须经 `encodeURIComponent` 处理。
- 当前标签页刷新后必须保留同一草稿；不同标签页不得读取或覆盖彼此草稿。
- 旧账号级草稿键只能作为当前标签首次无草稿时的初始迁移来源；写入新的标签页草稿后不得再次读取旧键。
- 生成历史不得包含 `tabId`，继续由现有 `saveHistory({ id, mode, format, duration, output })` 保存。
- `sessionStorage` 不可用时使用内存 ID；`localStorage` 不可用时保持当前不持久化行为。
- 不新增项目管理、草稿命名、草稿列表、跨标签同步或关闭页面确认。
- 不新增依赖，不覆盖用户已有修改，不创建 Git 提交，除非用户明确要求。

---

## 文件结构

- 修改 `frontend/src/user/pages/scriptDraftStorage.js`：增加标签页 ID 获取、草稿键构建和旧草稿单次迁移。
- 修改 `frontend/src/user/pages/ScriptPage.jsx`：初始化一个当前标签页 ID，并在所有读写草稿调用中传入它。
- 创建 `tests/script-tab-isolated-drafts.test.js`：使用内存 Storage 测试隔离、刷新稳定、旧草稿迁移和不可用存储降级。
- 修改 `tests/script-draft-persistence-contract.test.js`：将静态合约从账号级草稿更新为标签页隔离草稿，同时保护历史调用边界。

### Task 1: 实现标签页 ID 与隔离草稿键

**Files:**
- Modify: `frontend/src/user/pages/scriptDraftStorage.js`
- Create: `tests/script-tab-isolated-drafts.test.js`

**Interfaces:**
- Produces: `getScriptDraftTabId(sessionStorageLike, random = crypto.randomUUID)`、`loadScriptDraft(storage, username, tabId)`、`saveScriptDraft(storage, username, tabId, draft)`。
- Consumes: 现有 `normalizeDraft()`、`normalizeScriptConstraints()`、`normalizeExtractInfo()` 与 `normalizeExtractionPresetId()`。

- [ ] **Step 1: 写入不同标签页草稿隔离的失败测试**

```js
import { getScriptDraftTabId, loadScriptDraft, saveScriptDraft } from '../frontend/src/user/pages/scriptDraftStorage.js';

test('stores independent drafts for the same user in different tabs', () => {
  const local = memoryStorage();
  const alpha = { values: { novelText: '小说 A' } };
  const beta = { values: { novelText: '小说 B' } };

  assert.equal(saveScriptDraft(local, 'alice', 'tab-a', alpha), true);
  assert.equal(saveScriptDraft(local, 'alice', 'tab-b', beta), true);
  assert.equal(loadScriptDraft(local, 'alice', 'tab-a').values.novelText, '小说 A');
  assert.equal(loadScriptDraft(local, 'alice', 'tab-b').values.novelText, '小说 B');
});
```

测试文件内定义真实行为最小的 `memoryStorage()`：使用 `Map` 实现 `getItem(key)` 与 `setItem(key, value)`。

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/script-tab-isolated-drafts.test.js`

Expected: FAIL，`getScriptDraftTabId` 未导出，或 `saveScriptDraft` 参数仍为旧签名。

- [ ] **Step 3: 实现标签页 ID 与新键**

在 `scriptDraftStorage.js` 定义：

```js
const storagePrefix = 'qiantie:script-draft:';
const tabStorageKey = 'qiantie:script-draft-tab-id';

function usernameKey(username) {
  return `${storagePrefix}${encodeURIComponent(String(username || 'guest'))}`;
}

function tabDraftKey(username, tabId) {
  return `${usernameKey(username)}:${encodeURIComponent(String(tabId || ''))}`;
}
```

实现 `getScriptDraftTabId(sessionStorageLike, random = () => crypto.randomUUID())`：

1. 从 `sessionStorageLike.getItem(tabStorageKey)` 读取已有非空字符串则返回；
2. 否则调用 `random()`，转成非空字符串；若返回空值则使用 `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`；
3. 尝试写入 `sessionStorageLike.setItem(tabStorageKey, id)`；写入抛错时仍返回该 ID；
4. 不读写 `localStorage`，不生成跨页面共享 ID。

把草稿 API 改为：

```js
export function loadScriptDraft(storage, username, tabId) { /* ... */ }
export function saveScriptDraft(storage, username, tabId, draft) { /* ... */ }
```

`tabId` 为空时安全返回 `null` / `false`，不回退写入旧账号级键。

- [ ] **Step 4: 运行隔离测试确认通过**

Run: `node --test tests/script-tab-isolated-drafts.test.js`

Expected: PASS。

### Task 2: 添加旧账号级草稿单次迁移与存储降级测试

**Files:**
- Modify: `frontend/src/user/pages/scriptDraftStorage.js`
- Modify: `tests/script-tab-isolated-drafts.test.js`

**Interfaces:**
- Consumes: Task 1 的 `tabDraftKey()` 和新版 `loadScriptDraft(storage, username, tabId)`。
- Produces: 首次标签页读取旧草稿后写入标签键；标签键存在时只读标签键；不可用 `sessionStorage` 可返回本次内存 ID。

- [ ] **Step 1: 写入旧草稿迁移失败测试**

```js
test('migrates legacy account draft only when this tab has no draft', () => {
  const local = memoryStorage();
  local.setItem('qiantie:script-draft:alice', JSON.stringify(validDraft('旧小说')));

  assert.equal(loadScriptDraft(local, 'alice', 'tab-a').values.novelText, '旧小说');
  assert.equal(loadScriptDraft(local, 'alice', 'tab-a').values.novelText, '旧小说');
  saveScriptDraft(local, 'alice', 'tab-b', validDraft('新小说'));
  assert.equal(loadScriptDraft(local, 'alice', 'tab-b').values.novelText, '新小说');
});
```

`validDraft(novelText)` 必须返回满足当前 `normalizeDraft()` 要求的结构：

```js
({ version: 3, values: { novelText, extractionPreset: 'standard' }, extractInfo: {}, constraints: {} })
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/script-tab-isolated-drafts.test.js`

Expected: FAIL，`loadScriptDraft()` 不读取旧键或未将迁移内容写入标签键。

- [ ] **Step 3: 实现单次迁移**

在 `loadScriptDraft(storage, username, tabId)` 中：

1. 先读 `tabDraftKey(username, tabId)`；存在时解析并返回，不再查看旧键；
2. 标签键不存在时读 `usernameKey(username)`；不存在或无效时返回 `null`；
3. 旧键有效时，调用 `saveScriptDraft(storage, username, tabId, legacyDraft)` 写入新键，再返回归一化草稿；
4. 不删除旧键；若迁移写入失败，仍返回已解析的旧草稿作为当前页初始内容；
5. 任意 Storage 的 `getItem` / `setItem` 异常沿用当前安全返回 `null` / `false`。

- [ ] **Step 4: 写入 sessionStorage 不可用测试并运行通过**

```js
test('returns a usable in-memory tab id when session storage throws', () => {
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.equal(getScriptDraftTabId(broken, () => 'memory-tab'), 'memory-tab');
});
```

Run: `node --test tests/script-tab-isolated-drafts.test.js`

Expected: PASS。

### Task 3: 将 ScriptPage 连接到当前标签页草稿

**Files:**
- Modify: `frontend/src/user/pages/ScriptPage.jsx`
- Modify: `tests/script-draft-persistence-contract.test.js`

**Interfaces:**
- Consumes: `getScriptDraftTabId(window.sessionStorage)`、`loadScriptDraft(window.localStorage, username, tabId)`、`saveScriptDraft(window.localStorage, username, tabId, draft)`。
- Produces: 当前 `ScriptPage` 组件生命期内稳定的 `draftTabIdRef.current`，供首次恢复、自动保存、原文上传保存及 `pagehide` 保存复用。

- [ ] **Step 1: 写入页面静态合约失败测试**

将现有测试名称改为 `script workbench restores and synchronously persists tab-isolated drafts`，增加断言：

```js
assert.match(page, /getScriptDraftTabId/);
assert.match(page, /draftTabIdRef/);
assert.match(page, /getScriptDraftTabId\(window\.sessionStorage\)/);
assert.match(page, /loadScriptDraft\(window\.localStorage, draftUsernameRef\.current, draftTabIdRef\.current\)/);
assert.match(page, /saveScriptDraft\(window\.localStorage, draftUsernameRef\.current, draftTabIdRef\.current,/);
```

保留已有 `pagehide`、`onValuesChange`、`updateOutputDraft` 和同步保存断言。

额外读取 [history API 调用所在的 ScriptPage.jsx](file:///f:/脚本测试/chengming/qiantie/frontend/src/user/pages/ScriptPage.jsx#L463-L471)，断言历史保存对象仅包含 `id`、`mode`、`format`、`formatName`、`duration`、`output`，不包含 `tabId` 或 `draftTabId`。

- [ ] **Step 2: 运行合约测试确认失败**

Run: `node --test tests/script-draft-persistence-contract.test.js`

Expected: FAIL，页面尚未创建 `draftTabIdRef`，读写调用仍为两参数。

- [ ] **Step 3: 修改 ScriptPage 初始化与所有草稿调用**

在现有 ref 初始化区新增：

```js
const draftTabIdRef = useRef(getScriptDraftTabId(window.sessionStorage));
```

将当前页所有草稿读写调用更新为：

```js
loadScriptDraft(window.localStorage, draftUsernameRef.current, draftTabIdRef.current);
saveScriptDraft(window.localStorage, draftUsernameRef.current, draftTabIdRef.current, draft);
```

必须覆盖：

- `persistDraft()`；
- 首次 `useEffect` 中的 `restoredDraft`；
- 首次恢复后的立即保存；
- TXT 上传后的 `persistDraft()`；
- 已存在的 `pagehide` 同步保存。

不得改变 `saveHistory()` 的入参与位置。

- [ ] **Step 4: 运行页面和草稿测试确认通过**

Run:

```powershell
node --test tests/script-tab-isolated-drafts.test.js tests/script-draft-persistence-contract.test.js tests/script-entity-management.test.js
```

Expected: PASS。

### Task 4: 完整回归与多标签页手工验证

**Files:**
- Test: `tests/script-tab-isolated-drafts.test.js`
- Test: `tests/script-draft-persistence-contract.test.js`
- Test: `tests/script-entity-management.test.js`
- Test: `tests/script-entity-ui-contract.test.js`
- Test: `tests/script-entity-enrichment.test.js`
- Test: `tests/script-protagonist-generation-contract.test.js`

**Interfaces:**
- Consumes: 完成的隔离草稿存储、现有剧本实体/智能补全/生成流程。
- Produces: 已验证的多标签页隔离行为，无历史写入回归。

- [ ] **Step 1: 运行剧本相关完整测试集**

Run:

```powershell
node --test tests/script-tab-isolated-drafts.test.js tests/script-draft-persistence-contract.test.js tests/script-entity-management.test.js tests/script-entity-ui-contract.test.js tests/script-entity-enrichment.test.js tests/script-protagonist-generation-contract.test.js
```

Expected: PASS。

- [ ] **Step 2: 执行前端生产构建**

Run: `npm run build`

Working directory: `frontend`

Expected: Vite build 成功。仅记录已有 bundle 体积警告，不将其视为本功能失败。

- [ ] **Step 3: 手工验证同账号双标签页**

1. 打开 `/script`，在标签页 A 输入“小说 A”，添加人物或场景；
2. 复制或新开 `/script` 标签页 B，输入“小说 B”；
3. 在 A 刷新，确认只恢复“小说 A”及 A 的实体；
4. 在 B 刷新，确认只恢复“小说 B”及 B 的实体；
5. 在 A 修改原文/实体后，刷新 B，确认 B 不发生变化；
6. 分别在 A、B 成功生成一次，打开历史页，确认两条记录都存在，时间按实际生成顺序排列；
7. 关闭 B 后重新打开 `/script`，确认不会恢复 B 的临时草稿。

- [ ] **Step 4: 最终变更范围检查**

Run:

```powershell
git diff --check
git status --short
git diff --stat
```

Expected: `git diff --check` 无输出；变更只涉及草稿存储、剧本页面、测试及本设计/计划文档。不得执行 Git 提交，除非用户明确要求。
