# 暗色星空主题与聊天式输入框 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 qiantie 的所有暗色页面增加低亮度流动星空，并将剧本原文输入框升级为聊天式视觉，同时保持现有生成行为。

**Architecture:** 使用 CSS 伪元素实现全局星空和导航局部纹理，不新增运行时动画脚本。剧本页保留 Ant Design `Form.Item name="novelText"` 作为表单数据边界，仅包装输入区域和操作栏；提交按钮继续触发原有 `onFinish`。

**Tech Stack:** React, Ant Design, Vite, CSS custom properties, in-app Browser。

---

### Task 1: Add dark-theme star layers

**Files:**
- Modify: `frontend/src/shared/styles/global.css`

- [ ] **Step 1: Add non-interactive global layers**

Add `body::before` and `body::after` only for dark theme, with low-opacity radial star patterns, fixed positioning, `pointer-events: none`, and slow translate animations. Put content above them with a positioned stacking context.

- [ ] **Step 2: Add motion accessibility fallback**

Under `@media (prefers-reduced-motion: reduce)`, set the star layer animations to `none` and disable transition-heavy star effects.

- [ ] **Step 3: Add navigation texture**

Add a dark-theme-only `.legacy-sidebar::after` overlay with a lower-density pattern and `pointer-events: none`; keep the sidebar content at a higher stacking level.

### Task 2: Convert script input to chat-style layout

**Files:**
- Modify: `frontend/src/user/pages/ScriptPage.jsx`
- Modify: `frontend/src/shared/styles/global.css`

- [ ] **Step 1: Preserve form binding and replace visual wrapper**

Keep `Form.Item name="novelText"` and its required rule. Wrap the existing `Input.TextArea` in `.script-chat-input` and place a `.script-chat-options` footer within the same visual container.

- [ ] **Step 2: Keep auxiliary controls honest**

Use buttons with `type="button"` and accessible labels. They should show a small informational message such as `当前版本暂未接入附件` instead of pretending to upload or analyze data. The submit action must remain the existing primary form button.

- [ ] **Step 3: Style responsive states**

Add the dark gradient border, transparent textarea, compact action row, submit-adjacent layout, focus ring, and mobile wrapping. Reuse existing theme variables so the light theme remains readable.

### Task 3: Build and browser verification

**Files:**
- No source changes unless verification finds a defect.

- [ ] **Step 1: Build frontend**

Run `npm --prefix frontend run build`; expect a successful Vite build.

- [ ] **Step 2: Verify current browser page**

Reload `http://127.0.0.1:3000/script`, inspect DOM and console, and capture a screenshot. Confirm the navigation, star layer, input text area, auxiliary buttons, and submit button are visible.

- [ ] **Step 3: Verify theme and input behavior**

Toggle to light theme and confirm the dark-only star layers are hidden. Type into the novel input and confirm the text is retained; click the submit button with empty input and confirm the existing validation appears without a runtime error.

- [ ] **Step 4: Check narrow viewport**

Use a narrow browser viewport and confirm the chat footer wraps without horizontal overflow.

### Task 4: Final review

- [ ] **Step 1: Inspect diff scope**

Run `git diff -- frontend/src/shared/styles/global.css frontend/src/user/pages/ScriptPage.jsx` and verify only the approved visual and behavior changes are included.

- [ ] **Step 2: Report verification evidence**

Report build status, browser status, and any residual limitations such as auxiliary buttons being informational until backend capabilities exist.
