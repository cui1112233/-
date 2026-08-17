# 设置页通知与宠物开关备注 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在设置页为提示音和 CM 宠物显示开关显示明确的用途说明。

**Architecture:** 仅修改设置页两个已有 `Form.Item` 的展示内容，在开关控件下方使用现有 Ant Design 次要文本组件渲染固定说明。表单字段名、受控属性、配置保存和事件分发均不改动。

**Tech Stack:** React、Ant Design、Node.js 内置测试、Vite。

## Global Constraints

- 不改变提示音或宠物开关的逻辑、默认值、字段名和保存行为。
- 不新增依赖、接口、配置字段或交互。
- 说明文字必须使用以下文案：
  - `用于在剧本人物/场景提取完成、剧本生成完成时提醒；提取或生成失败（如网络、404、鉴权错误）时播放警示音。`
  - `控制右下角 CM 助手是否显示，关闭后可减少界面干扰。`

---

### Task 1: 设置开关说明

**Files:**
- Modify: `frontend/src/user/pages/SettingsPage.jsx:160-165`
- Modify: `tests/notification-settings-ui-contract.test.js`

**Interfaces:**
- 保持 `Form.Item name="soundEnabled" valuePropName="checked"` 与 `Form.Item name="petVisible" valuePropName="checked"` 不变。
- 不新增运行时接口。

- [ ] **Step 1: 写入失败测试**

在 `tests/notification-settings-ui-contract.test.js` 增加：

```js
assert.match(settings, /用于在剧本人物\/场景提取完成、剧本生成完成时提醒；提取或生成失败（如网络、404、鉴权错误）时播放警示音。/);
assert.match(settings, /控制右下角 CM 助手是否显示，关闭后可减少界面干扰。/);
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/notification-settings-ui-contract.test.js`

Expected: FAIL，因为设置页尚未包含说明文案。

- [ ] **Step 3: 最小实现说明文字**

在两个既有 `Form.Item` 内，将单独的 `<Switch />` 包裹在容器中，并在其后使用 `Typography.Text type="secondary"` 显示固定说明。保留现有 `label`、`name` 和 `valuePropName` 属性。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/notification-settings-ui-contract.test.js`

Expected: PASS。

### Task 2: 前端构建验证

**Files:**
- Modify: 仅修复构建发现的问题。

- [ ] **Step 1: 构建前端**

Run: `npm --prefix frontend run build`

Expected: Vite 构建成功。

- [ ] **Step 2: 检查最终改动**

Run: `git diff --check -- frontend/src/user/pages/SettingsPage.jsx tests/notification-settings-ui-contract.test.js`

Expected: 无空白错误。
