# 剧本通知音与 CM 显示开关 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为剧本提取和生成结果提供可关闭的成功/警示提示音，并增加按账号保存的 CM 显示开关。

**Architecture:** 用户配置新增 `notifications.soundEnabled` 和 `notifications.petVisible`，服务端为旧配置自动回填默认值。浏览器端使用独立 Web Audio 模块合成声音；剧本页仅在提取/生成成功或失败分支调用该模块；共享布局根据配置决定是否挂载宠物，并响应设置保存事件即时更新。

**Tech Stack:** React、Ant Design、Express、Node.js 内置测试、Web Audio API、Vite。

## Global Constraints

- 不新增第三方依赖或外部音频资源。
- 两个开关默认开启且按账号保存。
- 提示音仅用于剧本页提取、重新提取、生成的成功和失败结果。
- 404、鉴权、网络和上游错误只要进入失败分支均使用同一警示音。
- Web Audio 不可用或被浏览器阻止时必须静默，不影响原有请求、文字提示或宠物状态。
- API Key 不得出现在公开配置响应中。

---

## 文件结构

- 修改 `lib/shared.js`：提供默认通知配置并在读取旧用户配置时补齐。
- 修改 `routes/config.js`：规范化通知配置并持久化。
- 创建 `frontend/src/shared/notifications/taskSound.js`：合成成功和警示音的无副作用入口。
- 修改 `frontend/src/user/pages/ScriptPage.jsx`：在规定的异步结果分支触发声音。
- 修改 `frontend/src/user/pages/SettingsPage.jsx`：显示并保存两个设置开关，通知布局刷新宠物显示。
- 修改 `frontend/src/shared/layouts/UserLayout.jsx`：读取通知配置并按开关挂载宠物。
- 创建/修改 Node 测试：覆盖配置契约、声音模块契约、剧本分支和布局/设置契约。

### Task 1: 账号通知配置

**Files:**
- Modify: `lib/shared.js:24-42,159-180`
- Modify: `routes/config.js:21-59`
- Test: `tests/notification-settings.test.js`

**Interfaces:**
- Produces: 公开配置字段 `notifications: { soundEnabled: boolean, petVisible: boolean }`。
- Consumes: `readConfig(username)` 与 `writeConfig(username, config)`。

- [ ] **Step 1: 写入失败测试**

```js
test('config returns and persists default notification settings', async () => {
  const initial = await request(app, { requestPath: '/api/config', token });
  assert.deepEqual(initial.body.notifications, { soundEnabled: true, petVisible: true });

  const saved = await request(app, {
    method: 'POST',
    requestPath: '/api/config',
    token,
    body: { provider: 'openai', baseUrl: 'https://example.test/v1', model: 'test', notifications: { soundEnabled: false, petVisible: false } }
  });
  assert.deepEqual(saved.body.notifications, { soundEnabled: false, petVisible: false });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/notification-settings.test.js`

Expected: FAIL，因为响应尚未包含 `notifications`。

- [ ] **Step 3: 最小实现默认值与规范化**

在 `DEFAULT_CONFIG` 添加：

```js
notifications: { soundEnabled: true, petVisible: true }
```

在配置路由增加：

```js
function normalizeNotifications(value, fallback = {}) {
  return {
    soundEnabled: typeof value?.soundEnabled === 'boolean' ? value.soundEnabled : (fallback.soundEnabled ?? true),
    petVisible: typeof value?.petVisible === 'boolean' ? value.petVisible : (fallback.petVisible ?? true)
  };
}
```

