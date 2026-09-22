# H3 Workflow ID Switch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让管理员只修改 AutoDL H3 工作流 ID，就能在现有剧本视频流程中切换工作流。

**Architecture:** 在统一模型目录的 H3 平台预设记录中保存受校验的 `workflowId`。H3 适配器以该 ID 构造 AutoDL 路径并按 no-image 工作流清理参考图；前端配置页编辑并保存该字段，剧本页继续使用同一个模型选择器和服务端凭据边界。

**Tech Stack:** Node.js CommonJS、Express、React、Ant Design、Node test runner、Vite。

**Spec:** `docs/superpowers/specs/2026-09-21-h3-workflow-switch.md`

## Global Constraints

- 不修改 master、V78、数据库、Nginx、Browser Worker 或线上服务。
- 不把 API Key、Token、Base URL 或工作流脚本返回给前端。
- 不执行真实 AutoDL 生成或扣费 E2E。
- 保持现有 H3 任务前缀、轮询、结果解析和非 H3 视频模型行为。

## Review Focus

- 切换到 no_pic 后参考图不得发送；由 Task 1 测试覆盖。
- 空/非法工作流 ID 不得绕过服务端安全边界；由 Task 1 和 Task 2 测试覆盖。
- 保存配置后公开模型不能泄露凭据；由 Task 2 测试覆盖。
- 旧 H3 请求在未配置新字段时仍可构造；由 Task 1 回归测试覆盖。
- 配置页保存后再次加载能显示工作流 ID；由 Task 3 静态契约覆盖。

### Task 1: H3 目录与适配器支持可配置工作流

**Files:**
- Modify: `lib/video-model-catalog.js`
- Modify: `lib/h3-video-adapter.js`
- Test: `test/h3-workflow-switch.test.js`

**Interfaces:**
- Produces `normalizeH3WorkflowId(value)`, `buildH3SubmitPayload({ prompt, duration, resolution, referenceImages })` compatibility, and `buildH3Request({ workflowId, ... })`.

- [ ] 写失败测试：合法 ID 被保留、非法 ID 抛错、no_pic 不带参考图、默认 ID 仍可构造。
- [ ] 运行 `node --test test/h3-workflow-switch.test.js`，确认因新接口缺失而失败。
- [ ] 最小实现工作流 ID 校验、可配置路径和 no_pic 参考图清理。
- [ ] 重跑该测试，确认通过。

### Task 2: 统一模型目录和配置 API 持久化 workflowId

**Files:**
- Modify: `lib/model-catalog.js`
- Modify: `routes/script-video.js`
- Modify: `routes/batch-factory-v11.js`
- Test: `test/h3-workflow-config.test.js`

**Interfaces:**
- `normalizeCatalogRecord` / `publicModel` 保留已校验的 `workflowId`，不改变 credential 脱敏。
- H3 路由从运行时配置读取工作流 ID并传给 `buildH3Request`。

- [ ] 写失败测试：保存/标准化 workflowId、H3 路由使用配置 ID、no_pic 不发送图像字段。
- [ ] 运行测试并确认失败。
- [ ] 实现模型目录保留字段和路由接线；保留环境变量 API Key 回退。
- [ ] 重跑测试确认通过。

### Task 3: API 配置页展示和保存 H3 工作流 ID

**Files:**
- Modify: `frontend/src/user/pages/ApiConfigPage.jsx`
- Test: `test/h3-workflow-ui.test.js`

- [ ] 写静态契约测试，要求 H3 预设有工作流 ID输入、初始化已有值、保存 payload包含字段。
- [ ] 运行测试确认失败。
- [ ] 增加受控输入状态和保存字段，保持现有布局与 API Key 行为。
- [ ] 重跑静态测试确认通过。

### Task 4: 回归验证

**Files:**
- Test: existing H3 and script video suites

- [ ] 运行 `node --test test/h3-workflow-switch.test.js test/h3-workflow-config.test.js test/h3-workflow-ui.test.js`。
- [ ] 运行 `node --test test/script-video*.test.js test/h3-api-contract-v88.test.js`，记录已有基线失败而不扩大范围。
- [ ] 运行 `npm run frontend:build`。
- [ ] 运行 `git diff --check`，确认无空白错误。
