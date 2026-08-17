# 设置页提示音音量控制 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户能按账号调整剧本提示音音量，并立即应用到成功音和警示音。

**Architecture:** 在通知配置增加整数百分比 `soundVolume`，服务端统一规范化为 0 至 100，旧配置默认 60。设置页用 Ant Design Slider 编辑并通过已有通知更新事件同步到剧本页；声音模块将既有最大增益 0.12 按百分比缩放。

**Tech Stack:** React、Ant Design、Express、Node.js 内置测试、Web Audio API、Vite。

## Global Constraints

- `soundVolume` 的范围为 0 至 100，默认 60，步长 1。
- 提示音关闭时滑块置灰，保存值不重置；调节滑块不自动播放声音。
- 实际音频增益严格为 `0.12 × soundVolume / 100`。
- 音量为 0 时不创建或播放声音。
- 成功音与警示音使用同一个音量；现有 Web Audio 静默降级不得改变。
- 不新增依赖、接口或音频文件。

---

### Task 1: 通知音量配置与声音增益

**Files:**
- Modify: `lib/shared.js`
- Modify: `routes/config.js`
- Modify: `frontend/src/shared/notifications/taskSound.js`
- Modify: `tests/notification-settings.test.js`
- Modify: `tests/task-sound.test.js`

**Interfaces:**
- Produces: `notifications.soundVolume`，整数且范围 0 至 100。
- Changes: `playTaskSound(kind, enabled = true, volume = 60)`。

- [ ] **Step 1: 写入失败测试**

在通知配置测试增加：

```js
assert.equal(initial.body.notifications.soundVolume, 60);
assert.equal((await save({ soundVolume: 100 })).body.notifications.soundVolume, 100);
assert.equal((await save({ soundVolume: -1 })).body.notifications.soundVolume, 0);
assert.equal((await save({ soundVolume: 200 })).body.notifications.soundVolume, 100);
```

在声音测试增加：

```js
playTaskSound('success', true, 50);
assert.ok(gainValues.includes(0.06));
calls.length = 0;
playTaskSound('warning', true, 0);
assert.deepEqual(calls, []);
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/notification-settings.test.js tests/task-sound.test.js`

Expected: FAIL，因为尚无 `soundVolume` 与第三个声音参数。

- [ ] **Step 3: 最小实现配置规范化和增益**

在默认通知配置添加 `soundVolume: 60`。在 `normalizeNotifications` 中使用：

```js
const volume = Number(value?.soundVolume);
const fallbackVolume = Number(fallback.soundVolume);
soundVolume: Number.isFinite(volume) ? Math.min(100, Math.max(0, Math.round(volume))) : (Number.isFinite(fallbackVolume) ? Math.min(100, Math.max(0, Math.round(fallbackVolume))) : 60)
```

将声音函数第三参数默认设为 60，先将其限制为 0 至 100 的整数；当结果为 0 时返回；将既有 `0.12` 替换为 `0.12 * normalizedVolume / 100`。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/notification-settings.test.js tests/task-sound.test.js`

Expected: PASS。

### Task 2: 设置滑块与剧本页即时同步

**Files:**
- Modify: `frontend/src/user/pages/SettingsPage.jsx`
- Modify: `frontend/src/user/pages/ScriptPage.jsx`
- Modify: `tests/notification-settings-ui-contract.test.js`
- Modify: `tests/script-task-sound-contract.test.js`

**Interfaces:**
- Consumes: `notifications.soundVolume` 和 `qiantie:notifications-updated` 的 `detail.soundVolume`。
- Produces: 设置页提交与事件的完整通知对象包含 `soundVolume`。

- [ ] **Step 1: 写入失败测试**

设置页测试增加：

```js
assert.match(settings, /import \{[^}]*Slider/);
assert.match(settings, /name="soundVolume"/);
assert.match(settings, /min=\{0\}/);
assert.match(settings, /max=\{100\}/);
assert.match(settings, /step=\{1\}/);
assert.match(settings, /disabled=\{!soundEnabled\}/);
```

剧本页测试增加：

```js
assert.match(page, /const \[soundVolume, setSoundVolume\] = useState\(60\)/);
assert.match(page, /setSoundVolume\(event\.detail\?\.soundVolume/);
assert.match(page, /playTaskSound\('success', soundEnabled, soundVolume\)/);
assert.match(page, /playTaskSound\('warning', soundEnabled, soundVolume\)/);
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/notification-settings-ui-contract.test.js tests/script-task-sound-contract.test.js`

Expected: FAIL，因为界面与同步状态尚未实现。

- [ ] **Step 3: 最小实现设置页**

从 Ant Design 导入 `Slider`。加载配置与初始值增加 `soundVolume`，保存 `notifications` 时增加：

```js
soundVolume: Number.isFinite(values.soundVolume) ? values.soundVolume : 60
```

在提示音开关及其说明后渲染：

```jsx
<Form.Item label="提示音音量" name="soundVolume">
  <Slider min={0} max={100} step={1} disabled={!soundEnabled} tooltip={{ formatter: value => `${value}%` }} />
</Form.Item>
```

使用 `Form.useWatch('soundEnabled', form)` 取得当前开关值，确保关闭时滑块置灰。

- [ ] **Step 4: 最小实现剧本页同步**

增加 `soundVolume` 状态默认 60。配置加载、`qiantie:notifications-updated` 事件均设置规范化后的 0 至 100 音量。所有既有 `playTaskSound` 调用传入第三个参数 `soundVolume`。

- [ ] **Step 5: 运行测试确认通过**

Run: `node --test tests/notification-settings-ui-contract.test.js tests/script-task-sound-contract.test.js`

Expected: PASS。

### Task 3: 全量验证

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

- [ ] **Step 3: 检查改动**

Run: `git diff --check -- lib/shared.js routes/config.js frontend/src/shared/notifications/taskSound.js frontend/src/user/pages/SettingsPage.jsx frontend/src/user/pages/ScriptPage.jsx tests/notification-settings.test.js tests/task-sound.test.js tests/notification-settings-ui-contract.test.js tests/script-task-sound-contract.test.js`

Expected: 无空白错误。