GET 返回前规范化；POST 保存时写入 `notifications: normalizeNotifications(body.notifications, oldConfig.notifications)`。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/notification-settings.test.js`

Expected: PASS。

### Task 2: Web Audio 提示音模块

**Files:**
- Create: `frontend/src/shared/notifications/taskSound.js`
- Test: `tests/task-sound.test.js`

**Interfaces:**
- Produces: `playTaskSound(kind, enabled = true)`，其中 `kind` 为 `'success' | 'warning'`。
- Consumes: 浏览器 `AudioContext` 或 `webkitAudioContext`；不接受也不保存配置对象。

- [ ] **Step 1: 写入失败测试**

```js
test('task sound creates ascending success tones and descending warning tones only when enabled', async () => {
  const { playTaskSound } = await import('../frontend/src/shared/notifications/taskSound.js');
  const calls = [];
  globalThis.AudioContext = class {
    constructor() { this.currentTime = 0; this.destination = {}; }
    createOscillator() { return { frequency: { setValueAtTime(value) { calls.push(value); } }, connect() {}, start() {}, stop() {} }; }
    createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
  };
  playTaskSound('success', true);
  assert.deepEqual(calls, [660, 880]);
  calls.length = 0;
  playTaskSound('warning', false);
  assert.deepEqual(calls, []);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/task-sound.test.js`

Expected: FAIL，因为模块不存在。

- [ ] **Step 3: 最小实现声音入口**

实现 `playTaskSound`：配置关闭时直接返回；获取 `AudioContext || webkitAudioContext`，不可用或任何 Web Audio 操作抛错时吞掉异常；成功频率 `[660, 880]`，警示频率 `[440, 300]`，每段使用短暂振荡器与增益淡出。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/task-sound.test.js`

Expected: PASS。

### Task 3: 设置页和共享布局

**Files:**
- Modify: `frontend/src/user/pages/SettingsPage.jsx:1-177`
- Modify: `frontend/src/shared/layouts/UserLayout.jsx`
- Test: `tests/notification-settings-ui-contract.test.js`

**Interfaces:**
- Consumes: `config.notifications.soundEnabled`、`config.notifications.petVisible`。
- Produces: 保存后派发 `qiantie:notifications-updated`，detail 为完整通知配置。

- [ ] **Step 1: 写入失败测试**

```js
test('settings exposes notification and CM visibility switches and layout follows pet visibility', () => {
  const settings = read('frontend/src/user/pages/SettingsPage.jsx');
  const layout = read('frontend/src/shared/layouts/UserLayout.jsx');
  assert.match(settings, /name="soundEnabled"/);
  assert.match(settings, /name="petVisible"/);
  assert.match(settings, /qiantie:notifications-updated/);
  assert.match(layout, /qiantie:notifications-updated/);
  assert.match(layout, /petVisible.*<StackyPet/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/notification-settings-ui-contract.test.js`

Expected: FAIL，因为尚无两个开关及事件。

- [ ] **Step 3: 在设置页增加开关与保存事件**

从 Ant Design 导入 `Switch`；加载配置时给表单写入 `soundEnabled`、`petVisible`；在“模型与助手”区增加两个 `Form.Item` 开关；保存请求加入：

```js
notifications: { soundEnabled: values.soundEnabled !== false, petVisible: values.petVisible !== false }
```

保存成功后派发：

```js
window.dispatchEvent(new CustomEvent('qiantie:notifications-updated', { detail: saved.notifications }));
```

- [ ] **Step 4: 在共享布局按开关挂载宠物**

布局初始化读取 `getConfig()`，维护 `petVisible` 状态，订阅 `qiantie:notifications-updated` 并在事件发生时更新。将现有 `StackyPet` 渲染包裹为：

```jsx
{isLoggedIn && pathname !== '/' && petVisible ? <StackyPet /> : null}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `node --test tests/notification-settings-ui-contract.test.js`

Expected: PASS。

### Task 4: 剧本结果提示音集成

**Files:**
- Modify: `frontend/src/user/pages/ScriptPage.jsx:385-478`
- Test: `tests/script-task-sound-contract.test.js`

**Interfaces:**
- Consumes: `playTaskSound(kind, enabled)` 和当前 `getConfig()` 加载的 `notifications.soundEnabled`。
- Produces: 每次提取、重新提取、生成的完成/失败分支仅调用一次对应声音。

- [ ] **Step 1: 写入失败测试**

```js
test('script workflow plays success and warning sounds only at extraction and generation outcomes', () => {
  const page = read('frontend/src/user/pages/ScriptPage.jsx');
  assert.match(page, /playTaskSound\('success'/);
  assert.match(page, /playTaskSound\('warning'/);
  assert.match(page, /已提取[\s\S]*?playTaskSound\('success'/);
  assert.match(page, /人物与场景提取失败[\s\S]*?playTaskSound\('warning'/);
  assert.match(page, /生成完成[\s\S]*?playTaskSound\('success'/);
  assert.match(page, /剧本生成失败[\s\S]*?playTaskSound\('warning'/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/script-task-sound-contract.test.js`

Expected: FAIL，因为剧本页尚未引用声音模块。

- [ ] **Step 3: 最小集成**

剧本页加载配置后维护 `soundEnabled`；导入 `playTaskSound`。在提取、重新提取、生成的既有成功分支 `message.success` 后调用 `playTaskSound('success', soundEnabled)`；在对应 `message.error` 后调用 `playTaskSound('warning', soundEnabled)`。不改动其他消息分支。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/script-task-sound-contract.test.js`

Expected: PASS。

### Task 5: 全量验证

**Files:**
- Modify: 仅修复验证发现的问题。

- [ ] **Step 1: 运行定向测试**

Run:

```powershell
node --test tests/notification-settings.test.js tests/task-sound.test.js tests/notification-settings-ui-contract.test.js tests/script-task-sound-contract.test.js
```

Expected: 所有测试通过。

- [ ] **Step 2: 构建前端**

Run: `npm --prefix frontend run build`

Expected: Vite 构建成功。

- [ ] **Step 3: 浏览器验收**

登录后打开 `/settings`：关闭“显示 CM 宠物”并保存，确认 CM 立即隐藏；重新开启确认恢复。关闭“提示音”后进入 `/script`，完成提取或生成时无声音但仍显示文字成功提示；开启后成功与失败请求分别播放不同短音。
