# 视频模型配置 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让个人中心 API 配置页显示并保存 MiniMax H3 视频模型选择，并与现有剧本视频模型目录保持一致。

**Architecture:** 在共享配置规范化层增加安全的 `video.modelKey` 字段；配置页用固定的受支持视频模型目录渲染选择器；服务端公开配置只返回模型标识和配置状态，密钥仍只保留在服务端。

**Tech Stack:** Node.js、Express、React、Ant Design、Node test runner、Vite。

## Global Constraints

- 不改变数据库表结构。
- 不返回或打印 API Key。
- H3 标识使用 `minimax-h3-video`，显示名为 `MiniMax H3 多图生视频`。
- 不创建 `.github/workflows`，不通过 GitHub Actions 编译。

---

### Task 1: 配置契约

**Files:**
- Create: `tests/api-config-video-model.test.js`
- Modify: `lib/shared.js`
- Modify: `routes/config.js`

- [ ] 写测试，覆盖 H3 默认值、保存后的安全读取和无效模型回退。
- [ ] 运行 `node --test tests/api-config-video-model.test.js`，确认因缺少 `modelKey` 行为而失败。
- [ ] 在 `normalizeVideoConfig` 中保留受支持模型标识并默认到 `minimax-h3-video`，保留旧凭据兼容。
- [ ] 运行同一测试并确认通过。

### Task 2: API 配置页

**Files:**
- Modify: `frontend/src/user/pages/ApiConfigPage.jsx`
- Modify: `tests/api-config-video-model.test.js`

- [ ] 先增加静态契约测试，要求表单初始值、保存请求和 H3 文案存在。
- [ ] 运行测试确认前端契约失败。
- [ ] 在视频生成服务卡片增加模型选择器、H3 能力说明，并把 `modelKey` 一并保存。
- [ ] 运行测试确认通过。

### Task 3: 构建与发布

**Files:**
- Modify: `docs/superpowers/plans/2026-09-11-video-model-config.md`

- [ ] 运行相关测试和完整回归测试。
- [ ] 构建前端和 Node 镜像，检查镜像内包含 H3 与配置页资源。
- [ ] 更新公网 Compose 的 Node 镜像，保留旧环境备份。
- [ ] 验证公网 API 配置页面和脚本资源可访问，并确认运行容器使用新镜像。
